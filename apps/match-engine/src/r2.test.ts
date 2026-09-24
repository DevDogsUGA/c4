import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundleObjectKey, presignGetUrl, r2CredentialsFromEnv, uploadBundleToR2, uploadToR2, type R2Credentials } from './r2.js';

const creds: R2Credentials = {
  accountId: 'acct123',
  accessKeyId: 'AKIA-fake',
  secretAccessKey: 'secret-fake',
  bucket: 'c4-tournaments',
};

describe('r2CredentialsFromEnv', () => {
  const keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it('returns undefined when any required env var is missing', () => {
    expect(r2CredentialsFromEnv({})).toBeUndefined();
    expect(
      r2CredentialsFromEnv({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c' }),
    ).toBeUndefined();
  });

  it('builds credentials when all four are set', () => {
    expect(
      r2CredentialsFromEnv({
        R2_ACCOUNT_ID: 'a',
        R2_ACCESS_KEY_ID: 'b',
        R2_SECRET_ACCESS_KEY: 'c',
        R2_BUCKET: 'd',
      }),
    ).toEqual({ accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' });
  });
});

describe('bundleObjectKey', () => {
  it('builds a tournaments/<timestamp>.json key with no colons/periods (safe as a URL path segment)', () => {
    const key = bundleObjectKey(new Date('2026-09-24T18:30:00.123Z'));
    expect(key).toMatch(/^tournaments\/2026-09-24T18-30-00-123Z\.json$/);
  });
});

describe('uploadToR2 / presignGetUrl / uploadBundleToR2', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: Request) => {
      expect(input.method).toBe('PUT');
      expect(input.url).toContain(`https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}/`);
      // SigV4 auth header should be present on the signed request.
      expect(input.headers.get('authorization') ?? input.headers.get('Authorization')).toMatch(/^AWS4-HMAC-SHA256/);
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PUTs the body to the bucket at the given key', async () => {
    await uploadToR2(creds, 'tournaments/foo.json', '{"a":1}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws with the response status when the upload fails', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 403 }));
    await expect(uploadToR2(creds, 'tournaments/foo.json', '{}')).rejects.toThrow(/403/);
  });

  it('presignGetUrl returns a GET URL with SigV4 query params and a 7-day expiry', async () => {
    const url = await presignGetUrl(creds, 'tournaments/foo.json');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/${creds.bucket}/tournaments/foo.json`);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe(String(7 * 24 * 60 * 60));
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('uploadBundleToR2 uploads then returns a presigned URL for the same key it uploaded to', async () => {
    const at = new Date('2026-09-24T20:00:00.000Z');
    const url = await uploadBundleToR2(creds, '{"format":"c4-tournament-bundle"}', at);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url).toContain(bundleObjectKey(at));
  });
});
