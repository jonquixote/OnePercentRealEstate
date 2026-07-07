#!/usr/bin/env python3
"""
Geocoding script using Census Bureau (primary) + Nominatim (fallback).
"""
import os
import time
import urllib.parse
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing Supabase credentials")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

CENSUS_BENCHMARK = 'Public_AR_Current'

def geocode_address(address):
    """Geocodes via Census Bureau (no rate limit), falls back to Nominatim (1 req/sec)."""
    if not address:
        return None

    # Census
    try:
        encoded = urllib.parse.quote(address)
        url = f"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address={encoded}&benchmark={CENSUS_BENCHMARK}&format=json"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            matches = data.get('result', {}).get('addressMatches', [])
            if matches:
                c = matches[0]['coordinates']
                return (c['y'], c['x'])
    except Exception as e:
        print(f"  Census error: {e}")

    # Nominatim fallback
    try:
        encoded = urllib.parse.quote(address)
        url = f"https://nominatim.openstreetmap.org/search?q={encoded}&format=json&limit=1"
        resp = requests.get(url, headers={'User-Agent': 'OnePercentRealEstate/1.0'}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data:
                return (float(data[0]['lat']), float(data[0]['lon']))
    except Exception as e:
        print(f"  Nominatim error: {e}")

    return None

def backfill():
    print("Starting geocode backfill (Census + Nominatim)...")
    
    response = supabase.table("properties").select("id, address, raw_data").order("created_at", desc=True).limit(1000).execute()
    
    if not response.data:
        print("No properties found.")
        return
    
    print(f"Found {len(response.data)} properties.")
    
    to_geocode = []
    for p in response.data:
        raw_data = p.get("raw_data") or {}
        if not raw_data.get("lat") or not raw_data.get("lon"):
            to_geocode.append(p)
    
    print(f"{len(to_geocode)} need geocoding.")
    
    if not to_geocode:
        print("All done!")
        return
    
    success = 0
    fail = 0
    
    for i, prop in enumerate(to_geocode):
        address = prop.get("address")
        if not address:
            continue
        
        if (i+1) % 100 == 0:
            print(f"[{i+1}/{len(to_geocode)}] Success: {success}, Failed: {fail}")
        
        coords = geocode_address(address)
        
        if coords:
            lat, lon = coords
            raw_data = prop.get("raw_data") or {}
            raw_data["lat"] = lat
            raw_data["lon"] = lon
            
            try:
                supabase.table("properties").update({
                    "raw_data": raw_data
                }).eq("id", prop["id"]).execute()
                success += 1
            except:
                fail += 1
        else:
            fail += 1

        time.sleep(0.05)
    
    print(f"\n=== Done ===")
    print(f"Success: {success}")
    print(f"Failed:  {fail}")

if __name__ == "__main__":
    backfill()
