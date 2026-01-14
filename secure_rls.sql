-- Revert public access and enforce strict RLS

-- 1. Properties Table
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (including the public one)
DROP POLICY IF EXISTS "Allow public read access" ON properties;
DROP POLICY IF EXISTS "Users can only select their own properties" ON properties;
DROP POLICY IF EXISTS "Users can only insert their own properties" ON properties;
DROP POLICY IF EXISTS "Users can update their own properties" ON properties;
DROP POLICY IF EXISTS "Users can delete their own properties" ON properties;

-- Re-create strict policies
CREATE POLICY "Users can only select their own properties"
ON properties FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own properties"
ON properties FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own properties"
ON properties FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own properties"
ON properties FOR DELETE
USING (auth.uid() = user_id);


-- 2. Market Benchmarks (Keep public for now, or restrict if needed)
-- For now, let's keep benchmarks public as they are general data
-- But we can ensure only admins can write (if we had admins)
-- For this MVP, we'll leave benchmarks public read.
ALTER TABLE market_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access" ON market_benchmarks;
CREATE POLICY "Allow public read access"
ON market_benchmarks FOR SELECT
USING (true);


-- 3. Profiles Table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

CREATE POLICY "Users can view their own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id);

-- Ensure the trigger exists (idempotent)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to avoid duplication error in some SQL dialects, 
-- but Postgres supports CREATE OR REPLACE TRIGGER only in newer versions.
-- Let's just use DROP IF EXISTS then CREATE.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
