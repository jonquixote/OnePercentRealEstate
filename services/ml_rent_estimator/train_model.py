"""
ML Model Training for Rent Estimation
Trains an XGBoost model on rental listings data.
"""

import os
import sys
import json
import pickle
from datetime import datetime
import pandas as pd
import numpy as np

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client, Client
from dotenv import load_dotenv

# ML imports with graceful fallback
try:
    from xgboost import XGBRegressor
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False
    print("Warning: XGBoost not installed. Using sklearn GradientBoosting instead.")

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error, r2_score

from features import extract_features, prepare_training_data, get_feature_names

# Load environment
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../.env.local')
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(MODEL_DIR, 'model.pkl')
METADATA_PATH = os.path.join(MODEL_DIR, 'model_metadata.json')


def fetch_training_data() -> pd.DataFrame:
    """Fetch rental listings from database for training."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Missing Supabase credentials")
    
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Fetch all rental listings with valid data
    response = supabase.table("rental_listings").select("*").execute()
    
    if not response.data:
        raise ValueError("No rental listings found in database")
    
    df = pd.DataFrame(response.data)
    print(f"Fetched {len(df)} rental listings")
    
    return df


def train_model(df: pd.DataFrame, model_type: str = 'xgboost') -> tuple:
    """
    Train the rent prediction model.
    
    Args:
        df: DataFrame with rental listings
        model_type: 'xgboost', 'gradient_boosting', or 'random_forest'
        
    Returns:
        (model, metrics dict)
    """
    print(f"\nPreparing training data...")
    X, y = prepare_training_data(df)
    print(f"Training samples: {len(X)}")
    print(f"Features: {list(X.columns)}")
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Select model
    if model_type == 'xgboost' and HAS_XGBOOST:
        model = XGBRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            n_jobs=-1
        )
    elif model_type == 'random_forest':
        model = RandomForestRegressor(
            n_estimators=200,
            max_depth=12,
            min_samples_split=5,
            random_state=42,
            n_jobs=-1
        )
    else:
        model = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.8,
            random_state=42
        )
    
    print(f"\nTraining {model_type} model...")
    model.fit(X_train, y_train)
    
    # Evaluate
    y_pred_train = model.predict(X_train)
    y_pred_test = model.predict(X_test)
    
    metrics = {
        'train_mae': mean_absolute_error(y_train, y_pred_train),
        'test_mae': mean_absolute_error(y_test, y_pred_test),
        'train_mape': mean_absolute_percentage_error(y_train, y_pred_train) * 100,
        'test_mape': mean_absolute_percentage_error(y_test, y_pred_test) * 100,
        'train_r2': r2_score(y_train, y_pred_train),
        'test_r2': r2_score(y_test, y_pred_test),
        'training_samples': len(X_train),
        'test_samples': len(X_test)
    }
    
    # Cross-validation
    cv_scores = cross_val_score(model, X, y, cv=5, scoring='neg_mean_absolute_error')
    metrics['cv_mae_mean'] = -cv_scores.mean()
    metrics['cv_mae_std'] = cv_scores.std()
    
    # Feature importance
    if hasattr(model, 'feature_importances_'):
        importance = dict(zip(X.columns, model.feature_importances_))
        metrics['feature_importance'] = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))
    
    return model, metrics


def save_model(model, metrics: dict):
    """Save trained model and metadata."""
    # Save model
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    
    # Save metadata
    metadata = {
        'trained_at': datetime.now().isoformat(),
        'model_type': type(model).__name__,
        'metrics': metrics,
        'feature_names': get_feature_names()
    }
    
    with open(METADATA_PATH, 'w') as f:
        json.dump(metadata, f, indent=2, default=str)
    
    print(f"\nModel saved to {MODEL_PATH}")
    print(f"Metadata saved to {METADATA_PATH}")


def load_model():
    """Load trained model."""
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model not found at {MODEL_PATH}. Run training first.")
    
    with open(MODEL_PATH, 'rb') as f:
        model = pickle.load(f)
    
    metadata = None
    if os.path.exists(METADATA_PATH):
        with open(METADATA_PATH, 'r') as f:
            metadata = json.load(f)
    
    return model, metadata


def run_training():
    """Main training pipeline."""
    print("=" * 60)
    print("ML RENT ESTIMATOR - TRAINING PIPELINE")
    print("=" * 60)
    
    # Fetch data
    df = fetch_training_data()
    
    # Check minimum data requirement
    min_samples = 100
    if len(df) < min_samples:
        print(f"\n⚠️  Warning: Only {len(df)} samples available.")
        print(f"   Recommend at least {min_samples} samples for reliable training.")
        print(f"   Run scrape_rentals_scheduler.py to collect more data.\n")
    
    if len(df) < 20:
        print("❌ Not enough data to train. Need at least 20 samples.")
        return None, None
    
    # Train model
    model, metrics = train_model(df)
    
    # Print results
    print("\n" + "=" * 60)
    print("TRAINING RESULTS")
    print("=" * 60)
    print(f"Test MAE: ${metrics['test_mae']:.2f}")
    print(f"Test MAPE: {metrics['test_mape']:.1f}%")
    print(f"Test R²: {metrics['test_r2']:.3f}")
    print(f"CV MAE: ${metrics['cv_mae_mean']:.2f} (±${metrics['cv_mae_std']:.2f})")
    
    if 'feature_importance' in metrics:
        print("\nTop 5 Features:")
        for i, (feat, imp) in enumerate(list(metrics['feature_importance'].items())[:5]):
            print(f"  {i+1}. {feat}: {imp:.3f}")
    
    # Save model
    save_model(model, metrics)
    
    print("\n✅ Training complete!")
    return model, metrics


if __name__ == "__main__":
    run_training()
