/**
 * Admin authentication: verifies a real Cloudflare Access JWT rather than
 * trusting the plain `Cf-Access-Authenticated-User-Email` request header.
 *
 * That header is set by Cloudflare Access at the edge, but it is just an
 * ordinary HTTP header — any client that can reach the Worker directly
 * (a workers.dev URL, or any Access path rule that doesn't happen to match
 * some casing/encoding of the request) can forge it. The `Cf-Access-Jwt-
 * Assertion` header (or the `CF_Authorization` cookie) carries a signed
 * RS256 JWT instead; we verify its signature against the team's public keys
 * and only then trust the `email` claim inside it.
 */

export interface AccessEnv {
  /** Zero Trust team domain, e.g. "devdogs.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's Audience (AUD) tag. */
  ACCESS_AUD?: string;
  /** Optional comma-separated allowlist on top of Access authentication. */
  ADMIN_EMAILS?: string;
}

interface AccessClaims {
  email: string;
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  iat?: number;
  [key: string]: unknown;
}

const CERTS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_LEEWAY_SECONDS = 60;

interface CertsCacheEntry {
  domain: string;
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

let certsCache: CertsCacheEntry | null = null;

/** Test-only: clear the in-memory certs cache between tests/keypairs. */
export function _resetAccessCertsCacheForTests(): void {
  certsCache = null;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(b64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

/** JsonWebKey plus the `kid` field (present on real keys, but not part of the DOM lib type). */
type JwkWithKid = JsonWebKey & { kid?: string };

async function fetchAccessCerts(domain: string): Promise<Map<string, CryptoKey>> {
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`failed to fetch Access certs (${res.status})`);
  const body = (await res.json()) as { keys?: JwkWithKid[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keys.set(jwk.kid, key);
    } catch {
      // Skip keys we can't import (unexpected alg/kty); other kids may work.
    }
  }
  return keys;
}

/**
 * Resolves the verification key for `kid`, using a short-lived in-memory
 * cache. On a cache miss (including an unrecognized kid, which happens
 * during Access's key rotation) it refetches the certs endpoint once.
 */
async function getSigningKey(domain: string, kid: string): Promise<CryptoKey | null> {
  const cacheIsFresh =
    certsCache !== null && certsCache.domain === domain && Date.now() - certsCache.fetchedAt < CERTS_CACHE_TTL_MS;
  if (cacheIsFresh) {
    const key = certsCache!.keys.get(kid);
    if (key) return key;
  }
  const keys = await fetchAccessCerts(domain);
  certsCache = { domain, keys, fetchedAt: Date.now() };
  return keys.get(kid) ?? null;
}

/**
 * Verifies a Cloudflare Access JWT: RS256 signature against the team's
 * published keys, plus `aud`, `iss`, `exp`, and `nbf` (with small leeway).
 * Returns the verified claims, or null if anything doesn't check out.
 */
export async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<AccessClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  let header: { alg?: string; kid?: string };
  let payload: AccessClaims;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let key: CryptoKey | null;
  try {
    key = await getSigningKey(teamDomain, header.kid);
  } catch {
    return null;
  }
  if (!key) return null;

  let signature: Uint8Array;
  try {
    signature = base64UrlToBytes(sigB64);
  } catch {
    return null;
  }
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, signedData);
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || now > payload.exp + CLOCK_LEEWAY_SECONDS) return null;
  if (typeof payload.nbf === 'number' && now < payload.nbf - CLOCK_LEEWAY_SECONDS) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;

  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(aud)) return null;

  if (typeof payload.email !== 'string' || !payload.email) return null;

  return payload;
}

function accessTokenFromRequest(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const jwtHeader = c.req.header('Cf-Access-Jwt-Assertion');
  if (jwtHeader) return jwtHeader;

  const cookie = c.req.header('Cookie');
  if (!cookie) return null;
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Whether an email verified by Cloudflare Access is allowed to use /admin.
 * Cloudflare Access itself (plus JWT verification above) authenticates the
 * caller; this is an optional extra allowlist on top of that.
 */
export function isAllowedAdminEmail(email: string | null | undefined, allowlistCsv: string | undefined): boolean {
  if (!email) return false;
  const allowlist = (allowlistCsv ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return allowlist.includes(email.toLowerCase());
}

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 403; error: 'unauthorized' }
  | { ok: false; status: 503; error: 'admin not configured' };

/**
 * Authenticates an admin request. Fails closed: if ACCESS_TEAM_DOMAIN or
 * ACCESS_AUD isn't configured, returns 503 rather than trusting any header.
 * Otherwise requires a verified Access JWT (never the plain
 * Cf-Access-Authenticated-User-Email header) whose email claim passes the
 * ADMIN_EMAILS allowlist, if one is set.
 */
export async function authenticateAdmin(c: {
  req: { header: (name: string) => string | undefined };
  env: AccessEnv;
}): Promise<AdminAuthResult> {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAILS } = c.env;
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD) {
    return { ok: false, status: 503, error: 'admin not configured' };
  }

  const token = accessTokenFromRequest(c);
  if (!token) return { ok: false, status: 403, error: 'unauthorized' };

  const claims = await verifyAccessJwt(token, ACCESS_TEAM_DOMAIN, ACCESS_AUD);
  if (!claims) return { ok: false, status: 403, error: 'unauthorized' };

  if (!isAllowedAdminEmail(claims.email, ADMIN_EMAILS)) {
    return { ok: false, status: 403, error: 'unauthorized' };
  }

  return { ok: true, email: claims.email };
}
