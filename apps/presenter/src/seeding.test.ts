import { describe, expect, it } from 'vitest';
import type { MatchRecord, StandingsEntry } from '@acm-uga/c4-contract';
import {
  SEEDING_STEP_MAX_MS,
  SEEDING_STEP_MIN_MS,
  alphabeticalOrder,
  finalOrder,
  marqueeLines,
  seedingReplay,
  seedingStepMs,
} from './seeding.js';

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

function match(
  teamA: string,
  teamB: string,
  winnerTeam: 0 | 1 | null,
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

describe('seedingReplay', () => {
  const summary = (frame: { rows: { name: string; wins: number; losses: number }[] }) =>
    frame.rows.map((r) => `${r.name} ${r.wins}-${r.losses}`);

  it('opens on every team alphabetical at 0-0', () => {
    const frames = seedingReplay([entry('Charlie', 1), entry('Alpha', 2), entry('Bravo', 3)], []);
    expect(summary(frames[0]!)).toEqual(['Alpha 0-0', 'Bravo 0-0', 'Charlie 0-0']);
    expect(frames[0]!.winner).toBeNull();
  });

  it('adds one frame per round-robin match, crediting the winner and re-sorting by record', () => {
    const standings = [entry('Charlie', 1, 2, 0), entry('Bravo', 2, 1, 1), entry('Alpha', 3, 0, 2)];
    const frames = seedingReplay(standings, [
      match('Alpha', 'Charlie', 1, [0, 2]),
      match('Bravo', 'Alpha', 0, [2, 1]),
      match('Charlie', 'Bravo', 0, [2, 0]),
    ]);

    expect(frames).toHaveLength(5);
    expect(summary(frames[1]!)).toEqual(['Charlie 1-0', 'Bravo 0-0', 'Alpha 0-1']);
    expect(frames[1]!.winner).toBe('Charlie');
    expect(summary(frames[2]!)).toEqual(['Charlie 1-0', 'Bravo 1-0', 'Alpha 0-2']);
    expect(frames[2]!.winner).toBe('Bravo');
    expect(summary(frames[3]!)).toEqual(['Charlie 2-0', 'Bravo 1-1', 'Alpha 0-2']);
  });

  it('keeps the previous relative order for teams with equal records', () => {
    const standings = [entry('Alpha', 1, 1, 0), entry('Bravo', 2, 1, 0), entry('Charlie', 3, 0, 1), entry('Delta', 4, 0, 1)];
    const frames = seedingReplay(standings, [match('Charlie', 'Delta', 1, [0, 2]), match('Alpha', 'Bravo', 1, [0, 2])]);
    expect(summary(frames[1]!)).toEqual(['Delta 1-0', 'Alpha 0-0', 'Bravo 0-0', 'Charlie 0-1']);
    expect(summary(frames[2]!)).toEqual(['Delta 1-0', 'Bravo 1-0', 'Alpha 0-1', 'Charlie 0-1']);
  });

  it('closes on the official rank order and records, so upstream tie-breaks land', () => {
    const standings = [entry('Bravo', 1, 1, 0), entry('Alpha', 2, 1, 0)];
    const frames = seedingReplay(standings, [match('Alpha', 'Bravo', 0, [2, 0])]);
    const last = frames[frames.length - 1]!;
    expect(summary(last)).toEqual(['Bravo 1-0', 'Alpha 1-0']);
    expect(last.winner).toBeNull();
  });

  it('counts a double forfeit as a loss for both teams, with no winner', () => {
    const frames = seedingReplay([entry('Alpha', 1), entry('Bravo', 2)], [match('Alpha', 'Bravo', null, [0, 0])]);
    expect(summary(frames[1]!)).toEqual(['Alpha 0-1', 'Bravo 0-1']);
    expect(frames[1]!.winner).toBeNull();
  });

  it('skips bracket matches', () => {
    const frames = seedingReplay([entry('Alpha', 1), entry('Bravo', 2)], [match('Alpha', 'Bravo', 0, [2, 0], 'bracket')]);
    expect(frames).toHaveLength(2);
  });
});

describe('seedingStepMs', () => {
  it('slows to the max for a small round robin', () => {
    expect(seedingStepMs(3)).toBe(SEEDING_STEP_MAX_MS);
  });

  it('speeds up to the min for a large round robin', () => {
    expect(seedingStepMs(200)).toBe(SEEDING_STEP_MIN_MS);
  });

  it('spreads a mid-size round robin over the target duration', () => {
    expect(seedingStepMs(50)).toBe(600);
  });
});
