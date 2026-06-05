-- 2026_06_05_zip_iterator.sql
--
-- The n8n workflow (and any equivalent worker) ticks every 30 seconds and
-- needs to round-robin through every US ZIP code we care about,
-- enqueueing exactly one crawl_jobs row per tick. When the cursor reaches
-- the end of the list it wraps back to the start.
--
-- This migration ships:
--   1. `zip_codes`  — durable list of ZIPs to iterate, with priority +
--      last_scraped diagnostic columns.
--   2. `zip_iterator_state` — single-row cursor pointer + lifecycle
--      counters (cycles_completed, last_zip, last_advanced_at).
--   3. `enqueue_next_zip_job()` — atomic stored function:
--        - locks the cursor row,
--        - selects the next active zip ORDER BY priority DESC, zip ASC
--          where zip > last_zip (or wraps to the lowest zip),
--        - inserts a crawl_jobs row,
--        - advances the cursor,
--        - returns the zip.
--      The AFTER INSERT trigger from 2026_06_03_crawl_jobs_notify.sql then
--      pg_notifies `crawl_job_enqueued`, the Node worker picks it up via
--      LISTEN, and the scraper does its smart upsert.
--
-- Idempotent. Safe to re-apply.

BEGIN;

-- 1. zip_codes table ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS zip_codes (
    zip TEXT PRIMARY KEY CHECK (zip ~ '^\d{5}$'),
    state TEXT NOT NULL,
    city TEXT,
    -- Higher priority is iterated first within a cycle. Default 100 so
    -- seed-then-prioritize is easy.
    priority INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    times_scraped INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zip_codes_active_priority
    ON zip_codes (is_active, priority DESC, zip ASC)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_zip_codes_state ON zip_codes (state);

COMMENT ON TABLE zip_codes IS
    'Round-robin iteration list for the ZIP-by-ZIP scraper schedule. is_active=false to skip without deleting.';

-- 2. zip_iterator_state cursor ----------------------------------------------
CREATE TABLE IF NOT EXISTS zip_iterator_state (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),  -- enforce single row
    last_zip TEXT,                                    -- NULL means "start at top"
    last_advanced_at TIMESTAMPTZ,
    cycles_completed INTEGER NOT NULL DEFAULT 0,
    cycle_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO zip_iterator_state (id) VALUES (true) ON CONFLICT DO NOTHING;

COMMENT ON TABLE zip_iterator_state IS
    'Single-row cursor. enqueue_next_zip_job() updates last_zip and cycle counters.';

-- 3. enqueue_next_zip_job() function ----------------------------------------
-- Returns a row with (zip, crawl_job_id, cycle, was_wrap) so the caller
-- can observe the lifecycle without re-querying.
CREATE OR REPLACE FUNCTION enqueue_next_zip_job(
    p_listing_type TEXT DEFAULT 'for_sale'
)
RETURNS TABLE (
    out_zip TEXT,
    crawl_job_id BIGINT,
    cycle INTEGER,
    wrapped BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_last_zip TEXT;
    v_last_priority INTEGER;
    v_next_zip TEXT;
    v_cycles INTEGER;
    v_wrapped BOOLEAN := false;
    v_job_id BIGINT;
BEGIN
    -- Lock the cursor so two ticks can't double-advance.
    SELECT last_zip, cycles_completed
      INTO v_last_zip, v_cycles
      FROM zip_iterator_state
     WHERE id = true
       FOR UPDATE;

    -- Pick the next ZIP under ordering (priority DESC, zip ASC).
    -- "Next" means: lower priority, OR same priority + later zip alphabetically.
    IF v_last_zip IS NULL THEN
        SELECT z.zip INTO v_next_zip
          FROM zip_codes z
         WHERE z.is_active = true
         ORDER BY z.priority DESC, z.zip ASC
         LIMIT 1;
    ELSE
        SELECT z.priority INTO v_last_priority
          FROM zip_codes z
         WHERE z.zip = v_last_zip;

        SELECT z.zip INTO v_next_zip
          FROM zip_codes z
         WHERE z.is_active = true
           AND (
             z.priority < v_last_priority
             OR (z.priority = v_last_priority AND z.zip > v_last_zip)
           )
         ORDER BY z.priority DESC, z.zip ASC
         LIMIT 1;

        -- Wrap: end of the cycle, restart from the highest-priority lowest zip.
        IF v_next_zip IS NULL THEN
            SELECT z.zip INTO v_next_zip
              FROM zip_codes z
             WHERE z.is_active = true
             ORDER BY z.priority DESC, z.zip ASC
             LIMIT 1;
            v_wrapped := true;
            v_cycles := v_cycles + 1;
        END IF;
    END IF;

    -- No active zips at all — bail out, return empty.
    IF v_next_zip IS NULL THEN
        RAISE NOTICE 'enqueue_next_zip_job: no active zip_codes rows';
        RETURN;
    END IF;

    -- Insert the crawl job. region_value matches existing 'zip_code' convention
    -- used elsewhere in the codebase; status='pending' so the AFTER INSERT
    -- trigger from 2026_06_03_crawl_jobs_notify.sql pg_notifies the worker.
    INSERT INTO crawl_jobs (region_type, region_value, status)
    VALUES ('zip_code', v_next_zip, 'pending')
    RETURNING id INTO v_job_id;

    -- Advance the cursor.
    UPDATE zip_iterator_state
       SET last_zip = v_next_zip,
           last_advanced_at = now(),
           cycles_completed = v_cycles,
           cycle_started_at = CASE WHEN v_wrapped THEN now() ELSE cycle_started_at END
     WHERE id = true;

    -- Bump diagnostics on the zip row.
    UPDATE zip_codes z
       SET last_scraped_at = now(),
           times_scraped = times_scraped + 1
     WHERE z.zip = v_next_zip;

    out_zip := v_next_zip;
    crawl_job_id := v_job_id;
    cycle := v_cycles;
    wrapped := v_wrapped;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION enqueue_next_zip_job(TEXT) IS
    'Atomically advance the zip_codes cursor + insert a crawl_jobs row. Call once per scheduler tick.';

COMMIT;
