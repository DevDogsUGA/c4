import type { MatchRecord } from '@acm-uga/c4-contract';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from './rng.js';
import { computeStandings, roundRobinPairings } from './round-robin.js';
import type { Team } from './types.js';

const A: Team = { name: 'Alpha', repoUrl: 'https://a' };
const B: Team = { name: 'Bravo', repoUrl: 'https://b' };
const C: Team = { name: 'Charlie', repoUrl: 'https://c' };
const D: Team = { name: 'Delta', repoUrl: 'https://d' };

describe('roundRobinPairings', () => {
  it('produces every unique pair exactly once, no self-pairs', () => {
    const pairs = roundRobinPairings([A, B, C, D]);
    expect(pairs).toHaveLength(6); // C(4,2)
    for (const [x, y] of pairs) expect(x.name).not.toBe(y.name);

    const seen = new Set(pairs.map(([x, y]) => [x.name, y.name].sort().join('|')));
    expect(seen.size).toBe(6);
  });

  it('returns nothing for 0 or 1 teams', () => {
    expect(roundRobinPairings([])).toEqual([]);
    expect(roundRobinPairings([A])).toEqual([]);
  });
});

function matchRecord(
  matchId: string,
  a: Team,
  b: Team,
  winnerSlot: 0 | 1,
  gamesWon: [number, number],
): MatchRecord {
  return {
    match_id: matchId,
    phase: 'roundrobin',
    teams: [
      { name: a.name, repo_url: a.repoUrl },
      { name: b.name, repo_url: b.repoUrl },
    ],
    games: [],
    result: { winner_team: winnerSlot, games_won: gamesWon, reason: 'played' },
  };
}

describe('computeStandings', () => {
  it('ranks by match wins descending', () => {
    const matches: MatchRecord[] = [
      matchRecord('m1', A, B, 0, [2, 0]), // A beats B
      matchRecord('m2', A, C, 0, [2, 1]), // A beats C
      matchRecord('m3', B, C, 0, [2, 0]), // B beats C
    ];
    const standings = computeStandings([A, B, C], matches, createSeededRng(1));
    expect(standings.map((s) => s.team.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(standings[0]).toMatchObject({ match_wins: 2, match_losses: 0 });
    expect(standings[2]).toMatchObject({ match_wins: 0, match_losses: 2 });
  });

  it('breaks a match-win tie by head-to-head result', () => {
    // A and B both have 1 win, 1 loss overall, but A beat B directly.
    const matches: MatchRecord[] = [
      matchRecord('m1', A, B, 0, [2, 1]), // A beats B head-to-head
      matchRecord('m2', A, C, 1, [0, 2]), // A loses to C
      matchRecord('m3', B, C, 1, [0, 2]), // B loses to C
    ];
    const standings = computeStandings([A, B, C], matches, createSeededRng(1));
    const aRank = standings.find((s) => s.team.name === 'Alpha')!.rank;
    const bRank = standings.find((s) => s.team.name === 'Bravo')!.rank;
    expect(aRank).toBeLessThan(bRank);
  });

  it('falls back to total game wins when head-to-head has no data (never played)', () => {
    const matches: MatchRecord[] = [
      matchRecord('m1', A, C, 0, [2, 1]), // A: 1-0 match, 2-1 games
      matchRecord('m2', B, D, 0, [2, 0]), // B: 1-0 match, 2-0 games
    ];
    const standings = computeStandings([A, B, C, D], matches, createSeededRng(1));
    const aRank = standings.find((s) => s.team.name === 'Alpha')!.rank;
    const bRank = standings.find((s) => s.team.name === 'Bravo')!.rank;
    // Both 1-0 in matches, no head-to-head (never played); B has more game wins.
    expect(bRank).toBeLessThan(aRank);
  });

  it('falls back to a deterministic seeded coin flip as the last resort', () => {
    // No matches at all: everyone is tied on everything.
    const standingsA = computeStandings([A, B, C], [], createSeededRng(42));
    const standingsB = computeStandings([A, B, C], [], createSeededRng(42));
    expect(standingsA.map((s) => s.team.name)).toEqual(standingsB.map((s) => s.team.name));
  });

  it('ignores bracket-phase matches when computing standings', () => {
    const matches: MatchRecord[] = [
      { ...matchRecord('b1', A, B, 1, [0, 2]), phase: 'bracket' }, // would flip the ranking if counted
    ];
    const standings = computeStandings([A, B], matches, createSeededRng(1));
    expect(standings.every((s) => s.match_wins === 0 && s.match_losses === 0)).toBe(true);
  });
});
