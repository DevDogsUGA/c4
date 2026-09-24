import { describe, expect, it } from 'vitest';
import type { GameRecord, MatchRecord } from '@connect-4/contract';
import { buildMatchPhases, resolveBoardRegion } from './matchPhases.js';

const team = (name: string) => ({ name, repo_url: `https://github.com/example/${name}` });

function game(gameNumber: number): GameRecord {
  return {
    game_number: gameNumber,
    first_player: 1,
    first_player_team: 0,
    coin_flip: gameNumber === 1,
    moves: [],
    clock_events: [],
    outcome: { type: 'four_in_a_row', winner: 1 },
  };
}

function match(games: GameRecord[]): MatchRecord {
  return {
    match_id: 'm1',
    phase: 'bracket',
    teams: [team('A'), team('B')],
    games,
    result: { winner_team: 0, games_won: [2, 0], reason: 'played' },
  };
}

describe('buildMatchPhases', () => {
  it('a 2-game match: dual then result', () => {
    const games = [game(1), game(2)];
    const phases = buildMatchPhases(match(games));
    expect(phases.map((p) => p.kind)).toEqual(['dual', 'result']);
    expect(phases[0]).toMatchObject({ kind: 'dual', games: [games[0], games[1]] });
  });

  it('a 3-game match: dual, coinflip, single, result', () => {
    const games = [game(1), game(2), game(3)];
    const phases = buildMatchPhases(match(games));
    expect(phases.map((p) => p.kind)).toEqual(['dual', 'coinflip', 'single', 'result']);
    expect(phases[1]).toMatchObject({ kind: 'coinflip', game: games[2] });
    expect(phases[2]).toMatchObject({ kind: 'single', game: games[2] });
  });

  it('a 5-game match: dual, then a coinflip/single pair for EACH of the three games after the first two, then result', () => {
    const games = [game(1), game(2), game(3), game(4), game(5)];
    const phases = buildMatchPhases(match(games));
    expect(phases.map((p) => p.kind)).toEqual([
      'dual',
      'coinflip',
      'single',
      'coinflip',
      'single',
      'coinflip',
      'single',
      'result',
    ]);
    expect(phases[1]).toMatchObject({ game: games[2] });
    expect(phases[2]).toMatchObject({ game: games[2] });
    expect(phases[3]).toMatchObject({ game: games[3] });
    expect(phases[4]).toMatchObject({ game: games[3] });
    expect(phases[5]).toMatchObject({ game: games[4] });
    expect(phases[6]).toMatchObject({ game: games[4] });
  });

  it('a 1-game match: single then result', () => {
    const games = [game(1)];
    const phases = buildMatchPhases(match(games));
    expect(phases.map((p) => p.kind)).toEqual(['single', 'result']);
    expect(phases[0]).toMatchObject({ game: games[0] });
  });

  it('a 0-game match (startup-timeout forfeit): walkover then result', () => {
    const phases = buildMatchPhases(match([]));
    expect(phases.map((p) => p.kind)).toEqual(['walkover', 'result']);
  });

  it('every phase list ends with a result phase', () => {
    for (const games of [[], [game(1)], [game(1), game(2)], [game(1), game(2), game(3)]]) {
      const phases = buildMatchPhases(match(games));
      expect(phases[phases.length - 1]).toEqual({ kind: 'result' });
    }
  });
});

describe('resolveBoardRegion', () => {
  it('is the dual region for a 2-game match at any phase index', () => {
    const games = [game(1), game(2)];
    const phases = buildMatchPhases(match(games));
    expect(resolveBoardRegion(phases, 0)).toEqual({ kind: 'dual', games: [games[0], games[1]] });
    expect(resolveBoardRegion(phases, 1)).toEqual({ kind: 'dual', games: [games[0], games[1]] });
  });

  it('stays on the dual region through a coinflip phase, then switches to single', () => {
    const games = [game(1), game(2), game(3)];
    const phases = buildMatchPhases(match(games));
    // ['dual', 'coinflip', 'single', 'result']
    expect(resolveBoardRegion(phases, 0)).toEqual({ kind: 'dual', games: [games[0], games[1]] });
    expect(resolveBoardRegion(phases, 1)).toEqual({ kind: 'dual', games: [games[0], games[1]] });
    expect(resolveBoardRegion(phases, 2)).toEqual({ kind: 'single', game: games[2] });
    expect(resolveBoardRegion(phases, 3)).toEqual({ kind: 'single', game: games[2] });
  });

  it('advances through chained sudden-death games one at a time', () => {
    const games = [game(1), game(2), game(3), game(4)];
    const phases = buildMatchPhases(match(games));
    // ['dual', 'coinflip', 'single', 'coinflip', 'single', 'result']
    expect(resolveBoardRegion(phases, 2)).toEqual({ kind: 'single', game: games[2] });
    expect(resolveBoardRegion(phases, 4)).toEqual({ kind: 'single', game: games[3] });
  });

  it('is a walkover for a 0-game match', () => {
    const phases = buildMatchPhases(match([]));
    expect(resolveBoardRegion(phases, 0)).toEqual({ kind: 'walkover' });
    expect(resolveBoardRegion(phases, 1)).toEqual({ kind: 'walkover' });
  });

  it('is a single region for a 1-game match', () => {
    const games = [game(1)];
    const phases = buildMatchPhases(match(games));
    expect(resolveBoardRegion(phases, 0)).toEqual({ kind: 'single', game: games[0] });
  });

  it('clamps to the last defined region past the end of the phase list', () => {
    const games = [game(1), game(2)];
    const phases = buildMatchPhases(match(games));
    expect(resolveBoardRegion(phases, 99)).toEqual({ kind: 'dual', games: [games[0], games[1]] });
  });
});
