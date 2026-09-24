import { describe, expect, it } from 'vitest';
import { cellCenter, computeGeometry, dropStartY } from './geometry.js';

describe('computeGeometry', () => {
  it('fits a square 8x8 board into a square box exactly', () => {
    const g = computeGeometry(8, 8, 800, 800);
    expect(g.cellSize).toBe(100);
    expect(g.width).toBe(800);
    expect(g.height).toBe(800);
  });

  it('is bottlenecked by the shorter dimension', () => {
    const g = computeGeometry(8, 8, 1000, 400);
    expect(g.cellSize).toBe(50);
    expect(g.width).toBe(400);
    expect(g.height).toBe(400);
  });

  it('floors cell size to whole pixels', () => {
    const g = computeGeometry(8, 8, 801, 801);
    expect(g.cellSize).toBe(100);
    expect(Number.isInteger(g.cellSize)).toBe(true);
  });

  it('never produces a zero or negative cell size for a tiny box', () => {
    const g = computeGeometry(8, 8, 3, 3);
    expect(g.cellSize).toBeGreaterThanOrEqual(1);
  });

  it('derives a piece radius smaller than half the cell size (so neighbors do not touch)', () => {
    const g = computeGeometry(8, 8, 800, 800);
    expect(g.pieceRadius).toBeLessThan(g.cellSize / 2);
  });
});

describe('cellCenter', () => {
  const g = computeGeometry(8, 8, 800, 800); // cellSize 100

  it('places col 0, row 0 (bottom-left) at the bottom-left of the canvas', () => {
    const { x, y } = cellCenter(0, 0, g);
    expect(x).toBe(50);
    expect(y).toBe(750); // row 0 is the bottom row -> largest canvas y
  });

  it('places the top row at the smallest canvas y (row 0 = bottom per DESIGN.md)', () => {
    const { y } = cellCenter(0, 7, g);
    expect(y).toBe(50);
  });

  it('places the rightmost column at the largest canvas x', () => {
    const { x } = cellCenter(7, 0, g);
    expect(x).toBe(750);
  });
});

describe('dropStartY', () => {
  it('starts above the canvas (negative y)', () => {
    const g = computeGeometry(8, 8, 800, 800);
    expect(dropStartY(g)).toBeLessThan(0);
  });
});

describe('headroom (drop-hand band)', () => {
  it('defaults to zero headroom with unchanged layout', () => {
    const g = computeGeometry(8, 8, 400, 400);
    expect(g.headroom).toBe(0);
    expect(g.height).toBe(g.cellSize * 8);
    expect(dropStartY(g)).toBe(-g.cellSize / 2);
  });

  it('reserves a band above the face and keeps everything inside the canvas', () => {
    const g = computeGeometry(8, 8, 400, 400, 1.4);
    expect(g.headroom).toBe(Math.round(g.cellSize * 1.4));
    expect(g.height).toBe(g.cellSize * 8 + g.headroom);
    // fits the requested box
    expect(g.height).toBeLessThanOrEqual(400);
    // the drop start (hand/chip center) sits INSIDE the band, not above the canvas
    const y = dropStartY(g);
    expect(y).toBeGreaterThan(0);
    expect(y + g.pieceRadius).toBeLessThanOrEqual(g.headroom + g.cellSize / 2);
    // top row's cells sit below the band
    const top = cellCenter(0, 7, g);
    expect(top.y - g.pieceRadius).toBeGreaterThanOrEqual(g.headroom);
  });

  it('shifts cell centers down by exactly the headroom', () => {
    const flat = computeGeometry(8, 8, 400, 471);
    const banded = computeGeometry(8, 8, 400, 471 + Math.round(flat.cellSize * 1.4), 1.4);
    if (banded.cellSize === flat.cellSize) {
      expect(cellCenter(3, 2, banded).y).toBe(cellCenter(3, 2, flat).y + banded.headroom);
      expect(cellCenter(3, 2, banded).x).toBe(cellCenter(3, 2, flat).x);
    }
  });
});
