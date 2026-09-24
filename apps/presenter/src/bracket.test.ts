import { describe, expect, it } from 'vitest';
import type { BracketMatch } from '@acm-uga/c4-contract';
import { finalRound, groupBracketByRound } from './bracket.js';

const team = (name: string) => ({ name, repo_url: `https://github.com/example/${name}` });

const bracket: BracketMatch[] = [
  { match_id: 'sf-1', round: 'Semifinal', slot: 0, team_a: team('a'), team_b: team('b'), winner: team('a'), bye: false },
  { match_id: 'sf-2', round: 'Semifinal', slot: 1, team_a: team('c'), team_b: team('d'), winner: team('c'), bye: false },
  { match_id: 'final-1', round: 'Final', slot: 0, team_a: team('a'), team_b: team('c'), winner: team('a'), bye: false },
];

describe('groupBracketByRound', () => {
  it('groups by round, preserving first-seen round order', () => {
    const rounds = groupBracketByRound(bracket);
    expect(rounds.map((r) => r.round)).toEqual(['Semifinal', 'Final']);
  });

  it('sorts matches within a round by slot', () => {
    const shuffled = [bracket[1]!, bracket[0]!, bracket[2]!];
    const rounds = groupBracketByRound(shuffled);
    expect(rounds[0]!.matches.map((m) => m.slot)).toEqual([0, 1]);
  });
});

describe('finalRound', () => {
  it('returns the last round in bracket order', () => {
    expect(finalRound(bracket)?.round).toBe('Final');
  });

  it('returns null for an empty bracket', () => {
    expect(finalRound([])).toBeNull();
  });
});
