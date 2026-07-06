-- Wave 3: State-level average annual homeowners insurance premiums.
-- Replaces the flat $1200/yr default in underwriting_rules with a real
-- per-state average so the scorecard's insurance cost isn't a national
-- blunt instrument. Source: NAIC 2021 homeowners insurance report
-- (average annual premium by state, HO-3 policy). Coverage levels vary
-- by insurer; these figures are directional, not actuarial.

CREATE TABLE IF NOT EXISTS insurance_state_avg (
  state           TEXT    NOT NULL PRIMARY KEY,
  annual_premium  NUMERIC NOT NULL CHECK (annual_premium > 0),
  fy              INT     NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'naic_ho3_2021'
);

-- Seed: NAIC 2021 averages (most-recent stable publication).
-- Values are annual premiums in USD, rounded to nearest dollar.
-- Reference: https://content.naic.org/ (Homeowners Insurance report series).
INSERT INTO insurance_state_avg (state, annual_premium, fy, source) VALUES
  ('AL', 2725, 2021, 'naic_ho3_2021'),
  ('AK', 1175, 2021, 'naic_ho3_2021'),
  ('AZ', 2008, 2021, 'naic_ho3_2021'),
  ('AR', 2708, 2021, 'naic_ho3_2021'),
  ('CA', 1456, 2021, 'naic_ho3_2021'),
  ('CO', 3184, 2021, 'naic_ho3_2021'),
  ('CT', 2466, 2021, 'naic_ho3_2021'),
  ('DE', 1299, 2021, 'naic_ho3_2021'),
  ('DC', 1692, 2021, 'naic_ho3_2021'),
  ('FL', 4201, 2021, 'naic_ho3_2021'),
  ('GA', 2500, 2021, 'naic_ho3_2021'),
  ('HI', 1223, 2021, 'naic_ho3_2021'),
  ('ID', 1458, 2021, 'naic_ho3_2021'),
  ('IL', 2072, 2021, 'naic_ho3_2021'),
  ('IN', 1824, 2021, 'naic_ho3_2021'),
  ('IA', 1940, 2021, 'naic_ho3_2021'),
  ('KS', 2722, 2021, 'naic_ho3_2021'),
  ('KY', 2433, 2021, 'naic_ho3_2021'),
  ('LA', 3739, 2021, 'naic_ho3_2021'),
  ('ME', 1242, 2021, 'naic_ho3_2021'),
  ('MD', 1548, 2021, 'naic_ho3_2021'),
  ('MA', 1887, 2021, 'naic_ho3_2021'),
  ('MI', 2108, 2021, 'naic_ho3_2021'),
  ('MN', 2076, 2021, 'naic_ho3_2021'),
  ('MS', 2867, 2021, 'naic_ho3_2021'),
  ('MO', 2373, 2021, 'naic_ho3_2021'),
  ('MT', 1964, 2021, 'naic_ho3_2021'),
  ('NE', 2475, 2021, 'naic_ho3_2021'),
  ('NV', 1943, 2021, 'naic_ho3_2021'),
  ('NH', 1249, 2021, 'naic_ho3_2021'),
  ('NJ', 1442, 2021, 'naic_ho3_2021'),
  ('NM', 1952, 2021, 'naic_ho3_2021'),
  ('NY', 1725, 2021, 'naic_ho3_2021'),
  ('NC', 2206, 2021, 'naic_ho3_2021'),
  ('ND', 2407, 2021, 'naic_ho3_2021'),
  ('OH', 1905, 2021, 'naic_ho3_2021'),
  ('OK', 3447, 2021, 'naic_ho3_2021'),
  ('OR', 1356, 2021, 'naic_ho3_2021'),
  ('PA', 1559, 2021, 'naic_ho3_2021'),
  ('RI', 1735, 2021, 'naic_ho3_2021'),
  ('SC', 2393, 2021, 'naic_ho3_2021'),
  ('SD', 2279, 2021, 'naic_ho3_2021'),
  ('TN', 2053, 2021, 'naic_ho3_2021'),
  ('TX', 4144, 2021, 'naic_ho3_2021'),
  ('UT', 1366, 2021, 'naic_ho3_2021'),
  ('VT', 1233, 2021, 'naic_ho3_2021'),
  ('VA', 1857, 2021, 'naic_ho3_2021'),
  ('WA', 1322, 2021, 'naic_ho3_2021'),
  ('WV', 2069, 2021, 'naic_ho3_2021'),
  ('WI', 1582, 2021, 'naic_ho3_2021'),
  ('WY', 1692, 2021, 'naic_ho3_2021')
ON CONFLICT (state) DO NOTHING;
