-- Faster approach: Use window functions and CTE to delete duplicates
-- This should be more efficient than DELETE with NOT IN

-- Step 1: Delete duplicates using ctid (physical row identifier) - much faster
WITH duplicates AS (
    SELECT ctid, 
           ROW_NUMBER() OVER (PARTITION BY address, listing_type ORDER BY updated_at DESC NULLS LAST, created_at DESC) as rn
    FROM listings
)
DELETE FROM listings 
WHERE ctid IN (SELECT ctid FROM duplicates WHERE rn > 1);

-- Step 2: Drop the old constraint
ALTER TABLE listings DROP CONSTRAINT IF EXISTS unique_listing;

-- Step 3: Add new unique constraint on address + listing_type only
ALTER TABLE listings ADD CONSTRAINT unique_address_listing_type 
    UNIQUE (address, listing_type);

-- Verify
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'listings'::regclass AND contype = 'u';
