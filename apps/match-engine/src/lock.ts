// Submission freeze, per EVENT_PLAN.md: "each team's commit is recorded
// once into a lock file, each repo is cloned once, and every match uses
// that exact commit. Teams whose build fails stay in and forfeit."
//
// `freeze` resolves each team's current default-branch commit with a
// bounded-concurrency `git ls-remote` sweep — no local clone needed for
// this step — and never throws for an individual team's failure: a team
// whose repo can't be reached gets `commit: null` and an `error` message,
// so one broken submission can't abort freezing the rest of the roster.

import { readFile, writeFile } from 'node:fs/promises';
import { resolveDefaultBranchCommit } from './git.js';
import { runWithConcurrency } from './scheduler.js';
import type { Team } from './types.js';

export interface LockEntry {
  name: string;
  repo_url: string;
  members?: string[];
  /** null if the commit could not be resolved (see `error`). */
  commit: string | null;
  error?: string;
}

export interface LockFile {
  generated_at: string;
  teams: LockEntry[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface FreezeOptions {
  /** Bounded concurrency for the git ls-remote sweep. Default 8. */
  concurrency?: number;
}

/** Resolves each team's current default-branch commit. Never rejects for an individual team's failure. */
export async function freeze(teams: readonly Team[], options: FreezeOptions = {}): Promise<LockFile> {
  const { concurrency = 8 } = options;

  const jobs = teams.map((team) => async (): Promise<LockEntry> => {
    try {
      const commit = await resolveDefaultBranchCommit(team.repoUrl);
      return {
        name: team.name,
        repo_url: team.repoUrl,
        ...(team.members ? { members: [...team.members] } : {}),
        commit,
      };
    } catch (err) {
      return {
        name: team.name,
        repo_url: team.repoUrl,
        ...(team.members ? { members: [...team.members] } : {}),
        commit: null,
        error: errorMessage(err),
      };
    }
  });

  const entries = await runWithConcurrency(jobs, Math.max(1, concurrency));
  return { generated_at: new Date().toISOString(), teams: entries };
}

export async function writeLockFile(filePath: string, lock: LockFile): Promise<void> {
  await writeFile(filePath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

export async function readLockFile(filePath: string): Promise<LockFile> {
  const text = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(text) as LockFile;
  if (!parsed || !Array.isArray(parsed.teams)) {
    throw new Error(`${filePath} is not a valid lock file (expected { generated_at, teams: [...] })`);
  }
  return parsed;
}

/** Normalizes a repo URL for matching a team against a lock entry (case-insensitive, trailing slash/`.git` insensitive). */
export function normalizeRepoUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
}

/** Finds the lock entry for `team` by normalized repo URL, if any. */
export function findLockEntry(lock: LockFile, team: Team): LockEntry | undefined {
  const target = normalizeRepoUrl(team.repoUrl);
  return lock.teams.find((e) => normalizeRepoUrl(e.repo_url) === target);
}
