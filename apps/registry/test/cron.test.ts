import { beforeEach, describe, expect, it } from 'vitest';
import { SELF, fetchMock } from 'cloudflare:test';
import { refreshAllRepoStatuses } from '../src/cron';
import { getRepoStatus } from '../src/db';
import { makeFormPayload, signedFormRequest, TEST_ENV } from './helpers';
import { accessHeaders, mockAccessCerts, signAccessJwt } from './access-jwt';

// Only the "competition started" test below needs an admin JWT; harmless
// (and simpler) to mock the certs endpoint for the whole file.
beforeEach(async () => {
  await mockAccessCerts();
});

describe('refreshAllRepoStatuses (cron)', () => {
  it('marks a reachable repo with commits as reachable and records the latest commit', async () => {
    const payload = makeFormPayload({ repo_url: 'https://github.com/octo/hello-world' });
    await SELF.fetch(await signedFormRequest(payload));

    const gh = fetchMock.get('https://api.github.com');
    gh.intercept({ path: '/repos/octo/hello-world', method: 'GET' }).reply(200, {
      private: false,
      default_branch: 'main',
    });
    gh.intercept({ path: '/repos/octo/hello-world/commits/main', method: 'GET' }).reply(200, { sha: 'abc123' });

    await refreshAllRepoStatuses(TEST_ENV as never);

    const status = await getRepoStatus(TEST_ENV.DB, payload.repo_url);
    expect(status?.reachability).toBe('reachable');
    expect(status?.latest_commit).toBe('abc123');
  });

  it('marks a 404 repo as unreachable', async () => {
    const payload = makeFormPayload({ repo_url: 'https://github.com/octo/missing-repo' });
    await SELF.fetch(await signedFormRequest(payload));

    const gh = fetchMock.get('https://api.github.com');
    gh.intercept({ path: '/repos/octo/missing-repo', method: 'GET' }).reply(404, {});

    await refreshAllRepoStatuses(TEST_ENV as never);

    const status = await getRepoStatus(TEST_ENV.DB, payload.repo_url);
    expect(status?.reachability).toBe('unreachable');
  });

  it('marks a private repo as private', async () => {
    const payload = makeFormPayload({ repo_url: 'https://github.com/octo/secret-repo' });
    await SELF.fetch(await signedFormRequest(payload));

    const gh = fetchMock.get('https://api.github.com');
    gh.intercept({ path: '/repos/octo/secret-repo', method: 'GET' }).reply(200, { private: true });

    await refreshAllRepoStatuses(TEST_ENV as never);

    const status = await getRepoStatus(TEST_ENV.DB, payload.repo_url);
    expect(status?.reachability).toBe('private');
  });

  it('marks an empty repo (no commits on default branch) as empty', async () => {
    const payload = makeFormPayload({ repo_url: 'https://github.com/octo/empty-repo' });
    await SELF.fetch(await signedFormRequest(payload));

    const gh = fetchMock.get('https://api.github.com');
    gh.intercept({ path: '/repos/octo/empty-repo', method: 'GET' }).reply(200, {
      private: false,
      default_branch: 'main',
    });
    gh.intercept({ path: '/repos/octo/empty-repo/commits/main', method: 'GET' }).reply(409, {});

    await refreshAllRepoStatuses(TEST_ENV as never);

    const status = await getRepoStatus(TEST_ENV.DB, payload.repo_url);
    expect(status?.reachability).toBe('empty');
  });

  it('fetches the latest Actions run once the competition has started', async () => {
    const payload = makeFormPayload({ repo_url: 'https://github.com/octo/ci-repo' });
    await SELF.fetch(await signedFormRequest(payload));
    const token = await signAccessJwt({ email: 'organizer@uga.edu' });
    await SELF.fetch('https://registry.test/admin/competition-started', {
      method: 'POST',
      redirect: 'manual',
      headers: { ...accessHeaders(token), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ started: 'true' }),
    });

    const gh = fetchMock.get('https://api.github.com');
    gh.intercept({ path: '/repos/octo/ci-repo', method: 'GET' }).reply(200, {
      private: false,
      default_branch: 'main',
    });
    gh.intercept({ path: '/repos/octo/ci-repo/commits/main', method: 'GET' }).reply(200, { sha: 'zzz' });
    gh.intercept({ path: /\/repos\/octo\/ci-repo\/actions\/runs.*/, method: 'GET' }).reply(200, {
      workflow_runs: [{ status: 'completed', conclusion: 'success', html_url: 'https://github.com/octo/ci-repo/actions/runs/1' }],
    });

    await refreshAllRepoStatuses(TEST_ENV as never);

    const status = await getRepoStatus(TEST_ENV.DB, payload.repo_url);
    expect(status?.actions_status).toBe('success');
    expect(status?.actions_run_url).toBe('https://github.com/octo/ci-repo/actions/runs/1');
  });
});
