import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { makeFormPayload, signedFormRequest, TEST_ENV } from './helpers';

async function roster(env: 'production' | 'staging' = 'production') {
  const res = await SELF.fetch(`https://registry.test/api/roster?env=${env}`, {
    headers: { Authorization: `Bearer ${TEST_ENV.ROSTER_TOKEN}` },
  });
  return (await res.json()) as { teams: Array<Record<string, unknown>> };
}

describe('POST /api/form', () => {
  it('rejects a request with a bad signature', async () => {
    const payload = makeFormPayload();
    const raw = JSON.stringify(payload);
    const res = await SELF.fetch('https://registry.test/api/form', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-C4-Signature': 'deadbeef'.repeat(8) },
      body: raw,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request with no signature header', async () => {
    const payload = makeFormPayload();
    const res = await SELF.fetch('https://registry.test/api/form', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a validly signed new registration and normalizes the repo URL', async () => {
    const payload = makeFormPayload({ repo_url: 'https://github.com/Acme/Repo.git' });
    const res = await SELF.fetch(await signedFormRequest(payload));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { team: { repo_url: string } };
    expect(body.team.repo_url).toBe('https://github.com/acme/repo');
  });

  it('rejects a non-GitHub repo URL', async () => {
    const payload = makeFormPayload({ repo_url: 'https://gitlab.com/acme/repo' });
    const res = await SELF.fetch(await signedFormRequest(payload));
    expect(res.status).toBe(422);
  });

  it('treats a second submission from the same email (new response_id) as an edit, not a duplicate', async () => {
    const email = 'edit-test@uga.edu';
    const first = makeFormPayload({ submitter_email: email, team_name: 'Original Name' });
    const r1 = await SELF.fetch(await signedFormRequest(first));
    expect(r1.status).toBe(201);

    const second = makeFormPayload({
      submitter_email: email,
      team_name: 'Renamed Team',
      response_id: 'a-totally-different-response-id',
    });
    const r2 = await SELF.fetch(await signedFormRequest(second));
    expect(r2.status).toBe(200); // updated, not created

    const { teams } = await roster();
    const matches = teams.filter((t) => t.submitter_email === email);
    expect(matches).toHaveLength(1);
    expect(matches[0].team_name).toBe('Renamed Team');
  });

  it('rejects a repo URL already claimed by a different team', async () => {
    const shared = 'https://github.com/shared-team/repo';
    const first = makeFormPayload({ repo_url: shared });
    const r1 = await SELF.fetch(await signedFormRequest(first));
    expect(r1.status).toBe(201);

    const second = makeFormPayload({ repo_url: shared });
    const r2 = await SELF.fetch(await signedFormRequest(second));
    expect(r2.status).toBe(409);
  });

  it('enforces the 32-team cap', async () => {
    for (let i = 0; i < 32; i++) {
      const res = await SELF.fetch(await signedFormRequest(makeFormPayload()));
      expect(res.status).toBe(201);
    }
    const overflow = await SELF.fetch(await signedFormRequest(makeFormPayload()));
    expect(overflow.status).toBe(403);
    const body = (await overflow.json()) as { error: string };
    expect(body.error).toMatch(/cap/i);
  });

  it('keeps staging registrations out of the production roster, cap, and dup checks', async () => {
    const shared = 'https://github.com/staging-only/repo';
    const staging1 = makeFormPayload({ repo_url: shared, env: 'staging' });
    const res1 = await SELF.fetch(await signedFormRequest(staging1));
    expect(res1.status).toBe(201);

    // Same repo_url, but as a production submission — should NOT collide
    // with the staging registration above.
    const prod = makeFormPayload({ repo_url: shared });
    const res2 = await SELF.fetch(await signedFormRequest(prod));
    expect(res2.status).toBe(201);

    const { teams: prodTeams } = await roster('production');
    const { teams: stagingTeams } = await roster('staging');
    expect(prodTeams.some((t) => t.repo_url === shared)).toBe(true);
    expect(stagingTeams.some((t) => t.repo_url === shared)).toBe(true);
    expect(stagingTeams.every((t) => !prodTeams.some((p) => p.id === t.id))).toBe(true);
  });
});
