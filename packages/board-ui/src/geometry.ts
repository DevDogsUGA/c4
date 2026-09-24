// Pure layout math for the board renderer. No DOM, no canvas -- kept
// separate from renderer.ts so it can be unit tested directly (ground rule:
// pure logic is tested, rendering/DOM is not).

/** A single cell coordinate. Mirrors @acm-uga/c4-engine's Coord shape. */
export interface Coord {
  col: number;
  row: number;
}

/** Computed pixel layout for a `cols` x `rows` board inside a given box. */
export interface BoardGeometry {
  cols: number;
  rows: number;
  /** Side length of one (square) cell, in pixels. */
  cellSize: number;
  /** Total canvas width in pixels (cols * cellSize). */
  width: number;
  /** Total canvas height in pixels (rows * cellSize + headroom). */
  height: number;
  /** Piece radius in pixels, leaving a small gap between neighboring pieces. */
  pieceRadius: number;
  /**
   * Height in px of the empty band ABOVE the board face. 0 by default; the
   * renderer requests it when the drop-hand flourish is enabled so the
   * hand + held chip animate inside the canvas instead of being clipped
   * off its top edge (they play at `dropStartY`, which sits in this band).
   */
  headroom: number;
}

/**
 * Fits the largest square-celled `cols` x `rows` grid (plus an optional
 * `headroomCells`-tall band above the board face) inside `maxWidth` x
 * `maxHeight`, floored to whole pixels so cell borders stay crisp.
 */
export function computeGeometry(
  cols: number,
  rows: number,
  maxWidth: number,
  maxHeight: number,
  headroomCells = 0,
): BoardGeometry {
  const cellSize = Math.max(1, Math.floor(Math.min(maxWidth / cols, maxHeight / (rows + headroomCells))));
  const headroom = Math.round(cellSize * headroomCells);
  return {
    cols,
    rows,
    cellSize,
    width: cellSize * cols,
    height: cellSize * rows + headroom,
    pieceRadius: cellSize * 0.42,
    headroom,
  };
}

/**
 * Pixel center of cell (col, row) within a canvas of the given geometry.
 * Board rows are numbered bottom-up (row 0 = bottom, per DESIGN.md /
 * @acm-uga/c4-engine), but canvas y grows downward, so row is flipped here --
 * this is the one place that translation happens.
 */
export function cellCenter(col: number, row: number, geometry: BoardGeometry): { x: number; y: number } {
  const x = col * geometry.cellSize + geometry.cellSize / 2;
  const y = geometry.headroom + (geometry.rows - 1 - row) * geometry.cellSize + geometry.cellSize / 2;
  return { x, y };
}

/**
 * The y coordinate a piece falling into `col` starts its drop from: just
 * above the board face. With zero headroom that's off-canvas (clipped, as
 * before); with headroom it sits inside the visible band so the drop-hand
 * flourish and the falling piece's entry are actually visible.
 */
export function dropStartY(geometry: BoardGeometry): number {
  return geometry.headroom - geometry.cellSize / 2;
}
