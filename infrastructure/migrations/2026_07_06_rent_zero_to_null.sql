-- Convert legacy estimated_rent=0 rows to NULL.
--
-- Wave 2 encodes non-rentable properties as estimated_rent=NULL,
-- rent_model_version='non_rentable_skip' instead of estimated_rent=0.
-- All rent estimators (v0 triangulation, v1 LightGBM) return positive
-- values for rentable properties, so 0 is always an indicator of
-- "no estimate computed" or pre-Wave-2 convention.
--
-- Safe to re-run (idempotent).

UPDATE listings SET estimated_rent = NULL WHERE estimated_rent = 0;
