import os
import argparse
import json
import math
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print(json.dumps({"error": "Missing Supabase credentials"}))
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 3958.8 # Earth radius in miles
    
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_safmr_rent(zip_code, bedrooms):
    try:
        # Handle float zip codes
        if isinstance(zip_code, float):
            zip_code = str(int(zip_code))
        else:
            zip_code = str(zip_code).split('.')[0]
            
        response = supabase.table("market_benchmarks").select("safmr_data").eq("zip_code", zip_code).execute()
        if response.data:
            safmr = response.data[0].get("safmr_data", {})
            # Handle bedroom keys (0br, 1br, etc.)
            key = f"{int(bedrooms)}br"
            return safmr.get(key)
    except Exception as e:
        print(f"Error fetching SAFMR: {e}")
    return None

def estimate_rent(lat, lon, beds, baths, sqft, year_built=None, zip_code=None, radius=1.5, lookback_days=90):
    # 1. Fetch SAFMR as baseline
    safmr_rent = None
    if zip_code and beds:
        safmr_rent = get_safmr_rent(zip_code, beds)

    # 2. Fetch comps from DB
    query = supabase.table("rental_listings").select("*")
    
    if beds:
        query = query.gte("bedrooms", beds - 1).lte("bedrooms", beds + 1)
        
    response = query.execute()
    candidates = response.data
    
    comps = []
    
    for c in candidates:
        if c.get('latitude') is None or c.get('longitude') is None:
            continue
            
        dist = haversine_distance(lat, lon, c['latitude'], c['longitude'])
        if dist <= radius:
            # Calculate similarity score
            score = 1.0
            
            # Distance decay
            score *= (1 - (dist / radius)) 
            
            # Bed match
            if beds and c['bedrooms'] != beds:
                score *= 0.85
                
            # Bath match
            if baths and c['bathrooms'] and abs(c['bathrooms'] - baths) > 0.5:
                score *= 0.9
                
            # Sqft match
            if sqft and c['sqft']:
                sqft_diff = abs(c['sqft'] - sqft) / sqft
                if sqft_diff > 0.2:
                    score *= 0.9
                if sqft_diff > 0.5:
                    score *= 0.8

            # Year Built match (from raw_data if available)
            c_year = c.get('raw_data', {}).get('year_built')
            if year_built and c_year:
                try:
                    diff = abs(int(c_year) - int(year_built))
                    if diff > 15:
                        score *= 0.9
                    if diff > 30:
                        score *= 0.85
                except:
                    pass
            
            c['distance'] = dist
            c['similarity_score'] = score
            comps.append(c)
            
    # Sort by score
    comps.sort(key=lambda x: x['similarity_score'], reverse=True)
    
    # Take top 10
    top_comps = comps[:10]
    
    if not top_comps:
        # Fallback to SAFMR if available
        if safmr_rent:
             return {
                "estimated_rent": safmr_rent,
                "confidence_score": 0.5, # Low confidence since no comps
                "comps_used": 0,
                "comps": [],
                "safmr_rent": safmr_rent,
                "note": "Estimate based on HUD SAFMR data (no nearby comps found)."
            }
        return None
        
    # Weighted Average
    total_score = sum(c['similarity_score'] for c in top_comps)
    weighted_rent = sum(c['price'] * c['similarity_score'] for c in top_comps) / total_score
    
    return {
        "estimated_rent": round(weighted_rent),
        "confidence_score": min(len(top_comps) / 5.0, 1.0),
        "comps_used": len(top_comps),
        "safmr_rent": safmr_rent,
        "comps": [{
            "address": c['address'],
            "price": c['price'],
            "distance": round(c['distance'], 2),
            "score": round(c['similarity_score'], 2),
            "sqft": c.get('sqft'),
            "beds": c.get('bedrooms'),
            "baths": c.get('bathrooms')
        } for c in top_comps]
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--beds", type=float, required=True)
    parser.add_argument("--baths", type=float)
    parser.add_argument("--sqft", type=float)
    parser.add_argument("--year_built", type=int)
    parser.add_argument("--zip_code", type=str)
    
    args = parser.parse_args()
    
    result = estimate_rent(args.lat, args.lon, args.beds, args.baths, args.sqft, args.year_built, args.zip_code)
    print(json.dumps(result, indent=2))
