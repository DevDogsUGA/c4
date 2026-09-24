// Pure show-flow logic: turns a loaded TournamentData into an ordered
// script of scenes, and a phase-aware state machine for stepping through
// them. Per SHOW_PLAN.md §4: intro slides -> a live-sort seeding reveal ->
// the initial two-sided bracket -> one (match replay, bracket-with-result)
// pair per played bracket match, in elimination order -> a champion scene.
// Keyboard wiring (space = advance, ArrowLeft = back)
// lives in App.tsx; this module has no DOM.

import type { BracketMatch, MatchRecord, StandingsEntry, TeamRef } from '@acm-uga/c4-contract';
import type { TournamentData } from './records.js';
import { sortStandings } from './standings.js';
import { groupBracketByRound } from './bracket.js';
import { splitBracket, type SplitBracket } from './bracketLayout.js';
import { marqueeLines, seedingReplay, type SeedingFrame } from './seeding.js';
import { buildMatchPhases, type MatchPhase } from './matchPhases.js';
import { INTRO_SLIDES, type Slide } from './slides.js';

/**
 * Identifies a slot in the bracket independent of whether it's been played
 * yet (`BracketMatch.match_id` is null until then) -- round name + slot
 * index is stable from the moment the summary is generated.
 */
export function bracketRevealKey(match: Pick<BracketMatch, 'round' | 'slot'>): string {
  return `${match.round}#${match.slot}`;
}

export interface MatchBracketContext {
  round: string;
  slot: number;
}

export type Scene =
  | { type: 'slide'; slide: Slide }
  | { type: 'seeding'; standings: StandingsEntry[]; replay: SeedingFrame[]; marquee: string[] }
  | {
      type: 'bracket';
      layout: SplitBracket;
      revealedThrough: ReadonlySet<string>;
      /** The team that just advanced into this bracket state, if any (drives the slide-in/flash cue). Absent for a double-forfeit slot -- nobody advances from it. */
      justAdvanced?: TeamRef;
      /** The team just eliminated by that same match, if any (drives the tumble-off cue); null for a bye or a double forfeit (see `doubleForfeit`). */
      justEliminated?: TeamRef | null;
      /** True iff the just-decided slot was a double forfeit (both teams forfeited, per the contract's `winner_team: null`) -- both team cards tumble off and the next-round opponent (if any) advances by bye instead. */
      doubleForfeit?: boolean;
    }
  | { type: 'match'; match: MatchRecord; phases: MatchPhase[]; bracketContext: MatchBracketContext }
  | { type: 'champion'; team: TeamRef | null };

/**
 * How many discrete phases a host steps through within one scene before
 * `advance()` moves on to the next scene. Seeding is 2 (start table -> the
 * match-by-match replay, which auto-plays); a match scene has one phase per `buildMatchPhases` entry
 * (dual/coinflip/single/walkover/result); every other scene is a single
 * beat.
 */
export function scenePhaseCount(scene: Scene): number {
  if (scene.type === 'seeding') return 2;
  if (scene.type === 'match') return Math.max(1, scene.phases.length);
  return 1;
}

/**
 * Builds the ordered scene script for the whole show:
 *   1. the intro slide deck (slides.ts, unmodified)
 *   2. one seeding-reveal scene (match-by-match replay + results marquee)
 *   3. an initial two-sided bracket scene, with byes already revealed
 *      (there's no match to build suspense from) and every other slot
 *      hidden/TBD
 *   4. for each played bracket match, in bracket order (round order, then
 *      slot order within a round): a match-replay scene, followed by a
 *      bracket scene with that match's winner advanced and loser
 *      eliminated
 *   5. a champion scene, derived from the final round's winner (the last
 *      scene of the show)
 *
 * Bracket matches with no `match_id` (not-yet-played slots) are skipped;
 * the bracket scene itself still shows them as TBD.
 */
export function buildShowScript(data: TournamentData): Scene[] {
  const scenes: Scene[] = [];

  for (const slide of INTRO_SLIDES) scenes.push({ type: 'slide', slide });

  scenes.push({
    type: 'seeding',
    standings: sortStandings(data.summary.standings),
    replay: seedingReplay(data.summary.standings, data.matches),
    marquee: marqueeLines(data.matches),
  });

  const rounds = groupBracketByRound(data.summary.bracket);
  if (rounds.length > 0) {
    const layout = splitBracket(rounds);
    const finalRoundName = rounds[rounds.length - 1]!.round;
    const bracketMatchesById = new Map(
      data.matches.filter((m) => m.phase === 'bracket').map((m) => [m.match_id, m] as const),
    );

    const revealed = new Set<string>();
    for (const round of rounds) {
      for (const bracketMatch of round.matches) {
        if (bracketMatch.bye) revealed.add(bracketRevealKey(bracketMatch));
      }
    }

    scenes.push({ type: 'bracket', layout, revealedThrough: new Set(revealed) });

    let champion: TeamRef | null = null;
    let finalDecided = false;

    for (const round of rounds) {
      for (const bracketMatch of round.matches) {
        const match = resolvePlayedMatch(bracketMatch, bracketMatchesById);
        if (!match) continue;

        scenes.push({
          type: 'match',
          match,
          phases: buildMatchPhases(match),
          bracketContext: { round: round.round, slot: bracketMatch.slot },
        });

        revealed.add(bracketRevealKey(bracketMatch));

        // A double forfeit (winner_team: null) means BOTH teams are out --
        // there's no winner to advance and no single loser to tumble; the
        // bracket scene flags `doubleForfeit` instead so the stage tumbles
        // both cards. The next-round opponent (if any) advances by bye,
        // which the summary already encodes directly on that later
        // BracketMatch (bye: true) -- no extra scene needed here for it.
        const winner = bracketMatch.winner;
        const doubleForfeit = winner === null;
        const loser = winner
          ? bracketMatch.team_a?.name === winner.name
            ? bracketMatch.team_b
            : bracketMatch.team_a
          : null;

        scenes.push({
          type: 'bracket',
          layout,
          revealedThrough: new Set(revealed),
          justAdvanced: winner ?? undefined,
          justEliminated: loser ?? null,
          doubleForfeit: doubleForfeit || undefined,
        });

        if (round.round === finalRoundName) {
          finalDecided = true;
          champion = winner ?? null;
        }
      }
    }

    // Always show a champion beat once the final has been decided -- even
    // when it's a double forfeit and there's no champion to name
    // (ChampionStage renders that distinctly; see forfeitCopy.ts's
    // isDoubleForfeit for the match-level check this mirrors).
    if (finalDecided) scenes.push({ type: 'champion', team: champion });
  }

  return scenes;
}

function resolvePlayedMatch(
  bracketMatch: BracketMatch,
  byId: Map<string | null, MatchRecord>,
): MatchRecord | undefined {
  if (!bracketMatch.match_id) return undefined;
  return byId.get(bracketMatch.match_id);
}

/**
 * Steps forward/backward through a fixed scene script, phase-by-phase
 * within a scene (see `scenePhaseCount`) before crossing into the next/
 * previous scene. Pure, no timers/DOM.
 */
export class ShowController {
  private sceneIdx = 0;
  private phaseIdx = 0;

  constructor(private readonly scenes: readonly Scene[]) {}

  current(): Scene | null {
    return this.scenes[this.sceneIdx] ?? null;
  }

  sceneIndex(): number {
    return this.sceneIdx;
  }

  phaseIndex(): number {
    return this.phaseIdx;
  }

  private currentPhaseCount(): number {
    const scene = this.current();
    return scene ? scenePhaseCount(scene) : 1;
  }

  atStart(): boolean {
    return this.sceneIdx === 0 && this.phaseIdx === 0;
  }

  atEnd(): boolean {
    return this.sceneIdx >= this.scenes.length - 1 && this.phaseIdx >= this.currentPhaseCount() - 1;
  }

  /**
   * Advances one phase, if not already at the end of the current scene;
   * once the current scene's phases are exhausted, moves to the first
   * phase of the next scene. Returns the new current scene.
   */
  advance(): Scene | null {
    if (this.scenes.length === 0) return null;
    if (this.phaseIdx < this.currentPhaseCount() - 1) {
      this.phaseIdx += 1;
    } else if (this.sceneIdx < this.scenes.length - 1) {
      this.sceneIdx += 1;
      this.phaseIdx = 0;
    }
    return this.current();
  }

  /**
   * Steps back to the first phase of the previous scene (never steps back
   * phase-by-phase within a scene); a no-op at the first scene beyond
   * resetting to its first phase. Returns the new current scene.
   */
  back(): Scene | null {
    if (this.scenes.length === 0) return null;
    if (this.sceneIdx > 0) this.sceneIdx -= 1;
    this.phaseIdx = 0;
    return this.current();
  }

  /**
   * Jumps directly to `index` (clamped to the script's bounds), always
   * resetting to that scene's first phase -- used by the control window's
   * jumpable scene list (SHOW_PLAN.md §3). Returns the new current scene.
   */
  jumpTo(index: number): Scene | null {
    if (this.scenes.length === 0) return null;
    this.sceneIdx = Math.min(Math.max(index, 0), this.scenes.length - 1);
    this.phaseIdx = 0;
    return this.current();
  }
}
