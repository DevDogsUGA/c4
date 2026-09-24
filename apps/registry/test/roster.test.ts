import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { makeFormPayload, signedFormRequest, TEST_ENV } from './helpers';

describe('GET /api/roster', () => {
  it('rejects requests with no bearer token', async () => {
    const res = await SELF.fetch('https://registry.test/api/roster');
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong bearer token', async () => {
    const res = await SELF.fetch('https://registry.test/api/roster', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns the roster shape from the shared-interfaces contract', async () => {
    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));

    const res = await SELF.fetch('https://registry.test/api/roster', {
      headers: { Authorization: `Bearer ${TEST_ENV.ROSTER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { teams: Array<Record<string, unknown>> };
    expect(Array.isArray(body.teams)).toBe(true);
    const team = body.teams.find((t) => t.submitter_email === payload.submitter_email);
    expect(team).toMatchObject({
      team_name: payload.team_name,
      repo_url: payload.repo_url,
      members: payload.members,
      submitter_email: payload.submitter_email,
    });
    expect(typeof team!.id).toBe('number');
    expect(typeof team!.updated_at).toBe('string');
    // Exactly the contract shape, no leaking internal columns like env/response_id.
    expect(Object.keys(team!).sort()).toEqual(
      ['id', 'members', 'repo_url', 'submitter_email', 'team_name', 'updated_at'].sort(),
    );
  });
});
