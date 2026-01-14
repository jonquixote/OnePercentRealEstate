-- Create table for storing rental comps
CREATE TABLE IF NOT EXISTS rental_listings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    address TEXT NOT NULL,
    zip_code TEXT,
    city TEXT,
    state TEXT,
    price NUMERIC, -- Monthly rent
    bedrooms NUMERIC,
    bathrooms NUMERIC,
    sqft NUMERIC,
    property_type TEXT,
    latitude NUMERIC,
    longitude NUMERIC,
    listing_date DATE DEFAULT CURRENT_DATE,
    source TEXT, -- 'realtor.com', 'zillow', etc.
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(address, listing_date) -- Prevent duplicate inserts for same day
);

-- Index for geospatial/similarity search
CREATE INDEX IF NOT EXISTS idx_rental_zip ON rental_listings(zip_code);
CREATE INDEX IF NOT EXISTS idx_rental_beds ON rental_listings(bedrooms);
CREATE INDEX IF NOT EXISTS idx_rental_price ON rental_listings(price);

-- Enable RLS
ALTER TABLE rental_listings ENABLE ROW LEVEL SECURITY;

-- Allow public read (for now, or restrict to authenticated)
CREATE POLICY "Allow public read of rental listings" ON rental_listings
    FOR SELECT USING (true);

-- Allow service role insert
CREATE POLICY "Allow service role insert rental listings" ON rental_listings
    FOR INSERT WITH CHECK (true);
