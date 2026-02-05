-- Fix for stuck crawl jobs and improved recycling mechanism
-- Run this on production to fix the current stuck state and prevent future issues

-- Step 1: Reset all stuck "processing" jobs that haven't updated in 1 hour
-- This fixes the current issue where 439 jobs are stuck since Jan 29
UPDATE crawl_jobs 
SET status = 'failed', 
    error_message = 'Timeout: Job stuck in processing for over 1 hour'
WHERE status = 'processing' 
  AND started_at < NOW() - INTERVAL '1 hour';

-- Step 2: Improved recycle trigger that also handles stuck jobs
CREATE OR REPLACE FUNCTION recycle_crawl_jobs()
RETURNS TRIGGER AS $$
DECLARE
    pending_count INTEGER;
    processing_count INTEGER;
    stuck_processing_count INTEGER;
BEGIN
    -- Only check after a job is marked completed or failed
    IF NEW.status IN ('completed', 'failed') THEN
        -- Count remaining pending jobs
        SELECT COUNT(*) INTO pending_count 
        FROM crawl_jobs 
        WHERE status = 'pending';
        
        -- Count active processing jobs (started within last hour)
        SELECT COUNT(*) INTO processing_count 
        FROM crawl_jobs 
        WHERE status = 'processing'
          AND started_at > NOW() - INTERVAL '1 hour';
        
        -- Count and fix stuck processing jobs (started more than 1 hour ago)
        UPDATE crawl_jobs 
        SET status = 'failed',
            error_message = 'Timeout: Auto-failed after 1 hour of processing'
        WHERE status = 'processing'
          AND started_at < NOW() - INTERVAL '1 hour';
        
        GET DIAGNOSTICS stuck_processing_count = ROW_COUNT;
        
        IF stuck_processing_count > 0 THEN
            RAISE NOTICE 'Auto-failed % stuck processing jobs', stuck_processing_count;
        END IF;
        
        -- If no pending or actively processing jobs remain, reset all jobs
        IF pending_count = 0 AND processing_count = 0 THEN
            UPDATE crawl_jobs 
            SET status = 'pending',
                error_message = NULL,
                started_at = NULL,
                completed_at = NULL,
                items_found = 0,
                items_inserted = 0;
            
            RAISE NOTICE 'All crawl jobs recycled to pending status for next cycle';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Also create a scheduled function that can be called by pg_cron or n8n
-- to manually check and fix stuck jobs periodically
CREATE OR REPLACE FUNCTION check_and_fix_stuck_jobs()
RETURNS TABLE(fixed_count INTEGER, recycled BOOLEAN) AS $$
DECLARE
    v_fixed_count INTEGER := 0;
    v_pending_count INTEGER;
    v_processing_count INTEGER;
    v_recycled BOOLEAN := FALSE;
BEGIN
    -- Fix stuck processing jobs
    UPDATE crawl_jobs 
    SET status = 'failed',
        error_message = 'Timeout: Auto-failed after 1 hour of processing'
    WHERE status = 'processing'
      AND started_at < NOW() - INTERVAL '1 hour';
    
    GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
    
    -- Check if we should recycle
    SELECT COUNT(*) INTO v_pending_count 
    FROM crawl_jobs 
    WHERE status = 'pending';
    
    SELECT COUNT(*) INTO v_processing_count 
    FROM crawl_jobs 
    WHERE status = 'processing';
    
    -- If no pending or processing jobs remain, reset all jobs
    IF v_pending_count = 0 AND v_processing_count = 0 THEN
        UPDATE crawl_jobs 
        SET status = 'pending',
            error_message = NULL,
            started_at = NULL,
            completed_at = NULL,
            items_found = 0,
            items_inserted = 0;
        
        v_recycled := TRUE;
    END IF;
    
    RETURN QUERY SELECT v_fixed_count, v_recycled;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Show current status after fixes
SELECT status, COUNT(*) FROM crawl_jobs GROUP BY status ORDER BY status;
