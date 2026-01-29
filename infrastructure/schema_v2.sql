-- Schema Upgrade v2: Comprehensive Property Data
-- Adds fields for MLS details, agent info, tax data, and property characteristics

ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS mls_id TEXT,
ADD COLUMN IF NOT EXISTS mls_status TEXT,
ADD COLUMN IF NOT EXISTS days_on_market INTEGER,
ADD COLUMN IF NOT EXISTS hoa_fee NUMERIC,
ADD COLUMN IF NOT EXISTS tax_annual_amount NUMERIC,
ADD COLUMN IF NOT EXISTS agent_name TEXT,
ADD COLUMN IF NOT EXISTS agent_email TEXT,
ADD COLUMN IF NOT EXISTS agent_phone TEXT,
ADD COLUMN IF NOT EXISTS broker_name TEXT,
ADD COLUMN IF NOT EXISTS lot_size_acres NUMERIC,
ADD COLUMN IF NOT EXISTS stories INTEGER,
ADD COLUMN IF NOT EXISTS garage_spaces INTEGER;

-- Create indices for commonly queried new columns
CREATE INDEX IF NOT EXISTS idx_listings_mls_status ON listings(mls_status);
CREATE INDEX IF NOT EXISTS idx_listings_listing_id ON listings(mls_id);
-- Index for agent/broker analytics
CREATE INDEX IF NOT EXISTS idx_listings_broker_name ON listings(broker_name);
