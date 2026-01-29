-- Trigger to automatically recycle crawl jobs
-- When all jobs are completed/failed, reset them all to pending for continuous cycling

CREATE OR REPLACE FUNCTION recycle_crawl_jobs()
RETURNS TRIGGER AS $$
DECLARE
    pending_count INTEGER;
    processing_count INTEGER;
BEGIN
    -- Only check after a job is marked completed or failed
    IF NEW.status IN ('completed', 'failed') THEN
        -- Count remaining pending and processing jobs
        SELECT COUNT(*) INTO pending_count 
        FROM crawl_jobs 
        WHERE status = 'pending';
        
        SELECT COUNT(*) INTO processing_count 
        FROM crawl_jobs 
        WHERE status = 'processing';
        
        -- If no pending or processing jobs remain, reset all jobs
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

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_recycle_crawl_jobs ON crawl_jobs;

-- Create the trigger
CREATE TRIGGER trigger_recycle_crawl_jobs
    AFTER UPDATE ON crawl_jobs
    FOR EACH ROW
    EXECUTE FUNCTION recycle_crawl_jobs();

-- Verify trigger was created
SELECT trigger_name, event_manipulation, action_timing 
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_recycle_crawl_jobs';
