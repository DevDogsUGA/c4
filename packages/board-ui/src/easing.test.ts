import { describe, expect, it } from 'vitest';
import { dropEasing, easeInCubic } from './easing.js';

describe('easeInCubic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeInCubic(0)).toBe(0);
    expect(easeInCubic(1)).toBe(1);
  });

  it('is slower than linear in the first half (ease-in accelerates)', () => {
    expect(easeInCubic(0.5)).toBeLessThan(0.5);
  });
});

describe('dropEasing', () => {
  it('starts at 0', () => {
    expect(dropEasing(0)).toBe(0);
  });

  it('ends at exactly 1', () => {
    expect(dropEasing(1)).toBe(1);
  });

  it('reaches the drop distance (1.0) at the fall/bounce boundary', () => {
    expect(dropEasing(0.7)).toBeCloseTo(1, 5);
  });

  it('clamps inputs outside [0, 1]', () => {
    expect(dropEasing(-1)).toBe(0);
    expect(dropEasing(2)).toBe(1);
  });

  it('is monotonically increasing during the fall phase', () => {
    const a = dropEasing(0.2);
    const b = dropEasing(0.4);
    const c = dropEasing(0.6);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('settles back to 1 by the end of the bounce phase', () => {
    expect(dropEasing(0.99)).toBeCloseTo(1, 1);
  });
});
