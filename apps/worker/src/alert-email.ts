/**
 * Task 3 — instant alert email rendering + send (Resend-gated, opt-in).
 *
 * Pure `renderAlertEmail` produces a self-contained HTML deal-card email for
 * one user's batch of freshly-matched alert events. `sendAlertEmails` wraps it
 * in the Resend send (inlined, mirroring alerts.ts — digest.ts is NOT imported
 * here because it pulls in @oper/query-lang, which would break the plain-node
 * worker runtime). The unsubscribe token helpers are COPIED from digest.ts for
 * the same reason.
 */

import { createHmac } from 'node:crypto';
import { loadEnv } from './env.js';
import { getLogger, type WorkerLogger } from './logger.js';
import type { AlertRow, Candidate } from './alerts.js';

const env = loadEnv();
const logger = getLogger(env.LOG_LEVEL);

function escHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

// Inlined Resend send (mirrors alerts.ts; digest.ts is NOT imported).
async function sendResendEmail(recipient: string, subject: string, html: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.WATCHLIST_FROM_EMAIL,
      to: recipient,
      subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 200),
      html,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend API error ${response.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Resend-gating — evaluated lazily so a test that toggles RESEND_API_KEY
// (and re-imports) is not stuck with a stale module-init snapshot. The
// one-time "disabled" log is kept separate, fired on first disabled call.
// ---------------------------------------------------------------------------
let disabledLogged = false;
export function resendEnabled(): boolean {
  const key = process.env.RESEND_API_KEY ?? env.RESEND_API_KEY;
  const enabled = !!key && key !== 'dummy_key_for_dev';
  if (!enabled && !disabledLogged) {
    disabledLogged = true;
    logger.info('Alert email disabled: RESEND_API_KEY unset — in-app only.');
  }
  return enabled;
}

// ---------------------------------------------------------------------------
// Signed one-click unsubscribe token (COPIED from digest.ts; digest not imported)
// ---------------------------------------------------------------------------
function signUnsub(searchId: string, email: string): string {
  const payload = `${searchId}|${email}`;
  return createHmac('sha256', env.UNSUBSCRIBE_SECRET).update(payload).digest('hex');
}

function unsubUrl(searchId: string, email: string): string {
  const token = signUnsub(searchId, email);
  const configured = env.DIGEST_PUBLIC_URL && env.DIGEST_PUBLIC_URL !== 'https://octavo.press'
    ? env.DIGEST_PUBLIC_URL
    : 'https://one.octavo.press';
  const base = configured.replace(/\/$/, '');
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}&id=${encodeURIComponent(searchId)}&e=${encodeURIComponent(email)}`;
}

// ---------------------------------------------------------------------------
// Pure render
// ---------------------------------------------------------------------------

interface RenderOpts {
  userId?: string;
  email?: string;
}

function priceText(price: number | null): string {
  return price != null ? `$${escHtml(Number(price).toLocaleString())}` : 'N/A';
}

function ratioText(ratio: number | null): string {
  return ratio != null ? `${escHtml((Number(ratio) * 100).toFixed(2))}%` : 'N/A';
}

export function renderAlertEmail(
  events: AlertRow[],
  candidates: Candidate[],
  opts: RenderOpts = {},
): { subject: string; html: string } {
  if (events.length === 0) {
    return { subject: 'New deal in your watched areas', html: '' };
  }

  const area = events[0].source_label;
  let subject: string;
  if (events.length === 1) {
    subject = `New deal in ${area}`;
  } else {
    subject = `New deal in ${area} (+${events.length - 1} more)`;
  }

  // The plan pinpoints absolute links at https://one.octavo.press/property/<id>.
  // Use DIGEST_PUBLIC_URL only when it has been explicitly set to something
  // other than the generic env default; otherwise fall back to one.octavo.press.
  const configured = env.DIGEST_PUBLIC_URL && env.DIGEST_PUBLIC_URL !== 'https://octavo.press'
    ? env.DIGEST_PUBLIC_URL
    : 'https://one.octavo.press';
  const base = configured.replace(/\/$/, '');
  const unsub = unsubUrl(opts.userId ? `index|${opts.userId}` : 'index', opts.email ?? '');

  const cards = events.map((row) => {
    const c = candidates.find((x) => String(x.id) === String(row.listing_id));
    const address = escHtml(c?.address ?? 'a property');
    const id = escHtml(String(row.listing_id));
    const link = `${base}/property/${id}`;
    const price = priceText(c?.price ?? row.price);
    const ratio = ratioText(c?.rent_price_ratio ?? row.ratio);
    return `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:10px 0;max-width:520px">
        <a href="${escHtml(link)}" style="color:#1d4ed8;text-decoration:none;font-weight:600;font-size:15px">${address}</a><br/>
        <span style="color:#374151">Price: ${price}</span><br/>
        <span style="color:#374151">1% rule ratio: ${ratio}</span><br/>
        <span style="color:#6b7280;font-size:12px">${escHtml(row.source_label)}</span>
      </div>`;
  }).join('');

  const html = `
    <h2 style="font-family:Georgia,serif">New deals in your watched areas</h2>
    <p style="color:#374151;font-family:Arial,sans-serif">${events.length} new ${events.length === 1 ? 'match' : 'matches'} found for you.</p>
    ${cards}
    <hr style="margin-top:16px;border:none;border-top:1px solid #e5e7eb" />
    <p style="color:#6b7280;font-size:12px;font-family:Arial,sans-serif">
      <a href="${escHtml(unsub)}" style="color:#6b7280">Unsubscribe from these alerts</a>
    </p>`;

  return { subject, html };
}

// ---------------------------------------------------------------------------
// Send (Resend-gated)
// ---------------------------------------------------------------------------

export async function sendAlertEmails(
  user: { id: string; email?: string | null },
  rows: AlertRow[],
  candidates: Candidate[],
  log: WorkerLogger,
): Promise<number> {
  if (!resendEnabled()) return 0;
  if (!user.email) return 0;

  try {
    const { subject, html } = renderAlertEmail(rows, candidates, {
      userId: user.id,
      email: user.email,
    });
    await sendResendEmail(user.email, subject, html);
    return 1;
  } catch (err) {
    log.warn({ err, userId: user.id }, 'Alert email send failed');
    return 0;
  }
}
