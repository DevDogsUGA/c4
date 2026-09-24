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
