from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from homeharvest import scrape_property
import pandas as pd
import json

app = FastAPI()

class ScrapeRequest(BaseModel):
    location: str
    listing_type: str = "for_sale"  # for_sale, for_rent, sold
    past_days: int = 30
    radius: Optional[float] = None
    mls_only: bool = False
    foreclosure: bool = False
    
    # Filters
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    beds_min: Optional[int] = None
    baths_min: Optional[float] = None

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/scrape")
def scrape_listings(req: ScrapeRequest):
    try:
        print(f"Scraping {req.location} ({req.listing_type})...")
        
        # Call HomeHarvest
        print(f"Calling scrape_property for {req.location}...")
        df = scrape_property(
            location=req.location,
            listing_type=req.listing_type,
            past_days=req.past_days,
            radius=req.radius,
            mls_only=req.mls_only,
            foreclosure=req.foreclosure
        )
        print(f"scrape_property returned type: {type(df)}")
        
        if df is None:
            print("df is None")
            return {"count": 0, "results": []}
            
        if hasattr(df, "empty") and df.empty:
            print("df is empty")
            return {"count": 0, "results": []}

        print(f"df shape: {df.shape}")

        # Apply basic filters if HomeHarvest didn't catch them or to be safe
        if req.min_price is not None:
            df = df[df['list_price'] >= req.min_price]
        if req.max_price is not None:
            df = df[df['list_price'] <= req.max_price]
        if req.beds_min is not None:
            df = df[df['beds'] >= req.beds_min]
        if req.baths_min is not None and 'full_baths' in df.columns:
             pass 
             
        print("Filtering complete")

        # Convert to JSON-compatible format
        # Convert to JSON-compatible format
        # Handle NaN/dates
        records = df.to_dict(orient="records")
        clean_records = []
        
        for row in records:
            clean_row = {}
            for k, v in row.items():
                # Handle list/dict types which might confuse pd.isna
                if isinstance(v, (list, dict)):
                    clean_row[k] = v
                elif pd.isna(v):
                    clean_row[k] = None
                elif hasattr(v, 'isoformat'):
                    clean_row[k] = v.isoformat()
                else:
                    clean_row[k] = v
            
            # Ensure address field exists for n8n/DB
            if not clean_row.get('address'):
                # Try to construct address from components
                parts = []
                if clean_row.get('street'): parts.append(clean_row['street'])
                if clean_row.get('city'): parts.append(clean_row['city'])
                if clean_row.get('state'): parts.append(clean_row['state'])
                if clean_row.get('zip_code'): parts.append(clean_row['zip_code'])
                
                if parts:
                   clean_row['address'] = ", ".join(parts)
            
            # Filter out invalid rows where address is still missing
            if clean_row.get('address'):
                clean_records.append(clean_row)
            else:
                print(f"Skipping row missing address: {clean_row.get('street', 'UNKNOWN')}")

        return {
            "count": len(clean_records),
            "results": clean_records
        }

    except Exception as e:
        print(f"Error scraping {req.location}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
