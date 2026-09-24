// The prepare phase, per EVENT_PLAN.md: "each team's commit is recorded
// once into a lock file, each repo is cloned once, and every match uses
// that exact commit. Teams whose build fails stay in and forfeit."
//
// Runs ONCE per team, up front, with bounded concurrency — never per match:
// resolve/checkout the exact commit, detect the template language, and
// (best-effort, via BotProvider.prepare) validate the image builds and the
// bot passes its health check. Any failure here becomes a match-level
// forfeit reason (checkout_failed / build_failed / startup_timeout) that
// tournament-runner.ts applies to every match the team would have played,
// without ever calling into git or Docker again for that team.

import { ImageBuildError, StartupTimeoutError } from './docker/container-runtime.js';
import { checkoutRepoAtCommit, resolveDefaultBranchCommit } from './git.js';
import { detectLanguage } from './language.js';
import { findLockEntry, type LockFile } from './lock.js';
import { runWithConcurrency } from './scheduler.js';
import type { BotProvider } from './types.js';
import type { Team } from './types.js';

import type { MatchForfeitReason } from '@acm-uga/c4-contract';

export interface PreparedTeam {
  team: Team;
  /** Set unless checkout failed. */
  repoDir?: string;
  /** The exact commit checked out (from the lock file, or resolved implicitly). Set unless checkout failed. */
  commit?: string;
  /** Best-effort language detection from the checkout. */
  language?: string;
  /** Set iff this team is broken and every match it plays should forfeit. */
  forfeit?: MatchForfeitReason;
  /** Human-readable detail for logs / `validate --json`. */
  detail?: string;
}

export interface PrepareTeamsOptions {
  provider: BotProvider;
  workDir: string;
  /** Optional submission-freeze lock; when omitted, each team's current default-branch commit is resolved implicitly (an implicit freeze). */
  lock?: LockFile;
  botPort?: number;
  healthGraceMs?: number;
  /** Bounded concurrency for the prepare sweep. Defaults to matchConcurrency-sized (see scheduler.ts). */
  concurrency?: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function prepareOne(team: Team, options: PrepareTeamsOptions): Promise<PreparedTeam> {
  const { provider, workDir, lock, botPort = 8000, healthGraceMs = 30_000 } = options;

  let commit: string;
  if (lock) {
    const entry = findLockEntry(lock, team);
    if (!entry) {
      return { team, forfeit: 'checkout_failed', detail: `no lock entry found for ${team.repoUrl}` };
    }
    if (entry.commit === null) {
      return { team, forfeit: 'checkout_failed', detail: entry.error ?? 'lock entry has no resolved commit' };
    }
    commit = entry.commit;
  } else {
    try {
      commit = await resolveDefaultBranchCommit(team.repoUrl);
    } catch (err) {
      return { team, forfeit: 'checkout_failed', detail: `could not resolve default branch commit: ${errorMessage(err)}` };
    }
  }

  let repoDir: string;
  try {
    repoDir = await checkoutRepoAtCommit(team, commit, workDir);
  } catch (err) {
    return { team, commit, forfeit: 'checkout_failed', detail: `checkout failed: ${errorMessage(err)}` };
  }

  const language = await detectLanguage(repoDir).catch(() => undefined);

  if (provider.prepare) {
    try {
      await provider.prepare(repoDir);
    } catch (err) {
      if (err instanceof StartupTimeoutError) {
        return { team, repoDir, commit, language, forfeit: 'startup_timeout', detail: errorMessage(err) };
      }
      if (err instanceof ImageBuildError) {
        return { team, repoDir, commit, language, forfeit: 'build_failed', detail: errorMessage(err) };
      }
      return { team, repoDir, commit, language, forfeit: 'build_failed', detail: `build failed: ${errorMessage(err)}` };
    }
  } else {
    // The provider doesn't support a prebuild step (e.g. today's
    // DockerBotProvider) — validate by starting once and disposing
    // immediately, so a broken checkout/build still surfaces here rather
    // than mid-tournament. This costs one extra container start per team;
    // matches still each start their own fresh container (DESIGN.md), so
    // this is a validation pass, not a build-reuse optimization.
    try {
      const started = await provider.start({ repoDir, port: botPort, healthGraceMs });
      await started.dispose();
    } catch (err) {
      if (err instanceof StartupTimeoutError) {
        return { team, repoDir, commit, language, forfeit: 'startup_timeout', detail: errorMessage(err) };
      }
      if (err instanceof ImageBuildError) {
        return { team, repoDir, commit, language, forfeit: 'build_failed', detail: errorMessage(err) };
      }
      return { team, repoDir, commit, language, forfeit: 'build_failed', detail: `build failed: ${errorMessage(err)}` };
    }
  }

  return { team, repoDir, commit, language };
}

/**
 * Prepares every team once, with bounded concurrency. Never rejects for an
 * individual team's failure — a broken team comes back as a `PreparedTeam`
 * with `forfeit` set, per "one broken team must never abort the run".
 */
export async function prepareTeams(teams: readonly Team[], options: PrepareTeamsOptions): Promise<PreparedTeam[]> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const jobs = teams.map((team) => () => prepareOne(team, options));
  return runWithConcurrency(jobs, concurrency);
}
