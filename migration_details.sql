-- Add columns for deep analysis
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS images TEXT[],
ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Comment on columns
COMMENT ON COLUMN properties.images IS 'Array of image URLs from the listing';
COMMENT ON COLUMN properties.raw_data IS 'Full raw JSON dump of the listing data for detailed analysis';
