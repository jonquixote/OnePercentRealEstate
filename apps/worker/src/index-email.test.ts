import { describe, it, expect } from 'vitest';
import { indexEmailHtml } from './index-email';

describe('indexEmailHtml', () => {
  it('renders the top rows, the index CTA, and the unsubscribe link', () => {
    const html = indexEmailHtml(
      [{ metroLabel: 'Houston', pctClearing: 0.55, rank: 1 }],
      'July 2026',
      'https://octavo.press/u/abc',
      'https://octavo.press/the-1-percent-index',
    );
    expect(html).toContain('Houston');
    expect(html).toContain('55%');
    expect(html).toContain('the-1-percent-index');
    expect(html).toContain('/u/abc');
  });

  it('renders already-escaped inputs without re-escaping or injecting markup', () => {
    // The caller (digest.ts) is responsible for escHtml; indexEmailHtml emits
    // values verbatim, so the test passes pre-escaped strings and asserts the
    // exact text appears in the table (no double-escape, no breakout).
    const html = indexEmailHtml(
      [{ metroLabel: 'A&amp;B &lt;x&gt;', pctClearing: 0.1, rank: 1 }],
      'July &amp; &lt;2026&gt;',
      'https://octavo.press/u/abc',
      'https://octavo.press/the-1-percent-index',
    );
    expect(html).toContain('A&amp;B &lt;x&gt;');
    expect(html).toContain('July &amp; &lt;2026&gt;');
    expect(html).toContain('10%');
  });
});
