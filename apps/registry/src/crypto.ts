/** HMAC-SHA256 signing/verification shared with the Apps Script. */

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function signHex(secret: string, rawBody: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return toHex(sig);
}

/** Constant-time hex string comparison (equal-length inputs only). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifySignature(
  secret: string,
  rawBody: string,
  signatureHex: string | null | undefined,
): Promise<boolean> {
  if (!signatureHex) return false;
  // Reject malformed hex up front rather than let it fall through to compare.
  if (!/^[0-9a-f]+$/i.test(signatureHex)) return false;
  const expected = await signHex(secret, rawBody);
  return timingSafeEqualHex(expected.toLowerCase(), signatureHex.toLowerCase());
}
