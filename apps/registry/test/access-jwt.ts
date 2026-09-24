/**
 * Test helper: mints Cloudflare Access-shaped JWTs signed by an in-memory
 * RSA keypair, and mocks the `/cdn-cgi/access/certs` endpoint the Worker
 * fetches to verify them. Mirrors the real Access JWT shape closely enough
 * to exercise src/admin-auth.ts's verification end to end.
 */
import { fetchMock } from 'cloudflare:test';

/** Matches the ACCESS_TEAM_DOMAIN / ACCESS_AUD test bindings in vitest.config.ts. */
export const ACCESS_TEAM_DOMAIN = 'access.test';
export const ACCESS_AUD = 'test-audience-tag';

interface TestKeyPair {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  kid: string;
}

let keyPairPromise: Promise<TestKeyPair> | null = null;

function getKeyPair(): Promise<TestKeyPair> {
  if (!keyPairPromise) {
    keyPairPromise = (async () => {
      const { privateKey, publicKey } = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      );
      const exported = await crypto.subtle.exportKey('jwk', publicKey);
      const kid = 'test-key-1';
      return { privateKey, publicJwk: { ...exported, kid, alg: 'RS256', use: 'sig' }, kid };
    })();
  }
  return keyPairPromise;
}

/** A second, never-registered keypair, for signing with an unknown/wrong key. */
let rogueKeyPairPromise: Promise<TestKeyPair> | null = null;

function getRogueKeyPair(): Promise<TestKeyPair> {
  if (!rogueKeyPairPromise) {
    rogueKeyPairPromise = (async () => {
      const { privateKey, publicKey } = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      );
      const exported = await crypto.subtle.exportKey('jwk', publicKey);
      const kid = 'rogue-key';
      return { privateKey, publicJwk: { ...exported, kid, alg: 'RS256', use: 'sig' }, kid };
    })();
  }
  return rogueKeyPairPromise;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s));
}

export interface AccessJwtOverrides {
  email?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  kid?: string;
  alg?: string;
  /** Sign with a keypair that was never published on the mocked certs endpoint. */
  useRogueKey?: boolean;
  /** Tamper with the signature after signing, to simulate a forged token. */
  badSignature?: boolean;
}

/** Mints a signed Cloudflare Access-style JWT for tests. */
export async function signAccessJwt(overrides: AccessJwtOverrides = {}): Promise<string> {
  const { privateKey, kid } = overrides.useRogueKey ? await getRogueKeyPair() : await getKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: overrides.alg ?? 'RS256', typ: 'JWT', kid: overrides.kid ?? kid };
  const payload = {
    email: overrides.email ?? 'organizer@uga.edu',
    aud: overrides.aud ?? ACCESS_AUD,
    iss: overrides.iss ?? `https://${ACCESS_TEAM_DOMAIN}`,
    iat: now - 10,
    nbf: overrides.nbf ?? now - 10,
    exp: overrides.exp ?? now + 3600,
  };
  const headerB64 = base64UrlEncodeString(JSON.stringify(header));
  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  if (overrides.badSignature) {
    return `${signingInput}.${base64UrlEncodeString('this-is-not-a-real-signature')}`;
  }

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput));
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sig));
  return `${signingInput}.${sigB64}`;
}

/**
 * Registers a mocked `https://ACCESS_TEAM_DOMAIN/cdn-cgi/access/certs`
 * response serving the (real, verification-only-key) public JWK, so
 * src/admin-auth.ts's fetch of Access's certs endpoint resolves in tests.
 * Persists across repeated requests within the test.
 */
export async function mockAccessCerts(): Promise<void> {
  const { publicJwk } = await getKeyPair();
  const mock = fetchMock.get(`https://${ACCESS_TEAM_DOMAIN}`);
  mock.intercept({ path: '/cdn-cgi/access/certs', method: 'GET' }).reply(200, { keys: [publicJwk] }).persist();
}

export function accessHeaders(token: string): Record<string, string> {
  return { 'Cf-Access-Jwt-Assertion': token };
}
