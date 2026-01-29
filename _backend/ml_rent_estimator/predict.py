"""
ML Rent Prediction Service
Provides inference API for trained model.
"""

import os
import sys
import json
import pickle
from typing import Dict, Any, Optional

import numpy as np
import pandas as pd

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from features import extract_features, add_market_features, get_feature_names

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(MODEL_DIR, 'model.pkl')
METADATA_PATH = os.path.join(MODEL_DIR, 'model_metadata.json')

# Cache loaded model
_cached_model = None
_cached_metadata = None


def load_model():
    """Load model with caching."""
    global _cached_model, _cached_metadata
    
    if _cached_model is not None:
        return _cached_model, _cached_metadata
    
    if not os.path.exists(MODEL_PATH):
        return None, None
    
    with open(MODEL_PATH, 'rb') as f:
        _cached_model = pickle.load(f)
    
    if os.path.exists(METADATA_PATH):
        with open(METADATA_PATH, 'r') as f:
            _cached_metadata = json.load(f)
    
    return _cached_model, _cached_metadata


def predict_rent(property_data: Dict[str, Any], 
                 hud_rent: Optional[float] = None,
                 return_confidence: bool = True) -> Dict[str, Any]:
    """
    Predict rent for a property using the ML model.
    
    Args:
        property_data: Dict with property features (bedrooms, sqft, etc.)
        hud_rent: Optional HUD FMR rent for the area
        return_confidence: Whether to return confidence interval
        
    Returns:
        Dict with prediction, confidence, and metadata
    """
    model, metadata = load_model()
    
    if model is None:
        return {
            'ml_estimate': None,
            'error': 'Model not trained yet. Run train_model.py first.',
            'fallback': hud_rent
        }
    
    # Extract features
    features = extract_features(property_data)
    
    # Add market features
    features = add_market_features(features, hud_rent=hud_rent)
    
    # Create feature vector in correct order
    feature_names = get_feature_names()
    
    # Add market features to expected list
    extended_features = feature_names + ['hud_fmr', 'has_hud_data', 'median_income', 'rent_to_income_ratio']
    
    # Build feature vector (use only features the model was trained on)
    trained_features = metadata.get('feature_names', feature_names) if metadata else feature_names
    
    X = pd.DataFrame([{
        k: features.get(k, 0) for k in trained_features
    }])
    
    # Handle any missing columns
    for col in trained_features:
        if col not in X.columns:
            X[col] = 0
    
    X = X[trained_features]  # Ensure correct order
    X = X.fillna(0)
    
    # Predict
    prediction = model.predict(X)[0]
    
    # Round to nearest $25
    prediction = round(prediction / 25) * 25
    
    result = {
        'ml_estimate': int(prediction),
        'model_type': metadata.get('model_type', 'unknown') if metadata else 'unknown',
        'model_trained_at': metadata.get('trained_at') if metadata else None
    }
    
    # Add confidence based on model metrics
    if metadata and 'metrics' in metadata:
        test_mape = metadata['metrics'].get('test_mape', 15)
        result['confidence_score'] = max(0.3, min(0.95, (100 - test_mape) / 100))
        result['expected_error_pct'] = round(test_mape, 1)
        
        # Prediction interval
        if return_confidence:
            error_margin = prediction * (test_mape / 100)
            result['prediction_low'] = int(prediction - error_margin)
            result['prediction_high'] = int(prediction + error_margin)
    
    return result


def batch_predict(properties: list[Dict[str, Any]], 
                  hud_rents: Optional[Dict[str, float]] = None) -> list[Dict[str, Any]]:
    """
    Batch prediction for multiple properties.
    
    Args:
        properties: List of property dicts
        hud_rents: Optional dict mapping zip_code to HUD rent
        
    Returns:
        List of prediction results
    """
    results = []
    
    for prop in properties:
        hud_rent = None
        if hud_rents and prop.get('zip_code'):
            hud_rent = hud_rents.get(prop['zip_code'])
        
        result = predict_rent(prop, hud_rent=hud_rent)
        results.append(result)
    
    return results


if __name__ == "__main__":
    # Test prediction
    test_property = {
        'bedrooms': 3,
        'bathrooms': 2,
        'sqft': 1500,
        'year_built': 1995,
        'latitude': 41.4993,
        'longitude': -81.6944,
        'property_type': 'single_family',
        'has_garage': True
    }
    
    print("Testing ML Rent Prediction...")
    print(f"Input: {json.dumps(test_property, indent=2)}")
    
    result = predict_rent(test_property, hud_rent=1350)
    print(f"\nResult: {json.dumps(result, indent=2)}")
