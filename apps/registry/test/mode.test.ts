import { describe, expect, it } from 'vitest';
import { createExecutionContext } from 'cloudflare:test';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { makeFormPayload, TEST_ENV } from './helpers';
import { signHex } from '../src/crypto';

function envWithMode(mode: Env['MODE']): Env {
  return { ...(TEST_ENV as unknown as Env), MODE: mode };
}

async function call(env: Env, path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  return app.fetch(new Request(`https://registry.test${path}`, init), env, ctx);
}

describe('MODE routing', () => {
  it('MODE unset serves both public and admin routes (single-Worker/custom-domain topology)', async () => {
    const env = envWithMode(undefined);
    expect((await call(env, '/health')).status).toBe(200);
    expect((await call(env, '/')).status).toBe(200);
    expect(
      (await call(env, '/admin', { headers: { 'Cf-Access-Authenticated-User-Email': 'o@uga.edu' } })).status,
    ).toBe(200);
  });

  it("MODE=public serves public routes and 404s /admin*", async () => {
    const env = envWithMode('public');
    expect((await call(env, '/health')).status).toBe(200);
    expect((await call(env, '/')).status).toBe(200);
    expect((await call(env, '/api/roster', { headers: { Authorization: `Bearer ${env.ROSTER_TOKEN}` } })).status).toBe(
      200,
    );
    expect(
      (await call(env, '/admin', { headers: { 'Cf-Access-Authenticated-User-Email': 'o@uga.edu' } })).status,
    ).toBe(404);
    expect((await call(env, '/admin/roster.csv')).status).toBe(404);
  });

  it('MODE=admin serves the admin UI at both / and /admin, and 404s public routes', async () => {
    const env = envWithMode('admin');

    const rootRes = await call(env, '/', { headers: { 'Cf-Access-Authenticated-User-Email': 'o@uga.edu' } });
    expect(rootRes.status).toBe(200);
    expect(await rootRes.text()).toContain('Admin');

    const adminRes = await call(env, '/admin', { headers: { 'Cf-Access-Authenticated-User-Email': 'o@uga.edu' } });
    expect(adminRes.status).toBe(200);

    // Public routes are not served from the admin deployment.
    expect((await call(env, '/health')).status).toBe(404);
    expect((await call(env, '/api/roster', { headers: { Authorization: `Bearer ${env.ROSTER_TOKEN}` } })).status).toBe(
      404,
    );

    const payload = makeFormPayload();
    const raw = JSON.stringify(payload);
    const sig = await signHex(env.FORM_HMAC_SECRET, raw);
    const formRes = await call(env, '/api/form', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-C4-Signature': sig },
      body: raw,
    });
    expect(formRes.status).toBe(404);
  });

  it('MODE=admin still requires the Access header on /', async () => {
    const env = envWithMode('admin');
    const res = await call(env, '/');
    expect(res.status).toBe(401);
  });
});
