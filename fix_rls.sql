-- Allow public read access to properties for the MVP
DROP POLICY IF EXISTS "Users can only select their own properties" ON properties;

CREATE POLICY "Allow public read access"
ON properties
FOR SELECT
USING (true);

-- Allow public read access to market_benchmarks
DROP POLICY IF EXISTS "Allow public read access" ON market_benchmarks;
CREATE POLICY "Allow public read access"
ON market_benchmarks
FOR SELECT
USING (true);

-- Ensure RLS is enabled (or disabled if you prefer total openness for MVP)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_benchmarks ENABLE ROW LEVEL SECURITY;
