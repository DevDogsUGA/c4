import { beforeEach, describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { upsertRepoStatus } from '../src/db';
import { makeFormPayload, signedFormRequest, TEST_ENV } from './helpers';
import { accessHeaders, mockAccessCerts, signAccessJwt } from './access-jwt';

beforeEach(async () => {
  await mockAccessCerts();
});

function resultsRequest(body: Record<string, unknown>) {
  return new Request('https://registry.test/api/results', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TEST_ENV.RESULTS_TOKEN}` },
    body: JSON.stringify(body),
  });
}

describe('GET / (public status page)', () => {
  it('shows repo reachability before the competition starts', async () => {
    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));
    await upsertRepoStatus(TEST_ENV.DB, {
      repo_url: payload.repo_url,
      reachability: 'reachable',
      latest_commit: 'deadbeef',
      actions_status: 'unknown',
      actions_run_url: null,
      checked_at: new Date().toISOString(),
    });

    const res = await SELF.fetch('https://registry.test/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(payload.team_name);
    expect(html).toContain('reachable');
    expect(html).toContain('Registration / pre-competition');
  });

  it('shows GitHub Actions status after the competition starts, and never leaks arena results', async () => {
    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));
    await upsertRepoStatus(TEST_ENV.DB, {
      repo_url: payload.repo_url,
      reachability: 'reachable',
      latest_commit: 'deadbeef',
      actions_status: 'success',
      actions_run_url: 'https://github.com/x/y/actions/runs/1',
      checked_at: new Date().toISOString(),
    });

    const secretDetail = 'ARENA-ONLY-DETAIL-MARKER';
    await SELF.fetch(
      resultsRequest({
        repo_url: payload.repo_url,
        commit: 'c1',
        status: 'failed',
        stage: 'smoke',
        detail: secretDetail,
        at: new Date().toISOString(),
      }),
    );

    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      redirect: 'manual',
      headers: { ...accessHeaders(token), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ started: 'true' }),
    });

    const res = await SELF.fetch('https://registry.test/');
    const html = await res.text();
    expect(html).toContain('CI passing');
    expect(html).not.toContain(secretDetail);
    expect(html).not.toContain('ARENA');

    // But the admin page (with proper auth) does show the arena result detail.
    const adminRes = await SELF.fetch('https://registry.test/admin', {
      headers: accessHeaders(token),
    });
    const adminHtml = await adminRes.text();
    expect(adminHtml).toContain(secretDetail);
  });
});
