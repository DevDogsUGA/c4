import { describe, expect, it } from 'vitest';
import type { MatchRecord, StandingsEntry, TeamRef } from '@acm-uga/c4-contract';
import { describeScene, describeScenes } from './sceneDescriptor.js';
import type { Scene } from './show.js';
import { INTRO_SLIDES } from './slides.js';

function team(name: string): TeamRef {
  return { name, repo_url: `https://example.com/${name}` };
}

function standingsEntry(name: string): StandingsEntry {
  return {
    team: team(name),
    rank: 1,
    match_wins: 0,
    match_losses: 0,
    game_wins: 0,
    game_losses: 0,
  };
}

describe('describeScene', () => {
  it('describes a slide scene by its heading, with no teams', () => {
    const scene: Scene = { type: 'slide', slide: INTRO_SLIDES[0]! };
    expect(describeScene(scene)).toEqual({ type: 'slide', title: INTRO_SLIDES[0]!.heading, teams: [] });
  });

  it('describes a seeding scene with all standings team names', () => {
    const scene: Scene = {
      type: 'seeding',
      standings: [standingsEntry('Alpha'), standingsEntry('Beta')],
      replay: [],
      marquee: [],
    };
    expect(describeScene(scene)).toEqual({
      type: 'seeding',
      title: 'Seeding Reveal',
      teams: ['Alpha', 'Beta'],
    });
  });

  it('describes a bracket scene generically when nothing just advanced', () => {
    const scene: Scene = {
      type: 'bracket',
      layout: { left: [], right: [], final: [] } as never,
      revealedThrough: new Set(),
    };
    expect(describeScene(scene)).toEqual({ type: 'bracket', title: 'Bracket', teams: [] });
  });

  it('describes a bracket scene with the advancing team in the title', () => {
    const scene: Scene = {
      type: 'bracket',
      layout: { left: [], right: [], final: [] } as never,
      revealedThrough: new Set(),
      justAdvanced: team('Alpha'),
      justEliminated: team('Beta'),
    };
    expect(describeScene(scene)).toEqual({
      type: 'bracket',
      title: 'Bracket — Alpha advances',
      teams: [],
    });
  });

  it('describes a match scene by round and both team names', () => {
    const match: MatchRecord = {
      match_id: 'm1',
      phase: 'bracket',
      round: 'Quarterfinal',
      teams: [team('Alpha'), team('Beta')],
      games: [],
      result: { winner_team: 0, games_won: [2, 0], reason: 'played' },
    };
    const scene: Scene = { type: 'match', match, phases: [], bracketContext: { round: 'Quarterfinal', slot: 0 } };
    expect(describeScene(scene)).toEqual({
      type: 'match',
      title: 'Quarterfinal',
      teams: ['Alpha', 'Beta'],
    });
  });

  it('falls back to "Match" when the match record has no round label', () => {
    const match: MatchRecord = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [team('Alpha'), team('Beta')],
      games: [],
      result: { winner_team: 0, games_won: [2, 0], reason: 'played' },
    };
    const scene: Scene = { type: 'match', match, phases: [], bracketContext: { round: '', slot: 0 } };
    expect(describeScene(scene).title).toBe('Match');
  });

  it('describes a champion scene with the winning team', () => {
    const scene: Scene = { type: 'champion', team: team('Alpha') };
    expect(describeScene(scene)).toEqual({ type: 'champion', title: 'Champion', teams: ['Alpha'] });
  });

  it('describes a no-champion scene (double-forfeit final) with no teams', () => {
    const scene: Scene = { type: 'champion', team: null };
    expect(describeScene(scene)).toEqual({ type: 'champion', title: 'No Champion — Double Forfeit', teams: [] });
  });

  it('describes a double-forfeit bracket scene distinctly, even without justAdvanced', () => {
    const scene: Scene = {
      type: 'bracket',
      layout: { left: [], right: [], final: [] } as never,
      revealedThrough: new Set(),
      doubleForfeit: true,
    };
    expect(describeScene(scene)).toEqual({ type: 'bracket', title: 'Bracket — double forfeit', teams: [] });
  });
});

describe('describeScenes', () => {
  it('maps a whole script in order', () => {
    const scenes: Scene[] = [
      { type: 'slide', slide: INTRO_SLIDES[0]! },
      { type: 'champion', team: team('Alpha') },
    ];
    expect(describeScenes(scenes).map((d) => d.type)).toEqual(['slide', 'champion']);
  });
});
