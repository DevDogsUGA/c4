// Unit tests for the Docker-free pieces of container-runtime.ts's TASK 1
// "build once per team" support — deterministic tag derivation, tag
// sanitization, the build-concurrency formula, and the generic Semaphore
// primitive. None of this touches Docker (see docker.integration.test.ts /
// docker/hostile.integration.test.ts for the real-Docker coverage of
// prepare()/start() caching, timeout, and cleanup behavior).
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultBuildConcurrency, imageTagFor, sanitizeTagComponent, Semaphore } from './container-runtime.js';

const execFileAsync = promisify(execFile);

describe('sanitizeTagComponent', () => {
  it('lowercases and keeps already-valid characters', () => {
    expect(sanitizeTagComponent('Team_A-1.2')).toBe('team_a-1.2');
  });

  it('replaces invalid characters with a hyphen', () => {
    expect(sanitizeTagComponent('Team A!! (formerly "X")')).toBe('team-a-formerly-x');
  });

  it('strips leading/trailing separators left over from sanitization', () => {
    expect(sanitizeTagComponent('--Team--')).toBe('team');
  });

  it('never returns an empty string (docker tags must be non-empty)', () => {
    expect(sanitizeTagComponent('!!!')).toBe('x');
  });
});

describe('defaultBuildConcurrency', () => {
  it('is min(8, cpus/4), per TASK 1 ("bounded build concurrency during prepare")', () => {
    expect(defaultBuildConcurrency(4)).toBe(1);
    expect(defaultBuildConcurrency(16)).toBe(4);
    expect(defaultBuildConcurrency(64)).toBe(8); // capped at 8 even on a 64-core box
    expect(defaultBuildConcurrency(256)).toBe(8);
  });

  it('is never less than 1 even on a single-core host', () => {
    expect(defaultBuildConcurrency(1)).toBe(1);
    expect(defaultBuildConcurrency(0)).toBe(1);
  });
});

describe('imageTagFor', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'c4-imagetag-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('derives a deterministic c4-bot-<team>-<shortsha> tag from the team dir name + HEAD commit', async () => {
    const repoDir = path.join(workDir, 'Team_Rocket');
    await execFileAsync('git', ['init', repoDir]);
    await execFileAsync('git', ['-C', repoDir, 'config', 'user.email', 'a@example.com']);
    await execFileAsync('git', ['-C', repoDir, 'config', 'user.name', 'Test']);
    await writeFile(path.join(repoDir, 'Dockerfile'), 'FROM scratch\n', 'utf8');
    await execFileAsync('git', ['-C', repoDir, 'add', '.']);
    await execFileAsync('git', ['-C', repoDir, 'commit', '-m', 'init']);

    const { stdout: sha } = await execFileAsync('git', ['-C', repoDir, 'rev-parse', 'HEAD']);
    const shortSha = sha.trim().slice(0, 12);

    const tag = await imageTagFor(repoDir);
    expect(tag).toBe(`c4-bot-team_rocket-${shortSha}`);
  });

  it('is stable across repeated calls for the same commit (build-once caching depends on this)', async () => {
    const repoDir = path.join(workDir, 'Stable_Team');
    await execFileAsync('git', ['init', repoDir]);
    await execFileAsync('git', ['-C', repoDir, 'config', 'user.email', 'a@example.com']);
    await execFileAsync('git', ['-C', repoDir, 'config', 'user.name', 'Test']);
    await writeFile(path.join(repoDir, 'Dockerfile'), 'FROM scratch\n', 'utf8');
    await execFileAsync('git', ['-C', repoDir, 'add', '.']);
    await execFileAsync('git', ['-C', repoDir, 'commit', '-m', 'init']);

    const [a, b] = await Promise.all([imageTagFor(repoDir), imageTagFor(repoDir)]);
    expect(a).toBe(b);
  });

  it('falls back to a stable placeholder when repoDir is not a git checkout (never throws)', async () => {
    const repoDir = path.join(workDir, 'Not_A_Repo');
    await execFileAsync('mkdir', ['-p', repoDir]);
    const tag = await imageTagFor(repoDir);
    expect(tag).toBe('c4-bot-not_a_repo-nocommit');
  });
});

describe('Semaphore', () => {
  it('runs at most `concurrency` jobs at once', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const job = async () => {
      const release = await sem.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      release();
    };

    await Promise.all([job(), job(), job(), job(), job()]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('queues acquirers in order and lets each through once released', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const release1 = await sem.acquire();
    const p2 = sem.acquire().then((release) => {
      order.push(2);
      release();
    });
    const p3 = sem.acquire().then((release) => {
      order.push(3);
      release();
    });

    order.push(1);
    release1();
    await Promise.all([p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('treats concurrency < 1 as 1 (never deadlocks on a zero/negative bound)', async () => {
    const sem = new Semaphore(0);
    const release = await sem.acquire();
    release();
  });
});
