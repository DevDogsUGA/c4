import { describe, expect, it } from 'vitest';
import { isAllowedAdminEmail } from './admin-auth';

describe('isAllowedAdminEmail', () => {
  it('rejects a missing email', () => {
    expect(isAllowedAdminEmail(undefined, '')).toBe(false);
    expect(isAllowedAdminEmail(null, '')).toBe(false);
    expect(isAllowedAdminEmail('', '')).toBe(false);
  });

  it('allows any authenticated email when the allowlist is empty', () => {
    expect(isAllowedAdminEmail('someone@uga.edu', '')).toBe(true);
    expect(isAllowedAdminEmail('someone@uga.edu', undefined)).toBe(true);
  });

  it('allows only emails on a non-empty allowlist', () => {
    const allowlist = 'a@uga.edu, b@uga.edu';
    expect(isAllowedAdminEmail('a@uga.edu', allowlist)).toBe(true);
    expect(isAllowedAdminEmail('B@UGA.EDU', allowlist)).toBe(true); // case-insensitive
    expect(isAllowedAdminEmail('c@uga.edu', allowlist)).toBe(false);
  });
});
