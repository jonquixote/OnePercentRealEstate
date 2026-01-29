"""
GIS Features for ML Rent Estimation
Uses OpenStreetMap Overpass API (free) to get proximity features.
"""

import os
import sys
import json
import math
import time
from typing import Dict, Any, Optional, List
import requests

# Cache for POI queries (avoid hammering the API)
_poi_cache: Dict[str, Dict] = {}


# Overpass API endpoint (free, no key required)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in miles between two points."""
    R = 3958.8  # Earth radius in miles
    
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def query_overpass(query: str) -> Optional[Dict]:
    """Execute an Overpass API query."""
    try:
        response = requests.post(
            OVERPASS_URL,
            data={'data': query},
            timeout=30
        )
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Overpass API error: {response.status_code}")
            return None
    except Exception as e:
        print(f"Overpass query failed: {e}")
        return None


def get_nearby_pois(lat: float, lon: float, radius_meters: int = 2000) -> Dict[str, List[Dict]]:
    """
    Query OpenStreetMap for nearby points of interest.
    
    Returns dict with keys: schools, grocery, transit, parks, restaurants
    """
    cache_key = f"{round(lat, 3)}_{round(lon, 3)}_{radius_meters}"
    
    if cache_key in _poi_cache:
        return _poi_cache[cache_key]
    
    # Overpass QL query for multiple POI types
    query = f"""
    [out:json][timeout:25];
    (
      // Schools
      node["amenity"="school"](around:{radius_meters},{lat},{lon});
      way["amenity"="school"](around:{radius_meters},{lat},{lon});
      
      // Grocery stores
      node["shop"="supermarket"](around:{radius_meters},{lat},{lon});
      node["shop"="grocery"](around:{radius_meters},{lat},{lon});
      
      // Transit stops
      node["highway"="bus_stop"](around:{radius_meters},{lat},{lon});
      node["railway"="station"](around:{radius_meters},{lat},{lon});
      node["railway"="subway_entrance"](around:{radius_meters},{lat},{lon});
      
      // Parks
      node["leisure"="park"](around:{radius_meters},{lat},{lon});
      way["leisure"="park"](around:{radius_meters},{lat},{lon});
      
      // Restaurants/cafes
      node["amenity"="restaurant"](around:{radius_meters},{lat},{lon});
      node["amenity"="cafe"](around:{radius_meters},{lat},{lon});
    );
    out center;
    """
    
    result = query_overpass(query)
    
    if not result:
        return {}
    
    # Parse results into categories
    pois = {
        'schools': [],
        'grocery': [],
        'transit': [],
        'parks': [],
        'restaurants': []
    }
    
    for element in result.get('elements', []):
        tags = element.get('tags', {})
        
        # Get coordinates (center for ways)
        elem_lat = element.get('lat') or element.get('center', {}).get('lat')
        elem_lon = element.get('lon') or element.get('center', {}).get('lon')
        
        if not elem_lat or not elem_lon:
            continue
        
        distance = haversine_distance(lat, lon, elem_lat, elem_lon)
        
        poi_data = {
            'name': tags.get('name', 'Unknown'),
            'distance_miles': round(distance, 2),
            'lat': elem_lat,
            'lon': elem_lon
        }
        
        # Categorize
        if tags.get('amenity') == 'school':
            pois['schools'].append(poi_data)
        elif tags.get('shop') in ['supermarket', 'grocery']:
            pois['grocery'].append(poi_data)
        elif tags.get('highway') == 'bus_stop' or 'railway' in tags:
            pois['transit'].append(poi_data)
        elif tags.get('leisure') == 'park':
            pois['parks'].append(poi_data)
        elif tags.get('amenity') in ['restaurant', 'cafe']:
            pois['restaurants'].append(poi_data)
    
    # Sort each by distance
    for category in pois:
        pois[category].sort(key=lambda x: x['distance_miles'])
    
    # Cache result
    _poi_cache[cache_key] = pois
    
    return pois


def calculate_gis_features(lat: float, lon: float) -> Dict[str, Any]:
    """
    Calculate GIS-based features for a property.
    
    Returns features suitable for ML model input.
    """
    pois = get_nearby_pois(lat, lon)
    
    features = {}
    
    # Distance to nearest of each type (0 if none found, use max distance)
    max_dist = 2.0  # miles
    
    # Schools
    schools = pois.get('schools', [])
    features['distance_to_school'] = schools[0]['distance_miles'] if schools else max_dist
    features['schools_within_1mi'] = len([s for s in schools if s['distance_miles'] <= 1])
    
    # Grocery
    grocery = pois.get('grocery', [])
    features['distance_to_grocery'] = grocery[0]['distance_miles'] if grocery else max_dist
    
    # Transit
    transit = pois.get('transit', [])
    features['distance_to_transit'] = transit[0]['distance_miles'] if transit else max_dist
    features['transit_stops_within_half_mi'] = len([t for t in transit if t['distance_miles'] <= 0.5])
    
    # Parks
    parks = pois.get('parks', [])
    features['distance_to_park'] = parks[0]['distance_miles'] if parks else max_dist
    
    # Restaurants (proxy for walkability/urban density)
    restaurants = pois.get('restaurants', [])
    features['restaurants_within_half_mi'] = len([r for r in restaurants if r['distance_miles'] <= 0.5])
    
    # Walkability proxy score (0-100)
    walkability = 0
    if features['distance_to_grocery'] < 0.5:
        walkability += 25
    elif features['distance_to_grocery'] < 1.0:
        walkability += 15
    
    if features['transit_stops_within_half_mi'] >= 2:
        walkability += 25
    elif features['transit_stops_within_half_mi'] >= 1:
        walkability += 15
    
    if features['restaurants_within_half_mi'] >= 5:
        walkability += 25
    elif features['restaurants_within_half_mi'] >= 2:
        walkability += 15
    
    if features['distance_to_park'] < 0.5:
        walkability += 15
    elif features['distance_to_park'] < 1.0:
        walkability += 10
    
    if features['distance_to_school'] < 1.0:
        walkability += 10
    
    features['walkability_score'] = min(walkability, 100)
    
    return features


def get_gis_features_batch(properties: List[Dict]) -> List[Dict]:
    """
    Get GIS features for multiple properties.
    Includes rate limiting to be respectful to OSM.
    """
    results = []
    
    for i, prop in enumerate(properties):
        lat = prop.get('latitude')
        lon = prop.get('longitude')
        
        if not lat or not lon:
            results.append({})
            continue
        
        features = calculate_gis_features(lat, lon)
        results.append(features)
        
        # Rate limit: 1 request per second for Overpass API
        if i < len(properties) - 1:
            time.sleep(1)
    
    return results


if __name__ == "__main__":
    # Test with a sample property in Cleveland
    test_lat = 41.4993
    test_lon = -81.6944
    
    print(f"Testing GIS features for ({test_lat}, {test_lon})...")
    
    features = calculate_gis_features(test_lat, test_lon)
    print(json.dumps(features, indent=2))
