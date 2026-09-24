import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as git from './git.js';
import { findLockEntry, freeze, normalizeRepoUrl, readLockFile, writeLockFile, type LockFile } from './lock.js';
import type { Team } from './types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'c4-lock-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('freeze', () => {
  it('resolves each team to its current default-branch commit', async () => {
    vi.spyOn(git, 'resolveDefaultBranchCommit').mockImplementation(async (url) => `commit-for-${url}`);

    const teams: Team[] = [
      { name: 'Team A', repoUrl: 'https://github.com/a/a' },
      { name: 'Team B', repoUrl: 'https://github.com/b/b', members: ['Alice', 'Bob'] },
    ];

    const lock = await freeze(teams);
    expect(lock.teams).toEqual([
      { name: 'Team A', repo_url: 'https://github.com/a/a', commit: 'commit-for-https://github.com/a/a' },
      {
        name: 'Team B',
        repo_url: 'https://github.com/b/b',
        members: ['Alice', 'Bob'],
        commit: 'commit-for-https://github.com/b/b',
      },
    ]);
    expect(new Date(lock.generated_at).toString()).not.toBe('Invalid Date');
  });

  it('records a null commit + error for a team whose repo cannot be resolved, without failing the rest', async () => {
    vi.spyOn(git, 'resolveDefaultBranchCommit').mockImplementation(async (url) => {
      if (url.includes('broken')) throw new Error('repository not found');
      return `commit-for-${url}`;
    });

    const teams: Team[] = [
      { name: 'Team A', repoUrl: 'https://github.com/a/a' },
      { name: 'Broken Team', repoUrl: 'https://github.com/broken/repo' },
    ];

    const lock = await freeze(teams);
    const broken = lock.teams.find((t) => t.name === 'Broken Team')!;
    expect(broken.commit).toBeNull();
    expect(broken.error).toContain('repository not found');

    const ok = lock.teams.find((t) => t.name === 'Team A')!;
    expect(ok.commit).toBe('commit-for-https://github.com/a/a');
  });
});

describe('lock file round trip', () => {
  it('writes and reads back an identical lock file', async () => {
    const lock: LockFile = {
      generated_at: '2026-09-24T12:00:00.000Z',
      teams: [{ name: 'Team A', repo_url: 'https://github.com/a/a', commit: 'abc123' }],
    };
    const filePath = path.join(dir, 'lock.json');
    await writeLockFile(filePath, lock);
    const read = await readLockFile(filePath);
    expect(read).toEqual(lock);
  });

  it('rejects a file that is not a valid lock file', async () => {
    const filePath = path.join(dir, 'bad.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, JSON.stringify({ foo: 'bar' }));
    await expect(readLockFile(filePath)).rejects.toThrow();
  });
});

describe('normalizeRepoUrl / findLockEntry', () => {
  it('normalizes case, trailing slash, and .git suffix', () => {
    expect(normalizeRepoUrl('HTTPS://GitHub.com/a/a.git')).toBe(normalizeRepoUrl('https://github.com/a/a/'));
  });

  it('finds a lock entry by normalized repo URL', () => {
    const lock: LockFile = {
      generated_at: '2026-09-24T12:00:00.000Z',
      teams: [{ name: 'Team A', repo_url: 'https://github.com/a/a.git', commit: 'abc123' }],
    };
    const team: Team = { name: 'Team A (renamed)', repoUrl: 'https://github.com/a/a/' };
    expect(findLockEntry(lock, team)?.commit).toBe('abc123');
  });

  it('returns undefined when no entry matches', () => {
    const lock: LockFile = { generated_at: '2026-09-24T12:00:00.000Z', teams: [] };
    expect(findLockEntry(lock, { name: 'X', repoUrl: 'https://x' })).toBeUndefined();
  });
});
