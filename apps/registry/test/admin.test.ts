import { beforeEach, describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { makeFormPayload, signedFormRequest } from './helpers';
import { accessHeaders, mockAccessCerts, signAccessJwt } from './access-jwt';

beforeEach(async () => {
  await mockAccessCerts();
});

describe('GET /admin', () => {
  it('rejects requests missing any Access token', async () => {
    const res = await SELF.fetch('https://registry.test/admin');
    expect(res.status).toBe(403);
  });

  it('rejects a plain spoofed Cf-Access-Authenticated-User-Email header without a JWT', async () => {
    const res = await SELF.fetch('https://registry.test/admin', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'organizer@uga.edu' },
    });
    expect(res.status).toBe(403);
  });

  it('serves the admin page when a valid Access JWT is presented', async () => {
    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    const res = await SELF.fetch('https://registry.test/admin', { headers: accessHeaders(token) });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('organizer@uga.edu');
  });

  it('accepts the JWT from a CF_Authorization cookie', async () => {
    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    const res = await SELF.fetch('https://registry.test/admin', {
      headers: { Cookie: `CF_Authorization=${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a JWT with a bad/forged signature', async () => {
    const token = await signAccessJwt({ badSignature: true });
    const res = await SELF.fetch('https://registry.test/admin', { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it('rejects a JWT signed by a key not published on the certs endpoint', async () => {
    const token = await signAccessJwt({ useRogueKey: true });
    const res = await SELF.fetch('https://registry.test/admin', { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it('rejects an expired JWT', async () => {
    const token = await signAccessJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });
    const res = await SELF.fetch('https://registry.test/admin', { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it('rejects a JWT with the wrong audience', async () => {
    const token = await signAccessJwt({ aud: 'someone-elses-aud-tag' });
    const res = await SELF.fetch('https://registry.test/admin', { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it('rejects a JWT with the wrong issuer', async () => {
    const token = await signAccessJwt({ iss: 'https://someone-elses-team.cloudflareaccess.com' });
    const res = await SELF.fetch('https://registry.test/admin', { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it('rejects a malformed token', async () => {
    const res = await SELF.fetch('https://registry.test/admin', {
      headers: accessHeaders('not-a-jwt'),
    });
    expect(res.status).toBe(403);
  });

  it('503s when admin auth is unconfigured (missing ACCESS_TEAM_DOMAIN/ACCESS_AUD)', async () => {
    const { app } = await import('../src/index');
    const { createExecutionContext } = await import('cloudflare:test');
    const { TEST_ENV } = await import('./helpers');
    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    const env = { ...(TEST_ENV as unknown as Record<string, unknown>), ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined };
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request('https://registry.test/admin', { headers: accessHeaders(token) }),
      env as never,
      ctx,
    );
    expect(res.status).toBe(503);
  });

  it('enforces the ADMIN_EMAILS allowlist against the verified email claim', async () => {
    const { app } = await import('../src/index');
    const { createExecutionContext } = await import('cloudflare:test');
    const { TEST_ENV } = await import('./helpers');
    const env = { ...(TEST_ENV as unknown as Record<string, unknown>), ADMIN_EMAILS: 'allowed@uga.edu' };
    const ctx = createExecutionContext();

    const disallowed = await signAccessJwt({ email: 'not-allowed@uga.edu' });
    const rejected = await app.fetch(
      new Request('https://registry.test/admin', { headers: accessHeaders(disallowed) }),
      env as never,
      ctx,
    );
    expect(rejected.status).toBe(403);

    const allowed = await signAccessJwt({ email: 'allowed@uga.edu' });
    const accepted = await app.fetch(
      new Request('https://registry.test/admin', { headers: accessHeaders(allowed) }),
      env as never,
      ctx,
    );
    expect(accepted.status).toBe(200);
  });
});

describe('POST /admin/competition-started', () => {
  it('rejects requests missing the Access token', async () => {
    const res = await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      body: new URLSearchParams({ started: 'true' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a cross-origin submission (CSRF)', async () => {
    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    const res = await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      headers: { ...accessHeaders(token), Origin: 'https://evil.example' },
      body: new URLSearchParams({ started: 'true' }),
    });
    expect(res.status).toBe(403);
  });

  it('toggles competition_started and it is reflected on the public status page', async () => {
    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));

    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    const toggle = await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      redirect: 'manual',
      headers: { ...accessHeaders(token), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ started: 'true' }),
    });
    expect(toggle.status).toBe(303);

    const statusPage = await SELF.fetch('https://registry.test/');
    const html = await statusPage.text();
    expect(html).toContain('Competition in progress');
  });
});

describe('GET /admin/roster.csv', () => {
  it('rejects requests missing the Access token', async () => {
    const res = await SELF.fetch('https://registry.test/admin/roster.csv');
    expect(res.status).toBe(403);
  });

  it('returns a CSV with the registered team', async () => {
    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));

    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    const res = await SELF.fetch('https://registry.test/admin/roster.csv', { headers: accessHeaders(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain(payload.team_name);
    expect(csv).toContain(payload.submitter_email);
  });
});
