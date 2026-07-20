import { describe, it, expect, afterEach } from 'vitest';
import { sessionCookieOptions } from './auth';

describe('sessionCookieOptions', () => {
  const OLD = process.env.SESSION_COOKIE_DOMAIN;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SESSION_COOKIE_DOMAIN;
    else process.env.SESSION_COOKIE_DOMAIN = OLD;
  });

  it('omits domain when SESSION_COOKIE_DOMAIN is unset', () => {
    delete process.env.SESSION_COOKIE_DOMAIN;
    expect(sessionCookieOptions()).not.toHaveProperty('domain');
  });

  it('sets domain when SESSION_COOKIE_DOMAIN is set', () => {
    process.env.SESSION_COOKIE_DOMAIN = '.octavo.press';
    expect(sessionCookieOptions().domain).toBe('.octavo.press');
  });

  it('keeps the existing attributes', () => {
    delete process.env.SESSION_COOKIE_DOMAIN;
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});
