import { beforeEach, describe, expect, it } from 'vitest';
import { createExecutionContext } from 'cloudflare:test';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { makeFormPayload, TEST_ENV } from './helpers';
import { signHex } from '../src/crypto';
import { accessHeaders, mockAccessCerts, signAccessJwt } from './access-jwt';

beforeEach(async () => {
  await mockAccessCerts();
});

function envWithMode(mode: Env['MODE']): Env {
  return { ...(TEST_ENV as unknown as Env), MODE: mode };
}

async function call(env: Env, path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  return app.fetch(new Request(`https://registry.test${path}`, init), env, ctx);
}

describe('MODE routing', () => {
  it('MODE unset behaves like public: serves public routes, 404s /admin*', async () => {
    const env = envWithMode(undefined);
    const token = await signAccessJwt({ email: 'o@uga.edu' });
    expect((await call(env, '/health')).status).toBe(200);
    expect((await call(env, '/')).status).toBe(200);
    expect((await call(env, '/admin', { headers: accessHeaders(token) })).status).toBe(404);
    expect((await call(env, '/admin/roster.csv')).status).toBe(404);
  });

  it("MODE=public serves public routes and 404s /admin*", async () => {
    const env = envWithMode('public');
    const token = await signAccessJwt({ email: 'o@uga.edu' });
    expect((await call(env, '/health')).status).toBe(200);
    expect((await call(env, '/')).status).toBe(200);
    expect((await call(env, '/api/roster', { headers: { Authorization: `Bearer ${env.ROSTER_TOKEN}` } })).status).toBe(
      200,
    );
    expect((await call(env, '/admin', { headers: accessHeaders(token) })).status).toBe(404);
    expect((await call(env, '/admin/roster.csv')).status).toBe(404);
  });

  it('MODE=admin serves the admin UI at both / and /admin, and 404s public routes', async () => {
    const env = envWithMode('admin');
    const token = await signAccessJwt({ email: 'o@uga.edu' });

    const rootRes = await call(env, '/', { headers: accessHeaders(token) });
    expect(rootRes.status).toBe(200);
    expect(await rootRes.text()).toContain('Admin');

    const adminRes = await call(env, '/admin', { headers: accessHeaders(token) });
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

  it('MODE=admin still requires a valid Access token on /', async () => {
    const env = envWithMode('admin');
    const res = await call(env, '/');
    expect(res.status).toBe(403);
  });

  it('MODE=both serves every route, including /admin*, from one Worker', async () => {
    const env = envWithMode('both');
    const token = await signAccessJwt({ email: 'o@uga.edu' });
    expect((await call(env, '/health')).status).toBe(200);
    expect((await call(env, '/')).status).toBe(200);
    expect((await call(env, '/admin', { headers: accessHeaders(token) })).status).toBe(200);
  });

  it('admin routes 503 when ACCESS_TEAM_DOMAIN/ACCESS_AUD are unconfigured, regardless of MODE', async () => {
    const env = { ...envWithMode('both'), ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined };
    const token = await signAccessJwt({ email: 'o@uga.edu' });
    expect((await call(env, '/admin', { headers: accessHeaders(token) })).status).toBe(503);
  });
});
