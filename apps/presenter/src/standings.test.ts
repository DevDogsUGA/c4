import { describe, expect, it } from 'vitest';
import type { StandingsEntry } from '@acm-uga/c4-contract';
import { sortStandings } from './standings.js';

function entry(name: string, rank: number): StandingsEntry {
  return {
    team: { name, repo_url: `https://github.com/example/${name}` },
    rank,
    match_wins: 0,
    match_losses: 0,
    game_wins: 0,
    game_losses: 0,
  };
}

describe('sortStandings', () => {
  it('sorts ascending by rank regardless of input order', () => {
    const input = [entry('c', 3), entry('a', 1), entry('b', 2)];
    expect(sortStandings(input).map((e) => e.team.name)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [entry('b', 2), entry('a', 1)];
    const copy = [...input];
    sortStandings(input);
    expect(input).toEqual(copy);
  });
});
