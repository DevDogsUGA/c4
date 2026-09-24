import type { ActionsStatus, Reachability } from './types';

function ownerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repoUrl);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function ghFetch(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'c4-registry',
      'x-github-api-version': '2022-11-28',
    },
  });
}

export interface RepoCheckResult {
  reachability: Reachability;
  latest_commit: string | null;
  actions_status: ActionsStatus;
  actions_run_url: string | null;
}

/**
 * Check a team's repo: reachability/emptiness, default-branch latest commit,
 * and (when includeActions) the latest Actions run on the default branch.
 * Never throws; GitHub errors and rate limits degrade to 'unknown'.
 */
export async function checkRepo(
  repoUrl: string,
  token: string,
  includeActions: boolean,
): Promise<RepoCheckResult> {
  const parsed = ownerRepo(repoUrl);
  if (!parsed) {
    return { reachability: 'unreachable', latest_commit: null, actions_status: 'unknown', actions_run_url: null };
  }
  const { owner, repo } = parsed;

  let repoRes: Response;
  try {
    repoRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`, token);
  } catch {
    return { reachability: 'unknown', latest_commit: null, actions_status: 'unknown', actions_run_url: null };
  }

  if (repoRes.status === 404) {
    return { reachability: 'unreachable', latest_commit: null, actions_status: 'unknown', actions_run_url: null };
  }
  if (repoRes.status === 403) {
    // Could be private (no access) or rate-limited; either way we can't see it.
    return { reachability: 'private', latest_commit: null, actions_status: 'unknown', actions_run_url: null };
  }
  if (!repoRes.ok) {
    return { reachability: 'unknown', latest_commit: null, actions_status: 'unknown', actions_run_url: null };
  }

  const repoJson = (await repoRes.json()) as { private?: boolean; default_branch?: string };
  if (repoJson.private) {
    return { reachability: 'private', latest_commit: null, actions_status: 'unknown', actions_run_url: null };
  }
  const defaultBranch = repoJson.default_branch ?? 'main';

  let latestCommit: string | null = null;
  let reachability: Reachability = 'reachable';
  try {
    const commitsRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${defaultBranch}`,
      token,
    );
    if (commitsRes.status === 409 || commitsRes.status === 404) {
      // Empty repo (no commits on default branch) or branch missing.
      reachability = 'empty';
    } else if (commitsRes.ok) {
      const commitJson = (await commitsRes.json()) as { sha?: string };
      latestCommit = commitJson.sha ?? null;
    }
  } catch {
    // leave reachability as 'reachable' with unknown commit
  }

  let actionsStatus: ActionsStatus = 'unknown';
  let actionsRunUrl: string | null = null;
  if (includeActions && reachability !== 'empty') {
    try {
      const runsRes = await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(defaultBranch)}&per_page=1`,
        token,
      );
      if (runsRes.ok) {
        const runsJson = (await runsRes.json()) as {
          workflow_runs?: Array<{ status: string; conclusion: string | null; html_url: string }>;
        };
        const run = runsJson.workflow_runs?.[0];
        if (!run) {
          actionsStatus = 'none';
        } else if (run.status !== 'completed') {
          actionsStatus = 'in_progress';
          actionsRunUrl = run.html_url;
        } else {
          actionsStatus = run.conclusion === 'success' ? 'success' : 'failure';
          actionsRunUrl = run.html_url;
        }
      }
    } catch {
      // leave actionsStatus as 'unknown'
    }
  } else if (reachability === 'empty') {
    actionsStatus = 'none';
  }

  return { reachability, latest_commit: latestCommit, actions_status: actionsStatus, actions_run_url: actionsRunUrl };
}
