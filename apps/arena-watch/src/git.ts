import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitFn {
  (repoUrl: string): Promise<string | null>;
}

/**
 * `git ls-remote <repo> HEAD` -- no GitHub API, no rate limits, works for any
 * git host. Returns the commit SHA of HEAD, or null if the repo is
 * unreachable (private without access, deleted, network blip).
 */
export async function lsRemoteHead(repoUrl: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', repoUrl, 'HEAD'], {
      timeout: 15_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const sha = stdout.trim().split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
