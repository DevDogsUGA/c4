import { describe, expect, it, vi } from 'vitest';
import { boundedMap, nextBackoffMs, processTeam, runTick, type TickContext } from './scheduler.js';
import type { RosterTeam, ValidateResult } from './types.js';

function team(overrides: Partial<RosterTeam> = {}): RosterTeam {
  return {
    id: '1',
    team_name: 'Team A',
    repo_url: 'https://github.com/a/a',
    members: ['alice'],
    submitter_email: 'a@uga.edu',
    updated_at: 'now',
    ...overrides,
  };
}

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return {
    workerUrl: 'https://worker.example',
    rosterToken: 'rtok',
    resultsToken: 'restok',
    backupRosterUrl: undefined,
    discordWebhookUrl: undefined,
    rosterFetchTimeoutMs: 1000,
    concurrency: 4,
    state: { lastSeen: {} },
    inFlight: new Set(),
    runValidate: vi.fn(async (): Promise<ValidateResult> => ({
      team: 'Team A',
      repo_url: 'https://github.com/a/a',
      commit: 'abc123',
      ok: true,
      stage: 'smoke',
      ms: 42,
    })),
    lsRemote: vi.fn(async () => 'abc123'),
    postResultFn: vi.fn(async () => {}),
    postDiscordFn: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('boundedMap', () => {
  it('respects the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await boundedMap(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i * 2;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('preserves result order regardless of completion order', async () => {
    const items = [30, 10, 20];
    const results = await boundedMap(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms / 10));
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it('handles an empty list', async () => {
    const results = await boundedMap([], 4, async (x) => x);
    expect(results).toEqual([]);
  });
});

describe('processTeam', () => {
  it('skips a team with no commit change and does not call validate', async () => {
    const t = team();
    const ctx = baseCtx({ state: { lastSeen: { [t.repo_url]: 'abc123' } } });
    const outcome = await processTeam(t, ctx);
    expect(outcome.changed).toBe(false);
    expect(ctx.runValidate).not.toHaveBeenCalled();
  });

  it('reports building then the validate outcome for a new commit', async () => {
    const t = team();
    const ctx = baseCtx();
    const outcome = await processTeam(t, ctx);
    expect(outcome.changed).toBe(true);
    expect(outcome.result?.ok).toBe(true);
    expect(ctx.state.lastSeen[t.repo_url]).toBe('abc123');

    const postResultFn = ctx.postResultFn as ReturnType<typeof vi.fn>;
    expect(postResultFn).toHaveBeenCalledTimes(2);
    expect(postResultFn.mock.calls[0][0].status).toBe('building');
    expect(postResultFn.mock.calls[1][0].status).toBe('passed');
  });

  it('posts failed status and does not update state commit differently on failure', async () => {
    const t = team();
    const ctx = baseCtx({
      runValidate: vi.fn(async (): Promise<ValidateResult> => ({
        team: t.team_name,
        repo_url: t.repo_url,
        commit: 'abc123',
        ok: false,
        stage: 'build',
        detail: 'compile error',
        ms: 10,
      })),
    });
    const outcome = await processTeam(t, ctx);
    expect(outcome.result?.ok).toBe(false);
    const postResultFn = ctx.postResultFn as ReturnType<typeof vi.fn>;
    expect(postResultFn.mock.calls[1][0].status).toBe('failed');
    expect(postResultFn.mock.calls[1][0].stage).toBe('build');
  });

  it('notifies discord on both building and outcome', async () => {
    const t = team();
    const ctx = baseCtx();
    await processTeam(t, ctx);
    const postDiscordFn = ctx.postDiscordFn as ReturnType<typeof vi.fn>;
    expect(postDiscordFn).toHaveBeenCalledTimes(2);
  });

  it('skips a team already in flight', async () => {
    const t = team();
    const ctx = baseCtx();
    ctx.inFlight.add(t.repo_url);
    const outcome = await processTeam(t, ctx);
    expect(outcome.error).toMatch(/already in flight/);
    expect(ctx.runValidate).not.toHaveBeenCalled();
  });

  it('reports an error and leaves state untouched when ls-remote fails', async () => {
    const t = team();
    const ctx = baseCtx({ lsRemote: vi.fn(async () => null) });
    const outcome = await processTeam(t, ctx);
    expect(outcome.error).toMatch(/ls-remote failed/);
    expect(ctx.state.lastSeen[t.repo_url]).toBeUndefined();
  });

  it('removes the team from inFlight even when validate throws', async () => {
    const t = team();
    const ctx = baseCtx({
      runValidate: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const outcome = await processTeam(t, ctx);
    expect(outcome.error).toMatch(/boom/);
    expect(ctx.inFlight.has(t.repo_url)).toBe(false);
  });
});

describe('runTick', () => {
  it('fetches the roster and processes every team', async () => {
    const fetchRosterFn = vi.fn(async () => ({
      roster: { teams: [team({ repo_url: 'https://github.com/a/a' }), team({ id: '2', repo_url: 'https://github.com/b/b' })] },
      source: 'worker' as const,
    }));
    const ctx = baseCtx({ fetchRosterFn });
    const { outcomes, rosterSource } = await runTick(ctx);
    expect(rosterSource).toBe('worker');
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.changed)).toBe(true);
  });
});

describe('nextBackoffMs', () => {
  it('doubles per failure and caps at maxMs', () => {
    const opts = { baseMs: 1000, maxMs: 8000 };
    expect(nextBackoffMs(0, opts)).toBe(1000);
    expect(nextBackoffMs(1, opts)).toBe(2000);
    expect(nextBackoffMs(2, opts)).toBe(4000);
    expect(nextBackoffMs(3, opts)).toBe(8000);
    expect(nextBackoffMs(10, opts)).toBe(8000);
  });
});
