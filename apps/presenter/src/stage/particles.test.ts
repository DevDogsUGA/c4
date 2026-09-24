import { describe, expect, it } from 'vitest';
import {
  CHAMPION_CONFETTI_CONFIG,
  COIN_TRAIL_CONFIG,
  ELIMINATION_DEBRIS_CONFIG,
  LANDING_DUST_CONFIG,
  WIN_CONFETTI_CONFIG,
  WINNING_FOUR_SPARK_CONFIG,
  driftOffset,
  isExpired,
  mulberry32,
  particleAlpha,
  spawnParticles,
  stepParticle,
  twinkleAlpha,
  type ParticleConfig,
} from './particles.js';

const TEST_CONFIG: ParticleConfig = {
  count: 50,
  spawnX: { min: 100, max: 200 },
  spawnY: { min: -20, max: -10 },
  velocityX: { min: -30, max: 30 },
  velocityY: { min: 50, max: 150 },
  gravity: 400,
  spin: { min: -5, max: 5 },
  lifetimeMs: { min: 1000, max: 2000 },
  size: { min: 2, max: 8 },
  colors: ['#111111', '#222222'],
};

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('spawnParticles', () => {
  it('spawns exactly `count` particles', () => {
    expect(spawnParticles(TEST_CONFIG, 1)).toHaveLength(50);
  });

  it('is deterministic for a given seed', () => {
    expect(spawnParticles(TEST_CONFIG, 5)).toEqual(spawnParticles(TEST_CONFIG, 5));
  });

  it('differs across seeds', () => {
    expect(spawnParticles(TEST_CONFIG, 1)).not.toEqual(spawnParticles(TEST_CONFIG, 2));
  });

  it('keeps every particle field within its configured range', () => {
    const particles = spawnParticles(TEST_CONFIG, 3);
    for (const p of particles) {
      expect(p.x).toBeGreaterThanOrEqual(TEST_CONFIG.spawnX.min);
      expect(p.x).toBeLessThanOrEqual(TEST_CONFIG.spawnX.max);
      expect(p.y).toBeGreaterThanOrEqual(TEST_CONFIG.spawnY.min);
      expect(p.y).toBeLessThanOrEqual(TEST_CONFIG.spawnY.max);
      expect(p.vx).toBeGreaterThanOrEqual(TEST_CONFIG.velocityX.min);
      expect(p.vx).toBeLessThanOrEqual(TEST_CONFIG.velocityX.max);
      expect(p.vy).toBeGreaterThanOrEqual(TEST_CONFIG.velocityY.min);
      expect(p.vy).toBeLessThanOrEqual(TEST_CONFIG.velocityY.max);
      expect(p.spin).toBeGreaterThanOrEqual(TEST_CONFIG.spin.min);
      expect(p.spin).toBeLessThanOrEqual(TEST_CONFIG.spin.max);
      expect(p.lifetimeMs).toBeGreaterThanOrEqual(TEST_CONFIG.lifetimeMs.min);
      expect(p.lifetimeMs).toBeLessThanOrEqual(TEST_CONFIG.lifetimeMs.max);
      expect(p.size).toBeGreaterThanOrEqual(TEST_CONFIG.size.min);
      expect(p.size).toBeLessThanOrEqual(TEST_CONFIG.size.max);
      expect(TEST_CONFIG.colors).toContain(p.color);
      expect(p.age).toBe(0);
    }
  });

  it('returns an empty array for a zero count', () => {
    expect(spawnParticles({ ...TEST_CONFIG, count: 0 }, 1)).toEqual([]);
  });
});

describe('stepParticle', () => {
  it('integrates position from velocity over dtMs', () => {
    const p = spawnParticles(TEST_CONFIG, 1)[0]!;
    const next = stepParticle(p, 100, 0);
    expect(next.x).toBeCloseTo(p.x + p.vx * 0.1);
    expect(next.y).toBeCloseTo(p.y + p.vy * 0.1);
  });

  it('applies gravity to vertical velocity', () => {
    const p = spawnParticles(TEST_CONFIG, 1)[0]!;
    const next = stepParticle(p, 100, 400);
    expect(next.vy).toBeCloseTo(p.vy + 400 * 0.1);
  });

  it('does not mutate the input particle', () => {
    const p = spawnParticles(TEST_CONFIG, 1)[0]!;
    const before = { ...p };
    stepParticle(p, 50, 400);
    expect(p).toEqual(before);
  });

  it('accumulates age and advances rotation by spin', () => {
    const p = spawnParticles(TEST_CONFIG, 1)[0]!;
    const next = stepParticle(p, 200, 0);
    expect(next.age).toBe(200);
    expect(next.rotation).toBeCloseTo(p.rotation + p.spin * 0.2);
  });
});

describe('isExpired / particleAlpha', () => {
  it('is not expired before its lifetime elapses', () => {
    const p = spawnParticles(TEST_CONFIG, 1)[0]!;
    expect(isExpired({ ...p, age: p.lifetimeMs - 1 })).toBe(false);
  });

  it('is expired once age reaches lifetimeMs', () => {
    const p = spawnParticles(TEST_CONFIG, 1)[0]!;
    expect(isExpired({ ...p, age: p.lifetimeMs })).toBe(true);
  });

  it('alpha fades from 1 (just spawned) to 0 (expired)', () => {
    const p = spawnParticles(TEST_CONFIG, 1)[0]!;
    expect(particleAlpha({ ...p, age: 0 })).toBeCloseTo(1);
    expect(particleAlpha({ ...p, age: p.lifetimeMs })).toBeCloseTo(0);
    expect(particleAlpha({ ...p, age: p.lifetimeMs / 2 })).toBeCloseTo(0.5);
  });
});

describe('named configs', () => {
  it('win confetti is ~400 particles', () => {
    expect(WIN_CONFETTI_CONFIG.count).toBe(400);
  });

  it('champion confetti is denser than win confetti (~1500)', () => {
    expect(CHAMPION_CONFETTI_CONFIG.count).toBe(1500);
    expect(CHAMPION_CONFETTI_CONFIG.count).toBeGreaterThan(WIN_CONFETTI_CONFIG.count);
  });

  it('every named config spawns a valid, in-range particle set', () => {
    for (const config of [
      WIN_CONFETTI_CONFIG,
      CHAMPION_CONFETTI_CONFIG,
      COIN_TRAIL_CONFIG,
      LANDING_DUST_CONFIG,
      ELIMINATION_DEBRIS_CONFIG,
      WINNING_FOUR_SPARK_CONFIG,
    ]) {
      const particles = spawnParticles(config, 99);
      expect(particles).toHaveLength(config.count);
      for (const p of particles) {
        expect(p.lifetimeMs).toBeGreaterThanOrEqual(config.lifetimeMs.min);
        expect(p.size).toBeGreaterThan(0);
      }
    }
  });

  it('confetti configs fall (positive gravity, downward-biased velocity)', () => {
    expect(WIN_CONFETTI_CONFIG.gravity).toBeGreaterThan(0);
    expect(CHAMPION_CONFETTI_CONFIG.gravity).toBeGreaterThan(0);
  });

  it('the winning-four spark burst is omnidirectional (symmetric velocity range)', () => {
    expect(WINNING_FOUR_SPARK_CONFIG.velocityX.min).toBe(-WINNING_FOUR_SPARK_CONFIG.velocityX.max);
    expect(WINNING_FOUR_SPARK_CONFIG.velocityY.min).toBe(-WINNING_FOUR_SPARK_CONFIG.velocityY.max);
  });
});

describe('driftOffset', () => {
  it('is bounded by the given amplitude', () => {
    for (let i = 0; i < 20; i++) {
      const { x, y } = driftOffset(i, 12345, 6);
      expect(Math.abs(x)).toBeLessThanOrEqual(6);
      expect(Math.abs(y)).toBeLessThanOrEqual(6);
    }
  });

  it('is deterministic for the same index and time', () => {
    expect(driftOffset(3, 5000)).toEqual(driftOffset(3, 5000));
  });

  it('varies over time', () => {
    expect(driftOffset(3, 0)).not.toEqual(driftOffset(3, 5000));
  });
});

describe('twinkleAlpha', () => {
  it('stays within [0.35, 1]', () => {
    for (let t = 0; t < 10000; t += 137) {
      const a = twinkleAlpha(2, t);
      expect(a).toBeGreaterThanOrEqual(0.35);
      expect(a).toBeLessThanOrEqual(1.0001);
    }
  });
});
