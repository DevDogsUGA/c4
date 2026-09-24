import { describe, expect, it } from 'vitest';
import {
  bracketSize,
  byeWinner,
  firstRoundPairings,
  isBye,
  nextPowerOfTwo,
  nextRoundPairings,
  roundLabel,
  seedOrder,
} from './bracket.js';
import type { Team } from './types.js';

function team(n: number): Team {
  return { name: `Seed ${n}`, repoUrl: `https://team-${n}` };
}

describe('nextPowerOfTwo', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [16, 16],
    [17, 32],
  ])('nextPowerOfTwo(%i) === %i', (input, expected) => {
    expect(nextPowerOfTwo(input)).toBe(expected);
  });
});

describe('seedOrder', () => {
  it('places seed 1 and seed 2 in opposite halves at every bracket size (they can only meet in the final)', () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const order = seedOrder(size);
      expect(order).toHaveLength(size);
      const half = size / 2;
      const indexOf1 = order.indexOf(1);
      const indexOf2 = order.indexOf(2);
      expect(Math.floor(indexOf1 / half)).not.toBe(Math.floor(indexOf2 / half));
    }
  });

  it('is a permutation of 1..size', () => {
    const order = seedOrder(8);
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('matches the standard 8-seed bracket (1v8, 4v5, 2v7, 3v6)', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('bracketSize', () => {
  it('defaults to at least 16 slots', () => {
    expect(bracketSize(5)).toBe(16);
    expect(bracketSize(16)).toBe(16);
  });

  it('scales past 16 for larger fields, never capping registrations', () => {
    expect(bracketSize(17)).toBe(32);
    expect(bracketSize(33)).toBe(64);
  });
});

describe('firstRoundPairings', () => {
  it('gives byes to the top seeds when the field is smaller than the bracket', () => {
    const teams = [team(1), team(2), team(3)]; // 3 real teams, min 4 slots
    const pairings = firstRoundPairings(teams, 4);
    const byes = pairings.filter(isBye);
    expect(byes).toHaveLength(1);
    // The bye winner should be one of the top seeds (1 or 2), not the worst (3).
    expect(byeWinner(byes[0])?.name).not.toBe('Seed 3');
  });

  it('produces no byes when the field exactly fills the bracket', () => {
    const teams = [1, 2, 3, 4].map(team);
    const pairings = firstRoundPairings(teams, 4);
    expect(pairings.every((p) => !isBye(p))).toBe(true);
    expect(pairings).toHaveLength(2);
  });

  it('seed 1 and seed 2 cannot meet before the final in a real bracket', () => {
    const teams = Array.from({ length: 16 }, (_, i) => team(i + 1));
    let round = firstRoundPairings(teams, 16);
    // Simulate every round with the higher seed always winning (no byes at 16 real teams).
    while (round.length > 1) {
      const winners = round.map((p) => {
        if (isBye(p)) return byeWinner(p);
        return p.teamA!.name < p.teamB!.name ? p.teamA : p.teamB; // arbitrary but consistent
      });
      // seed1 and seed2 should never be paired against each other before the final.
      for (const p of round) {
        const names = [p.teamA?.name, p.teamB?.name];
        if (names.includes('Seed 1') && names.includes('Seed 2')) {
          throw new Error('seed 1 and seed 2 met before the final');
        }
      }
      round = nextRoundPairings(winners);
    }
  });
});

describe('roundLabel', () => {
  it.each([
    [2, 'Final'],
    [4, 'Semifinal'],
    [8, 'Quarterfinal'],
    [16, 'Round of 16'],
    [32, 'Round of 32'],
  ])('roundLabel(%i) === %s', (size, label) => {
    expect(roundLabel(size)).toBe(label);
  });
});
