import { describe, expect, it } from 'vitest';
import {
  chain,
  coinSpinScaleX,
  easeInCubic,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutQuad,
  evaluate,
  hold,
  linear,
  stagger,
  timelineDuration,
  track,
} from './timeline.js';

describe('track', () => {
  it('defaults to a linear ease', () => {
    const t = track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100 });
    expect(t.ease).toBe(linear);
  });

  it('keeps a supplied ease', () => {
    const t = track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100, ease: easeOutCubic });
    expect(t.ease).toBe(easeOutCubic);
  });
});

describe('evaluate', () => {
  it('omits a key entirely before its track starts', () => {
    const tracks = [track({ key: 'a', prop: 'x', t0: 100, t1: 200, from: 0, to: 10 })];
    expect(evaluate(tracks, 0)).toEqual({});
    expect(evaluate(tracks, 99)).toEqual({});
  });

  it('interpolates linearly within the window', () => {
    const tracks = [track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100 })];
    expect(evaluate(tracks, 0).a!.x).toBeCloseTo(0);
    expect(evaluate(tracks, 50).a!.x).toBeCloseTo(50);
  });

  it('holds at `to` at and after t1', () => {
    const tracks = [track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100 })];
    expect(evaluate(tracks, 100).a!.x).toBe(100);
    expect(evaluate(tracks, 10_000).a!.x).toBe(100);
  });

  it('applies the ease function, not just linear interpolation', () => {
    const tracks = [track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100, ease: easeInCubic })];
    // easeInCubic(0.5) = 0.125, far from the linear midpoint of 50.
    expect(evaluate(tracks, 50).a!.x).toBeCloseTo(12.5);
  });

  it('merges multiple props for the same key into one frame entry', () => {
    const tracks = [
      track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100 }),
      track({ key: 'a', prop: 'alpha', t0: 0, t1: 100, from: 0, to: 1 }),
    ];
    const frame = evaluate(tracks, 50);
    expect(frame.a).toEqual({ x: 50, alpha: 0.5 });
  });

  it('keeps separate keys independent', () => {
    const tracks = [
      track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100 }),
      track({ key: 'b', prop: 'x', t0: 0, t1: 100, from: 0, to: 200 }),
    ];
    const frame = evaluate(tracks, 50);
    expect(frame.a!.x).toBeCloseTo(50);
    expect(frame.b!.x).toBeCloseTo(100);
  });

  it('lets a later track in the array win over an earlier one active at the same t (chained segments)', () => {
    const tracks = [
      track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 100 }),
      track({ key: 'a', prop: 'x', t0: 100, t1: 200, from: 100, to: 300 }),
    ];
    // At t=150, track 1 alone would hold at 100 (t >= t1); track 2 is active
    // and should win since it's later in the array.
    expect(evaluate(tracks, 150).a!.x).toBeCloseTo(200);
  });

  it('handles a zero-duration track by snapping straight to `to`', () => {
    const tracks = [track({ key: 'a', prop: 'x', t0: 50, t1: 50, from: 0, to: 10 })];
    expect(evaluate(tracks, 50).a!.x).toBe(10);
  });
});

describe('easing functions', () => {
  it.each([
    ['linear', linear],
    ['easeInCubic', easeInCubic],
    ['easeOutCubic', easeOutCubic],
    ['easeInOutCubic', easeInOutCubic],
    ['easeOutQuad', easeOutQuad],
    ['easeOutBack', easeOutBack],
  ])('%s maps 0 -> 0 and 1 -> 1', (_name, ease) => {
    expect(ease(0)).toBeCloseTo(0);
    expect(ease(1)).toBeCloseTo(1);
  });

  it('easeOutCubic decelerates (front-loaded relative to linear)', () => {
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25);
  });

  it('easeInCubic accelerates (back-loaded relative to linear)', () => {
    expect(easeInCubic(0.25)).toBeLessThan(0.25);
  });

  it('easeInOutCubic is symmetric around the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it('easeOutBack overshoots past 1 before settling', () => {
    const samples = Array.from({ length: 50 }, (_, i) => easeOutBack(i / 49));
    expect(Math.max(...samples)).toBeGreaterThan(1);
  });
});

describe('hold', () => {
  it('keeps the value constant across, and beyond, its window', () => {
    const t = hold('a', 'alpha', 0.5, 100, 200);
    const frame1 = evaluate([t], 150);
    const frame2 = evaluate([t], 500);
    expect(frame1.a!.alpha).toBe(0.5);
    expect(frame2.a!.alpha).toBe(0.5);
  });
});

describe('chain', () => {
  it('links segments so each starts where the last left off, in time and value', () => {
    const tracks = chain({
      key: 'card',
      prop: 'x',
      from: 0,
      startAt: 10,
      segments: [
        { to: 100, duration: 50 },
        { to: 100, duration: 20 }, // a pause (from === to)
        { to: 400, duration: 80 },
      ],
    });
    expect(tracks).toHaveLength(3);
    expect(tracks[0]).toMatchObject({ t0: 10, t1: 60, from: 0, to: 100 });
    expect(tracks[1]).toMatchObject({ t0: 60, t1: 80, from: 100, to: 100 });
    expect(tracks[2]).toMatchObject({ t0: 80, t1: 160, from: 100, to: 400 });
  });

  it('evaluates to a single continuous motion across segment boundaries', () => {
    const tracks = chain({
      key: 'card',
      prop: 'x',
      from: 0,
      segments: [
        { to: 100, duration: 100 },
        { to: 300, duration: 100 },
      ],
    });
    expect(evaluate(tracks, 0).card!.x).toBeCloseTo(0);
    expect(evaluate(tracks, 100).card!.x).toBeCloseTo(100);
    expect(evaluate(tracks, 150).card!.x).toBeCloseTo(200);
    expect(evaluate(tracks, 200).card!.x).toBeCloseTo(300);
    expect(evaluate(tracks, 1000).card!.x).toBeCloseTo(300);
  });

  it('defaults startAt to 0', () => {
    const tracks = chain({ key: 'a', prop: 'y', from: 5, segments: [{ to: 15, duration: 10 }] });
    expect(tracks[0]!.t0).toBe(0);
  });
});

describe('stagger', () => {
  it('offsets each key by index * staggerMs, preserving duration', () => {
    const tracks = stagger({
      keys: ['a', 'b', 'c'],
      prop: 'alpha',
      from: 0,
      to: 1,
      duration: 200,
      staggerMs: 90,
      startAt: 1000,
    });
    expect(tracks.map((t) => t.key)).toEqual(['a', 'b', 'c']);
    expect(tracks[0]).toMatchObject({ t0: 1000, t1: 1200 });
    expect(tracks[1]).toMatchObject({ t0: 1090, t1: 1290 });
    expect(tracks[2]).toMatchObject({ t0: 1180, t1: 1380 });
  });

  it('defaults startAt to 0', () => {
    const tracks = stagger({ keys: ['a'], prop: 'alpha', from: 0, to: 1, duration: 10, staggerMs: 5 });
    expect(tracks[0]!.t0).toBe(0);
  });
});

describe('timelineDuration', () => {
  it('is the latest t1 across all tracks', () => {
    const tracks = [
      track({ key: 'a', prop: 'x', t0: 0, t1: 100, from: 0, to: 1 }),
      track({ key: 'b', prop: 'x', t0: 50, t1: 300, from: 0, to: 1 }),
    ];
    expect(timelineDuration(tracks)).toBe(300);
  });

  it('is 0 for an empty track list', () => {
    expect(timelineDuration([])).toBe(0);
  });
});

describe('coinSpinScaleX', () => {
  it('starts face-on (scaleX 1) at t=0', () => {
    expect(coinSpinScaleX(0, 4)).toBeCloseTo(1);
  });

  it('passes through edge-on (scaleX 0) a quarter-cycle in', () => {
    expect(coinSpinScaleX(250, 1)).toBeCloseTo(0, 5);
  });

  it('completes a full cycle back to face-on after 1/cyclesPerSecond seconds', () => {
    expect(coinSpinScaleX(1000, 2)).toBeCloseTo(1);
  });

  it('stays within [-1, 1]', () => {
    for (let t = 0; t < 5000; t += 37) {
      const v = coinSpinScaleX(t, 3);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });
});
