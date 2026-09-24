// Framework-free canvas board renderer. DOM-dependent, so excluded from
// unit tests per the repo's ground rules (see geometry.ts / easing.ts /
// color.ts / pixels.ts for the pure logic this builds on, which *is*
// tested).
//
// Rendering pipeline (SHOW_PLAN.md §2a): an offscreen "static layer" holds
// the board face, every settled chip, and every empty hole; it is redrawn
// only when that state actually changes (setBoard, a piece landing, a piece
// clearing out, resize, or a highlight toggling). Every animation frame
// blits that layer once (`drawImage`) and then draws only the handful of
// dynamic pieces (falling/clearing chips, the drop-hand flourish) via
// pre-rendered pixel-art sprites (sprites.ts) -- no per-frame gradients or
// shadowBlur anywhere.

import type { Board, Cell, Player } from '@connect-4/engine';
import { type Coord, computeGeometry, cellCenter, dropStartY, type BoardGeometry } from './geometry.js';
import { dropEasing, easeInCubic } from './easing.js';
import { type BoardTheme, resolveTheme } from './theme.js';
import { lighten } from './color.js';
import { buildSpriteSet, type SpriteSet } from './sprites.js';
import type { HandSide } from './pixels.js';

export type { Coord, HandSide };

export interface BoardRendererOptions {
  /** Number of columns. Defaults to 8 (the DESIGN.md board size). */
  cols?: number;
  /** Number of rows. Defaults to 8. */
  rows?: number;
  /** Theme color overrides; unset fields fall back to DEFAULT_THEME. */
  theme?: Partial<BoardTheme>;
  /** Milliseconds a piece takes to fall + settle. Defaults to 450. */
  dropDurationMs?: number;
  /**
   * When true, `dropPiece()` plays a small pixel-art "hand" flourish before
   * the normal fall animation runs: a sideways-pointing hand enters
   * horizontally from the board's edge at drop height carrying the chip,
   * stops above the target column, holds/releases, then retreats back off
   * the same edge (~350-450ms total). Defaults to false (presenter turns it
   * on; testground leaves it off for instant drops). See SHOW_PLAN.md
   * §2e/§9c item 6. Which edge it enters from is chosen per-call via
   * `dropPiece(..., { handSide })`, defaulting to `'left'`.
   */
  dropHand?: boolean;
  /**
   * Scales the canvas's backing store resolution beyond
   * `devicePixelRatio`, e.g. so a Pixi stage blitting this renderer's
   * canvas as a texture (SHOW_PLAN.md §9b) can match its own physical
   * resolution. CSS size is unaffected -- only pixel density changes.
   * Effective scale is `devicePixelRatio * resolutionScale`, clamped to
   * `MAX_TOTAL_SCALE` (4) to protect fill rate. Defaults to 1.
   */
  resolutionScale?: number;
}

/** Additive per-call options for `dropPiece()`. See `BoardRendererOptions.dropHand`. */
export interface DropPieceOptions {
  /** Which edge of the board the drop-hand flourish enters from / retreats to. Defaults to `'left'`. */
  handSide?: HandSide;
}

/** Hard ceiling on `devicePixelRatio * resolutionScale` (see `BoardRendererOptions.resolutionScale`). */
const MAX_TOTAL_SCALE = 4;

/** Shading derived once per theme; only the board-slab edge needs deriving now (chip/hole shading lives in pixels.ts/sprites.ts). */
interface DerivedTheme {
  boardEdge: string;
}

function deriveTheme(theme: BoardTheme): DerivedTheme {
  return {
    boardEdge: lighten(theme.boardFill, 0.18),
  };
}

/** Per-column delay before a settled piece starts falling out in clearBoard(). */
const CLEAR_STAGGER_MS = 60;
/** Total duration of the drop-hand flourish (slide in, hold/release, retreat). */
const HAND_DURATION_MS = 350;
/** Fraction of HAND_DURATION_MS spent sliding in from the edge. */
const HAND_ENTRY_FRACTION = 0.4;
/** Fraction of HAND_DURATION_MS at which the hold/release phase ends and the retreat begins. */
const HAND_HOLD_END_FRACTION = 0.6;

interface FallingPiece {
  col: number;
  row: number;
  player: Player;
  startedAt: number;
  resolve: () => void;
}

interface ClearingPiece {
  col: number;
  row: number;
  player: Player;
  startAt: number;
}

interface HandFlourish {
  col: number;
  row: number;
  player: Player;
  startedAt: number;
  resolve: () => void;
  handSide: HandSide;
}

/**
 * A framework-free, canvas-based Connect Four board renderer.
 *
 * Usage:
 *   const renderer = new BoardRenderer(containerEl);
 *   renderer.setBoard(board);                    // instant, no animation
 *   await renderer.dropPiece(col, row, player);   // animated drop
 *   renderer.highlightWin(winResult.line);
 *   await renderer.clearBoard();                  // animated reset
 *   renderer.destroy();                           // stop animations, detach canvas
 *
 * The renderer owns a <canvas> it appends to `container` and resizes to
 * fill it (call `resize()` again after the container's size changes, e.g.
 * on a window resize). It keeps no game logic of its own -- callers own the
 * board state and pass it in.
 */
export class BoardRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly container: HTMLElement;
  private readonly cols: number;
  private readonly rows: number;
  private readonly theme: BoardTheme;
  private readonly derived: DerivedTheme;
  private readonly dropDurationMs: number;
  private readonly clearDurationMs: number;
  private readonly dropHandEnabled: boolean;
  private readonly resolutionScale: number;

  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D;
  private sprites!: SpriteSet;

  private geometry: BoardGeometry;
  private board: (Cell | 0)[][];
  private winLine: Coord[] | null = null;

  private falling: FallingPiece[] = [];
  private clearing: ClearingPiece[] = [];
  private clearResolvers: Array<() => void> = [];
  private handFlourish: HandFlourish | null = null;
  private rafHandle: number | null = null;
  private fallbackHandle: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(container: HTMLElement, options: BoardRendererOptions = {}) {
    this.container = container;
    this.cols = options.cols ?? 8;
    this.rows = options.rows ?? 8;
    this.theme = resolveTheme(options.theme);
    this.derived = deriveTheme(this.theme);
    this.dropDurationMs = options.dropDurationMs ?? 450;
    this.clearDurationMs = this.dropDurationMs;
    this.dropHandEnabled = options.dropHand ?? false;
    this.resolutionScale = options.resolutionScale ?? 1;

    this.board = emptyGrid(this.cols, this.rows);

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.maxWidth = '100%';
    this.canvas.style.maxHeight = '100%';
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('BoardRenderer: 2D canvas context unavailable');
    this.ctx = ctx;

    // Offscreen static layer: board face + settled chips + empty holes.
    // Redrawn only on state change (see rebuildStaticLayer()); every
    // animation frame blits it with a single drawImage instead of
    // repainting all 64 cells.
    this.staticCanvas = document.createElement('canvas');
    const staticCtx = this.staticCanvas.getContext('2d');
    if (!staticCtx) throw new Error('BoardRenderer: 2D canvas context unavailable (static layer)');
    this.staticCtx = staticCtx;

    this.geometry = computeGeometry(this.cols, this.rows, 1, 1);
    this.resize();
  }

  /**
   * How many cell-heights of empty headroom to reserve above the board
   * face. The drop-hand flourish (and the falling piece's entry) animate
   * at `dropStartY`, which without headroom sits above the canvas and gets
   * clipped invisible -- so enabling the hand implies reserving the band.
   */
  private headroomCells(): number {
    return this.dropHandEnabled ? 1.4 : 0;
  }

  /** Recomputes layout to fit the container's current size and redraws. */
  resize(): void {
    const box = this.container.getBoundingClientRect();
    const maxWidth = Math.max(1, box.width || this.container.clientWidth || 480);
    const maxHeight = Math.max(1, box.height || this.container.clientHeight || 480);
    this.geometry = computeGeometry(this.cols, this.rows, maxWidth, maxHeight, this.headroomCells());

    const dpr = window.devicePixelRatio || 1;
    // Effective backing-store scale (SHOW_PLAN §9b): devicePixelRatio times
    // the caller's resolutionScale, clamped so a Pixi stage blitting this
    // canvas at high resolutionScale can't blow the fill-rate budget. CSS
    // size (below) is unaffected -- only pixel density changes.
    const scale = Math.min(dpr * this.resolutionScale, MAX_TOTAL_SCALE);

    this.canvas.width = this.geometry.width * scale;
    this.canvas.height = this.geometry.height * scale;
    this.canvas.style.width = `${this.geometry.width}px`;
    this.canvas.style.height = `${this.geometry.height}px`;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);

    this.staticCanvas.width = this.geometry.width * scale;
    this.staticCanvas.height = this.geometry.height * scale;
    this.staticCtx.setTransform(scale, 0, 0, scale, 0, 0);

    // Sprites are pre-rendered at the current cellSize*scale with
    // imageSmoothingEnabled=false; regenerate them whenever that changes.
    this.sprites = buildSpriteSet(this.theme, this.geometry.pieceRadius * 2, scale);

    this.rebuildStaticLayer();
    this.draw();
  }

  /**
   * Replaces the whole board instantly (no drop animation). Useful for
   * initial setup, scrubbing to an arbitrary point in a replay, or jumping
   * between games. Cancels any in-flight drop animations, any in-flight
   * `clearBoard()` (its promise still resolves), and any active highlight.
   */
  setBoard(board: Board): void {
    this.board = board.map((column) => column.slice());
    this.falling = [];
    this.handFlourish = null;
    this.winLine = null;
    this.clearScheduled();
    this.resolveClear();
    this.rebuildStaticLayer();
    this.draw();
  }

  /** Restores every chip to full brightness, removing the win highlight, if any. */
  clearHighlight(): void {
    this.winLine = null;
    this.rebuildStaticLayer();
    this.draw();
  }

  /**
   * Dims every settled chip that is NOT part of `line` (multiplied toward
   * black to ~35% brightness); the four winning chips stay full-strength.
   * Purely static -- redraws the static layer once and schedules nothing.
   */
  highlightWin(line: Coord[]): void {
    this.winLine = line;
    this.rebuildStaticLayer();
    this.draw();
  }

  /**
   * Animates `player`'s piece falling into (col, row) from above the board,
   * then settles the internal board state to match. `row` is the resting
   * row the piece will land on (callers compute this from game rules, e.g.
   * @connect-4/engine's applyMove); the renderer does not validate legality.
   * Resolves once the drop animation completes.
   *
   * When `dropHand` is enabled (BoardRendererOptions), a small pixel-art
   * hand flourish plays first -- entering horizontally from the board's
   * edge at drop height carrying the chip, stopping above the target
   * column, holding/releasing, then retreating back off the same edge
   * (~350-450ms) -- before the fall starts; the returned promise still
   * resolves once the piece has settled, same as when the flourish is
   * disabled. `opts.handSide` picks which edge it enters from/retreats to
   * (defaults to `'left'`); additive and optional, existing call sites are
   * unaffected.
   */
  dropPiece(col: number, row: number, player: Player, opts?: DropPieceOptions): Promise<void> {
    return new Promise((resolve) => {
      if (this.dropHandEnabled) {
        const handSide = opts?.handSide ?? 'left';
        this.handFlourish = { col, row, player, startedAt: performance.now(), resolve, handSide };
      } else {
        this.falling.push({ col, row, player, startedAt: performance.now(), resolve });
      }
      this.ensureAnimating();
    });
  }

  /**
   * Animates every settled piece falling out the bottom of the board (a
   * gravity-style release, with a per-column stagger so columns let go in a
   * quick left-to-right ripple). Resolves once the board is empty and
   * redrawn. Rides the same rAF + fallback-timer loop as `dropPiece`, so it
   * still completes in hidden/background tabs. `setBoard()` and `destroy()`
   * cancel the animation but the returned promise still resolves -- callers
   * `await` this in game loops, and a promise that never resolves would hang
   * them.
   */
  clearBoard(): Promise<void> {
    return new Promise((resolve) => {
      if (this.destroyed) {
        resolve();
        return;
      }

      // Emptying the board also retires the previous game's win highlight --
      // otherwise dimmed/bright chips would carry over into the next game.
      this.winLine = null;

      const pieces: ClearingPiece[] = [];
      const now = performance.now();
      for (let col = 0; col < this.cols; col++) {
        for (let row = 0; row < this.rows; row++) {
          const cell = this.board[col][row];
          if (cell === 1 || cell === 2) {
            pieces.push({ col, row, player: cell, startAt: now + col * CLEAR_STAGGER_MS });
          }
        }
      }

      if (pieces.length === 0) {
        this.board = emptyGrid(this.cols, this.rows);
        this.rebuildStaticLayer();
        this.draw();
        resolve();
        return;
      }

      this.clearing.push(...pieces);
      this.clearResolvers.push(resolve);
      // Cleared cells must read as empty holes immediately -- the pieces
      // themselves are now painted dynamically (see draw()) sliding out.
      this.rebuildStaticLayer();
      this.ensureAnimating();
    });
  }

  /** Stops animation and detaches the canvas from the DOM. Pending `clearBoard()` promises still resolve. */
  destroy(): void {
    this.destroyed = true;
    this.clearScheduled();
    this.resolveClear();
    this.handFlourish = null;
    this.canvas.remove();
  }

  private resolveClear(): void {
    this.clearing = [];
    const resolvers = this.clearResolvers;
    this.clearResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  private clearScheduled(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.fallbackHandle !== null) {
      clearTimeout(this.fallbackHandle);
      this.fallbackHandle = null;
    }
  }

  private isAnimating(): boolean {
    return this.falling.length > 0 || this.clearing.length > 0 || this.handFlourish !== null;
  }

  private ensureAnimating(): void {
    if (this.rafHandle !== null || this.fallbackHandle !== null || this.destroyed) return;
    const step = (now: number) => {
      this.clearScheduled();
      this.tick(now);
      if (this.isAnimating() && !this.destroyed) schedule();
    };
    const schedule = () => {
      this.rafHandle = requestAnimationFrame(step);
      // rAF is suspended in hidden/background tabs. Without a fallback,
      // dropPiece()/clearBoard() promises would never resolve there --
      // hanging the testground's game loop and the presenter's replays (and
      // letting wall-clock forfeit timers drain). The coarse timer keeps
      // animation time advancing (tick() works off timestamps); rAF, when it
      // runs, wins the race and keeps things smooth.
      this.fallbackHandle = setTimeout(() => step(performance.now()), 250);
    };
    schedule();
  }

  private tick(now: number): void {
    let staticDirty = false;

    if (this.handFlourish && now - this.handFlourish.startedAt >= HAND_DURATION_MS) {
      const { col, row, player, resolve } = this.handFlourish;
      this.handFlourish = null;
      this.falling.push({ col, row, player, startedAt: now, resolve });
    }

    const finished: FallingPiece[] = [];
    this.falling = this.falling.filter((f) => {
      const t = (now - f.startedAt) / this.dropDurationMs;
      if (t >= 1) {
        finished.push(f);
        return false;
      }
      return true;
    });

    for (const f of finished) {
      this.board[f.col][f.row] = f.player;
      staticDirty = true;
      f.resolve();
    }

    if (this.clearing.length > 0) {
      const before = this.clearing.length;
      this.clearing = this.clearing.filter((c) => {
        const t = (now - c.startAt) / this.clearDurationMs;
        if (t >= 1) {
          this.board[c.col][c.row] = 0;
          return false;
        }
        return true;
      });
      if (this.clearing.length !== before) staticDirty = true;
      if (this.clearing.length === 0) {
        this.resolveClear();
      }
    }

    if (staticDirty) this.rebuildStaticLayer();

    this.draw();
  }

  /**
   * Rebuilds the offscreen static layer: board face + every settled chip
   * (dimmed if a highlight is active and it's not part of the winning line)
   * + every empty hole. Cells currently mid-`clearBoard()` render as empty
   * holes here -- the actual piece is painted dynamically in draw() as it
   * slides out. Called only on state change, never per animation frame.
   */
  private rebuildStaticLayer(): void {
    const ctx = this.staticCtx;
    const { width, height } = this.geometry;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);
    this.drawBoardFace(ctx);

    const hiddenCells = new Set<string>();
    for (const c of this.clearing) hiddenCells.add(`${c.col},${c.row}`);

    const winSet = this.winLine ? new Set(this.winLine.map((c) => `${c.col},${c.row}`)) : null;

    for (let col = 0; col < this.cols; col++) {
      for (let row = 0; row < this.rows; row++) {
        const key = `${col},${row}`;
        if (hiddenCells.has(key)) {
          this.drawHoleSprite(ctx, col, row);
          continue;
        }
        const cell = this.board[col][row];
        if (cell === 1 || cell === 2) {
          const dim = winSet !== null && !winSet.has(key);
          this.drawChipSprite(ctx, col, row, cell, dim);
        } else {
          this.drawHoleSprite(ctx, col, row);
        }
      }
    }
  }

  /** One frame: blit the static layer, then paint only dynamic (falling/clearing/hand) pieces. */
  private draw(): void {
    const ctx = this.ctx;
    const { geometry } = this;
    ctx.clearRect(0, 0, geometry.width, geometry.height);
    ctx.drawImage(this.staticCanvas, 0, 0, geometry.width, geometry.height);

    const now = performance.now();

    for (const c of this.clearing) {
      const t = Math.min(Math.max((now - c.startAt) / this.clearDurationMs, 0), 1);
      const eased = easeInCubic(t);
      const rest = cellCenter(c.col, c.row, geometry);
      const exitY = geometry.height + geometry.cellSize;
      const y = rest.y + (exitY - rest.y) * eased;
      this.drawSprite(ctx, this.sprites.falling[c.player], rest.x, y);
    }

    for (const f of this.falling) {
      const t = (now - f.startedAt) / this.dropDurationMs;
      const progress = dropEasing(t);
      const target = cellCenter(f.col, f.row, geometry);
      const startY = dropStartY(geometry);
      const y = startY + (target.y - startY) * progress;
      this.drawSprite(ctx, this.sprites.falling[f.player], target.x, y);
    }

    if (this.handFlourish) this.drawHandFlourish(now);
  }

  private drawBoardFace(ctx: CanvasRenderingContext2D): void {
    // The face occupies the canvas BELOW the headroom band (the band is
    // where the drop-hand flourish and falling-piece entries animate).
    const { width, height, headroom } = this.geometry;
    const faceHeight = height - headroom;
    const radius = Math.min(width, faceHeight) * 0.03;
    ctx.save();
    this.roundedRectPath(ctx, 0, headroom, width, faceHeight, radius);
    ctx.fillStyle = this.theme.boardFill;
    ctx.fill();
    ctx.strokeStyle = this.derived.boardEdge;
    ctx.lineWidth = Math.max(1, Math.min(width, faceHeight) * 0.004);
    ctx.stroke();
    ctx.restore();
  }

  private roundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  private drawChipSprite(ctx: CanvasRenderingContext2D, col: number, row: number, player: Player, dim: boolean): void {
    const sprite = dim ? this.sprites.faceDim[player] : this.sprites.face[player];
    const { x, y } = cellCenter(col, row, this.geometry);
    ctx.drawImage(sprite.canvas, x - sprite.width / 2, y - sprite.height / 2, sprite.width, sprite.height);
  }

  private drawHoleSprite(ctx: CanvasRenderingContext2D, col: number, row: number): void {
    const sprite = this.sprites.hole;
    const { x, y } = cellCenter(col, row, this.geometry);
    ctx.drawImage(sprite.canvas, x - sprite.width / 2, y - sprite.height / 2, sprite.width, sprite.height);
  }

  private drawSprite(
    ctx: CanvasRenderingContext2D,
    sprite: { canvas: HTMLCanvasElement; width: number; height: number },
    x: number,
    y: number,
  ): void {
    ctx.drawImage(sprite.canvas, x - sprite.width / 2, y - sprite.height / 2, sprite.width, sprite.height);
  }

  /**
   * Draws the sideways drop-hand flourish (SHOW_PLAN §9c item 6): a
   * sideways-pointing hand slides in horizontally from the board's edge at
   * drop height, carrying the chip with it, stops above the target column,
   * holds/releases the chip, then retreats back off the same edge. The
   * chip travels with the hand during entry, then stays put from the
   * hold/release phase onward -- the real fall animation only starts once
   * this flourish's promise handoff pushes a FallingPiece (see tick()).
   */
  private drawHandFlourish(now: number): void {
    if (!this.handFlourish) return;
    const { col, row, player, startedAt, handSide } = this.handFlourish;
    const t = Math.min(Math.max((now - startedAt) / HAND_DURATION_MS, 0), 1);
    const { x: targetX } = cellCenter(col, row, this.geometry);
    const chipY = dropStartY(this.geometry);
    const handSprite = this.sprites.handSide[handSide];
    // Fully off-canvas at the entry edge, regardless of the target column.
    const edgeX = handSide === 'left' ? -handSprite.width : this.geometry.width + handSprite.width;

    let chipX: number;
    let handX: number;
    if (t < HAND_ENTRY_FRACTION) {
      chipX = edgeX + (targetX - edgeX) * easeInCubic(t / HAND_ENTRY_FRACTION);
      handX = chipX;
    } else if (t < HAND_HOLD_END_FRACTION) {
      chipX = targetX;
      handX = targetX;
    } else {
      chipX = targetX;
      handX =
        targetX + (edgeX - targetX) * easeInCubic((t - HAND_HOLD_END_FRACTION) / (1 - HAND_HOLD_END_FRACTION));
    }

    const ctx = this.ctx;
    const chipSprite = this.sprites.face[player];
    ctx.drawImage(
      chipSprite.canvas,
      chipX - chipSprite.width / 2,
      chipY - chipSprite.height / 2,
      chipSprite.width,
      chipSprite.height,
    );
    ctx.drawImage(
      handSprite.canvas,
      handX - handSprite.width / 2,
      chipY - handSprite.height / 2,
      handSprite.width,
      handSprite.height,
    );
  }
}

function emptyGrid(cols: number, rows: number): (Cell | 0)[][] {
  return Array.from({ length: cols }, () => Array.from({ length: rows }, () => 0 as Cell));
}
