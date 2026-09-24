import { describe, expect, it } from 'vitest';
import type { GameOutcome, MatchRecord } from '@acm-uga/c4-contract';
import { describeGameOutcome, describeMatchForfeit, gameForfeitReasonLabel, isDoubleForfeit, matchForfeitReasonLabel } from './forfeitCopy.js';

const team = (name: string) => ({ name, repo_url: `https://example.com/${name}` });

function matchWithForfeits(forfeits: MatchRecord['result']['forfeits'], winner_team: 0 | 1 | null): MatchRecord {
  return {
    match_id: 'm1',
    phase: 'bracket',
    teams: [team('Alpha'), team('Bravo')],
    games: [],
    result: { winner_team, games_won: [0, 0], reason: forfeits ? 'forfeit' : 'played', forfeits },
  };
}

describe('matchForfeitReasonLabel', () => {
  it('labels every match-forfeit reason distinctly', () => {
    expect(matchForfeitReasonLabel('startup_timeout')).toBe("Didn't start in time");
    expect(matchForfeitReasonLabel('build_failed')).toBe('Build failed');
    expect(matchForfeitReasonLabel('checkout_failed')).toBe('Repo unavailable');
  });
});

describe('isDoubleForfeit', () => {
  it('is true only when winner_team is null', () => {
    expect(isDoubleForfeit(matchWithForfeits(undefined, 0))).toBe(false);
    expect(
      isDoubleForfeit(
        matchWithForfeits([{ team: 0, reason: 'startup_timeout' }, { team: 1, reason: 'build_failed' }], null),
      ),
    ).toBe(true);
  });
});

describe('describeMatchForfeit', () => {
  it('names the forfeiting team and reason for a single forfeit', () => {
    const match = matchWithForfeits([{ team: 1, reason: 'checkout_failed' }], 0);
    expect(describeMatchForfeit(match)).toBe('Bravo forfeits — Repo unavailable.');
  });

  it('renders a distinct line for a double forfeit', () => {
    const match = matchWithForfeits(
      [{ team: 0, reason: 'startup_timeout' }, { team: 1, reason: 'build_failed' }],
      null,
    );
    expect(describeMatchForfeit(match)).toBe('Double forfeit — neither team advances.');
  });

  it('is empty for a normally-played match', () => {
    expect(describeMatchForfeit(matchWithForfeits(undefined, 0))).toBe('');
  });
});

describe('gameForfeitReasonLabel', () => {
  it('labels every game-forfeit reason distinctly', () => {
    expect(gameForfeitReasonLabel('clock_expired')).toBe('Clock expired');
    expect(gameForfeitReasonLabel('invalid_move')).toBe('Invalid move');
    expect(gameForfeitReasonLabel('crash_loop')).toBe('Crash loop');
  });
});

describe('describeGameOutcome', () => {
  it('returns null for a four_in_a_row outcome (the board itself communicates it)', () => {
    const outcome: GameOutcome = { type: 'four_in_a_row', winner: 1 };
    expect(describeGameOutcome(outcome, null)).toBeNull();
  });

  it('returns "DRAW" for a draw', () => {
    expect(describeGameOutcome({ type: 'draw' }, null)).toBe('DRAW');
  });

  it.each(['clock_expired', 'invalid_move', 'crash_loop'] as const)(
    'describes a %s game forfeit with the forfeiting team name',
    (reason) => {
      const outcome: GameOutcome = { type: 'forfeit', winner: 1, forfeited_player: 2, reason };
      expect(describeGameOutcome(outcome, 'Night Owls')).toBe(`Night Owls forfeits — ${gameForfeitReasonLabel(reason)}`);
    },
  );

  it('falls back to a generic label when the forfeiting team name is unknown', () => {
    const outcome: GameOutcome = { type: 'forfeit', winner: 1, forfeited_player: 2, reason: 'invalid_move' };
    expect(describeGameOutcome(outcome, null)).toBe('The mover forfeits — Invalid move');
  });
});
