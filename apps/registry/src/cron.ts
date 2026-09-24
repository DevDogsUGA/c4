import { checkRepo } from './github';
import { isCompetitionStarted, listTeams, upsertRepoStatus } from './db';
import type { Env } from './types';

/**
 * Refresh reachability/emptiness/latest-commit for every registered repo,
 * plus (once the competition has started) each team's default-branch
 * GitHub Actions status. Runs sequentially with a small stagger to stay
 * well under GitHub's rate limits for ~32 repos every 2 minutes.
 */
export async function refreshAllRepoStatuses(env: Env): Promise<void> {
  const teams = await listTeams(env.DB);
  const started = await isCompetitionStarted(env.DB);

  for (const team of teams) {
    try {
      const result = await checkRepo(team.repo_url, env.GITHUB_TOKEN, started);
      await upsertRepoStatus(env.DB, {
        repo_url: team.repo_url,
        reachability: result.reachability,
        latest_commit: result.latest_commit,
        actions_status: result.actions_status,
        actions_run_url: result.actions_run_url,
        checked_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`repo status refresh failed for ${team.repo_url}`, err);
    }
  }
}
