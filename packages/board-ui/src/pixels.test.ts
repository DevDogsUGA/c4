import { describe, expect, it } from 'vitest';
import {
  CHIP_GRID_SIZE,
  SHADE_FACE,
  SHADE_HIGHLIGHT,
  SHADE_RING,
  SHADE_TRANSPARENT,
  chipGrid,
  chipRingFaceGrid,
  chipShadeColors,
  dimShadeColors,
  emptyHoleGrid,
  emptyHoleShadeColors,
  handGrid,
  handSideGrid,
  mirrorGridHorizontal,
  rotateGrid90CW,
  type PixelGrid,
} from './pixels.js';

describe('chipRingFaceGrid (pixel-art chip silhouette)', () => {
  const grid = chipRingFaceGrid();

  it('is a CHIP_GRID_SIZE x CHIP_GRID_SIZE grid', () => {
    expect(grid.length).toBe(CHIP_GRID_SIZE);
    for (const row of grid) expect(row.length).toBe(CHIP_GRID_SIZE);
  });

  it('is horizontally and vertically symmetric', () => {
    for (let row = 0; row < CHIP_GRID_SIZE; row++) {
      for (let col = 0; col < CHIP_GRID_SIZE; col++) {
        const mirroredCol = CHIP_GRID_SIZE - 1 - col;
        const mirroredRow = CHIP_GRID_SIZE - 1 - row;
        expect(grid[row][col]).toBe(grid[row][mirroredCol]);
        expect(grid[row][col]).toBe(grid[mirroredRow][col]);
      }
    }
  });

  it('has a ring present at all four cardinal edges', () => {
    const mid = Math.round((CHIP_GRID_SIZE - 1) / 2);
    // Scan inward from each edge along the mid row/col; the first opaque
    // pixel encountered must be a ring pixel, not a bare face pixel.
    const firstOpaqueFromLeft = grid[mid].findIndex((s) => s !== SHADE_TRANSPARENT);
    const firstOpaqueFromRight = [...grid[mid]].reverse().findIndex((s) => s !== SHADE_TRANSPARENT);
    expect(grid[mid][firstOpaqueFromLeft]).toBe(SHADE_RING);
    expect(grid[mid][CHIP_GRID_SIZE - 1 - firstOpaqueFromRight]).toBe(SHADE_RING);

    const col = grid.map((r) => r[mid]);
    const firstOpaqueFromTop = col.findIndex((s) => s !== SHADE_TRANSPARENT);
    const firstOpaqueFromBottom = [...col].reverse().findIndex((s) => s !== SHADE_TRANSPARENT);
    expect(col[firstOpaqueFromTop]).toBe(SHADE_RING);
    expect(col[CHIP_GRID_SIZE - 1 - firstOpaqueFromBottom]).toBe(SHADE_RING);
  });

  it('has a bounded circular silhouette: corners transparent, center opaque', () => {
    expect(grid[0][0]).toBe(SHADE_TRANSPARENT);
    expect(grid[0][CHIP_GRID_SIZE - 1]).toBe(SHADE_TRANSPARENT);
    expect(grid[CHIP_GRID_SIZE - 1][0]).toBe(SHADE_TRANSPARENT);
    expect(grid[CHIP_GRID_SIZE - 1][CHIP_GRID_SIZE - 1]).toBe(SHADE_TRANSPARENT);

    const mid = Math.round((CHIP_GRID_SIZE - 1) / 2);
    expect(grid[mid][mid]).not.toBe(SHADE_TRANSPARENT);
  });
});

describe('chipGrid (with top-left highlight cluster)', () => {
  const grid = chipGrid();
  const base = chipRingFaceGrid();

  it('contains at least one highlight pixel', () => {
    const flat = grid.flat();
    expect(flat.some((s) => s === SHADE_HIGHLIGHT)).toBe(true);
  });

  it('only replaces face pixels, and only in the top-left quadrant', () => {
    for (let row = 0; row < CHIP_GRID_SIZE; row++) {
      for (let col = 0; col < CHIP_GRID_SIZE; col++) {
        if (grid[row][col] === SHADE_HIGHLIGHT) {
          expect(base[row][col]).toBe(SHADE_FACE);
          expect(col).toBeLessThan(CHIP_GRID_SIZE / 2);
          expect(row).toBeLessThan(CHIP_GRID_SIZE / 2);
        } else {
          expect(grid[row][col]).toBe(base[row][col]);
        }
      }
    }
  });
});

describe('emptyHoleGrid', () => {
  const grid = emptyHoleGrid();

  it('is symmetric and ring-bearing, matching the chip silhouette style', () => {
    for (let row = 0; row < CHIP_GRID_SIZE; row++) {
      for (let col = 0; col < CHIP_GRID_SIZE; col++) {
        const mirroredCol = CHIP_GRID_SIZE - 1 - col;
        expect(grid[row][col]).toBe(grid[row][mirroredCol]);
      }
    }
    const mid = Math.round((CHIP_GRID_SIZE - 1) / 2);
    const firstOpaque = grid[mid].findIndex((s) => s !== SHADE_TRANSPARENT);
    expect(grid[mid][firstOpaque]).toBe(SHADE_RING);
  });

  it('has no groove or highlight shades', () => {
    const flat = grid.flat();
    expect(flat.every((s) => s === SHADE_TRANSPARENT || s === SHADE_RING || s === SHADE_FACE)).toBe(true);
  });
});

describe('chipShadeColors / dimShadeColors', () => {
  it('derives distinct ring/groove/face/highlight colors from a base color', () => {
    const colors = chipShadeColors('#f4c430');
    const values = Object.values(colors);
    expect(new Set(values).size).toBe(values.length);
  });

  it('dims every shade toward black while preserving relative ordering-free structure', () => {
    const colors = chipShadeColors('#f4c430');
    const dimmed = dimShadeColors(colors, 0.35);
    for (const key of Object.keys(colors) as unknown as Array<keyof typeof colors>) {
      expect(dimmed[key]).not.toBe(colors[key]);
      expect(dimmed[key].toLowerCase()).not.toBe('#000000');
    }
  });

  it('fully dims to black at brightness 0', () => {
    const colors = chipShadeColors('#f4c430');
    const dimmed = dimShadeColors(colors, 0);
    for (const key of Object.keys(colors) as unknown as Array<keyof typeof colors>) {
      expect(dimmed[key].toLowerCase()).toBe('#000000');
    }
  });
});

describe('emptyHoleShadeColors', () => {
  it('derives a ring color distinct from the face color', () => {
    const colors = emptyHoleShadeColors('#05070a');
    expect(colors[SHADE_RING]).not.toBe(colors[SHADE_FACE]);
  });
});

describe('handGrid', () => {
  const grid = handGrid();

  it('is a rectangular grid with at least one opaque pixel', () => {
    const width = grid[0].length;
    for (const row of grid) expect(row.length).toBe(width);
    expect(grid.flat().some((s) => s !== SHADE_TRANSPARENT)).toBe(true);
  });
});

describe('rotateGrid90CW', () => {
  it('rotates a small grid clockwise (rows x cols -> cols x rows)', () => {
    const grid: PixelGrid = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(rotateGrid90CW(grid)).toEqual([
      [4, 1],
      [5, 2],
      [6, 3],
    ]);
  });

  it('swaps the bounds of the vertical hand grid', () => {
    const base = handGrid();
    const rotated = rotateGrid90CW(base);
    expect(rotated.length).toBe(base[0].length);
    for (const row of rotated) expect(row.length).toBe(base.length);
  });
});

describe('mirrorGridHorizontal', () => {
  it('reverses column order within each row', () => {
    const grid: PixelGrid = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(mirrorGridHorizontal(grid)).toEqual([
      [3, 2, 1],
      [6, 5, 4],
    ]);
  });
});

describe('handSideGrid (sideways drop-hand, SHOW_PLAN §9c item 6)', () => {
  const base = handGrid();
  const baseHeight = base.length;
  const baseWidth = base[0].length;
  const baseOpaqueCount = base.flat().filter((s) => s !== SHADE_TRANSPARENT).length;

  it('has bounds swapped relative to the vertical hand for both sides', () => {
    for (const side of ['left', 'right'] as const) {
      const grid = handSideGrid(side);
      expect(grid.length).toBe(baseWidth);
      for (const row of grid) expect(row.length).toBe(baseHeight);
    }
  });

  it('preserves the opaque pixel count of the vertical hand for both sides (pure permutation)', () => {
    for (const side of ['left', 'right'] as const) {
      const grid = handSideGrid(side);
      const opaqueCount = grid.flat().filter((s) => s !== SHADE_TRANSPARENT).length;
      expect(opaqueCount).toBe(baseOpaqueCount);
    }
  });

  it("'right' points its grip toward the left edge of the sprite", () => {
    const grid = handSideGrid('right');
    expect(grid.some((row) => row[0] !== SHADE_TRANSPARENT)).toBe(true);
  });

  it("'left' points its grip toward the right edge of the sprite", () => {
    const grid = handSideGrid('left');
    const width = grid[0].length;
    expect(grid.some((row) => row[width - 1] !== SHADE_TRANSPARENT)).toBe(true);
  });

  it("'left' is the exact horizontal mirror of 'right'", () => {
    const right = handSideGrid('right');
    const left = handSideGrid('left');
    const width = right[0].length;
    for (let r = 0; r < right.length; r++) {
      for (let c = 0; c < width; c++) {
        expect(left[r][c]).toBe(right[r][width - 1 - c]);
      }
    }
  });
});
