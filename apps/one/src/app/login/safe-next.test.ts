import { describe, it, expect } from 'vitest';
import { safeNextPath } from './page';

describe('safeNextPath', () => {
  it('keeps relative paths', () => expect(safeNextPath('/welcome')).toBe('/welcome'));
  it('rejects protocol-relative', () => expect(safeNextPath('//evil.com')).toBe('/'));
  it('allows the two production hosts over https', () => {
    expect(safeNextPath('https://two.octavo.press/')).toBe('https://two.octavo.press/');
    expect(safeNextPath('https://one.octavo.press/shelf')).toBe('https://one.octavo.press/shelf');
  });
  it('rejects other hosts and suffix tricks', () => {
    expect(safeNextPath('https://two.octavo.press.evil.com/')).toBe('/');
    expect(safeNextPath('https://evil.com/')).toBe('/');
    expect(safeNextPath('http://two.octavo.press/')).toBe('/'); // https only
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
  });
});
