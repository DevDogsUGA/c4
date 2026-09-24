import { describe, expect, it } from 'vitest';
import type { BracketMatch, MatchRecord } from '@acm-uga/c4-contract';
import { groupBracketByRound } from './bracket.js';
import { eliminationSequence, splitBracket } from './bracketLayout.js';

const team = (name: string) => ({ name, repo_url: `https://github.com/example/${name}` });

function bm(
  round: string,
  slot: number,
  teamA: string | null,
  teamB: string | null,
  winner: string | null,
  bye = false,
  matchId: string | null = null,
): BracketMatch {
  return {
    match_id: matchId,
    round,
    slot,
    team_a: teamA ? team(teamA) : null,
    team_b: teamB ? team(teamB) : null,
    winner: winner ? team(winner) : null,
    bye,
  };
}

function playedMatch(matchId: string, teamA: string, teamB: string, winnerSlot: 0 | 1): MatchRecord {
  return {
    match_id: matchId,
    phase: 'bracket',
    teams: [team(teamA), team(teamB)],
    games: [],
    result: { winner_team: winnerSlot, games_won: winnerSlot === 0 ? [2, 1] : [1, 2], reason: 'played' },
  };
}

// 8-team bracket: Round 1 (4 matches) -> Semifinal (2 matches) -> Final (1 match).
const eightTeamBracket: BracketMatch[] = [
  bm('Round 1', 0, 'A', 'B', 'A', false, 'r1-0'),
  bm('Round 1', 1, 'C', 'D', 'C', false, 'r1-1'),
  bm('Round 1', 2, 'E', 'F', 'E', false, 'r1-2'),
  bm('Round 1', 3, 'G', 'H', 'G', false, 'r1-3'),
  bm('Semifinal', 0, 'A', 'C', 'A', false, 'sf-0'),
  bm('Semifinal', 1, 'E', 'G', 'E', false, 'sf-1'),
  bm('Final', 0, 'A', 'E', 'A', false, 'final-0'),
];

const eightTeamMatches = new Map<string, MatchRecord>([
  ['r1-0', playedMatch('r1-0', 'A', 'B', 0)],
  ['r1-1', playedMatch('r1-1', 'C', 'D', 0)],
  ['r1-2', playedMatch('r1-2', 'E', 'F', 0)],
  ['r1-3', playedMatch('r1-3', 'G', 'H', 0)],
  ['sf-0', playedMatch('sf-0', 'A', 'C', 0)],
  ['sf-1', playedMatch('sf-1', 'E', 'G', 0)],
  ['final-0', playedMatch('final-0', 'A', 'E', 0)],
]);

describe('splitBracket', () => {
  it('splits an 8-team bracket into two sides + a center final', () => {
    const rounds = groupBracketByRound(eightTeamBracket);
    const split = splitBracket(rounds);

    expect(split.sided).toBe(true);
    expect(split.final?.round).toBe('Final');

    expect(split.left.map((r) => r.round)).toEqual(['Round 1', 'Semifinal']);
    expect(split.right.map((r) => r.round)).toEqual(['Round 1', 'Semifinal']);

    const leftRound1 = split.left.find((r) => r.round === 'Round 1')!;
    const rightRound1 = split.right.find((r) => r.round === 'Round 1')!;
    expect(leftRound1.matches.map((m) => m.slot)).toEqual([0, 1]);
    expect(rightRound1.matches.map((m) => m.slot)).toEqual([2, 3]);

    const leftSf = split.left.find((r) => r.round === 'Semifinal')!;
    const rightSf = split.right.find((r) => r.round === 'Semifinal')!;
    expect(leftSf.matches.map((m) => m.slot)).toEqual([0]);
    expect(rightSf.matches.map((m) => m.slot)).toEqual([1]);
  });

  it('falls back to one-sided for a 4-team bracket (< 4 first-round matches)', () => {
    // 4-team: Round 1 has 2 matches -> below the 4-match threshold.
    const fourTeamBracket: BracketMatch[] = [
      bm('Round 1', 0, 'A', 'B', 'A', false, 'r1-0'),
      bm('Round 1', 1, 'C', 'D', 'C', false, 'r1-1'),
      bm('Final', 0, 'A', 'C', 'A', false, 'final-0'),
    ];
    const rounds = groupBracketByRound(fourTeamBracket);
    const split = splitBracket(rounds);

    expect(split.sided).toBe(false);
    expect(split.right).toEqual([]);
    expect(split.left.map((r) => r.round)).toEqual(['Round 1']);
    expect(split.final?.round).toBe('Final');
  });

  it('returns an empty shape for an empty bracket', () => {
    const split = splitBracket([]);
    expect(split).toEqual({ sided: false, left: [], right: [], final: null });
  });
});

describe('eliminationSequence', () => {
  it('returns played matches in bracket order with winner/loser names', () => {
    const rounds = groupBracketByRound(eightTeamBracket);
    const sequence = eliminationSequence(rounds, eightTeamMatches);

    expect(sequence).toHaveLength(7);
    expect(sequence.map((e) => e.key)).toEqual([
      'Round 1#0',
      'Round 1#1',
      'Round 1#2',
      'Round 1#3',
      'Semifinal#0',
      'Semifinal#1',
      'Final#0',
    ]);
    expect(sequence[0]).toMatchObject({ winnerName: 'A', loserName: 'B' });
    expect(sequence[6]).toMatchObject({ winnerName: 'A', loserName: 'E' });
  });

  it('reports loserName null for byes', () => {
    const withBye: BracketMatch[] = [
      bm('Round 1', 0, 'A', 'B', 'A', false, 'r1-0'),
      bm('Round 1', 1, 'C', null, 'C', true),
      bm('Final', 0, 'A', 'C', 'A', false, 'final-0'),
    ];
    const matches = new Map<string, MatchRecord>([
      ['r1-0', playedMatch('r1-0', 'A', 'B', 0)],
      ['final-0', playedMatch('final-0', 'A', 'C', 0)],
    ]);
    const rounds = groupBracketByRound(withBye);
    const sequence = eliminationSequence(rounds, matches);

    const byeEntry = sequence.find((e) => e.key === 'Round 1#1');
    expect(byeEntry).toMatchObject({ winnerName: 'C', loserName: null });
  });

  it('omits slots with no determined winner yet', () => {
    const unresolved: BracketMatch[] = [bm('Round 1', 0, 'A', 'B', null, false, null)];
    const rounds = groupBracketByRound(unresolved);
    expect(eliminationSequence(rounds, new Map())).toEqual([]);
  });

  it('falls back to one-sided for the 4-team bracket and still sequences correctly', () => {
    const fourTeamBracket: BracketMatch[] = [
      bm('Round 1', 0, 'A', 'B', 'A', false, 'r1-0'),
      bm('Round 1', 1, 'C', 'D', 'C', false, 'r1-1'),
      bm('Final', 0, 'A', 'C', 'A', false, 'final-0'),
    ];
    const matches = new Map<string, MatchRecord>([
      ['r1-0', playedMatch('r1-0', 'A', 'B', 0)],
      ['r1-1', playedMatch('r1-1', 'C', 'D', 0)],
      ['final-0', playedMatch('final-0', 'A', 'C', 0)],
    ]);
    const rounds = groupBracketByRound(fourTeamBracket);
    const sequence = eliminationSequence(rounds, matches);
    expect(sequence.map((e) => e.key)).toEqual(['Round 1#0', 'Round 1#1', 'Final#0']);
  });
});
