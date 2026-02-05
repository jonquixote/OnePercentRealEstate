-- Add rent estimation tracking columns to production listings table
-- These columns were missing, causing rent estimates to lack transparency

-- Add rent estimation tracking columns if they don't exist
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rent_estimation_status TEXT DEFAULT 'pending';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rent_estimation_method TEXT;

-- Create index for faster rent estimation status queries
CREATE INDEX IF NOT EXISTS idx_listings_rent_status ON listings(rent_estimation_status);

-- Update existing listings that have estimated_rent but no method
UPDATE listings 
SET rent_estimation_method = 'legacy_0.8_percent',
    rent_estimation_status = 'completed'
WHERE estimated_rent IS NOT NULL 
  AND estimated_rent > 0 
  AND rent_estimation_method IS NULL;

-- Update listings with zero rent (likely land/vacant)
UPDATE listings 
SET rent_estimation_method = 'non_rentable',
    rent_estimation_status = 'completed'
WHERE estimated_rent = 0 
  AND rent_estimation_method IS NULL;

-- Mark null rent listings as pending
UPDATE listings 
SET rent_estimation_status = 'pending'
WHERE estimated_rent IS NULL;

-- Show summary
SELECT rent_estimation_status, rent_estimation_method, COUNT(*) 
FROM listings 
GROUP BY rent_estimation_status, rent_estimation_method
ORDER BY COUNT(*) DESC;
