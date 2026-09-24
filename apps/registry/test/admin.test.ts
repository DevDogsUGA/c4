import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { makeFormPayload, signedFormRequest } from './helpers';

describe('GET /admin', () => {
  it('rejects requests missing Cf-Access-Authenticated-User-Email', async () => {
    const res = await SELF.fetch('https://registry.test/admin');
    expect(res.status).toBe(401);
  });

  it('serves the admin page when the Access header is present', async () => {
    const res = await SELF.fetch('https://registry.test/admin', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'organizer@uga.edu' },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('organizer@uga.edu');
  });
});

describe('POST /admin/competition-started', () => {
  it('rejects requests missing the Access header', async () => {
    const res = await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      body: new URLSearchParams({ started: 'true' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a cross-origin submission (CSRF)', async () => {
    const res = await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      headers: { 'Cf-Access-Authenticated-User-Email': 'organizer@uga.edu', Origin: 'https://evil.example' },
      body: new URLSearchParams({ started: 'true' }),
    });
    expect(res.status).toBe(403);
  });

  it('toggles competition_started and it is reflected on the public status page', async () => {
    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));

    const toggle = await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Cf-Access-Authenticated-User-Email': 'organizer@uga.edu',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ started: 'true' }),
    });
    expect(toggle.status).toBe(303);

    const statusPage = await SELF.fetch('https://registry.test/');
    const html = await statusPage.text();
    expect(html).toContain('Competition in progress');
  });
});

describe('GET /admin/roster.csv', () => {
  it('rejects requests missing the Access header', async () => {
    const res = await SELF.fetch('https://registry.test/admin/roster.csv');
    expect(res.status).toBe(401);
  });

  it('returns a CSV with the registered team', async () => {
    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));

    const res = await SELF.fetch('https://registry.test/admin/roster.csv', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'organizer@uga.edu' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain(payload.team_name);
    expect(csv).toContain(payload.submitter_email);
  });
});
