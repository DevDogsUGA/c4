import { describe, expect, it } from 'vitest';
import { SELF, fetchMock } from 'cloudflare:test';
import { makeFormPayload, signedFormRequest, TEST_ENV } from './helpers';

function resultsRequest(body: Record<string, unknown>) {
  return new Request('https://registry.test/api/results', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TEST_ENV.RESULTS_TOKEN}` },
    body: JSON.stringify(body),
  });
}

describe('POST /api/results', () => {
  it('rejects requests without the results bearer token', async () => {
    const res = await SELF.fetch('https://registry.test/api/results', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid status/stage', async () => {
    const res = await SELF.fetch(
      resultsRequest({ repo_url: 'https://github.com/a/b', commit: 'abc', status: 'bogus', stage: 'build', at: 'now' }),
    );
    expect(res.status).toBe(400);
  });

  it('records a result and posts to Discord on first status (change from nothing)', async () => {
    const mockPool = fetchMock.get('https://discord.test');
    mockPool.intercept({ path: '/webhook', method: 'POST' }).reply(204, '');

    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));

    const res = await SELF.fetch(
      resultsRequest({
        repo_url: payload.repo_url,
        commit: 'abcdef1234567890',
        status: 'building',
        stage: 'checkout',
        at: new Date().toISOString(),
      }),
    );
    expect(res.status).toBe(200);
    fetchMock.assertNoPendingInterceptors();
  });

  it('only posts to Discord when the latest status actually changes', async () => {
    const mockPool = fetchMock.get('https://discord.test');
    // Expect exactly 2 webhook posts across 3 results (building -> passed is a
    // change, passed -> passed with a different stage/detail is not).
    mockPool.intercept({ path: '/webhook', method: 'POST' }).reply(204, '').times(2);

    const payload = makeFormPayload();
    await SELF.fetch(await signedFormRequest(payload));

    const at = new Date().toISOString();
    await SELF.fetch(
      resultsRequest({ repo_url: payload.repo_url, commit: 'c1', status: 'building', stage: 'checkout', at }),
    );
    await SELF.fetch(
      resultsRequest({ repo_url: payload.repo_url, commit: 'c1', status: 'passed', stage: 'smoke', at }),
    );
    const res = await SELF.fetch(
      resultsRequest({ repo_url: payload.repo_url, commit: 'c1', status: 'passed', stage: 'smoke', at, detail: 'unchanged' }),
    );
    expect(res.status).toBe(200);

    fetchMock.assertNoPendingInterceptors();
  });
});
