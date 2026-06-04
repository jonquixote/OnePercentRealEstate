"""
Rent Estimator v2 - Triangulated Architecture

Implements the weighted triangulation formula from the technical report:
E_R = (w_HUD * R_SAFMR + w_Scrape * R_MedianComps + w_ML * R_Predicted) / w_Total

Sources:
- HUD SAFMR (0.30): Conservative safety floor from federal data
- Scraped Comps (0.50): Market pulse from nearby rental listings
- ML Model (0.20): XGBoost prediction using property + GIS features

Features:
- Property type classification (returns $0 for non-rentable)
- Scam filtering (discards comps >30% below HUD)
- Confidence scoring based on source availability
- Variance check for outlier detection
"""

import os
import sys
import json
import math
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
load_dotenv(dotenv_path=env_path)

# Optional ML imports
try:
    from ml_rent_estimator.predict import predict_rent as ml_predict_rent
    HAS_ML_MODEL = True
except ImportError:
    HAS_ML_MODEL = False
    print("Warning: ML model not available. Will use HUD + Comps only.")


# Database connection
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASS = os.getenv("DB_PASS", "root_password_change_me_please")
    DB_HOST = os.getenv("DB_HOST", "infrastructure-postgres-1")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "postgres")
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


# Non-rentable property types
NON_RENTABLE_TYPES = {
    'LAND', 'LOT', 'LOTS', 'VACANT', 'VACANT_LAND', 'LOTS/LAND',
    'FARM', 'MOBILE_LAND', 'OTHER', 'TIMBERLAND', 'AGRICULTURAL'
}


@dataclass
class RentEstimate:
    """Result of rent estimation with source attribution."""
    estimated_rent: float
    confidence_score: float
    method: str
    
    # Individual source values
    hud_fmr: Optional[float] = None
    comps_median: Optional[float] = None
    ml_prediction: Optional[float] = None
    
    # Metadata
    comp_count: int = 0
    comps: List[Dict] = None
    property_type: Optional[str] = None
    reason: Optional[str] = None
    variance_pct: Optional[float] = None
    weights_used: Optional[Dict[str, float]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'estimated_rent': self.estimated_rent,
            'active_estimate': self.estimated_rent,  # Backwards compat
            'confidence_score': round(self.confidence_score, 2),
            'method': self.method,
            'hud_fmr': self.hud_fmr,
            'comps_avg': self.comps_median,
            'ml_prediction': self.ml_prediction,
            'comp_count': self.comp_count,
            'comps': self.comps or [],
            'property_type': self.property_type,
            'reason': self.reason,
            'variance_pct': self.variance_pct,
            'weights_used': self.weights_used
        }


def get_db_connection():
    """Get database connection."""
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        print(f"Database connection error: {e}")
        return None


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in miles between two points."""
    R = 3958.8  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def is_non_rentable(property_type: Optional[str]) -> bool:
    """Check if property type indicates no rentable structure."""
    if not property_type:
        return False
    
    pt_upper = property_type.upper().strip()
    
    # Check exact match
    if pt_upper in NON_RENTABLE_TYPES:
        return True
    
    # Check partial match
    if any(x in pt_upper for x in ['LAND', 'LOT', 'VACANT']):
        return True
    
    return False


def get_hud_safmr(zip_code: str, bedrooms: int) -> Optional[float]:
    """Fetch HUD SAFMR from market_benchmarks table."""
    conn = get_db_connection()
    if not conn:
        return None
    
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Clean zip code
        if isinstance(zip_code, float):
            zip_code = str(int(zip_code))
        else:
            zip_code = str(zip_code).split('.')[0].strip()
        
        cur.execute("""
            SELECT safmr_data FROM market_benchmarks 
            WHERE zip_code = %s
        """, (zip_code,))
        
        row = cur.fetchone()
        if row and row['safmr_data']:
            key = f"{int(bedrooms)}br"
            return row['safmr_data'].get(key)
            
    except Exception as e:
        print(f"Error fetching HUD SAFMR: {e}")
    finally:
        conn.close()
    
    return None


def get_scraped_comps(
    lat: float, 
    lon: float, 
    bedrooms: int,
    radius_miles: float = 2.0,
    max_comps: int = 15,
    lookback_days: int = 90,
    hud_rent: Optional[float] = None
) -> Tuple[Optional[float], List[Dict], int]:
    """
    Get comparable rentals from rental_listings table.
    
    Returns:
        (median_rent, list of comps, count)
    """
    conn = get_db_connection()
    if not conn:
        return None, [], 0
    
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Query nearby rentals
        cur.execute("""
            SELECT 
                address, price, bedrooms, bathrooms, sqft,
                latitude, longitude, created_at
            FROM rental_listings
            WHERE 
                latitude IS NOT NULL 
                AND longitude IS NOT NULL
                AND price > 0
                AND price < 10000
                AND bedrooms BETWEEN %s AND %s
                AND created_at > NOW() - INTERVAL '%s days'
        """, (max(0, bedrooms - 1), bedrooms + 1, lookback_days))
        
        candidates = cur.fetchall()
        
        comps = []
        for c in candidates:
            dist = haversine_distance(lat, lon, c['latitude'], c['longitude'])
            if dist <= radius_miles:
                # Calculate similarity score
                score = 1.0 * (1 - dist / radius_miles)  # Distance weight
                if c['bedrooms'] == bedrooms:
                    score += 0.25
                else:
                    score += 0.15
                
                comp = {
                    'address': c['address'],
                    'price': float(c['price']),
                    'beds': c['bedrooms'],
                    'baths': c['bathrooms'],
                    'sqft': c['sqft'],
                    'distance': round(dist, 2),
                    'score': round(score, 2)
                }
                
                # Scam filtering: discard if >30% below HUD
                if hud_rent and c['price'] < hud_rent * 0.7:
                    continue  # Skip potential scam listing
                
                comps.append(comp)
        
        # Sort by score and take top comps
        comps.sort(key=lambda x: x['score'], reverse=True)
        top_comps = comps[:max_comps]
        
        if not top_comps:
            return None, [], 0
        
        # Calculate weighted median (by similarity score)
        prices = [c['price'] for c in top_comps]
        prices.sort()
        median_rent = prices[len(prices) // 2]
        
        return median_rent, top_comps, len(top_comps)
        
    except Exception as e:
        print(f"Error fetching comps: {e}")
        return None, [], 0
    finally:
        conn.close()


def get_ml_prediction(property_data: Dict[str, Any], hud_rent: Optional[float] = None) -> Optional[float]:
    """Get ML model prediction if available."""
    if not HAS_ML_MODEL:
        return None
    
    try:
        result = ml_predict_rent(property_data, hud_rent=hud_rent)
        return result.get('ml_estimate')
    except Exception as e:
        print(f"ML prediction error: {e}")
        return None


def calculate_variance(values: List[float]) -> float:
    """Calculate variance percentage between sources."""
    if len(values) < 2:
        return 0.0
    
    mean = sum(values) / len(values)
    if mean == 0:
        return 0.0
    
    max_diff = max(abs(v - mean) for v in values)
    return (max_diff / mean) * 100


def estimate_rent_v2(
    lat: float,
    lon: float,
    bedrooms: int,
    bathrooms: Optional[float] = None,
    sqft: Optional[int] = None,
    zip_code: Optional[str] = None,
    property_type: Optional[str] = None,
    year_built: Optional[int] = None,
    radius_miles: float = 2.0
) -> RentEstimate:
    """
    Triangulated rent estimation using HUD + Scraped Comps + ML.
    
    Base weights:
    - HUD SAFMR: 0.30 (safety floor)
    - Scraped Comps: 0.50 (market pulse)
    - ML Model: 0.20 (arbiter)
    
    Weights adjust based on data availability.
    """
    
    # 1. Check for non-rentable property type
    if is_non_rentable(property_type):
        return RentEstimate(
            estimated_rent=0,
            confidence_score=1.0,
            method='non_rentable_property_type',
            property_type=property_type,
            reason='Property type indicates no rentable structure'
        )
    
    # 2. Get HUD SAFMR (Source A)
    hud_rent = None
    if zip_code and bedrooms:
        hud_rent = get_hud_safmr(zip_code, bedrooms)
    
    # 3. Get Scraped Comps (Source B)
    comps_median, comps, comp_count = get_scraped_comps(
        lat, lon, bedrooms or 3,
        radius_miles=radius_miles,
        hud_rent=hud_rent
    )
    
    # 4. Get ML Prediction (Source C)
    ml_prediction = None
    if HAS_ML_MODEL:
        property_data = {
            'bedrooms': bedrooms,
            'bathrooms': bathrooms,
            'sqft': sqft,
            'year_built': year_built,
            'latitude': lat,
            'longitude': lon,
            'property_type': property_type
        }
        ml_prediction = get_ml_prediction(property_data, hud_rent=hud_rent)
    
    # 5. Calculate weights based on availability
    weights = {}
    sources = {}
    
    if hud_rent and hud_rent > 0:
        weights['hud'] = 0.30
        sources['hud'] = hud_rent
    
    if comps_median and comp_count >= 3:
        weights['comps'] = 0.50
        sources['comps'] = comps_median
    elif comps_median and comp_count >= 1:
        weights['comps'] = 0.30  # Lower weight for few comps
        sources['comps'] = comps_median
    
    if ml_prediction and ml_prediction > 0:
        weights['ml'] = 0.20
        sources['ml'] = ml_prediction
    
    # Dynamic weight adjustment if sources missing
    total_weight = sum(weights.values())
    if total_weight > 0 and total_weight != 1.0:
        # Normalize weights
        for k in weights:
            weights[k] = weights[k] / total_weight
    
    # 6. Calculate triangulated estimate
    if not sources:
        # No data available - return 0 with low confidence
        return RentEstimate(
            estimated_rent=0,
            confidence_score=0.1,
            method='insufficient_data',
            comp_count=0,
            comps=[],
            reason='No HUD, comp, or ML data available'
        )
    
    # Weighted average
    estimated_rent = sum(sources[k] * weights[k] for k in sources)
    
    # 7. Calculate confidence score
    confidence = 0.0
    if 'hud' in sources:
        confidence += 0.25
    if 'comps' in sources:
        confidence += min(0.50, comp_count / 5 * 0.50)  # Max 0.50 with 5+ comps
    if 'ml' in sources:
        confidence += 0.15
    
    # 8. Variance check
    source_values = list(sources.values())
    variance_pct = calculate_variance(source_values)
    
    if variance_pct > 25:
        confidence *= 0.8  # Reduce confidence if sources disagree
    
    # Determine method name
    method_parts = []
    if 'hud' in sources:
        method_parts.append('hud')
    if 'comps' in sources:
        method_parts.append('comps')
    if 'ml' in sources:
        method_parts.append('ml')
    method = 'triangulated_' + '_'.join(method_parts) if len(method_parts) > 1 else method_parts[0] if method_parts else 'unknown'
    
    return RentEstimate(
        estimated_rent=round(estimated_rent),
        confidence_score=min(confidence, 1.0),
        method=method,
        hud_fmr=hud_rent,
        comps_median=comps_median,
        ml_prediction=ml_prediction,
        comp_count=comp_count,
        comps=comps,
        property_type=property_type,
        variance_pct=round(variance_pct, 1) if variance_pct else None,
        weights_used=weights
    )


# CLI interface for testing
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Triangulated Rent Estimator v2")
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--beds", type=int, default=3)
    parser.add_argument("--baths", type=float)
    parser.add_argument("--sqft", type=int)
    parser.add_argument("--zip", type=str)
    parser.add_argument("--property-type", type=str)
    
    args = parser.parse_args()
    
    result = estimate_rent_v2(
        lat=args.lat,
        lon=args.lon,
        bedrooms=args.beds,
        bathrooms=args.baths,
        sqft=args.sqft,
        zip_code=args.zip,
        property_type=args.property_type
    )
    
    print(json.dumps(result.to_dict(), indent=2))
