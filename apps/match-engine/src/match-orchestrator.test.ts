import { describe, expect, it } from 'vitest';
import { orchestrateMatch } from './match-orchestrator.js';
import { createSeededRng } from './rng.js';
import { FakeBotProvider } from './testing/fake-bot-provider.js';
import type { Team } from './types.js';

const teamA: Team = { name: 'Team A', repoUrl: 'https://github.com/a/a' };
const teamB: Team = { name: 'Team B', repoUrl: 'https://github.com/b/b' };

describe('orchestrateMatch', () => {
  it('starts both bots, plays a match, and disposes both afterward', async () => {
    const disposed: string[] = [];
    const provider = new FakeBotProvider({
      transports: {
        '/repos/a': { script: () => ({ type: 'ok', column: 0 }) },
        '/repos/b': { script: () => ({ type: 'ok', column: 1 }) },
      },
      onDispose: (repoDir) => disposed.push(repoDir),
    });

    const record = await orchestrateMatch({
      matchId: 'rr-001',
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: ['/repos/a', '/repos/b'],
      provider,
      rng: createSeededRng(1),
    });

    expect(provider.startedRepoDirs).toEqual(['/repos/a', '/repos/b']);
    expect(disposed.sort()).toEqual(['/repos/a', '/repos/b']);
    expect(record.result.reason).toBe('played');
    expect(record.teams.map((t) => t.name)).toEqual(['Team A', 'Team B']);
  });

  it('forfeits the match (startup_timeout) when a bot never becomes healthy, without playing any games', async () => {
    const disposed: string[] = [];
    const provider = new FakeBotProvider({
      failToStart: new Set(['/repos/b']),
      onDispose: (repoDir) => disposed.push(repoDir),
    });

    const record = await orchestrateMatch({
      matchId: 'rr-001',
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: ['/repos/a', '/repos/b'],
      provider,
      rng: createSeededRng(1),
    });

    expect(record.games).toEqual([]);
    expect(record.result).toEqual({
      winner_team: 0,
      games_won: [0, 0],
      reason: 'forfeit',
      forfeits: [{ team: 1, reason: 'startup_timeout' }],
    });
    // Team A's bot was started (and must be cleaned up) even though team B failed to start.
    expect(disposed).toEqual(['/repos/a']);
  });

  it('forfeits to the healthy team when the first bot fails to start (the second bot is still attempted, per "one broken team must never abort the run")', async () => {
    const provider = new FakeBotProvider({ failToStart: new Set(['/repos/a']) });

    const record = await orchestrateMatch({
      matchId: 'rr-001',
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: ['/repos/a', '/repos/b'],
      provider,
      rng: createSeededRng(1),
    });

    expect(record.result.forfeits).toEqual([{ team: 0, reason: 'startup_timeout' }]);
    expect(record.result.winner_team).toBe(1);
    expect(provider.startedRepoDirs).toEqual(['/repos/a', '/repos/b']);
  });

  it('produces a double forfeit (winner_team null) when both teams fail to start, without throwing', async () => {
    const provider = new FakeBotProvider({ failToStart: new Set(['/repos/a', '/repos/b']) });

    const record = await orchestrateMatch({
      matchId: 'rr-001',
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: ['/repos/a', '/repos/b'],
      provider,
      rng: createSeededRng(1),
    });

    expect(record.games).toEqual([]);
    expect(record.result.winner_team).toBeNull();
    expect(record.result.forfeits).toEqual([
      { team: 0, reason: 'startup_timeout' },
      { team: 1, reason: 'startup_timeout' },
    ]);
  });

  it('skips provider.start entirely for a slot with a pre-determined forfeit (no per-match checkout/build work for a known-broken team)', async () => {
    const provider = new FakeBotProvider({
      transports: { '/repos/b': { script: () => ({ type: 'ok', column: 1 }) } },
    });

    const record = await orchestrateMatch({
      matchId: 'rr-001',
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: ['/repos/a', '/repos/b'],
      provider,
      rng: createSeededRng(1),
      preForfeits: ['checkout_failed', undefined],
    });

    expect(provider.startedRepoDirs).toEqual(['/repos/b']);
    expect(record.result).toEqual({
      winner_team: 1,
      games_won: [0, 0],
      reason: 'forfeit',
      forfeits: [{ team: 0, reason: 'checkout_failed' }],
    });
  });

  it('converts a non-StartupTimeoutError failure (e.g. an image build failure) into a build_failed forfeit instead of throwing', async () => {
    const provider = new FakeBotProvider();
    // Simulate a build failure by overriding start() to throw a generic error for one repo.
    const originalStart = provider.start.bind(provider);
    provider.start = async (opts) => {
      if (opts.repoDir === '/repos/a') throw new Error('docker build exited 1');
      return originalStart(opts);
    };

    const record = await orchestrateMatch({
      matchId: 'rr-001',
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: ['/repos/a', '/repos/b'],
      provider,
      rng: createSeededRng(1),
    });

    expect(record.result.forfeits).toEqual([{ team: 0, reason: 'build_failed' }]);
    expect(record.result.winner_team).toBe(1);
  });
});
