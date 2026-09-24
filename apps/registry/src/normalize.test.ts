import { describe, expect, it } from 'vitest';
import { normalizeRepoUrl } from './normalize';

describe('normalizeRepoUrl', () => {
  it('normalizes a plain https URL', () => {
    expect(normalizeRepoUrl('https://github.com/Acme/Repo')).toBe('https://github.com/acme/repo');
  });

  it('strips a trailing .git', () => {
    expect(normalizeRepoUrl('https://github.com/acme/repo.git')).toBe('https://github.com/acme/repo');
  });

  it('strips a trailing slash', () => {
    expect(normalizeRepoUrl('https://github.com/acme/repo/')).toBe('https://github.com/acme/repo');
  });

  it('accepts a bare host (no scheme)', () => {
    expect(normalizeRepoUrl('github.com/acme/repo')).toBe('https://github.com/acme/repo');
  });

  it('ignores extra path segments', () => {
    expect(normalizeRepoUrl('https://github.com/acme/repo/tree/main')).toBe('https://github.com/acme/repo');
  });

  it('rejects non-GitHub hosts', () => {
    expect(normalizeRepoUrl('https://gitlab.com/acme/repo')).toBeNull();
  });

  it('rejects a URL with no repo path', () => {
    expect(normalizeRepoUrl('https://github.com/acme')).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(normalizeRepoUrl('not a url')).toBeNull();
    expect(normalizeRepoUrl('')).toBeNull();
  });
});
