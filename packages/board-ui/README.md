# @acm-uga/c4-board-ui

Framework-free, canvas-based Connect Four board renderer. No DOM framework,
no dependency beyond `@acm-uga/c4-engine` (for the `Board`/`Cell`/`Player`
types). Owned by `presenter`; also consumed by `testground`.

## Install / import

Within this monorepo:

```ts
import { BoardRenderer } from '@acm-uga/c4-board-ui';
```

## Quick start

```ts
import { BoardRenderer } from '@acm-uga/c4-board-ui';
import { emptyBoard, applyMove, checkWin } from '@acm-uga/c4-engine';

const container = document.getElementById('board')!; // any sized block element
const renderer = new BoardRenderer(container);

let board = emptyBoard();

// Instant render (no animation) -- good for initial setup or scrubbing to
// an arbitrary point in a replay.
renderer.setBoard(board);

// Animate a piece falling into column 3 for player 1. The caller (not the
// renderer) is responsible for game rules: compute the landing row with
// @acm-uga/c4-engine, apply it to your own board state, then tell the
// renderer to animate it.
const nextBoard = applyMove(board, 3, 1);
const landingRow = nextBoard[3].findIndex((cell, row) => cell !== board[3][row]);
await renderer.dropPiece(3, landingRow, 1);
board = nextBoard;

const win = checkWin(board);
if (win) renderer.highlightWin(win.line);
```

## API

### `new BoardRenderer(container: HTMLElement, options?: BoardRendererOptions)`

Creates a `<canvas>`, appends it to `container`, and sizes it to fit.

`BoardRendererOptions`:

| field | default | meaning |
|---|---|---|
| `cols` | `8` | board width, in columns |
| `rows` | `8` | board height, in rows |
| `theme` | `DEFAULT_THEME` | partial override of colors (dark/projector theme by default) |
| `dropDurationMs` | `450` | how long a `dropPiece` animation takes |
| `dropHand` | `false` | play a small pixel-art hand flourish before each `dropPiece()` fall: a sideways-pointing hand enters horizontally from the board's edge at drop height carrying the chip, stops above the target column, holds/releases, then retreats back off the same edge (~350-450ms total). Off by default (testground); presenter turns it on. See SHOW_PLAN §9c item 6. |
| `resolutionScale` | `1` | scales the canvas's backing-store resolution beyond `devicePixelRatio` -- e.g. so a Pixi stage blitting this renderer's canvas as a texture (SHOW_PLAN §9b) can match its own physical resolution. CSS size is unaffected, only pixel density; sprites are regenerated at the effective scale so everything stays crisp nearest-neighbor. Effective scale is `devicePixelRatio * resolutionScale`, clamped to a total of 4 to protect fill rate. |

### `renderer.setBoard(board: Board): void`

Replaces the whole board instantly, no animation. Cancels any in-flight
drops. Use for initial render, jumping between games, or scrubbing a replay.

### `renderer.dropPiece(col: number, row: number, player: Player, opts?: DropPieceOptions): Promise<void>`

Animates `player`'s piece falling from above the board into `(col, row)`,
with a small bounce settle. `row` is the **landing row** — the renderer does
not compute gravity or validate legality; callers own game rules (typically
via `@acm-uga/c4-engine`'s `applyMove`). Resolves once the piece has visually
settled and the renderer's internal board state has been updated to match.

`opts` is optional and additive (existing 3-argument call sites are
unaffected). `DropPieceOptions`:

| field | default | meaning |
|---|---|---|
| `handSide` | `'left'` | when `dropHand` is enabled, which edge of the board the hand flourish enters from / retreats to (`'left'` \| `'right'`). Mirror per seat, e.g. the player on the right side of the table gets `handSide: 'right'`. Ignored when `dropHand` is off. |

### `renderer.highlightWin(line: Coord[]): void` / `renderer.clearHighlight(): void`

Dims every settled chip that is **not** part of the four `line` cells
(multiplied toward black to ~35% brightness); the winning four stay
full-strength. No ring, no glow -- this is a single static redraw of the
static layer, so it schedules no timers of its own. `clearHighlight()`
restores full brightness. `Coord` is `{ col: number; row: number }`, the
same shape `@acm-uga/c4-engine`'s `checkWin().line` returns. `setBoard()` and
`destroy()` also clear the highlight.

### `renderer.clearBoard(): Promise<void>`

Animates every settled piece falling out the bottom of the board, with a
per-column stagger so columns release in a quick left-to-right ripple.
Resolves once the board is empty and redrawn. Rides the same rAF + fallback
timer loop as `dropPiece`, so it still completes in hidden/background tabs.
`setBoard()` and `destroy()` cancel the fall-out animation, but the promise
still resolves either way -- safe to `await` from a game loop.

### `renderer.resize(): void`

Recomputes layout to fit the container's current bounding box and redraws.
Call this after the container's size changes (e.g. on a window `resize`
event or a CSS layout change) — the renderer does not observe this itself,
to avoid silently attaching a `ResizeObserver` a consumer didn't ask for.

### `renderer.destroy(): void`

Stops any running animation and removes the canvas from the DOM. Call when
unmounting.

### Theming

```ts
import { DEFAULT_THEME, type BoardTheme } from '@acm-uga/c4-board-ui';

const renderer = new BoardRenderer(container, {
  theme: { player1: '#00ff88' }, // override just what you need
});
```

`BoardTheme` fields: `background`, `boardFill`, `emptyCell`, `player1`,
`player2`, `winHighlight`, `holeStroke`. Defaults are a dark, high-contrast
palette meant to read from the back of a room on a projector.

### Pure helpers (also exported, useful for tests or custom layouts)

- `computeGeometry(cols, rows, maxWidth, maxHeight): BoardGeometry` — fits a
  square-celled grid into a box.
- `cellCenter(col, row, geometry): { x, y }` — pixel center of a cell. Note
  `row` is bottom-up per DESIGN.md/`@acm-uga/c4-engine` convention; this
  function does the row-flip to canvas y for you.
- `dropEasing(t: number): number` — the 0..1 animation curve `dropPiece`
  uses internally (accelerating fall, then a decaying bounce settle).
- `parseHex`, `toHex`, `lighten`, `darken`, `alpha` (from `color.ts`) — small
  hex-color math the sprite pipeline uses to derive chip ring/groove/face/
  highlight shades, the board edge stroke, and the win-dim brightness, from
  the theme's flat colors, without requiring any new `BoardTheme` fields.
- `pixels.ts` (internal, not re-exported except `HandSide` -- exercised
  directly by its own test file) — the pixel-art *data*: `chipGrid()`/
  `chipRingFaceGrid()`, `emptyHoleGrid()`, `handGrid()` (the vertical hand,
  kept for its pixel-art data even though the renderer now uses the
  sideways variant), `handSideGrid(side)` (the sideways drop-hand sprite
  data, SHOW_PLAN §9c item 6 -- derived from `handGrid()` via the generic,
  tested `rotateGrid90CW`/`mirrorGridHorizontal` helpers), plus the
  color-mapping helpers (`chipShadeColors`, `dimShadeColors`,
  `emptyHoleShadeColors`) that turn a shade index into an actual hex color
  for a given theme. This is where the chip/hand *design* lives, kept as
  plain data so it's unit-testable (symmetry, ring presence, silhouette
  bounds, sideways orientation/mirroring) independent of canvas.

## Rendering pipeline (performance)

Chips are drawn pixel-art style (SHOW_PLAN.md §2b), not shaded spheres — no
`createRadialGradient` or `shadowBlur` runs on any per-frame path. Instead:

- **Static layer**: the board face, every settled chip, and every empty hole
  are painted once to an offscreen canvas whenever that state actually
  changes (`setBoard`, a piece landing, a piece clearing out, `resize`, or a
  highlight toggling) — never on every animation frame.
- **Sprites**: each chip variant (per player: settled, dimmed-for-highlight,
  and falling-with-a-baked-shadow) plus the empty hole and the drop-hand
  sprite are pre-rendered from `pixels.ts`'s pixel grids to small offscreen
  canvases sized to the current `cellSize * devicePixelRatio`, with
  `imageSmoothingEnabled = false` for crisp nearest-neighbor scaling. They're
  regenerated only on `resize()` (cell size / dpr changed).
- **Per animation frame**: one `drawImage` blit of the static layer, then a
  `drawImage` per dynamic piece (falling, clearing-out, or the drop-hand
  flourish) — no gradient allocation, no shadow blur, regardless of how many
  chips are on the board.

## What this package does NOT do

- No game rules (legality, win detection, turn order) — that's
  `@acm-uga/c4-engine`.
- No game-record parsing or replay pacing — that's `presenter`.
- No network calls.

## Testing

Only DOM-free pure logic (`geometry.ts`, `easing.ts`, `color.ts`,
`pixels.ts`) has unit tests, per this repo's ground rules — canvas/DOM
rendering (`renderer.ts`, `sprites.ts`) is excluded from automated tests
(aside from the promise/timer-lifecycle regression tests in
`renderer.fallback.test.ts` / `renderer.clearBoard.test.ts`, which stub the
canvas entirely) and should be checked visually via a consuming app
(`presenter`, `testground`).
