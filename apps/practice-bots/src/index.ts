// Cloudflare Worker serving practice bots (random, greedy, minimax).
// Bot logic exported as pure functions for import by other tools.

import {
  type Board,
  type Player,
  legalMoves,
  applyMove,
  checkWin,
} from '@acm-uga/c4-engine';

/**
 * Random bot: picks a legal move uniformly at random.
 */
export function randomBot(board: Board, _you: Player): number {
  const legal = legalMoves(board);
  return legal[Math.floor(Math.random() * legal.length)];
}

/**
 * Greedy bot: wins immediately if possible, blocks opponent win if forced to,
 * otherwise picks randomly.
 */
export function greedyBot(board: Board, you: Player): number {
  const opponent: Player = you === 1 ? 2 : 1;
  const legal = legalMoves(board);

  // Check if we can win immediately
  for (const col of legal) {
    const nextBoard = applyMove(board, col, you);
    if (checkWin(nextBoard)?.player === you) {
      return col;
    }
  }

  // Check if we need to block opponent's win
  for (const col of legal) {
    const nextBoard = applyMove(board, col, opponent);
    if (checkWin(nextBoard)?.player === opponent) {
      return col;
    }
  }

  // Otherwise, pick randomly
  return legal[Math.floor(Math.random() * legal.length)];
}

/**
 * Simple minimax with depth ~4.
 *
 * The heuristic scores a position:
 * - Win: +1000
 * - Loss: -1000
 * - Draw: 0
 * - For non-terminal positions: count potential threats/opportunities
 *
 * We use alpha-beta pruning to manage the branching factor.
 */
export function minimaxBot(board: Board, you: Player): number {
  const depth = 4;
  const legal = legalMoves(board);

  // If only one move, pick it
  if (legal.length === 1) {
    return legal[0];
  }

  let bestCol = legal[0];
  let bestScore = -Infinity;

  for (const col of legal) {
    const nextBoard = applyMove(board, col, you);
    const score = minimax(nextBoard, depth - 1, false, you, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }

  return bestCol;
}

/**
 * Minimax with alpha-beta pruning.
 * Returns a heuristic score, higher is better for `you`.
 */
function minimax(
  board: Board,
  depth: number,
  isMaximizing: boolean,
  you: Player,
  alpha: number,
  beta: number,
): number {
  // Terminal conditions
  const win = checkWin(board);
  if (win) {
    return win.player === you ? 1000 : -1000;
  }

  const legal = legalMoves(board);
  if (legal.length === 0) {
    // Draw (board full, no winner)
    return 0;
  }

  if (depth === 0) {
    // Evaluate heuristically
    return evaluateBoard(board, you);
  }

  const opponent: Player = you === 1 ? 2 : 1;
  const mover = isMaximizing ? you : opponent;

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const col of legal) {
      const nextBoard = applyMove(board, col, mover);
      const score = minimax(nextBoard, depth - 1, false, you, alpha, beta);
      maxScore = Math.max(maxScore, score);
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break; // Prune
    }
    return maxScore;
  } else {
    let minScore = Infinity;
    for (const col of legal) {
      const nextBoard = applyMove(board, col, mover);
      const score = minimax(nextBoard, depth - 1, true, you, alpha, beta);
      minScore = Math.min(minScore, score);
      beta = Math.min(beta, score);
      if (beta <= alpha) break; // Prune
    }
    return minScore;
  }
}

/**
 * Heuristic board evaluation: count four-in-a-row opportunities.
 * Higher score is better for `you`.
 */
function evaluateBoard(board: Board, you: Player): number {
  const opponent: Player = you === 1 ? 2 : 1;
  const yourScore = countThreats(board, you);
  const oppScore = countThreats(board, opponent);
  return yourScore - oppScore;
}

/**
 * Count "three in a row" opportunities (one empty cell in a potential four).
 * Used as a heuristic for position evaluation.
 */
function countThreats(board: Board, player: Player): number {
  let count = 0;
  const width = board.length;
  const height = board[0].length;

  // Directions: horizontal, vertical, diagonal /, diagonal \
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      for (const [dc, dr] of directions) {
        // Check 4 consecutive cells in this direction
        let playerCount = 0;
        let emptyCount = 0;
        for (let i = 0; i < 4; i++) {
          const c = col + dc * i;
          const r = row + dr * i;
          if (c < 0 || c >= width || r < 0 || r >= height) {
            playerCount = -1; // Out of bounds, invalidate
            break;
          }
          const cell = board[c][r];
          if (cell === player) playerCount++;
          else if (cell === 0) emptyCount++;
          else {
            playerCount = -1; // Blocked by opponent
            break;
          }
        }
        // Count 3-in-a-row with 1 empty
        if (playerCount === 3 && emptyCount === 1) {
          count++;
        }
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Cloudflare Worker HTTP Handler
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

interface MoveRequest {
  you: 1 | 2;
  board: (0 | 1 | 2)[][];
  moves: number[];
  game: {
    match_id: string;
    game_number: number;
    clock_remaining_ms: number;
  };
}

interface MoveResponse {
  column: number;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    // Health check
    if (pathname === '/health') {
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    // Move endpoints
    if (request.method === 'POST') {
      if (pathname === '/random/move') {
        return handleMove(request, randomBot);
      }
      if (pathname === '/greedy/move') {
        return handleMove(request, greedyBot);
      }
      if (pathname === '/minimax/move') {
        return handleMove(request, minimaxBot);
      }
    }

    // 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  },
};

/**
 * Handle a move request by calling the bot logic function.
 */
async function handleMove(
  request: Request,
  botFn: (board: Board, you: Player) => number,
): Promise<Response> {
  try {
    const body = (await request.json()) as MoveRequest;

    // Validate request shape (basic)
    if (!body.you || !body.board || !Array.isArray(body.moves)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      });
    }

    // Call the bot
    const column = botFn(body.board as Board, body.you as Player);

    const response: MoveResponse = { column };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  }
}
