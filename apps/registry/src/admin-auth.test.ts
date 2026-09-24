import { beforeEach, describe, expect, it } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import { _resetAccessCertsCacheForTests, authenticateAdmin, isAllowedAdminEmail, verifyAccessJwt } from './admin-auth';

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

// ---------------------------------------------------------------------------
// JWT verification: a self-contained RSA keypair generated in this file,
// with a fake `/cdn-cgi/access/certs` endpoint served via mocked fetch —
// exercising the exact WebCrypto verification path the Worker uses against
// real Cloudflare Access tokens.
// ---------------------------------------------------------------------------

const TEAM_DOMAIN = 'unit-test-team.cloudflareaccess.com';
const AUD = 'unit-test-aud-tag';

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s));
}

interface MintOptions {
  email?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  kid?: string;
  alg?: string;
  signingKey?: CryptoKey;
  badSignature?: boolean;
}

async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as Promise<CryptoKeyPair>;
}

async function mintJwt(privateKey: CryptoKey, kid: string, opts: MintOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: opts.alg ?? 'RS256', typ: 'JWT', kid: opts.kid ?? kid };
  const payload = {
    email: opts.email ?? 'organizer@uga.edu',
    aud: opts.aud ?? AUD,
    iss: opts.iss ?? `https://${TEAM_DOMAIN}`,
    iat: now - 10,
    nbf: opts.nbf ?? now - 10,
    exp: opts.exp ?? now + 3600,
  };
  const headerB64 = base64UrlEncodeString(JSON.stringify(header));
  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  if (opts.badSignature) {
    return `${signingInput}.${base64UrlEncodeString('forged-signature-bytes')}`;
  }

  const key = opts.signingKey ?? privateKey;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(sig))}`;
}

// Generated once and reused across tests: fetchMock's mock pool for a given
// origin queues interceptors rather than replacing them, so re-registering
// a *different* persisted key every test would leave earlier tests' keys
// permanently first in that queue (undici matches the oldest not-yet-
// consumed interceptor). A single stable keypair, re-registered with
// identical contents each test, sidesteps that entirely.
let keyPairPromise: Promise<CryptoKeyPair> | null = null;
function sharedKeyPair(): Promise<CryptoKeyPair> {
  if (!keyPairPromise) keyPairPromise = generateRsaKeyPair();
  return keyPairPromise;
}
const KID = 'unit-test-kid';

describe('verifyAccessJwt / authenticateAdmin', () => {
  let keyPair: CryptoKeyPair;
  const kid = KID;

  beforeEach(async () => {
    keyPair = await sharedKeyPair();
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    // fetchMock is reset (activate()) by test/setup.ts's global beforeEach.
    // admin-auth's in-memory certs cache is reset there too, so every test
    // starts cold and re-fetches (matching this re-registered mock).
    const mock = fetchMock.get(`https://${TEAM_DOMAIN}`);
    mock
      .intercept({ path: '/cdn-cgi/access/certs', method: 'GET' })
      .reply(200, { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] })
      .persist();
  });

  function env(overrides: Partial<{ ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; ADMIN_EMAILS: string }> = {}) {
    return { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD, ...overrides };
  }

  it('accepts a validly signed, current, correctly-scoped JWT', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { email: 'organizer@uga.edu' });
    const claims = await verifyAccessJwt(token, TEAM_DOMAIN, AUD);
    expect(claims?.email).toBe('organizer@uga.edu');
  });

  it('rejects a forged signature', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { badSignature: true });
    expect(await verifyAccessJwt(token, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('rejects a token signed by a key never published on the certs endpoint', async () => {
    const rogue = await generateRsaKeyPair();
    const token = await mintJwt(rogue.privateKey, kid);
    expect(await verifyAccessJwt(token, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { exp: Math.floor(Date.now() / 1000) - 120 });
    expect(await verifyAccessJwt(token, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('rejects a not-yet-valid token (nbf in the future)', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { nbf: Math.floor(Date.now() / 1000) + 120 });
    expect(await verifyAccessJwt(token, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('rejects the wrong audience', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { aud: 'not-the-configured-aud' });
    expect(await verifyAccessJwt(token, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('accepts when aud is an array containing the configured audience', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { aud: ['other-aud', AUD] });
    expect((await verifyAccessJwt(token, TEAM_DOMAIN, AUD))?.email).toBe('organizer@uga.edu');
  });

  it('rejects the wrong issuer', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { iss: 'https://someone-elses-team.cloudflareaccess.com' });
    expect(await verifyAccessJwt(token, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('rejects a malformed token', async () => {
    expect(await verifyAccessJwt('not.a.jwt.at.all', TEAM_DOMAIN, AUD)).toBeNull();
    expect(await verifyAccessJwt('garbage', TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('rejects a non-RS256 alg header', async () => {
    const token = await mintJwt(keyPair.privateKey, kid, { alg: 'none' });
    expect(await verifyAccessJwt(token, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it('handles key rotation: refetches certs once on an unrecognized kid', async () => {
    // Use a dedicated domain/mock pool for this test rather than the shared
    // (persisted) TEAM_DOMAIN mock above: undici's mock pool matches the
    // oldest not-yet-consumed interceptor for a given path, so two
    // *different* persisted responses queued on the same pool would starve
    // the second one forever. Two single-use (non-persist) interceptors on
    // their own pool, consumed in order, cleanly model "the certs endpoint
    // used to serve key A, now serves key B".
    const rotationDomain = 'rotation.unit-test-team.cloudflareaccess.com';

    const original = await sharedKeyPair();
    const originalJwk = await crypto.subtle.exportKey('jwk', original.publicKey);
    fetchMock
      .get(`https://${rotationDomain}`)
      .intercept({ path: '/cdn-cgi/access/certs', method: 'GET' })
      .reply(200, { keys: [{ ...originalJwk, kid: KID, alg: 'RS256', use: 'sig' }] });

    // Warm the cache with the original key first.
    const originalToken = await mintJwt(original.privateKey, KID, { iss: `https://${rotationDomain}` });
    expect((await verifyAccessJwt(originalToken, rotationDomain, AUD))?.email).toBe('organizer@uga.edu');

    // Rotate: a new keypair signs the token, and the certs endpoint now
    // serves only the new key under a new kid, simulating Access having
    // rotated keys server-side after our in-memory cache was warmed.
    const rotated = await generateRsaKeyPair();
    const rotatedKid = 'rotated-kid';
    const rotatedJwk = await crypto.subtle.exportKey('jwk', rotated.publicKey);
    fetchMock
      .get(`https://${rotationDomain}`)
      .intercept({ path: '/cdn-cgi/access/certs', method: 'GET' })
      .reply(200, { keys: [{ ...rotatedJwk, kid: rotatedKid, alg: 'RS256', use: 'sig' }] });

    const rotatedToken = await mintJwt(rotated.privateKey, rotatedKid, {
      kid: rotatedKid,
      iss: `https://${rotationDomain}`,
    });
    const claims = await verifyAccessJwt(rotatedToken, rotationDomain, AUD);
    expect(claims?.email).toBe('organizer@uga.edu');
  });

  describe('authenticateAdmin', () => {
    function reqWith(headers: Record<string, string>) {
      return { req: { header: (n: string) => headers[n] } };
    }

    it('returns 503 when ACCESS_TEAM_DOMAIN is missing (fails closed, never trusts the plain header)', async () => {
      const result = await authenticateAdmin({
        ...reqWith({ 'Cf-Access-Authenticated-User-Email': 'organizer@uga.edu' }),
        env: env({ ACCESS_TEAM_DOMAIN: undefined as unknown as string }),
      });
      expect(result).toEqual({ ok: false, status: 503, error: 'admin not configured' });
    });

    it('returns 503 when ACCESS_AUD is missing', async () => {
      const result = await authenticateAdmin({
        ...reqWith({}),
        env: env({ ACCESS_AUD: undefined as unknown as string }),
      });
      expect(result).toEqual({ ok: false, status: 503, error: 'admin not configured' });
    });

    it('returns 403 for a plain spoofed Cf-Access-Authenticated-User-Email header with no JWT', async () => {
      const result = await authenticateAdmin({
        ...reqWith({ 'Cf-Access-Authenticated-User-Email': 'organizer@uga.edu' }),
        env: env(),
      });
      expect(result).toEqual({ ok: false, status: 403, error: 'unauthorized' });
    });

    it('returns 200-equivalent ok:true for a valid JWT, taking the email from the verified claim', async () => {
      const token = await mintJwt(keyPair.privateKey, kid, { email: 'organizer@uga.edu' });
      const result = await authenticateAdmin({
        ...reqWith({
          'Cf-Access-Jwt-Assertion': token,
          // A spoofed header claiming a different identity must be ignored.
          'Cf-Access-Authenticated-User-Email': 'attacker@evil.example',
        }),
        env: env(),
      });
      expect(result).toEqual({ ok: true, email: 'organizer@uga.edu' });
    });

    it('reads the token from the CF_Authorization cookie when no JWT header is present', async () => {
      const token = await mintJwt(keyPair.privateKey, kid, { email: 'organizer@uga.edu' });
      const result = await authenticateAdmin({
        ...reqWith({ Cookie: `foo=bar; CF_Authorization=${token}` }),
        env: env(),
      });
      expect(result).toEqual({ ok: true, email: 'organizer@uga.edu' });
    });

    it('returns 403 for a forged/expired/wrong-aud/wrong-iss token', async () => {
      const forged = await mintJwt(keyPair.privateKey, kid, { badSignature: true });
      const expired = await mintJwt(keyPair.privateKey, kid, { exp: Math.floor(Date.now() / 1000) - 3600 });
      const wrongAud = await mintJwt(keyPair.privateKey, kid, { aud: 'wrong-aud' });
      const wrongIss = await mintJwt(keyPair.privateKey, kid, { iss: 'https://not-us.cloudflareaccess.com' });

      for (const token of [forged, expired, wrongAud, wrongIss]) {
        const result = await authenticateAdmin({ ...reqWith({ 'Cf-Access-Jwt-Assertion': token }), env: env() });
        expect(result).toEqual({ ok: false, status: 403, error: 'unauthorized' });
      }
    });

    it('applies the ADMIN_EMAILS allowlist after verifying the JWT', async () => {
      const allowedToken = await mintJwt(keyPair.privateKey, kid, { email: 'allowed@uga.edu' });
      const disallowedToken = await mintJwt(keyPair.privateKey, kid, { email: 'nope@uga.edu' });
      const allowlistEnv = env({ ADMIN_EMAILS: 'allowed@uga.edu' });

      expect(
        await authenticateAdmin({ ...reqWith({ 'Cf-Access-Jwt-Assertion': allowedToken }), env: allowlistEnv }),
      ).toEqual({ ok: true, email: 'allowed@uga.edu' });

      expect(
        await authenticateAdmin({ ...reqWith({ 'Cf-Access-Jwt-Assertion': disallowedToken }), env: allowlistEnv }),
      ).toEqual({ ok: false, status: 403, error: 'unauthorized' });
    });
  });
});
