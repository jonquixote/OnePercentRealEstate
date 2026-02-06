-- Fix duplicate listings by adding proper unique constraint
-- Run this on production to prevent future duplicates

-- Step 1: First, identify and remove duplicates keeping the most recent one
-- Create temp table with rows to keep (most recent per address+listing_type)
CREATE TEMP TABLE listings_to_keep AS
SELECT DISTINCT ON (address, listing_type) id
FROM listings
ORDER BY address, listing_type, updated_at DESC NULLS LAST, created_at DESC;

-- Count how many duplicates we're removing
SELECT 'DUPLICATES_TO_REMOVE' as action, 
       (SELECT COUNT(*) FROM listings) - (SELECT COUNT(*) FROM listings_to_keep) as count;

-- Step 2: Delete duplicates (keep only the most recent)
DELETE FROM listings 
WHERE id NOT IN (SELECT id FROM listings_to_keep);

-- Step 3: Drop the old constraint that includes listing_date
ALTER TABLE listings DROP CONSTRAINT IF EXISTS unique_listing;

-- Step 4: Add new unique constraint on address + listing_type only
-- This will enforce uniqueness at the database level
ALTER TABLE listings ADD CONSTRAINT unique_address_listing_type 
    UNIQUE (address, listing_type);

-- Step 5: Create index to speed up lookups
CREATE INDEX IF NOT EXISTS idx_listings_address_type 
    ON listings(address, listing_type);

-- Step 6: Verify the constraint exists
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'listings'::regclass AND contype = 'u';

-- Show final count
SELECT 'FINAL_LISTING_COUNT' as metric, COUNT(*) as count FROM listings;
