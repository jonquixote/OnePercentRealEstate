"""
Feature Engineering for ML Rent Estimation
Transforms raw property data into ML-ready features.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional


def extract_features(property_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract ML features from a single property.
    
    Returns a dict of features ready for model input.
    """
    features = {}
    
    # Core property features
    features['bedrooms'] = float(property_data.get('bedrooms') or 3)
    features['bathrooms'] = float(property_data.get('bathrooms') or 2)
    features['sqft'] = float(property_data.get('sqft') or 1500)
    features['year_built'] = float(property_data.get('year_built') or 1990)
    
    # Derived features
    features['age'] = 2025 - features['year_built']
    features['sqft_per_bed'] = features['sqft'] / max(features['bedrooms'], 1)
    features['bath_bed_ratio'] = features['bathrooms'] / max(features['bedrooms'], 1)
    
    # Location features
    features['latitude'] = float(property_data.get('latitude') or 0)
    features['longitude'] = float(property_data.get('longitude') or 0)
    
    # Lot size
    lot_sqft = property_data.get('lot_sqft')
    features['lot_sqft'] = float(lot_sqft) if lot_sqft else features['sqft'] * 3
    features['lot_to_sqft_ratio'] = features['lot_sqft'] / max(features['sqft'], 1)
    
    # Binary amenity features
    features['has_garage'] = 1 if property_data.get('parking_garage') else 0
    features['has_ac'] = 1 if property_data.get('has_ac') else 0
    features['has_pool'] = 1 if property_data.get('has_pool') else 0
    features['pet_friendly'] = 1 if property_data.get('pet_friendly') else 0
    
    # Property type encoding
    prop_type = str(property_data.get('property_type', 'single_family')).lower()
    features['is_single_family'] = 1 if 'single' in prop_type or 'house' in prop_type else 0
    features['is_townhouse'] = 1 if 'town' in prop_type else 0
    features['is_condo'] = 1 if 'condo' in prop_type or 'apartment' in prop_type else 0
    features['is_multi_family'] = 1 if 'multi' in prop_type or 'duplex' in prop_type else 0
    
    return features


def prepare_training_data(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """
    Prepare rental listings dataframe for model training.
    
    Args:
        df: DataFrame with rental listings
        
    Returns:
        X (features), y (target rent prices)
    """
    # Filter valid rows
    df = df[df['price'] > 0].copy()
    df = df[df['price'] < 10000]  # Remove outliers
    df = df[df['bedrooms'].notna()]
    
    # Extract features for each row
    feature_list = []
    for _, row in df.iterrows():
        features = extract_features(row.to_dict())
        feature_list.append(features)
    
    X = pd.DataFrame(feature_list)
    y = df['price'].values
    
    # Handle missing values
    X = X.fillna(X.median())
    
    return X, y


def get_feature_names() -> list[str]:
    """Return the list of feature names in order."""
    return [
        'bedrooms', 'bathrooms', 'sqft', 'year_built', 'age',
        'sqft_per_bed', 'bath_bed_ratio', 'latitude', 'longitude',
        'lot_sqft', 'lot_to_sqft_ratio',
        'has_garage', 'has_ac', 'has_pool', 'pet_friendly',
        'is_single_family', 'is_townhouse', 'is_condo', 'is_multi_family'
    ]


def add_market_features(features: Dict[str, Any], hud_rent: Optional[float] = None, 
                        median_income: Optional[float] = None,
                        gis_features: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Add market-level and GIS features to property features.
    """
    features = features.copy()
    
    # HUD benchmark as a feature
    features['hud_fmr'] = float(hud_rent) if hud_rent else 0
    features['has_hud_data'] = 1 if hud_rent else 0
    
    # Census income data
    features['median_income'] = float(median_income) if median_income else 50000
    
    # Income to potential rent ratio (affordability indicator)
    if hud_rent and median_income:
        features['rent_to_income_ratio'] = (hud_rent * 12) / median_income
    else:
        features['rent_to_income_ratio'] = 0.3  # Default 30%
    
    # GIS features (from gis_features.py)
    if gis_features:
        features['distance_to_school'] = gis_features.get('distance_to_school', 2.0)
        features['distance_to_grocery'] = gis_features.get('distance_to_grocery', 2.0)
        features['distance_to_transit'] = gis_features.get('distance_to_transit', 2.0)
        features['distance_to_park'] = gis_features.get('distance_to_park', 2.0)
        features['schools_within_1mi'] = gis_features.get('schools_within_1mi', 0)
        features['transit_stops_within_half_mi'] = gis_features.get('transit_stops_within_half_mi', 0)
        features['restaurants_within_half_mi'] = gis_features.get('restaurants_within_half_mi', 0)
        features['walkability_score'] = gis_features.get('walkability_score', 50)
    else:
        # Default GIS features when not available
        features['distance_to_school'] = 1.0
        features['distance_to_grocery'] = 1.0
        features['distance_to_transit'] = 1.0
        features['distance_to_park'] = 1.0
        features['schools_within_1mi'] = 1
        features['transit_stops_within_half_mi'] = 1
        features['restaurants_within_half_mi'] = 3
        features['walkability_score'] = 50
    
    return features
