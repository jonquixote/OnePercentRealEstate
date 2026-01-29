-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Listings Table (Raw Scrape Data)
CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id TEXT, -- e.g., 'Zillow-12345' or just the address hash
    address TEXT NOT NULL,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    price NUMERIC,
    bedrooms NUMERIC,
    bathrooms NUMERIC,
    sqft NUMERIC,
    lot_sqft NUMERIC,
    year_built INTEGER,
    property_type TEXT,
    listing_type TEXT, -- 'for_sale', 'for_rent', 'sold'
    listing_status TEXT, -- 'active', 'pending', etc.
    listing_date DATE,
    sold_date DATE,
    sold_price NUMERIC,
    latitude NUMERIC,
    longitude NUMERIC,
    
    raw_data JSONB, -- Full JSON dump from scraper
    url TEXT,
    property_url TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_listing UNIQUE (address, listing_type, listing_date) 
    -- Or just unique address if we update inplace. For now, unique by address+type usually suffices or we add date for history.
    -- Let's go with unique address + listing_type so we have the "latest" state for a property in that mode.
);

-- Index for searching
CREATE INDEX idx_listings_zip ON listings(zip_code);
CREATE INDEX idx_listings_state ON listings(state);
CREATE INDEX idx_listings_updated ON listings(updated_at);

-- Crawl Jobs Table (To track progress)
CREATE TABLE IF NOT EXISTS crawl_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_type TEXT, -- 'county', 'zip'
    region_value TEXT, -- 'New York, NY' or '10001'
    status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    items_found INTEGER DEFAULT 0,
    items_inserted INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);
