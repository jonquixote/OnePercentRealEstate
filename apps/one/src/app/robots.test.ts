import { describe, it, expect } from 'vitest';
import robots from './robots';

describe('robots', () => {
  const result = robots();
  const rule = (result.rules as Array<{ userAgent: string; allow: string; disallow: string[] }>)[0];

  it('allows /', () => {
    expect(rule.allow).toBe('/');
  });

  it('disallows /api/', () => {
    expect(rule.disallow).toContain('/api/');
  });

  it('disallows /account', () => {
    expect(rule.disallow).toContain('/account');
  });

  it('disallows /settings', () => {
    expect(rule.disallow).toContain('/settings');
  });

  it('disallows /shelf', () => {
    expect(rule.disallow).toContain('/shelf');
  });

  it('disallows /welcome', () => {
    expect(rule.disallow).toContain('/welcome');
  });

  it('disallows /admin', () => {
    expect(rule.disallow).toContain('/admin');
  });

  it('sets sitemap to SITE/sitemap.xml', () => {
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';
    expect(result.sitemap).toBe(`${site}/sitemap.xml`);
  });

  it('sets host to SITE', () => {
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';
    expect(result.host).toBe(site);
  });
});
