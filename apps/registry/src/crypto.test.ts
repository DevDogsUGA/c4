import { describe, expect, it } from 'vitest';
import { signHex, verifySignature } from './crypto';

describe('HMAC signature verification', () => {
  const secret = 'shhh';
  const body = JSON.stringify({ response_id: 'r1', a: 1 });

  it('accepts a correctly signed body', async () => {
    const sig = await signHex(secret, body);
    expect(await verifySignature(secret, body, sig)).toBe(true);
  });

  it('is case-insensitive on the hex signature', async () => {
    const sig = await signHex(secret, body);
    expect(await verifySignature(secret, body, sig.toUpperCase())).toBe(true);
  });

  it('rejects a signature for a different body', async () => {
    const sig = await signHex(secret, body);
    expect(await verifySignature(secret, body + 'x', sig)).toBe(false);
  });

  it('rejects a signature made with a different secret', async () => {
    const sig = await signHex('other-secret', body);
    expect(await verifySignature(secret, body, sig)).toBe(false);
  });

  it('rejects a missing signature', async () => {
    expect(await verifySignature(secret, body, undefined)).toBe(false);
    expect(await verifySignature(secret, body, null)).toBe(false);
    expect(await verifySignature(secret, body, '')).toBe(false);
  });

  it('rejects non-hex garbage without throwing', async () => {
    expect(await verifySignature(secret, body, 'not-hex!!')).toBe(false);
  });
});
