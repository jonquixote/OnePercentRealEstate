-- Wave 5: credentials auth. bcrypt hash lives on profiles; NULL means the
-- profile predates auth (or was created via a future OAuth path).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
