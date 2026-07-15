import { describe, it, expect, afterEach } from 'vitest';

describe('SCRAPER_URLS parsing', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('splits SCRAPER_URLS on commas and trims', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    process.env.SCRAPER_URLS = ' http://10.8.3.41 , http://10.8.4.10 ';
    const { loadEnv } = await import('./env');
    expect(loadEnv().SCRAPER_URLS).toEqual(['http://10.8.3.41', 'http://10.8.4.10']);
  });
  it('falls back to the single SCRAPER_URL when SCRAPER_URLS is unset', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    delete process.env.SCRAPER_URLS;
    process.env.SCRAPER_URL = 'http://only';
    const { loadEnv } = await import('./env');
    expect(loadEnv().SCRAPER_URLS).toEqual(['http://only']);
  });
});
