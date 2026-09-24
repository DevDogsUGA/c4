// Pure pixel-art data for chips, empty holes, and the drop-hand sprite
// (SHOW_PLAN.md §2b/§2e). No DOM/canvas -- these are plain 2D arrays of
// small integer "shade indices"; the renderer rasterizes them onto offscreen
// canvases (see renderer.ts) and maps shade index -> actual color via
// `chipShadeColors` / `emptyHoleShadeColors` / `handShadeColors`, which
// derive every color from the theme's flat hex values using color.ts's pure
// helpers. Kept separate from renderer.ts so the pixel-grid *design* (ring
// presence, silhouette shape, symmetry) can be unit tested directly.

import { darken, lighten } from './color.js';

/** Logical resolution both chip and empty-hole grids are authored at. */
export const CHIP_GRID_SIZE = 24;

/** Shade roles used by the chip/hole pixel grids. */
export const SHADE_TRANSPARENT = 0;
export const SHADE_RING = 1;
export const SHADE_FACE = 2;
export const SHADE_HIGHLIGHT = 3;
export const SHADE_GROOVE = 4;

/** A square grid of shade indices, `size` x `size`. */
export type PixelGrid = number[][];

function makeGrid(size: number, fill: (col: number, row: number) => number): PixelGrid {
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => fill(col, row)));
}

const CENTER = (CHIP_GRID_SIZE - 1) / 2;
const OUTER_RADIUS = CHIP_GRID_SIZE / 2;

function distanceFromCenter(col: number, row: number): number {
  const dx = col - CENTER;
  const dy = row - CENTER;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The chip's ring/groove/face silhouette *without* the top-left highlight
 * cluster -- kept separate so tests can assert the underlying shape is
 * symmetric (the highlight is deliberately asymmetric, per SHOW_PLAN §2b).
 */
export function chipRingFaceGrid(): PixelGrid {
  const ringWidth = 2.5;
  const grooveWidth = 1;
  return makeGrid(CHIP_GRID_SIZE, (col, row) => {
    const d = distanceFromCenter(col, row);
    if (d > OUTER_RADIUS) return SHADE_TRANSPARENT;
    if (d > OUTER_RADIUS - ringWidth) return SHADE_RING;
    if (d > OUTER_RADIUS - ringWidth - grooveWidth) return SHADE_GROOVE;
    return SHADE_FACE;
  });
}

/** Full chip grid: ring/groove/face silhouette plus the top-left highlight cluster. */
export function chipGrid(): PixelGrid {
  const grid = chipRingFaceGrid();
  for (let row = 0; row < CHIP_GRID_SIZE; row++) {
    for (let col = 0; col < CHIP_GRID_SIZE; col++) {
      const dx = col - CENTER;
      const dy = row - CENTER;
      const inHighlightZone = dx <= -3 && dx > -6.5 && dy <= -3 && dy > -6.5;
      if (inHighlightZone && grid[row][col] === SHADE_FACE) {
        grid[row][col] = SHADE_HIGHLIGHT;
      }
    }
  }
  return grid;
}

/** Empty-hole silhouette: thinner 1px-equivalent ring, flat face, no groove/highlight. */
export function emptyHoleGrid(): PixelGrid {
  const ringWidth = 1.5;
  return makeGrid(CHIP_GRID_SIZE, (col, row) => {
    const d = distanceFromCenter(col, row);
    if (d > OUTER_RADIUS) return SHADE_TRANSPARENT;
    if (d > OUTER_RADIUS - ringWidth) return SHADE_RING;
    return SHADE_FACE;
  });
}

/** Per-shade hex color for a chip of the given base color. All derived via color.ts. */
export type ChipShadeColors = Record<number, string>;

/** Derives the ring/groove/face/highlight colors for a chip from its flat base color. */
export function chipShadeColors(baseColor: string): ChipShadeColors {
  return {
    [SHADE_RING]: darken(baseColor, 0.4),
    [SHADE_GROOVE]: darken(baseColor, 0.2),
    [SHADE_FACE]: baseColor,
    [SHADE_HIGHLIGHT]: lighten(baseColor, 0.45),
  };
}

/** Multiplies a chip's shade colors toward black, for the "dim non-winning chip" highlight (§2c). */
export function dimShadeColors(colors: ChipShadeColors, brightness: number): ChipShadeColors {
  const dim = (hex: string) => darken(hex, 1 - brightness);
  return {
    [SHADE_RING]: dim(colors[SHADE_RING]),
    [SHADE_GROOVE]: dim(colors[SHADE_GROOVE]),
    [SHADE_FACE]: dim(colors[SHADE_FACE]),
    [SHADE_HIGHLIGHT]: dim(colors[SHADE_HIGHLIGHT]),
  };
}

/** Per-shade hex color for an empty hole. */
export type HoleShadeColors = Record<number, string>;

/** Derives the ring/face colors for an empty hole from the board's flat empty-cell color. */
export function emptyHoleShadeColors(emptyCellColor: string): HoleShadeColors {
  return {
    [SHADE_RING]: lighten(emptyCellColor, 0.22),
    [SHADE_FACE]: emptyCellColor,
  };
}

/** Neutral grays for the drop-hand sprite (§2e) -- deliberately theme-independent so it reads over either player's chip color. */
export const HAND_SHADE_COLORS: { [key: number]: string } = {
  1: '#3a3a3a',
  2: '#8a8a8a',
  3: '#d8d8d8',
};

/**
 * A small pixel-art hand/fist sprite (authored as data), used for the
 * optional drop-hand flourish (§2e). 16 wide x 12 tall. Shade 1 = outline
 * (dark), 2 = mid gray, 3 = light gray (knuckle highlight), 0 = transparent.
 */
export function handGrid(): PixelGrid {
  const rows: string[] = [
    '................',
    '.....1111.......',
    '....132231......',
    '...13222231.....',
    '..1322222231....',
    '..1322222231....',
    '..1322222231....',
    '..1322222231....',
    '...132222311....',
    '....1322311.....',
    '.....1331.......',
    '......11........',
  ];
  return rows.map((line) =>
    line.split('').map((ch) => (ch === '.' ? SHADE_TRANSPARENT : Number.parseInt(ch, 10))),
  );
}

/** Which edge of the board a sideways drop-hand enters from / retreats to. */
export type HandSide = 'left' | 'right';

/**
 * Rotates a pixel grid 90 degrees clockwise. Pure geometry helper -- a
 * `rows x cols` grid becomes a `cols x rows` grid.
 */
export function rotateGrid90CW(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const rotated: PixelGrid = Array.from({ length: cols }, () =>
    Array.from({ length: rows }, () => SHADE_TRANSPARENT),
  );
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rotated[c][rows - 1 - r] = grid[r][c];
    }
  }
  return rotated;
}

/** Mirrors a pixel grid horizontally (reverses column order within each row). */
export function mirrorGridHorizontal(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row].reverse());
}

/**
 * A small pixel-art SIDEWAYS-pointing hand/fist sprite (SHOW_PLAN §9c item
 * 6), derived from the vertical `handGrid()` (§2e) rotated 90 degrees so its
 * grip end points along the horizontal axis instead of straight down.
 *
 * `'right'` is the canonical rotation: grip end toward the LEFT edge of the
 * sprite, wrist/arm trailing off the RIGHT edge -- i.e. a hand that enters
 * the board from its right side and reaches left toward the target column.
 * `'left'` is its exact horizontal mirror: grip toward the right edge,
 * wrist trailing off the left edge -- entering from the board's left side.
 */
export function handSideGrid(side: HandSide): PixelGrid {
  const rotated = rotateGrid90CW(handGrid());
  return side === 'right' ? rotated : mirrorGridHorizontal(rotated);
}
