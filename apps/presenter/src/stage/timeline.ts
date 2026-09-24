// Pure keyframe/easing evaluator -- THE animation substrate for every
// per-frame Pixi mutation on the stage (SHOW_PLAN.md §9b/§9c). A `Track`
// describes one property's motion on one keyed object over a time window;
// `evaluate()` collapses a list of tracks down to a snapshot of props per
// key at time `t`, for a `useTick` callback to apply directly to Pixi node
// refs. No Pixi/DOM imports here at all -- React state changes only at
// scene/phase boundaries; per-frame motion flows entirely through this pure
// module and imperative ref mutation, never `setState` (the Iron Rule,
// SHOW_PLAN.md §9b).

export type EaseFn = (t: number) => number;

// ---------------------------------------------------------------------------
// Easing -- board-ui's easeInCubic is reused verbatim (re-exported below);
// the rest are local pure fns, since board-ui only exports the two
// drop-animation-specific curves it needs internally.
// ---------------------------------------------------------------------------

export { easeInCubic } from '@acm-uga/c4-board-ui';

export const linear: EaseFn = (t) => t;

export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3);

export const easeInOutCubic: EaseFn = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const easeOutQuad: EaseFn = (t) => 1 - (1 - t) * (1 - t);

/** Overshoots past its endpoint before settling -- for landings that punch past the mark (coin flip, card slams, winner-slot pop). */
export const easeOutBack: EaseFn = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** The Pixi node props this timeline module knows how to animate. */
export type AnimatableProp = 'x' | 'y' | 'rotation' | 'alpha' | 'scaleX' | 'scaleY';

export interface Track {
  /** Identifies which object this track targets -- matched against a scene's element keys (e.g. layout.ts's PlacedElement.key). */
  key: string;
  prop: AnimatableProp;
  t0: number;
  t1: number;
  from: number;
  to: number;
  ease: EaseFn;
}

export interface TrackInput {
  key: string;
  prop: AnimatableProp;
  t0: number;
  t1: number;
  from: number;
  to: number;
  ease?: EaseFn;
}

/** Builds one Track, defaulting to a linear ease. `input.ease` may be `undefined` (e.g. forwarded from an optional field) without clobbering that default. */
export function track(input: TrackInput): Track {
  return { ...input, ease: input.ease ?? linear };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type FrameProps = Partial<Record<AnimatableProp, number>>;

/**
 * Evaluates a single track at time `t`:
 *   - before t0: `undefined` (untouched -- whatever the JSX default or a
 *     prior track already set stands, so a track never has to explicitly
 *     restate "no motion yet").
 *   - within [t0, t1): eased interpolation from `from` to `to`.
 *   - at/after t1: `to`, held forever -- this alone implements the "hold"
 *     behavior; see `hold()` below for an explicit standalone version.
 */
function evaluateTrack(trk: Track, t: number): number | undefined {
  if (t < trk.t0) return undefined;
  if (t >= trk.t1) return trk.to;
  const span = trk.t1 - trk.t0;
  const local = span <= 0 ? 1 : (t - trk.t0) / span;
  return trk.from + (trk.to - trk.from) * trk.ease(local);
}

/**
 * Collapses `tracks` down to a snapshot of animated props per key at time
 * `t`, e.g. `{ 'card-3': { x: 812.4, alpha: 1 } }`. Tracks are evaluated in
 * array order; when more than one track targets the same key+prop and both
 * are active at `t` (e.g. two contiguous segments of a `chain()`), the
 * later one in the array wins -- so `chain()`/`stagger()` below always push
 * tracks in chronological order, and callers composing tracks by hand
 * should too.
 */
export function evaluate(tracks: readonly Track[], t: number): Record<string, FrameProps> {
  const frame: Record<string, FrameProps> = {};
  for (const trk of tracks) {
    const value = evaluateTrack(trk, t);
    if (value === undefined) continue;
    const props = frame[trk.key] ?? (frame[trk.key] = {});
    props[trk.prop] = value;
  }
  return frame;
}

// ---------------------------------------------------------------------------
// Sequencing helpers
// ---------------------------------------------------------------------------

/**
 * An explicit, standalone hold: freezes `key`'s `prop` at `value` for
 * [t0, t1). `evaluateTrack` already holds a track's value past its own t1
 * forever, so this is rarely needed for "what happens after" -- it's for
 * reserving an explicit pause *before* a later track/segment begins, or for
 * freezing a prop that has no other track touching it during a window.
 */
export function hold(key: string, prop: AnimatableProp, value: number, t0: number, t1: number): Track {
  return track({ key, prop, t0, t1, from: value, to: value });
}

export interface ChainSegment {
  to: number;
  duration: number;
  ease?: EaseFn;
}

/**
 * Builds a sequence of tracks on the same key+prop, each starting exactly
 * where the previous segment left off in both time and value -- e.g. a
 * bracket winner's x sliding along a connector, pausing at a waypoint, then
 * continuing into the next round's slot.
 */
export function chain(params: {
  key: string;
  prop: AnimatableProp;
  from: number;
  startAt?: number;
  segments: readonly ChainSegment[];
}): Track[] {
  const tracks: Track[] = [];
  let t = params.startAt ?? 0;
  let value = params.from;
  for (const segment of params.segments) {
    const t0 = t;
    const t1 = t + Math.max(0, segment.duration);
    tracks.push(track({ key: params.key, prop: params.prop, t0, t1, from: value, to: segment.to, ease: segment.ease }));
    value = segment.to;
    t = t1;
  }
  return tracks;
}

/**
 * Builds the same `from -> to` track for every key in `keys`, each starting
 * `staggerMs` after the previous -- e.g. bracket cards entering one by one,
 * seeding rows settling in sequence.
 */
export function stagger(params: {
  keys: readonly string[];
  prop: AnimatableProp;
  from: number;
  to: number;
  duration: number;
  staggerMs: number;
  startAt?: number;
  ease?: EaseFn;
}): Track[] {
  const start = params.startAt ?? 0;
  return params.keys.map((key, i) => {
    const t0 = start + i * params.staggerMs;
    return track({ key, prop: params.prop, t0, t1: t0 + params.duration, from: params.from, to: params.to, ease: params.ease });
  });
}

/** The latest `t1` across `tracks` -- e.g. to size a scene's phase-advance timer or a useTick loop's "done" check. */
export function timelineDuration(tracks: readonly Track[]): number {
  return tracks.reduce((max, t) => Math.max(max, t.t1), 0);
}

// ---------------------------------------------------------------------------
// Coin-flip helper (SHOW_PLAN.md §9c item 5) -- a pure periodic "flip" curve
// for a coin sprite's scaleX, simulating a spinning disc viewed edge-on: a
// full cycle goes face -> edge -> other face -> edge -> face. Decoupled from
// `track`/`evaluate` (a continuous oscillation isn't a from->to interpolation)
// but still pure and tested like every other per-frame evaluator here.
// ---------------------------------------------------------------------------

/**
 * `scaleX` for a coin spinning continuously at `cyclesPerSecond`, at time
 * `tMs` since the spin started. Ranges over [-1, 1] -- 0 is edge-on
 * (invisible-thin), +/-1 is face-on. `spinRate` lets a caller slow the spin
 * down as it approaches landing (e.g. `spinRate(t)` shrinking near 1).
 */
export function coinSpinScaleX(tMs: number, cyclesPerSecond: number): number {
  return Math.cos((tMs / 1000) * cyclesPerSecond * Math.PI * 2);
}
