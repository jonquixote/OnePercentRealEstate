// ML scheduler: triggers drift + eval reports on a cron schedule.
//
// Lifecycle:
// 1. On startup, calculate next 02:00 UTC (drift) and Sunday 03:00 UTC (eval).
// 2. At each scheduled time: POST to http://ml:8000/ops/run-drift or /ops/run-eval.
// 3. Capture response JSON {ok, lines, alert: bool, exit_code}.
// 4. If alert=true and OPS_WEBHOOK_URL is set, POST the alert to the webhook.
// 5. Log all results structurally.
// 6. SIGTERM/SIGINT: cancel pending timeouts, exit gracefully.
//
// Note: This is a single-threaded tick scheduler. On restart, timeouts are
// lost — the job won't run until the next scheduled time. For HA, consider
// moving the schedule to PostgreSQL with a cron extension or moving to an
// external cron runner (n8n, etc.).
import { loadEnv } from './env.js';
import { getLogger, newTraceId, withTrace } from './logger.js';
const env = loadEnv();
const log = getLogger(env.LOG_LEVEL);
// ---------------------------------------------------------------------------
// Schedule calculations
// ---------------------------------------------------------------------------
/**
 * Calculate milliseconds until next occurrence of a specific time (HH:MM UTC).
 */
function msUntilNextTime(hour, minute) {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    let next = new Date(Date.UTC(utcYear, utcMonth, utcDate, hour, minute, 0, 0));
    // If the time has already passed today, schedule for tomorrow
    if (next <= now) {
        next = new Date(Date.UTC(utcYear, utcMonth, utcDate + 1, hour, minute, 0, 0));
    }
    return next.getTime() - now.getTime();
}
/**
 * Calculate milliseconds until next Sunday at a specific time (HH:MM UTC).
 */
function msUntilNextSunday(hour, minute) {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const utcDay = now.getUTCDay(); // 0 = Sunday
    let daysUntilSunday = (7 - utcDay) % 7;
    // If today is Sunday and the time hasn't passed, use today
    if (daysUntilSunday === 0) {
        const timeToday = new Date(Date.UTC(utcYear, utcMonth, utcDate, hour, minute, 0, 0));
        if (timeToday > now) {
            return timeToday.getTime() - now.getTime();
        }
        daysUntilSunday = 7;
    }
    const next = new Date(Date.UTC(utcYear, utcMonth, utcDate + daysUntilSunday, hour, minute, 0, 0));
    return next.getTime() - now.getTime();
}
// ---------------------------------------------------------------------------
// Run ops endpoint
// ---------------------------------------------------------------------------
async function runOps(endpoint, timeoutMs = 60_000) {
    try {
        const response = await fetch(`${env.ML_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            return {
                ok: false,
                lines: [`HTTP ${response.status}`],
                exit_code: response.status,
            };
        }
        const json = (await response.json());
        return json;
    }
    catch (err) {
        return {
            ok: false,
            lines: [String(err)],
            exit_code: 1,
        };
    }
}
// ---------------------------------------------------------------------------
// Send alert webhook
// ---------------------------------------------------------------------------
async function sendAlert(job, response) {
    if (!env.OPS_WEBHOOK_URL) {
        log.info({ job }, 'alert suppressed (OPS_WEBHOOK_URL not set)');
        return;
    }
    try {
        const payload = {
            text: `ML ${job} alert`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*ML ${job} Alert*\n\`\`\`\n${(response.lines || []).join('\n')}\n\`\`\``,
                    },
                },
            ],
        };
        const alertResponse = await fetch(env.OPS_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
        });
        if (!alertResponse.ok) {
            log.warn({ job, webhook_status: alertResponse.status }, 'webhook post failed');
        }
        else {
            log.info({ job }, 'webhook alert sent');
        }
    }
    catch (err) {
        log.error({ job, err: String(err) }, 'webhook post error');
    }
}
// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------
async function runDrift() {
    const traceId = newTraceId();
    const traceLog = withTrace(log, traceId, { job: 'drift' });
    traceLog.info('drift job starting');
    const response = await runOps('/ops/run-drift');
    if (response.ok) {
        traceLog.info({ lines: response.lines }, 'drift job completed');
    }
    else {
        traceLog.error({ lines: response.lines, exit_code: response.exit_code }, 'drift job failed');
    }
    if (response.alert) {
        await sendAlert('drift', response);
    }
}
async function runTrain() {
    const traceId = newTraceId();
    const traceLog = withTrace(log, traceId, { job: 'train' });
    traceLog.info('nightly retrain starting');
    // First, refresh market stats
    traceLog.info('refreshing market stats before train');
    const statsResponse = await runOps('/ops/refresh-market-stats', 10 * 60_000);
    if (!statsResponse.ok) {
        traceLog.error({ lines: statsResponse.lines, exit_code: statsResponse.exit_code }, 'market stats refresh failed before train — proceeding anyway');
    }
    else {
        traceLog.info('market stats refresh completed');
    }
    // Train (~7 min) + eval gate (~2 min) + swap. Generous ceiling.
    const response = await runOps('/ops/run-train', 45 * 60_000);
    if (response.ok) {
        traceLog.info({ lines: response.lines }, 'nightly retrain completed');
    }
    else {
        traceLog.error({ lines: response.lines, exit_code: response.exit_code }, 'nightly retrain failed');
    }
    if (response.alert) {
        await sendAlert('train', response);
    }
}
async function runEval() {
    const traceId = newTraceId();
    const traceLog = withTrace(log, traceId, { job: 'eval' });
    traceLog.info('eval job starting');
    const response = await runOps('/ops/run-eval');
    if (response.ok) {
        traceLog.info({ lines: response.lines }, 'eval job completed');
    }
    else {
        traceLog.error({ lines: response.lines, exit_code: response.exit_code }, 'eval job failed');
    }
    if (response.alert) {
        await sendAlert('eval', response);
    }
}
// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let shutdownRequested = false;
const activeTimeouts = [];
function scheduleNext(name, fn, nextMs) {
    if (shutdownRequested) {
        return;
    }
    // nextMs is a FUNCTION recomputed on every re-arm. The previous version
    // reused the boot-relative delay, so a job that first fired at 02:00
    // re-armed at 02:00 + (02:00 - boot time) — daily cadence drifted by
    // however long the process had been up before the first fire.
    const ms = nextMs();
    const timeout = setTimeout(async () => {
        const index = activeTimeouts.indexOf(timeout);
        if (index !== -1) {
            activeTimeouts.splice(index, 1);
        }
        if (!shutdownRequested) {
            await fn();
        }
        // Schedule the next run at the freshly-computed next occurrence.
        scheduleNext(name, fn, nextMs);
    }, ms);
    activeTimeouts.push(timeout);
    log.info({ job: name, next_ms: ms }, 'job scheduled');
}
async function gracefulShutdown(signal) {
    log.info({ signal }, 'shutdown requested');
    shutdownRequested = true;
    // Cancel all pending timeouts
    for (const timeout of activeTimeouts) {
        clearTimeout(timeout);
    }
    activeTimeouts.length = 0;
    log.info('all timeouts cancelled, exiting');
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
(async () => {
    try {
        log.info({ ml_url: env.ML_URL }, 'ml-scheduler starting');
        // Schedule nightly retrain: 01:00 UTC (before drift at 02:00 so the
        // drift monitor sees the freshly-promoted model's predictions).
        scheduleNext('train', runTrain, () => msUntilNextTime(1, 0));
        // Schedule drift job: nightly at 02:00 UTC
        scheduleNext('drift', runDrift, () => msUntilNextTime(2, 0));
        // Schedule eval job: Sunday at 03:00 UTC
        scheduleNext('eval', runEval, () => msUntilNextSunday(3, 0));
        log.info('ml-scheduler ready (train 01:00, drift 02:00, eval Sun 03:00 UTC)');
    }
    catch (err) {
        log.error({ err: String(err) }, 'startup failed');
        process.exit(1);
    }
})();
//# sourceMappingURL=ml-scheduler.js.map