import { describe, expect, it } from 'vitest';
import { playMatch, startupForfeitMatch, type MatchConfig, type MatchTransports } from './match-runner.js';
import { createSeededRng } from './rng.js';
import { FakeBotTransport } from './testing/fake-bot-transport.js';

const teams: [{ name: string; repo_url: string }, { name: string; repo_url: string }] = [
  { name: 'Team A', repo_url: 'https://github.com/a/a' },
  { name: 'Team B', repo_url: 'https://github.com/b/b' },
];

function baseConfig(seed: number): MatchConfig {
  return {
    matchId: 'rr-001',
    phase: 'roundrobin',
    teams,
    thinkBudgetMs: 10_000,
    rng: createSeededRng(seed),
  };
}

/** A bot that always plays the given column, instantly. */
function botAlwaysPlaying(column: number): FakeBotTransport {
  return new FakeBotTransport({ script: () => ({ type: 'ok', column }) });
}

describe('playMatch', () => {
  it('decides a match once a team reaches 2 game wins, alternating first mover across regular games', async () => {
    // Column 0 always wins for whoever moves first (vertical 4 in col 0),
    // so whichever team is first_player_team of a given game wins that game.
    const transports: MatchTransports = { 0: botAlwaysPlaying(0), 1: botAlwaysPlaying(1) };
    const record = await playMatch(transports, baseConfig(1));

    expect(record.result.reason).toBe('played');
    expect(record.result.games_won[0] + record.result.games_won[1]).toBeGreaterThanOrEqual(2);
    expect(record.result.winner_team === 0 ? record.result.games_won[0] : record.result.games_won[1]).toBe(2);

    // Game 1 is a coin flip; game 2 (if played) must alternate deterministically.
    expect(record.games[0].coin_flip).toBe(true);
    if (record.games.length >= 2 && record.games.length <= 3) {
      expect(record.games[1].coin_flip).toBe(false);
      expect(record.games[1].first_player_team).not.toBe(record.games[0].first_player_team);
    }
  });

  it('is deterministic for a given seed (coin flips reproduce)', async () => {
    const makeTransports = (): MatchTransports => ({ 0: botAlwaysPlaying(0), 1: botAlwaysPlaying(1) });
    const a = await playMatch(makeTransports(), baseConfig(99));
    const b = await playMatch(makeTransports(), baseConfig(99));
    expect(a.games.map((g) => g.first_player_team)).toEqual(b.games.map((g) => g.first_player_team));
    expect(a.result).toEqual(b.result);
  });

  it('with a first-mover-always-wins bot, the regular best-of-3 always decides in exactly 3 games', async () => {
    // Whoever moves first in a given game wins it (a race to stack 4 in
    // their own column), so across the coin-flip + 2 deterministic
    // alternations of a regular best-of-3, the score always splits 2-1 by
    // game 3 — this scripting alone never reaches sudden death. (See
    // match-runner.sudden-death.test.ts for a scripted tie that does.)
    const transports: MatchTransports = { 0: botAlwaysPlaying(0), 1: botAlwaysPlaying(1) };
    const record = await playMatch(transports, baseConfig(7));
    expect(record.games).toHaveLength(3);
    expect(record.games).toHaveLength(record.result.games_won[0] + record.result.games_won[1]);
  });
});

describe('startupForfeitMatch', () => {
  it('builds a zero-game match record forfeited to the healthy team', () => {
    const record = startupForfeitMatch(baseConfig(1), 1);
    expect(record.games).toEqual([]);
    expect(record.result).toEqual({
      winner_team: 0,
      games_won: [0, 0],
      reason: 'forfeit',
      forfeit_detail: { team: 1, reason: 'startup_timeout' },
    });
  });
});
