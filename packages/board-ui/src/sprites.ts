// Canvas-dependent sprite generation for the board renderer (SHOW_PLAN.md
// §2a/§2b/§2e). DOM-dependent, so -- like renderer.ts -- excluded from unit
// tests per the repo's ground rules; the pixel-grid *data* it rasterizes
// lives in pixels.ts (pure, tested) and the color math it uses lives in
// color.ts (pure, tested).
//
// All sprites are pre-rendered offscreen canvases, generated once on
// construction/resize (never per animation frame). Runtime painting is
// always a single `drawImage` blit per piece -- this is what keeps the
// per-frame cost flat regardless of how many chips are on the board.

import type { Player } from '@acm-uga/c4-engine';
import {
  CHIP_GRID_SIZE,
  chipGrid,
  chipShadeColors,
  dimShadeColors,
  emptyHoleGrid,
  emptyHoleShadeColors,
  handSideGrid,
  HAND_SHADE_COLORS,
  SHADE_TRANSPARENT,
  type HandSide,
  type PixelGrid,
} from './pixels.js';
import { alpha } from './color.js';
import type { BoardTheme } from './theme.js';

/** A pre-rendered sprite: an offscreen canvas plus the CSS-pixel footprint it should be drawn at. */
export interface SpriteImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Brightness multiplier for dimmed (non-winning) settled chips -- SHOW_PLAN §2c: "~35% brightness". */
export const DIM_BRIGHTNESS = 0.35;

function rasterizeGrid(grid: PixelGrid, colorFor: (shade: number) => string | undefined): HTMLCanvasElement {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const shade = grid[row][col];
      if (shade === SHADE_TRANSPARENT) continue;
      const color = colorFor(shade);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(col, row, 1, 1);
    }
  }
  return canvas;
}

/** Upscales a logical (small, crisp) canvas to its final device-pixel sprite size with nearest-neighbor sampling. */
function toSprite(
  logical: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  footprintWidthCss: number,
  footprintHeightCss: number,
  dpr: number,
): SpriteImage {
  const outW = Math.max(1, Math.round(footprintWidthCss * dpr));
  const outH = Math.max(1, Math.round(footprintHeightCss * dpr));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(logical, 0, 0, logicalWidth, logicalHeight, 0, 0, outW, outH);
  return { canvas, width: footprintWidthCss, height: footprintHeightCss };
}

function buildChipLogical(baseColor: string, dim: boolean): HTMLCanvasElement {
  const colors = chipShadeColors(baseColor);
  const shades = dim ? dimShadeColors(colors, DIM_BRIGHTNESS) : colors;
  return rasterizeGrid(chipGrid(), (shade) => shades[shade]);
}

/**
 * Builds a "falling" chip sprite: the crisp pixel-art chip plus a soft drop
 * shadow baked in at generation time (shadowBlur here is fine -- it never
 * runs per animation frame, only when sprites are (re)built).
 */
function buildFallingSprite(baseColor: string, diameterCss: number, dpr: number): SpriteImage {
  const logical = buildChipLogical(baseColor, false);
  const pad = diameterCss * 0.35;
  const footprint = diameterCss + pad * 2;
  const outSize = Math.max(1, Math.round(footprint * dpr));
  const chipSizePx = Math.max(1, Math.round(diameterCss * dpr));
  const chipOffsetPx = Math.round(pad * dpr);

  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    chipOffsetPx + chipSizePx / 2 + chipSizePx * 0.08,
    chipOffsetPx + chipSizePx / 2 + chipSizePx * 0.18,
    chipSizePx * 0.42,
    chipSizePx * 0.32,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = alpha('#000000', 0.4);
  ctx.shadowColor = alpha('#000000', 0.4);
  ctx.shadowBlur = chipSizePx * 0.25;
  ctx.fill();
  ctx.restore();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(logical, 0, 0, CHIP_GRID_SIZE, CHIP_GRID_SIZE, chipOffsetPx, chipOffsetPx, chipSizePx, chipSizePx);

  return { canvas, width: footprint, height: footprint };
}

/** All sprites the renderer needs for one geometry/theme/dpr combination. */
export interface SpriteSet {
  face: Record<Player, SpriteImage>;
  faceDim: Record<Player, SpriteImage>;
  falling: Record<Player, SpriteImage>;
  hole: SpriteImage;
  /** Sideways-pointing drop-hand sprite (SHOW_PLAN §9c item 6), one per entry side. */
  handSide: Record<HandSide, SpriteImage>;
}

export function buildSpriteSet(theme: BoardTheme, diameterCss: number, dpr: number): SpriteSet {
  const players: Player[] = [1, 2];
  const face = {} as Record<Player, SpriteImage>;
  const faceDim = {} as Record<Player, SpriteImage>;
  const falling = {} as Record<Player, SpriteImage>;

  for (const player of players) {
    const baseColor = player === 1 ? theme.player1 : theme.player2;
    const normalLogical = buildChipLogical(baseColor, false);
    const dimLogical = buildChipLogical(baseColor, true);
    face[player] = toSprite(normalLogical, CHIP_GRID_SIZE, CHIP_GRID_SIZE, diameterCss, diameterCss, dpr);
    faceDim[player] = toSprite(dimLogical, CHIP_GRID_SIZE, CHIP_GRID_SIZE, diameterCss, diameterCss, dpr);
    falling[player] = buildFallingSprite(baseColor, diameterCss, dpr);
  }

  const holeColors = emptyHoleShadeColors(theme.emptyCell);
  const holeLogical = rasterizeGrid(emptyHoleGrid(), (shade) => holeColors[shade]);
  const hole = toSprite(holeLogical, CHIP_GRID_SIZE, CHIP_GRID_SIZE, diameterCss, diameterCss, dpr);

  const handSide = {} as Record<HandSide, SpriteImage>;
  const sides: HandSide[] = ['left', 'right'];
  for (const side of sides) {
    const handSourceGrid = handSideGrid(side);
    const handLogical = rasterizeGrid(handSourceGrid, (shade) => HAND_SHADE_COLORS[shade]);
    const handWidthCss = diameterCss * 1.1;
    const handAspect = handSourceGrid[0].length / handSourceGrid.length;
    const handHeightCss = handWidthCss / handAspect;
    handSide[side] = toSprite(
      handLogical,
      handSourceGrid[0].length,
      handSourceGrid.length,
      handWidthCss,
      handHeightCss,
      dpr,
    );
  }

  return { face, faceDim, falling, hole, handSide };
}
