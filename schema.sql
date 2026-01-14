-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Enum Types
CREATE TYPE subscription_tier AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE property_status AS ENUM ('watch', 'analyzing', 'offer_sent', 'under_contract', 'archived');

-- 1. Profiles Table (Extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_tier subscription_tier DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Properties Table
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  address TEXT NOT NULL,
  listing_price NUMERIC NOT NULL,
  estimated_rent NUMERIC,
  expense_ratio NUMERIC,
  financial_snapshot JSONB, -- Stores calculated metrics (Cap Rate, CoC, NOI)
  status property_status DEFAULT 'watch',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Market Benchmarks Table
CREATE TABLE market_benchmarks (
  zip_code TEXT PRIMARY KEY,
  avg_rent_sqft NUMERIC,
  median_price NUMERIC,
  safmr_data JSONB, -- Stores 0br, 1br, 2br, 3br, 4br rents
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Properties
CREATE POLICY "Users can only select their own properties"
ON properties
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own properties"
ON properties
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own properties"
ON properties
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own properties"
ON properties
FOR DELETE
USING (auth.uid() = user_id);

-- RLS Policies for Profiles
CREATE POLICY "Users can view their own profile"
ON profiles
FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON profiles
FOR UPDATE
USING (auth.uid() = id);

-- Function to handle new user signup (Trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
