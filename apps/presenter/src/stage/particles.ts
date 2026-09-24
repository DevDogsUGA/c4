// Pure particle-emitter config + simulation module (SHOW_PLAN.md §9c item
// 7): spawn/velocity/gravity/spin/lifetime ranges for every particle effect
// on the stage, plus a deterministic (seeded) spawner and a per-frame
// stepper so a `useTick` callback can mutate Pixi node refs without any
// randomness or per-frame allocation surprises leaking into untested code.
// No Pixi/DOM imports -- rendering (ParticleField.tsx et al.) is excluded
// from unit tests per this repo's convention; this module IS tested.

export interface Range {
  min: number;
  max: number;
}

export interface ParticleConfig {
  /** How many particles one `spawnParticles()` call produces. */
  count: number;
  /** Spawn area, in the same logical px space as everything else. */
  spawnX: Range;
  spawnY: Range;
  velocityX: Range;
  velocityY: Range;
  /** Downward acceleration, px/s^2. 0 for effects that shouldn't fall (ambient title dots). */
  gravity: number;
  /** Rotation speed, radians/s. */
  spin: Range;
  lifetimeMs: Range;
  size: Range;
  colors: readonly string[];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  age: number;
  lifetimeMs: number;
  size: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Deterministic RNG -- mulberry32, seeded so tests (and the "deterministic
// option" the task calls for) can assert exact ranges/reproducibility.
// ---------------------------------------------------------------------------

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpRange(range: Range, t: number): number {
  return range.min + (range.max - range.min) * t;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

/** Spawns `config.count` particles at time 0, deterministic for a given `seed`. */
export function spawnParticles(config: ParticleConfig, seed: number): Particle[] {
  const rng = mulberry32(seed);
  return Array.from({ length: Math.max(0, config.count) }, () => ({
    x: lerpRange(config.spawnX, rng()),
    y: lerpRange(config.spawnY, rng()),
    vx: lerpRange(config.velocityX, rng()),
    vy: lerpRange(config.velocityY, rng()),
    rotation: rng() * Math.PI * 2,
    spin: lerpRange(config.spin, rng()),
    age: 0,
    lifetimeMs: lerpRange(config.lifetimeMs, rng()),
    size: lerpRange(config.size, rng()),
    color: pick(config.colors, rng),
  }));
}

/**
 * Advances one particle by `dtMs` -- gravity accelerates vy, position
 * integrates from velocity, rotation from spin, age accumulates. Pure: does
 * not mutate `p`, returns a new object (the Pixi component decides whether
 * to mutate its own ref copies in place for perf; this stays allocation-
 * transparent and testable).
 */
export function stepParticle(p: Particle, dtMs: number, gravity: number): Particle {
  const dt = dtMs / 1000;
  const vy = p.vy + gravity * dt;
  return {
    ...p,
    x: p.x + p.vx * dt,
    y: p.y + vy * dt,
    vy,
    rotation: p.rotation + p.spin * dt,
    age: p.age + dtMs,
  };
}

/** Whether a particle has outlived its lifetime and should be recycled/removed. */
export function isExpired(p: Particle): boolean {
  return p.age >= p.lifetimeMs;
}

/** 1 (just spawned) -> 0 (expired) -- a fade-out alpha curve driven by age. */
export function particleAlpha(p: Particle): number {
  if (p.lifetimeMs <= 0) return 0;
  const remaining = 1 - p.age / p.lifetimeMs;
  return Math.max(0, Math.min(1, remaining));
}

// ---------------------------------------------------------------------------
// Named configs -- one per SHOW_PLAN.md §9c item 7 effect. Positions are
// caller-supplied (spawnX/spawnY get overridden per call site, e.g. above a
// specific board or the winning line's cells); these are the canonical
// motion parameters.
// ---------------------------------------------------------------------------

const BULLDOG = '#BA0C2F';
const CHALK = '#FFFFFF';
const STEEL = '#B7B7B7';
const SILVER = '#EFEFEF';

/** Win confetti: ~400 dots falling from the top of the stage (SHOW_PLAN §9c item 7). */
export const WIN_CONFETTI_CONFIG: ParticleConfig = {
  count: 400,
  spawnX: { min: 0, max: 1920 },
  spawnY: { min: -60, max: -10 },
  velocityX: { min: -60, max: 60 },
  velocityY: { min: 80, max: 220 },
  gravity: 380,
  spin: { min: -6, max: 6 },
  lifetimeMs: { min: 2200, max: 3800 },
  size: { min: 4, max: 10 },
  colors: [BULLDOG, BULLDOG, CHALK, SILVER],
};

/** Champion confetti: ~1500 dots, denser and longer-lived, rendered via a ParticleContainer for GPU batching. */
export const CHAMPION_CONFETTI_CONFIG: ParticleConfig = {
  count: 1500,
  spawnX: { min: 0, max: 1920 },
  spawnY: { min: -80, max: -10 },
  velocityX: { min: -90, max: 90 },
  velocityY: { min: 60, max: 200 },
  gravity: 300,
  spin: { min: -8, max: 8 },
  lifetimeMs: { min: 3000, max: 5500 },
  size: { min: 4, max: 12 },
  colors: [BULLDOG, BULLDOG, BULLDOG, CHALK, SILVER, STEEL],
};

/** Coin-flip trail sparks: a short burst trailing the coin's arc. Caller re-spawns/repositions per frame along the arc. */
export const COIN_TRAIL_CONFIG: ParticleConfig = {
  count: 10,
  spawnX: { min: -4, max: 4 },
  spawnY: { min: -4, max: 4 },
  velocityX: { min: -40, max: 40 },
  velocityY: { min: -40, max: 40 },
  gravity: 200,
  spin: { min: -4, max: 4 },
  lifetimeMs: { min: 250, max: 500 },
  size: { min: 2, max: 5 },
  colors: [BULLDOG, CHALK],
};

/** Landing dust puff -- low, wide, quick-fading, at the coin/hand's landing point. */
export const LANDING_DUST_CONFIG: ParticleConfig = {
  count: 24,
  spawnX: { min: -20, max: 20 },
  spawnY: { min: -6, max: 6 },
  velocityX: { min: -140, max: 140 },
  velocityY: { min: -60, max: -10 },
  gravity: 260,
  spin: { min: -2, max: 2 },
  lifetimeMs: { min: 300, max: 650 },
  size: { min: 3, max: 8 },
  colors: [STEEL, SILVER],
};

/** Elimination debris -- a few chips of card breaking off as the loser's card tumbles away (SHOW_PLAN §5/§9c item 3). */
export const ELIMINATION_DEBRIS_CONFIG: ParticleConfig = {
  count: 14,
  spawnX: { min: -18, max: 18 },
  spawnY: { min: -10, max: 10 },
  velocityX: { min: -80, max: 80 },
  velocityY: { min: 20, max: 140 },
  gravity: 420,
  spin: { min: -10, max: 10 },
  lifetimeMs: { min: 500, max: 1000 },
  size: { min: 3, max: 7 },
  colors: [STEEL, '#2E2E2E'],
};

/** Winning-four radial spark burst -- fired from the winning line's centroid (SHOW_PLAN §9c item 7). */
export const WINNING_FOUR_SPARK_CONFIG: ParticleConfig = {
  count: 60,
  spawnX: { min: -4, max: 4 },
  spawnY: { min: -4, max: 4 },
  velocityX: { min: -260, max: 260 },
  velocityY: { min: -260, max: 260 },
  gravity: 120,
  spin: { min: -6, max: 6 },
  lifetimeMs: { min: 350, max: 700 },
  size: { min: 3, max: 6 },
  colors: [BULLDOG, CHALK],
};

/**
 * Title-slide scatter-dot ambient drift/twinkle (SHOW_PLAN §9c item 7): near-
 * zero velocity, no gravity -- these aren't spawned/expired like the bursts
 * above, they're the SAME dots as layout.ts's `scatterDots`, gently drifting
 * forever. `driftOffset`/`twinkleAlpha` below are the pure per-frame
 * evaluators the component uses instead of the spawn/step/expire lifecycle.
 */
export const TITLE_SCATTER_DRIFT_CONFIG: ParticleConfig = {
  count: 0, // dots come from layout.ts's scatterDots(), not spawnParticles()
  spawnX: { min: 0, max: 0 },
  spawnY: { min: 0, max: 0 },
  velocityX: { min: -4, max: 4 },
  velocityY: { min: -4, max: 4 },
  gravity: 0,
  spin: { min: 0, max: 0 },
  lifetimeMs: { min: Infinity, max: Infinity },
  size: { min: 2, max: 2 },
  colors: [BULLDOG],
};

/**
 * A small, slow Lissajous-style drift offset for dot index `i` at time
 * `tMs` -- deterministic (no RNG state to carry across frames), bounded to
 * +/-`amplitude` px, for the title slide's ambient scatter dots.
 */
export function driftOffset(i: number, tMs: number, amplitude = 6): { x: number; y: number } {
  const phase = i * 0.618033988749895; // golden-ratio stride decorrelates neighboring dots
  const speed = 0.0004 + (i % 5) * 0.00005;
  return {
    x: Math.sin(tMs * speed + phase) * amplitude,
    y: Math.cos(tMs * speed * 0.8 + phase) * amplitude,
  };
}

/** A slow twinkle alpha in [0.35, 1] for dot index `i` at time `tMs`. */
export function twinkleAlpha(i: number, tMs: number): number {
  const phase = i * 1.32471795724;
  const speed = 0.0007 + (i % 7) * 0.00003;
  return 0.35 + 0.325 * (1 + Math.sin(tMs * speed + phase));
}
