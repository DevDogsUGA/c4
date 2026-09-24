import { postDiscord, statusEmoji } from './discord.js';
import type { GitFn } from './git.js';
import { log } from './log.js';
import { postResult } from './results.js';
import { fetchRoster, type RosterSourceOptions } from './roster.js';
import type { RunValidateFn } from './validate.js';
import type { RosterTeam, ValidateResult } from './types.js';
import { type WatchState } from './state.js';

/** Concurrency-limited map. Order of results matches input order; errors in
 * one item don't cancel the others (each is caught by the caller). */
export async function boundedMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface TickContext {
  workerUrl: string;
  rosterToken: string;
  resultsToken: string;
  backupRosterUrl: string | undefined;
  discordWebhookUrl: string | undefined;
  rosterFetchTimeoutMs: number;
  concurrency: number;
  state: WatchState;
  inFlight: Set<string>;
  runValidate: RunValidateFn;
  lsRemote: GitFn;
  fetchFn?: RosterSourceOptions['fetchFn'];
  postResultFn?: typeof postResult;
  postDiscordFn?: typeof postDiscord;
  fetchRosterFn?: typeof fetchRoster;
}

export interface TeamOutcome {
  team: RosterTeam;
  changed: boolean;
  commit?: string;
  result?: ValidateResult;
  error?: string;
}

/**
 * Full pipeline for one team: check for a new commit via ls-remote, and if
 * found, post `building`, run validate, post the outcome, notify Discord on
 * status change, and record the commit in state. Skips (and reports) a team
 * that's already in flight -- guards against overlapping ticks.
 */
export async function processTeam(team: RosterTeam, ctx: TickContext): Promise<TeamOutcome> {
  if (ctx.inFlight.has(team.repo_url)) {
    return { team, changed: false, error: 'skipped: already in flight' };
  }
  ctx.inFlight.add(team.repo_url);
  try {
    const head = await ctx.lsRemote(team.repo_url);
    if (!head) {
      return { team, changed: false, error: 'ls-remote failed (unreachable repo)' };
    }
    const lastSeen = ctx.state.lastSeen[team.repo_url];
    if (lastSeen === head) {
      return { team, changed: false, commit: head };
    }

    const postResultFn = ctx.postResultFn ?? postResult;
    const postDiscordFn = ctx.postDiscordFn ?? postDiscord;
    const at = () => new Date().toISOString();

    await postResultFn(
      { repo_url: team.repo_url, commit: head, status: 'building', at: at() },
      { workerUrl: ctx.workerUrl, resultsToken: ctx.resultsToken, ...(ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {}) },
    );
    await postDiscordFn(`${statusEmoji('building')} **${team.team_name}** building \`${head.slice(0, 7)}\``, {
      webhookUrl: ctx.discordWebhookUrl,
      ...(ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {}),
    });

    const result = await ctx.runValidate(team);
    const status = result.ok ? 'passed' : 'failed';

    await postResultFn(
      {
        repo_url: team.repo_url,
        commit: head,
        status,
        stage: result.stage,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
        at: at(),
      },
      { workerUrl: ctx.workerUrl, resultsToken: ctx.resultsToken, ...(ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {}) },
    );
    await postDiscordFn(
      `${statusEmoji(status)} **${team.team_name}** ${status} (${result.stage}) \`${head.slice(0, 7)}\`${
        result.detail ? ` — ${result.detail}` : ''
      }`,
      { webhookUrl: ctx.discordWebhookUrl, ...(ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {}) },
    );

    ctx.state.lastSeen[team.repo_url] = head;
    return { team, changed: true, commit: head, result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error('processTeam failed', { team: team.team_name, error });
    return { team, changed: false, error };
  } finally {
    ctx.inFlight.delete(team.repo_url);
  }
}

export interface TickResult {
  outcomes: TeamOutcome[];
  rosterSource: 'worker' | 'backup';
}

/** One poll cycle: fetch roster, then process all teams with bounded overall concurrency. */
export async function runTick(ctx: TickContext): Promise<TickResult> {
  const fetchRosterFn = ctx.fetchRosterFn ?? fetchRoster;
  const { roster, source } = await fetchRosterFn({
    workerUrl: ctx.workerUrl,
    rosterToken: ctx.rosterToken,
    backupRosterUrl: ctx.backupRosterUrl,
    timeoutMs: ctx.rosterFetchTimeoutMs,
    ...(ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {}),
  });

  const outcomes = await boundedMap(roster.teams, ctx.concurrency, (team) => processTeam(team, ctx));
  return { outcomes, rosterSource: source };
}

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

/** Exponential backoff with a cap: baseMs * 2^failures, capped at maxMs. */
export function nextBackoffMs(failures: number, opts: BackoffOptions): number {
  const delay = opts.baseMs * Math.pow(2, Math.max(0, failures));
  return Math.min(delay, opts.maxMs);
}
