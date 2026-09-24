// Checks out a team's submitted repo into a local working directory, so
// docker build has something to point at. Shells out to the system `git`
// rather than adding a git library dependency — this is I/O-heavy glue,
// deliberately not covered by the no-Docker unit test suite (same reasoning
// as the docker/ module: it needs a real network + real git to mean
// anything).

import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Team } from './types.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;

export function safeDirName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

/**
 * Clones (first time) or fast-forward pulls (subsequent times) `team`'s repo
 * into `workDir/<safe-team-name>`. Returns that directory. Matches
 * DESIGN.md's dev-hour step 5 ("Arena validate command (pull all -> ...)").
 *
 * This is the "latest" path used by `c4 validate` (which deliberately wants
 * whatever is on the branch right now). Tournament play uses
 * `checkoutRepoAtCommit` instead, per the submission freeze.
 */
export async function checkoutRepo(team: Team, workDir: string): Promise<string> {
  const dir = path.join(workDir, safeDirName(team.name));
  await mkdir(workDir, { recursive: true });

  if (await pathExists(path.join(dir, '.git'))) {
    await execFileAsync('git', ['-C', dir, 'pull', '--ff-only'], { timeout: GIT_TIMEOUT_MS });
  } else {
    await execFileAsync('git', ['clone', '--depth', '1', team.repoUrl, dir], { timeout: GIT_TIMEOUT_MS });
  }
  return dir;
}

/**
 * Resolves the current commit hash at the tip of `repoUrl`'s default branch,
 * via `git ls-remote --symref ... HEAD` (no local clone needed). This is
 * what `c4 freeze` records into the lock file, and what a lock-less
 * tournament run resolves implicitly before checking out.
 */
export async function resolveDefaultBranchCommit(repoUrl: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['ls-remote', '--symref', repoUrl, 'HEAD'], {
    timeout: GIT_TIMEOUT_MS,
  });
  // Two relevant lines, e.g.:
  //   ref: refs/heads/main\tHEAD
  //   3a1b2c...\tHEAD
  const commitLine = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('ref:'));
  if (!commitLine) {
    throw new Error(`could not resolve HEAD commit for ${repoUrl} (empty git ls-remote output)`);
  }
  const commit = commitLine.split(/\s+/)[0];
  if (!commit) {
    throw new Error(`could not parse commit hash from git ls-remote output for ${repoUrl}`);
  }
  return commit;
}

/**
 * Clones (first time) or fetches (subsequent times) `team`'s repo into
 * `workDir/<safe-team-name>`, then checks out `commit` exactly — the
 * submission-freeze contract: every match a team plays uses this one
 * checkout, unmutated for the rest of the run. Returns that directory.
 *
 * Safe to call once per team up front (not per match): this is the only
 * git operation any given team's working directory sees during a
 * tournament run, so there's no concurrent-git-on-the-same-dir hazard even
 * under bounded-concurrency prepare.
 */
export async function checkoutRepoAtCommit(team: Team, commit: string, workDir: string): Promise<string> {
  const dir = path.join(workDir, safeDirName(team.name));
  await mkdir(workDir, { recursive: true });

  if (await pathExists(path.join(dir, '.git'))) {
    await execFileAsync('git', ['-C', dir, 'fetch', '--depth', '1', 'origin', commit], { timeout: GIT_TIMEOUT_MS }).catch(
      // Some git servers/transports (notably local file:// remotes used by
      // the samples runner) reject fetching a bare commit hash; fall back
      // to a full fetch, which always works.
      () => execFileAsync('git', ['-C', dir, 'fetch', 'origin'], { timeout: GIT_TIMEOUT_MS }),
    );
  } else {
    await execFileAsync('git', ['clone', team.repoUrl, dir], { timeout: GIT_TIMEOUT_MS });
  }
  await execFileAsync('git', ['-C', dir, 'checkout', '--force', commit], { timeout: GIT_TIMEOUT_MS });
  return dir;
}
