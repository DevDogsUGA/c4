import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseManifest,
  parseMatchRecord,
  parseTournamentBundle,
  parseTournamentSummary,
  tournamentDataFromBundle,
  type TournamentData,
} from './records.js';
import { bracketRevealKey, buildShowScript, ShowController, scenePhaseCount, type Scene } from './show.js';
import { INTRO_SLIDES, OUTRO_SLIDES } from './slides.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(fixturesDir + name, 'utf-8'));
}

function loadFixtureData(): TournamentData {
  const manifest = parseManifest(readJson('manifest.json'));
  const summary = parseTournamentSummary(readJson(manifest.summary), manifest.summary);
  const matches = manifest.matches.map((f) => parseMatchRecord(readJson(f), f));
  return { summary, matches };
}

function loadEdgeCaseBundleData(): TournamentData {
  return tournamentDataFromBundle(parseTournamentBundle(readJson('tournament.json'), 'tournament.json'));
}

function bracketScenes(scenes: Scene[]): Extract<Scene, { type: 'bracket' }>[] {
  return scenes.filter((s): s is Extract<Scene, { type: 'bracket' }> => s.type === 'bracket');
}

function matchScenes(scenes: Scene[]): Extract<Scene, { type: 'match' }>[] {
  return scenes.filter((s): s is Extract<Scene, { type: 'match' }> => s.type === 'match');
}

describe('buildShowScript', () => {
  const data = loadFixtureData();
  const scenes = buildShowScript(data);

  it('opens with the intro slide deck, in order', () => {
    expect(scenes.slice(0, INTRO_SLIDES.length).map((s) => s.type)).toEqual(
      INTRO_SLIDES.map(() => 'slide'),
    );
    expect(scenes.slice(0, INTRO_SLIDES.length).map((s) => (s as Extract<Scene, { type: 'slide' }>).slide)).toEqual(
      INTRO_SLIDES,
    );
  });

  it('follows the intro slides with exactly one seeding scene', () => {
    expect(scenes[INTRO_SLIDES.length]!.type).toBe('seeding');
    expect(scenes.filter((s) => s.type === 'seeding')).toHaveLength(1);
  });

  it("the seeding scene carries the marquee and this tournament's standings", () => {
    const seeding = scenes[INTRO_SLIDES.length] as Extract<Scene, { type: 'seeding' }>;
    expect(seeding.standings.length).toBe(data.summary.standings.length);
    expect(seeding.marquee.length).toBeGreaterThan(0);
  });

  it('follows the seeding scene with the initial two-sided bracket scene', () => {
    const initial = scenes[INTRO_SLIDES.length + 1]!;
    expect(initial.type).toBe('bracket');
    const bracket = initial as Extract<Scene, { type: 'bracket' }>;
    expect(bracket.layout.final?.round).toBe('Final');
    expect(bracket.justAdvanced).toBeUndefined();
  });

  it('reveals nothing at the outset (fixture has no byes)', () => {
    const initial = bracketScenes(scenes)[0]!;
    expect(initial.revealedThrough.size).toBe(0);
  });

  it('interleaves each played bracket match as match -> bracket-with-winner-revealed', () => {
    const brackets = bracketScenes(scenes);
    // initial + one per played match (sf-1, sf-2, final-1)
    expect(brackets).toHaveLength(4);

    const sf1Key = bracketRevealKey({ round: 'Semifinal', slot: 0 });
    const sf2Key = bracketRevealKey({ round: 'Semifinal', slot: 1 });
    const finalKey = bracketRevealKey({ round: 'Final', slot: 0 });

    expect(brackets[0]!.revealedThrough.size).toBe(0);
    expect(brackets[1]!.revealedThrough.has(sf1Key)).toBe(true);
    expect(brackets[1]!.revealedThrough.has(sf2Key)).toBe(false);
    expect(brackets[1]!.justAdvanced).toBeDefined();
    expect(brackets[2]!.revealedThrough.has(sf1Key)).toBe(true);
    expect(brackets[2]!.revealedThrough.has(sf2Key)).toBe(true);
    expect(brackets[2]!.revealedThrough.has(finalKey)).toBe(false);
    expect(brackets[3]!.revealedThrough.has(finalKey)).toBe(true);
    expect(brackets[3]!.justEliminated).toBeDefined();
  });

  it('places a match scene immediately before each non-initial bracket scene', () => {
    const bracketIndices = scenes.map((s, i) => (s.type === 'bracket' ? i : -1)).filter((i) => i >= 0);
    for (const i of bracketIndices.slice(1)) {
      expect(scenes[i - 1]!.type).toBe('match');
    }
  });

  it('gives every played bracket match exactly one match scene (all games, no per-game replays)', () => {
    const matches = matchScenes(scenes);
    expect(matches).toHaveLength(3); // sf-1, sf-2, final-1
    expect(matches.map((m) => m.match.match_id)).toEqual(['sf-1', 'sf-2', 'final-1']);
  });

  it("each match scene's phases come straight from buildMatchPhases", () => {
    const finalScene = matchScenes(scenes).find((m) => m.match.match_id === 'final-1')!;
    expect(finalScene.phases.length).toBeGreaterThan(0);
    expect(finalScene.phases[finalScene.phases.length - 1]!.kind).toBe('result');
    expect(finalScene.bracketContext).toEqual({ round: 'Final', slot: 0 });
  });

  it('derives the champion scene from the final match winner', () => {
    const champion = scenes.find((s) => s.type === 'champion') as Extract<Scene, { type: 'champion' }> | undefined;
    expect(champion).toBeDefined();
    const finalMatch = data.matches.find((m) => m.match_id === 'final-1')!;
    const winnerSlot = finalMatch.result.winner_team;
    expect(winnerSlot).not.toBeNull();
    expect(champion!.team!.name).toBe(finalMatch.teams[winnerSlot!]!.name);
  });

  it('places the champion scene right before the outro slides', () => {
    const championIndex = scenes.findIndex((s) => s.type === 'champion');
    expect(championIndex).toBeGreaterThan(-1);
    expect(scenes.slice(championIndex + 1).map((s) => s.type)).toEqual(OUTRO_SLIDES.map(() => 'slide'));
  });

  it('closes with the outro slide deck, in order', () => {
    const tail = scenes.slice(scenes.length - OUTRO_SLIDES.length);
    expect(tail.map((s) => (s as Extract<Scene, { type: 'slide' }>).slide)).toEqual(OUTRO_SLIDES);
  });
});

describe('bracketRevealKey', () => {
  it('combines round and slot into a stable key', () => {
    expect(bracketRevealKey({ round: 'Final', slot: 0 })).toBe('Final#0');
  });
});

describe('scenePhaseCount', () => {
  it('is 2 for a seeding scene (start table -> settled)', () => {
    expect(scenePhaseCount({ type: 'seeding', standings: [], marquee: [] })).toBe(2);
  });

  it('is 1 for a slide/bracket/champion scene', () => {
    expect(scenePhaseCount({ type: 'slide', slide: INTRO_SLIDES[0]! })).toBe(1);
    expect(scenePhaseCount({ type: 'bracket', layout: { sided: false, left: [], right: [], final: null }, revealedThrough: new Set() })).toBe(1);
    expect(
      scenePhaseCount({ type: 'champion', team: { name: 'A', repo_url: 'a' } }),
    ).toBe(1);
  });

  it('matches the phases array length for a match scene', () => {
    const scene: Scene = {
      type: 'match',
      match: {
        match_id: 'm',
        phase: 'bracket',
        teams: [
          { name: 'A', repo_url: 'a' },
          { name: 'B', repo_url: 'b' },
        ],
        games: [],
        result: { winner_team: 0, games_won: [0, 0], reason: 'forfeit' },
      },
      phases: [{ kind: 'walkover' }, { kind: 'result' }],
      bracketContext: { round: 'Final', slot: 0 },
    };
    expect(scenePhaseCount(scene)).toBe(2);
  });
});

describe('ShowController', () => {
  const slideScene = (): Scene => ({ type: 'slide', slide: INTRO_SLIDES[0]! });
  const seedingScene = (): Scene => ({ type: 'seeding', standings: [], marquee: [] });

  it('starts at the first scene, first phase', () => {
    const controller = new ShowController([slideScene()]);
    expect(controller.current()).toEqual(slideScene());
    expect(controller.sceneIndex()).toBe(0);
    expect(controller.phaseIndex()).toBe(0);
    expect(controller.atStart()).toBe(true);
  });

  it('advance() steps phase-by-phase within a multi-phase scene before crossing scenes', () => {
    const controller = new ShowController([seedingScene(), slideScene()]);
    expect(controller.phaseIndex()).toBe(0);
    expect(controller.sceneIndex()).toBe(0);

    controller.advance(); // seeding phase 0 -> 1
    expect(controller.sceneIndex()).toBe(0);
    expect(controller.phaseIndex()).toBe(1);
    expect(controller.atEnd()).toBe(false);

    controller.advance(); // seeding phase 1 -> next scene, phase 0
    expect(controller.sceneIndex()).toBe(1);
    expect(controller.phaseIndex()).toBe(0);
    expect(controller.atEnd()).toBe(true);

    controller.advance(); // stays put at the end
    expect(controller.sceneIndex()).toBe(1);
    expect(controller.phaseIndex()).toBe(0);
  });

  it('back() goes to the previous scene, at its first phase', () => {
    const controller = new ShowController([slideScene(), seedingScene()]);
    controller.advance(); // -> seeding, phase 0
    controller.advance(); // -> seeding, phase 1
    expect(controller.sceneIndex()).toBe(1);
    expect(controller.phaseIndex()).toBe(1);

    controller.back();
    expect(controller.sceneIndex()).toBe(0);
    expect(controller.phaseIndex()).toBe(0);
    expect(controller.atStart()).toBe(true);

    controller.back(); // stays put at the start
    expect(controller.sceneIndex()).toBe(0);
    expect(controller.phaseIndex()).toBe(0);
  });

  it('back() resets phase to 0 even when already on the first scene', () => {
    const controller = new ShowController([seedingScene()]);
    controller.advance();
    expect(controller.phaseIndex()).toBe(1);
    controller.back();
    expect(controller.phaseIndex()).toBe(0);
    expect(controller.sceneIndex()).toBe(0);
  });

  it('current() returns null for an empty script', () => {
    const controller = new ShowController([]);
    expect(controller.current()).toBeNull();
    expect(controller.advance()).toBeNull();
    expect(controller.back()).toBeNull();
  });

  it('jumpTo() moves directly to a scene, resetting to its first phase', () => {
    const controller = new ShowController([slideScene(), seedingScene(), slideScene()]);
    controller.jumpTo(1);
    expect(controller.sceneIndex()).toBe(1);
    expect(controller.phaseIndex()).toBe(0);

    controller.advance(); // seeding phase 0 -> 1
    expect(controller.phaseIndex()).toBe(1);

    controller.jumpTo(1); // re-jumping to the same scene still resets phase
    expect(controller.sceneIndex()).toBe(1);
    expect(controller.phaseIndex()).toBe(0);
  });

  it('jumpTo() clamps out-of-range indices to the script bounds', () => {
    const controller = new ShowController([slideScene(), seedingScene()]);
    controller.jumpTo(99);
    expect(controller.sceneIndex()).toBe(1);
    controller.jumpTo(-5);
    expect(controller.sceneIndex()).toBe(0);
  });

  it('jumpTo() is a no-op returning null for an empty script', () => {
    const controller = new ShowController([]);
    expect(controller.jumpTo(0)).toBeNull();
  });
});

describe('buildShowScript with double forfeits (fixtures/tournament.json)', () => {
  const data = loadEdgeCaseBundleData();
  const scenes = buildShowScript(data);

  it('flags the Round 1 double-forfeit slot as doubleForfeit, with no justAdvanced/justEliminated', () => {
    const brackets = bracketScenes(scenes);
    const doubleForfeitScene = brackets.find((b) => b.doubleForfeit);
    expect(doubleForfeitScene).toBeDefined();
    expect(doubleForfeitScene!.justAdvanced).toBeUndefined();
    expect(doubleForfeitScene!.justEliminated).toBeNull();
  });

  it("reveals the next round's bye slot (the double-forfeit walkover) from the very first bracket scene", () => {
    const initial = bracketScenes(scenes)[0]!;
    const byeKey = bracketRevealKey({ round: 'Semifinal', slot: 0 });
    expect(initial.revealedThrough.has(byeKey)).toBe(true);
  });

  it('the double-forfeit Final still gets exactly one match scene (a walkover, per matchPhases)', () => {
    const finalMatchScene = matchScenes(scenes).find((m) => m.match.match_id === 'edge-final');
    expect(finalMatchScene).toBeDefined();
    expect(finalMatchScene!.match.result.winner_team).toBeNull();
    expect(finalMatchScene!.phases.map((p) => p.kind)).toEqual(['walkover', 'result']);
  });

  it('the Final bracket-transition scene is flagged doubleForfeit too, with no champion-worthy winner', () => {
    const brackets = bracketScenes(scenes);
    const finalKey = bracketRevealKey({ round: 'Final', slot: 0 });
    const finalTransition = brackets.find((b) => b.revealedThrough.has(finalKey) && b.doubleForfeit);
    expect(finalTransition).toBeDefined();
  });

  it('still produces a champion scene after a double-forfeit final, but with a null team ("no champion")', () => {
    const champion = scenes.find((s) => s.type === 'champion') as Extract<Scene, { type: 'champion' }> | undefined;
    expect(champion).toBeDefined();
    expect(champion!.team).toBeNull();
  });

  it('places the no-champion scene right before the outro slides, same as a normal champion', () => {
    const championIndex = scenes.findIndex((s) => s.type === 'champion');
    expect(championIndex).toBeGreaterThan(-1);
    expect(scenes.slice(championIndex + 1).map((s) => s.type)).toEqual(OUTRO_SLIDES.map(() => 'slide'));
  });

  it('the round-robin double forfeit produces a "vs. — double forfeit" marquee line, not a "def." line', () => {
    const seeding = scenes.find((s) => s.type === 'seeding') as Extract<Scene, { type: 'seeding' }>;
    expect(seeding.marquee.some((line) => line.includes('double forfeit'))).toBe(true);
  });
});
