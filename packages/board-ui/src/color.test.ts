import { describe, expect, it } from 'vitest';
import { alpha, darken, lighten, parseHex, toHex } from './color.js';

describe('parseHex', () => {
  it('parses 6-digit hex colors', () => {
    expect(parseHex('#ba0c2f')).toEqual({ r: 0xba, g: 0x0c, b: 0x2f });
  });

  it('parses 3-digit shorthand hex colors', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('tolerates a missing leading #', () => {
    expect(parseHex('000000')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('toHex', () => {
  it('round-trips through parseHex', () => {
    expect(toHex(parseHex('#1d161e'))).toBe('#1d161e');
  });

  it('pads single-digit byte values', () => {
    expect(toHex({ r: 0, g: 1, b: 2 })).toBe('#000102');
  });

  it('clamps out-of-range components', () => {
    expect(toHex({ r: -10, g: 300, b: 128 })).toBe('#00ff80');
  });
});

describe('lighten', () => {
  it('returns the original color unchanged at amount 0', () => {
    expect(lighten('#101010', 0)).toBe('#101010');
  });

  it('returns white at amount 1', () => {
    expect(lighten('#101010', 1)).toBe('#ffffff');
  });

  it('moves each channel toward 255', () => {
    const result = parseHex(lighten('#000000', 0.5));
    expect(result.r).toBeGreaterThan(0);
    expect(result.r).toBeLessThan(255);
  });

  it('clamps amounts above 1', () => {
    expect(lighten('#101010', 2)).toBe('#ffffff');
  });
});

describe('darken', () => {
  it('returns the original color unchanged at amount 0', () => {
    expect(darken('#e7e4e7', 0)).toBe('#e7e4e7');
  });

  it('returns black at amount 1', () => {
    expect(darken('#e7e4e7', 1)).toBe('#000000');
  });

  it('moves each channel toward 0', () => {
    const result = parseHex(darken('#ffffff', 0.5));
    expect(result.r).toBeGreaterThan(0);
    expect(result.r).toBeLessThan(255);
  });

  it('clamps negative amounts', () => {
    expect(darken('#e7e4e7', -1)).toBe('#e7e4e7');
  });
});

describe('alpha', () => {
  it('formats an rgba string from a hex color', () => {
    expect(alpha('#ba0c2f', 0.5)).toBe('rgba(186, 12, 47, 0.5)');
  });

  it('clamps alpha above 1', () => {
    expect(alpha('#000000', 5)).toBe('rgba(0, 0, 0, 1)');
  });

  it('clamps alpha below 0', () => {
    expect(alpha('#000000', -5)).toBe('rgba(0, 0, 0, 0)');
  });
});
