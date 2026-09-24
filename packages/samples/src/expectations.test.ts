import { describe, it, expect } from 'vitest';
import type { MatchRecord, TournamentBundle } from '@acm-uga/c4-contract';
import { checkExpectations, checkFailStateCoverage } from './expectations.js';
import type { MaterializedSample } from './materialize.js';

function sample(name: string, expectKind: string, reason?: string): MaterializedSample {
  return {
    slug: name,
    sample: { name, template: 'python', expect: { kind: expectKind as never, reason } },
    dir: '/tmp/x',
    repoUrl: 'file:///tmp/x',
    commitSha: 'deadbeef',
  };
}

function team(name: string) {
  return { name, repo_url: `file:///tmp/${name}` };
}

function bundle(matches: MatchRecord[]): TournamentBundle {
  return {
    format: 'c4-tournament-bundle',
    version: 1,
    summary: { standings: [], bracket: [], generated_at: new Date().toISOString() },
    matches,
  };
}

describe('checkExpectations', () => {
  it('passes a normal match that was actually played', () => {
    const m: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('Random'), team('Greedy')],
      games: [],
      result: { winner_team: 0, games_won: [2, 0], reason: 'played' },
    };
    const [check] = checkExpectations([sample('Random', 'normal')], bundle([m]));
    expect(check.ok).toBe(true);
  });

  it('fails a game_forfeit expectation when no forfeit occurred', () => {
    const m: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('Slow'), team('Greedy')],
      games: [
        {
          game_number: 1,
          first_player: 1,
          first_player_team: 0,
          coin_flip: true,
          moves: [],
          clock_events: [],
          outcome: { type: 'four_in_a_row', winner: 1 },
        },
      ],
      result: { winner_team: 0, games_won: [2, 0], reason: 'played' },
    };
    const [check] = checkExpectations([sample('Slow', 'game_forfeit', 'clock_expired')], bundle([m]));
    expect(check.ok).toBe(false);
  });

  it('passes a game_forfeit expectation with matching reason', () => {
    const m: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('Slow'), team('Greedy')],
      games: [
        {
          game_number: 1,
          first_player: 1,
          first_player_team: 0,
          coin_flip: true,
          moves: [],
          clock_events: [{ type: 'forfeit', player: 1, reason: 'clock_expired', at_move: 3 }],
          outcome: { type: 'forfeit', winner: 2, forfeited_player: 1, reason: 'clock_expired' },
        },
      ],
      result: { winner_team: 1, games_won: [0, 1], reason: 'played' },
    };
    const [check] = checkExpectations([sample('Slow', 'game_forfeit', 'clock_expired')], bundle([m]));
    expect(check.ok).toBe(true);
  });

  it('passes a game_forfeit expectation from outcome alone (the real engine never populates clock_events with a forfeit entry -- see game-runner.ts playGame)', () => {
    const m: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('Greedy'), team('NeverResponds')],
      games: [
        {
          game_number: 1,
          first_player: 1,
          first_player_team: 1,
          coin_flip: true,
          moves: [],
          clock_events: [],
          outcome: { type: 'forfeit', winner: 1, forfeited_player: 2, reason: 'clock_expired' },
        },
      ],
      result: { winner_team: 1, games_won: [1, 0], reason: 'played' },
    };
    // first_player_team is 1 (NeverResponds), so NeverResponds is player 1
    // and Greedy (slot 0) is player 2 -- the forfeited player. Both come
    // straight from outcome; clock_events is empty, matching production.
    const [check] = checkExpectations([sample('Greedy', 'game_forfeit', 'clock_expired')], bundle([m]));
    expect(check.ok).toBe(true);
  });

  it("maps team slot to in-game player number per-game (first_player_team flips), not a fixed slot 0 -> player 1 assumption", () => {
    // Team is slot 1. Game 1: first_player_team is 0, so slot 1 is player 2,
    // and that's who forfeits -- must be detected.
    const m: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('Greedy'), team('NeverResponds')],
      games: [
        {
          game_number: 1,
          first_player: 1,
          first_player_team: 0,
          coin_flip: true,
          moves: [],
          clock_events: [],
          outcome: { type: 'forfeit', winner: 1, forfeited_player: 2, reason: 'clock_expired' },
        },
      ],
      result: { winner_team: 0, games_won: [1, 0], reason: 'played' },
    };
    const [check] = checkExpectations([sample('NeverResponds', 'game_forfeit', 'clock_expired')], bundle([m]));
    expect(check.ok).toBe(true);
  });

  it('does not false-positive a restart for the opposing team when player numbers flip mid-match', () => {
    // CrashOnceRecover is team slot 0. Game 1: first_player_team is 1, so
    // slot 0 is player 2 -- a restart recorded for player 1 belongs to the
    // OTHER team (slot 1) and must not count for slot 0.
    const m: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('CrashOnceRecover'), team('Greedy')],
      games: [
        {
          game_number: 1,
          first_player: 1,
          first_player_team: 1,
          coin_flip: true,
          moves: [],
          clock_events: [{ type: 'restart', player: 1, billed_ms: 50, at_move: 0 }],
          outcome: { type: 'four_in_a_row', winner: 1 },
        },
      ],
      result: { winner_team: 1, games_won: [0, 1], reason: 'played' },
    };
    const [check] = checkExpectations([sample('CrashOnceRecover', 'restarts')], bundle([m]));
    expect(check.ok).toBe(false);
  });

  it('detects a double forfeit for coverage', () => {
    const m: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('BrokenA'), team('BrokenB')],
      games: [],
      result: {
        winner_team: null,
        games_won: [0, 0],
        reason: 'forfeit',
        forfeits: [
          { team: 0, reason: 'build_failed' },
          { team: 1, reason: 'checkout_failed' },
        ],
      },
    };
    const coverage = checkFailStateCoverage(bundle([m]));
    const doubleForfeit = coverage.find((c) => c.label.includes('double forfeit'));
    expect(doubleForfeit?.ok).toBe(true);
    const buildFailed = coverage.find((c) => c.label.includes('build_failed'));
    expect(buildFailed?.ok).toBe(true);
    const checkoutFailed = coverage.find((c) => c.label.includes('checkout_failed'));
    expect(checkoutFailed?.ok).toBe(true);
    const clockExpired = coverage.find((c) => c.label.includes('clock_expired'));
    expect(clockExpired?.ok).toBe(false);
  });
});
