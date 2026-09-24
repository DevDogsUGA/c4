import { describe, expect, it } from 'vitest';
import type { MatchRecord, StandingsEntry } from '@acm-uga/c4-contract';
import { alphabeticalOrder, finalOrder, marqueeLines, sortMoves } from './seeding.js';

function entry(name: string, rank: number, wins = 0, losses = 0): StandingsEntry {
  return {
    team: { name, repo_url: `https://github.com/example/${name}` },
    rank,
    match_wins: wins,
    match_losses: losses,
    game_wins: 0,
    game_losses: 0,
  };
}

const team = (name: string) => ({ name, repo_url: `https://github.com/example/${name}` });

describe('alphabeticalOrder', () => {
  it('sorts by team name regardless of rank', () => {
    const input = [entry('Charlie', 1), entry('Alpha', 3), entry('Bravo', 2)];
    expect(alphabeticalOrder(input).map((e) => e.team.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('does not mutate the input', () => {
    const input = [entry('b', 2), entry('a', 1)];
    const copy = [...input];
    alphabeticalOrder(input);
    expect(input).toEqual(copy);
  });
});

describe('finalOrder', () => {
  it('sorts by rank ascending', () => {
    const input = [entry('Charlie', 3), entry('Alpha', 1), entry('Bravo', 2)];
    expect(finalOrder(input).map((e) => e.team.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('preserves relative order for tied ranks (stable sort)', () => {
    const input = [entry('First', 1), entry('TiedA', 2), entry('TiedB', 2)];
    expect(finalOrder(input).map((e) => e.team.name)).toEqual(['First', 'TiedA', 'TiedB']);
  });
});

describe('sortMoves', () => {
  it('maps each team from its alphabetical index to its final-rank index', () => {
    // Alphabetical: Alpha(0), Bravo(1), Charlie(2)
    // Final rank:   Charlie(1) -> 0, Alpha(3) -> 2, Bravo(2) -> 1
    const input = [entry('Charlie', 1, 3, 0), entry('Alpha', 3, 0, 3), entry('Bravo', 2, 1, 2)];
    const moves = sortMoves(input);

    expect(moves.map((m) => m.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);

    const alpha = moves.find((m) => m.name === 'Alpha')!;
    expect(alpha).toMatchObject({ fromIndex: 0, toIndex: 2, wins: 0, losses: 3 });

    const bravo = moves.find((m) => m.name === 'Bravo')!;
    expect(bravo).toMatchObject({ fromIndex: 1, toIndex: 1, wins: 1, losses: 2 });

    const charlie = moves.find((m) => m.name === 'Charlie')!;
    expect(charlie).toMatchObject({ fromIndex: 2, toIndex: 0, wins: 3, losses: 0 });
  });

  it('handles tied ranks without throwing and keeps a stable toIndex per team', () => {
    const input = [entry('First', 1), entry('TiedA', 2), entry('TiedB', 2)];
    const moves = sortMoves(input);
    const toIndexes = moves.map((m) => m.toIndex);
    expect(new Set(toIndexes).size).toBe(3);
  });
});

function match(
  teamA: string,
  teamB: string,
  winnerTeam: 0 | 1,
  gamesWon: [number, number],
  phase: 'roundrobin' | 'bracket' = 'roundrobin',
): MatchRecord {
  return {
    match_id: `${teamA}-vs-${teamB}`,
    phase,
    teams: [team(teamA), team(teamB)],
    games: [],
    result: { winner_team: winnerTeam, games_won: gamesWon, reason: 'played' },
  };
}

describe('marqueeLines', () => {
  it('formats a winner-first "def." line per round-robin match', () => {
    const lines = marqueeLines([match('Alpha', 'Bravo', 0, [2, 1])]);
    expect(lines).toEqual(['Alpha def. Bravo 2-1']);
  });

  it('orders the score winner-first when team slot 1 wins', () => {
    const lines = marqueeLines([match('Alpha', 'Bravo', 1, [1, 2])]);
    expect(lines).toEqual(['Bravo def. Alpha 2-1']);
  });

  it('excludes bracket matches', () => {
    const lines = marqueeLines([
      match('Alpha', 'Bravo', 0, [2, 1], 'roundrobin'),
      match('Charlie', 'Delta', 0, [2, 0], 'bracket'),
    ]);
    expect(lines).toEqual(['Alpha def. Bravo 2-1']);
  });

  it('handles a forfeit match (0-0 games) without throwing', () => {
    const forfeited = match('Alpha', 'Bravo', 0, [0, 0]);
    forfeited.result.reason = 'forfeit';
    forfeited.result.forfeits = [{ team: 1, reason: 'startup_timeout' }];
    expect(marqueeLines([forfeited])).toEqual(['Alpha def. Bravo 0-0']);
  });

  it('returns an empty array for no matches', () => {
    expect(marqueeLines([])).toEqual([]);
  });
});
