import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as git from './git.js';
import type { LockFile } from './lock.js';
import { prepareTeams } from './prepare.js';
import { FakeBotProvider } from './testing/fake-bot-provider.js';
import type { Team } from './types.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'c4-prepare-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const teamA: Team = { name: 'Team A', repoUrl: 'https://a' };
const teamB: Team = { name: 'Team B', repoUrl: 'https://b' };

function mockGitOk(): void {
  vi.spyOn(git, 'resolveDefaultBranchCommit').mockImplementation(async (url) => `commit-${url}`);
  vi.spyOn(git, 'checkoutRepoAtCommit').mockImplementation(async (team) => {
    const dir = path.join(workDir, team.name.replace(/\s+/g, '_'));
    await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
    return dir;
  });
}

describe('prepareTeams', () => {
  it('resolves commit, checks out, detects language, and validates the build for a healthy team (implicit freeze, no lock)', async () => {
    mockGitOk();
    // Drop a Cargo.toml in the checkout so language detection has something to find.
    vi.spyOn(git, 'checkoutRepoAtCommit').mockImplementation(async (team) => {
      const dir = path.join(workDir, team.name.replace(/\s+/g, '_'));
      const fs = await import('node:fs/promises');
      await fs.mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'Cargo.toml'), '', 'utf8');
      return dir;
    });

    const provider = new FakeBotProvider();
    const [result] = await prepareTeams([teamA], { provider, workDir });

    expect(result.forfeit).toBeUndefined();
    expect(result.commit).toBe('commit-https://a');
    expect(result.language).toBe('rust');
    expect(result.repoDir).toBeTruthy();
  });

  it('forfeits checkout_failed when the commit cannot be resolved (no lock, implicit freeze fails)', async () => {
    vi.spyOn(git, 'resolveDefaultBranchCommit').mockRejectedValue(new Error('unreachable repo'));
    const provider = new FakeBotProvider();

    const [result] = await prepareTeams([teamA], { provider, workDir });
    expect(result.forfeit).toBe('checkout_failed');
    expect(result.detail).toContain('unreachable repo');
  });

  it('forfeits checkout_failed when git checkout itself fails', async () => {
    vi.spyOn(git, 'resolveDefaultBranchCommit').mockResolvedValue('abc123');
    vi.spyOn(git, 'checkoutRepoAtCommit').mockRejectedValue(new Error('checkout: fatal'));
    const provider = new FakeBotProvider();

    const [result] = await prepareTeams([teamA], { provider, workDir });
    expect(result.forfeit).toBe('checkout_failed');
  });

  it('uses the lock file commit when provided, and never resolves the branch itself', async () => {
    const resolveSpy = vi.spyOn(git, 'resolveDefaultBranchCommit');
    vi.spyOn(git, 'checkoutRepoAtCommit').mockImplementation(async (team, commit) => {
      const dir = path.join(workDir, team.name.replace(/\s+/g, '_'));
      await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
      expect(commit).toBe('locked-commit');
      return dir;
    });
    const lock: LockFile = {
      generated_at: '2026-09-24T00:00:00.000Z',
      teams: [{ name: 'Team A', repo_url: 'https://a', commit: 'locked-commit' }],
    };
    const provider = new FakeBotProvider();

    const [result] = await prepareTeams([teamA], { provider, workDir, lock });
    expect(result.forfeit).toBeUndefined();
    expect(result.commit).toBe('locked-commit');
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('forfeits checkout_failed when the lock has no entry for the team', async () => {
    const lock: LockFile = { generated_at: '2026-09-24T00:00:00.000Z', teams: [] };
    const provider = new FakeBotProvider();

    const [result] = await prepareTeams([teamA], { provider, workDir, lock });
    expect(result.forfeit).toBe('checkout_failed');
  });

  it('forfeits checkout_failed when the lock entry has a null commit (freeze recorded an error)', async () => {
    const lock: LockFile = {
      generated_at: '2026-09-24T00:00:00.000Z',
      teams: [{ name: 'Team A', repo_url: 'https://a', commit: null, error: 'repo not found' }],
    };
    const provider = new FakeBotProvider();

    const [result] = await prepareTeams([teamA], { provider, workDir, lock });
    expect(result.forfeit).toBe('checkout_failed');
    expect(result.detail).toContain('repo not found');
  });

  it('forfeits build_failed when the provider fails to build (validation start/dispose path, no provider.prepare)', async () => {
    mockGitOk();
    const provider = new FakeBotProvider({ failToBuild: new Set([path.join(workDir, 'Team_A')]) });

    const [result] = await prepareTeams([teamA], { provider, workDir });
    expect(result.forfeit).toBe('build_failed');
  });

  it('forfeits startup_timeout when the provider builds but the bot never becomes healthy', async () => {
    mockGitOk();
    const provider = new FakeBotProvider({ failToStart: new Set([path.join(workDir, 'Team_A')]) });

    const [result] = await prepareTeams([teamA], { provider, workDir });
    expect(result.forfeit).toBe('startup_timeout');
  });

  it('uses provider.prepare (build-once) when the provider supports it, instead of start+dispose', async () => {
    mockGitOk();
    const provider = new FakeBotProvider({ supportsPrepare: true });

    const [result] = await prepareTeams([teamA], { provider, workDir });
    expect(result.forfeit).toBeUndefined();
    expect(provider.preparedRepoDirs).toHaveLength(1);
    expect(provider.startedRepoDirs).toHaveLength(0); // no validation start/dispose needed
  });

  it('never aborts the whole sweep when one team is broken — the other team still prepares successfully', async () => {
    vi.spyOn(git, 'resolveDefaultBranchCommit').mockImplementation(async (url) => {
      if (url === teamA.repoUrl) throw new Error('broken repo');
      return `commit-${url}`;
    });
    vi.spyOn(git, 'checkoutRepoAtCommit').mockImplementation(async (team) => {
      const dir = path.join(workDir, team.name.replace(/\s+/g, '_'));
      await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
      return dir;
    });
    const provider = new FakeBotProvider();

    const results = await prepareTeams([teamA, teamB], { provider, workDir, concurrency: 2 });
    expect(results.find((r) => r.team.name === 'Team A')?.forfeit).toBe('checkout_failed');
    expect(results.find((r) => r.team.name === 'Team B')?.forfeit).toBeUndefined();
  });
});
