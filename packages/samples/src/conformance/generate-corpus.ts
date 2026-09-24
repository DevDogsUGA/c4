// Generates packages/samples/src/conformance/corpus.json: ~200 board
// positions (random legal playouts + handcrafted tactics), each annotated
// with the reference implementation's expected column. Deterministic: a
// fixed PRNG seed, so re-running this script reproduces the same corpus.
//
// Run: pnpm -C packages/samples corpus:generate

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chooseMove, COLS, ROWS, legalMoves, type Board, type Player } from './reference.ts';

// --- deterministic PRNG (mulberry32) -----------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;
const rng = mulberry32(SEED);

function randInt(n: number): number {
  return Math.floor(rng() * n);
}

function emptyBoard(): Board {
  return Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => 0));
}

function drop(board: Board, c: number, player: Player): number {
  for (let r = 0; r < ROWS; r++) {
    if (board[c][r] === 0) {
      board[c][r] = player;
      return r;
    }
  }
  throw new Error(`column ${c} is full`);
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function isWin(board: Board, c: number, r: number, player: Player): boolean {
  for (const [dc, dr] of DIRECTIONS) {
    let count = 1;
    let cc = c + dc;
    let rr = r + dr;
    while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && board[cc][rr] === player) {
      count++;
      cc += dc;
      rr += dr;
    }
    cc = c - dc;
    rr = r - dr;
    while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && board[cc][rr] === player) {
      count++;
      cc -= dc;
      rr -= dr;
    }
    if (count >= 4) return true;
  }
  return false;
}

interface CorpusEntry {
  name: string;
  you: Player;
  board: Board;
  moves: number[];
  expected: number;
}

const entries: CorpusEntry[] = [];
const seen = new Set<string>();

function boardKey(board: Board): string {
  return board.map((col) => col.join('')).join('|');
}

function tryAdd(name: string, board: Board, you: Player, moves: number[]) {
  const legal = legalMoves(board);
  if (legal.length === 0) return; // full board, skip
  // Reject already-won boards: check every cell that has a piece for a
  // winning line would be redundant to check per-cell; instead check via
  // recomputing from the move list is complex, so just detect any 4-in-a-row
  // anywhere on the board directly.
  if (boardHasAnyWin(board)) return;
  const key = boardKey(board) + '#' + you;
  if (seen.has(key)) return;
  seen.add(key);
  const expected = chooseMove(board, you);
  entries.push({ name, you, board, moves, expected });
}

function boardHasAnyWin(board: Board): boolean {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const player = board[c][r];
      if (player === 0) continue;
      // Only check "forward" directions from each cell to avoid re-checking;
      // isWin already looks both ways so this still finds every line, just
      // possibly redundantly -- fine for a generator script.
      if (isWin(board, c, r, player as Player)) return true;
    }
  }
  return false;
}

// --- 1. Random legal playouts from the empty board ----------------------
// Varying lengths, including near-full boards and boards with several full
// columns. Either player may have "moved first" (we don't enforce move 0
// belongs to a fixed player -- we just alternate strictly, which is exactly
// "piece counts consistent with alternating play").
const PLAYOUT_COUNT = 150;
let playoutsAdded = 0;
let attempt = 0;
while (playoutsAdded < PLAYOUT_COUNT && attempt < PLAYOUT_COUNT * 20) {
  attempt++;
  const board = emptyBoard();
  const moves: number[] = [];
  // Random target length: bias across the whole range, including deep/near-full.
  const targetLen = 1 + randInt(62); // up to 62 plies (board has 64 cells)
  // Randomly choose which color moves first in this playout.
  const firstPlayer: Player = rng() < 0.5 ? 1 : 2;
  let player = firstPlayer;
  let stoppedEarly = false;
  for (let i = 0; i < targetLen; i++) {
    const legal = legalMoves(board);
    if (legal.length === 0) {
      stoppedEarly = true;
      break;
    }
    const c = legal[randInt(legal.length)];
    const r = drop(board, c, player);
    moves.push(c);
    if (isWin(board, c, r, player)) {
      stoppedEarly = true;
      break;
    }
    player = player === 1 ? 2 : 1;
  }
  if (stoppedEarly) continue; // don't use playouts that ended in a win
  const legalNow = legalMoves(board);
  if (legalNow.length === 0) continue;
  // The player to move next is whoever didn't move last.
  const toMove: Player = player;
  const idx = playoutsAdded;
  tryAdd(`playout-${idx}-len${moves.length}`, board, toMove, moves);
  playoutsAdded++;
}

// --- 2. Handcrafted tactical positions -----------------------------------
function rowsToBoard(rows: string[]): Board {
  const board = emptyBoard();
  for (let i = 0; i < ROWS; i++) {
    const r = ROWS - 1 - i;
    const line = rows[i];
    for (let c = 0; c < COLS; c++) {
      const ch = line[c];
      board[c][r] = ch === '1' ? 1 : ch === '2' ? 2 : 0;
    }
  }
  return board;
}

function movesFromBoard(board: Board): number[] {
  // Not a real move history (order is unrecoverable from a static board);
  // reconstruct *a* valid alternating history by column-major piece order,
  // good enough for the HTTP request's `moves` field, which the reference
  // algorithm never reads.
  const moves: number[] = [];
  const counts = board.map((col) => col.filter((cell) => cell !== 0).length);
  const totalPieces = counts.reduce((a, b) => a + b, 0);
  const remaining = counts.slice();
  for (let i = 0; i < totalPieces; i++) {
    for (let c = 0; c < COLS; c++) {
      if (remaining[c] > 0) {
        moves.push(c);
        remaining[c]--;
        break;
      }
    }
  }
  return moves;
}

const handcrafted: Array<{ name: string; rows: string[]; you: Player }> = [
  {
    name: 'win-in-1-horizontal-left-edge',
    you: 1,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '111.....',
    ],
  },
  {
    name: 'win-in-1-horizontal-right-edge',
    you: 2,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '.....222',
    ],
  },
  {
    name: 'must-block-horizontal',
    you: 1,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '1222....',
    ],
  },
  {
    name: 'win-in-1-vertical',
    you: 1,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '1.......',
      '1.......',
      '1.......',
      '2.......',
    ],
  },
  {
    name: 'win-in-1-diagonal-up-right',
    you: 1,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '...1....',
      '..12....',
      '.122....',
      '2221....',
    ],
  },
  {
    name: 'win-in-1-diagonal-down-right',
    you: 1,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '1.......',
      '21......',
      '221.....',
      '222.....',
    ],
  },
  {
    name: 'must-block-diagonal',
    you: 2,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '........',
      '..12....',
      '.121....',
      '1212....',
    ],
  },
  {
    name: 'win-in-2-setup-horizontal',
    you: 1,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '2.......',
      '2111....',
    ],
  },
  {
    name: 'edge-column-0-win-in-1',
    you: 1,
    rows: [
      '........',
      '........',
      '........',
      '........',
      '1.......',
      '1.......',
      '1.......',
      '1.......'.slice(0, 0) + '2.......'.slice(0), // placeholder, overwritten below
    ],
  },
];

// Fix the last handcrafted entry (edge column 0 vertical win) to a valid
// simple board: three of player 1 stacked in column 0, empty above.
handcrafted[handcrafted.length - 1] = {
  name: 'edge-column-0-vertical-win-in-1',
  you: 1,
  rows: [
    '........',
    '........',
    '........',
    '........',
    '........',
    '1.......',
    '1.......',
    '1.......',
  ],
};

for (const { name, rows, you } of handcrafted) {
  const board = rowsToBoard(rows);
  if (boardHasAnyWin(board)) {
    throw new Error(`handcrafted position "${name}" is already won -- fix the fixture`);
  }
  tryAdd(name, board, you, movesFromBoard(board));
}

// --- 3. A handful of deliberately near-full / edge-heavy random playouts
// to push corpus size toward ~200 while keeping variety. Reuse the same
// random-playout logic with a different length bias (deep games).
let deepAdded = 0;
attempt = 0;
while (deepAdded < 40 && attempt < 40 * 400) {
  attempt++;
  const board = emptyBoard();
  const moves: number[] = [];
  const targetLen = 40 + randInt(23); // deep games, 40..62 plies
  const firstPlayer: Player = rng() < 0.5 ? 1 : 2;
  let player = firstPlayer;
  let stoppedEarly = false;
  for (let i = 0; i < targetLen; i++) {
    const legal = legalMoves(board);
    if (legal.length === 0) {
      stoppedEarly = true;
      break;
    }
    const c = legal[randInt(legal.length)];
    const r = drop(board, c, player);
    moves.push(c);
    if (isWin(board, c, r, player)) {
      stoppedEarly = true;
      break;
    }
    player = player === 1 ? 2 : 1;
  }
  if (stoppedEarly) continue;
  const legalNow = legalMoves(board);
  if (legalNow.length === 0) continue;
  tryAdd(`deep-playout-${deepAdded}-len${moves.length}`, board, player, moves);
  deepAdded++;
}

// --- write out ------------------------------------------------------------
const outPath = fileURLToPath(new URL('./corpus.json', import.meta.url));
writeFileSync(outPath, JSON.stringify(entries, null, 2) + '\n');

console.log(`Wrote ${entries.length} corpus entries to ${outPath}`);
console.log(`  random playouts:      ${playoutsAdded}`);
console.log(`  deep random playouts: ${deepAdded}`);
console.log(`  handcrafted tactics:  ${handcrafted.length}`);
