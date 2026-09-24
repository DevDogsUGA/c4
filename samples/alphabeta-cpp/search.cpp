// Alpha-beta (fixed depth 7) with center-first move ordering. Kept out of
// bot.cpp so bot.cpp stays a thin wrapper. Depth is fixed (not
// clock-driven) and tuned to stay comfortably under the 5s/game budget: a
// released C++ build easily manages depth 7 on an 8x8 board within tens of
// milliseconds per move.
#include "search.hpp"

#include <algorithm>
#include <limits>

namespace {

constexpr int DEPTH = 7;
constexpr int WIDTH = 8;
constexpr int HEIGHT = 8;
constexpr int DIRS[4][2] = { { 1, 0 }, { 0, 1 }, { 1, 1 }, { 1, -1 } };

std::vector<int> legalMoves(const std::vector<std::vector<int>>& board) {
  std::vector<int> moves;
  for (int col = 0; col < WIDTH; col++) {
    if (board[col].back() == 0) moves.push_back(col);
  }
  return moves;
}

std::vector<std::vector<int>> drop(const std::vector<std::vector<int>>& board, int col, int piece) {
  auto next = board;
  for (auto& cell : next[col]) {
    if (cell == 0) {
      cell = piece;
      break;
    }
  }
  return next;
}

int countDir(const std::vector<std::vector<int>>& board, int col, int row, int dc, int dr, int piece) {
  int count = 0;
  while (col >= 0 && col < WIDTH && row >= 0 && row < HEIGHT && board[col][row] == piece) {
    count++;
    col += dc;
    row += dr;
  }
  return count;
}

bool wins(const std::vector<std::vector<int>>& board, int piece) {
  for (int col = 0; col < WIDTH; col++) {
    for (int row = 0; row < HEIGHT; row++) {
      if (board[col][row] != piece) continue;
      for (auto& d : DIRS) {
        if (countDir(board, col, row, d[0], d[1], piece) >= 4) return true;
      }
    }
  }
  return false;
}

long heuristic(const std::vector<std::vector<int>>& board, int me, int opp) {
  long score = 0;
  double center = (WIDTH - 1) / 2.0;
  for (int col = 0; col < WIDTH; col++) {
    for (int row = 0; row < HEIGHT; row++) {
      int cell = board[col][row];
      if (cell == 0) continue;
      int sign = cell == me ? 1 : -1;
      score += sign * static_cast<long>(4 - std::abs(col - center));
      for (auto& d : DIRS) {
        int run = countDir(board, col, row, d[0], d[1], cell);
        if (run >= 2) score += sign * static_cast<long>(run) * run;
      }
    }
  }
  return score;
}

std::vector<int> orderedMoves(const std::vector<std::vector<int>>& board) {
  auto moves = legalMoves(board);
  double center = (WIDTH - 1) / 2.0;
  std::sort(moves.begin(), moves.end(), [&](int a, int b) { return std::abs(a - center) < std::abs(b - center); });
  return moves;
}

long alphabeta(const std::vector<std::vector<int>>& board, int depth, bool maximizing, int me, int opp, long alpha, long beta) {
  if (wins(board, me)) return 1'000'000L - depth;
  if (wins(board, opp)) return -1'000'000L + depth;
  auto moves = orderedMoves(board);
  if (moves.empty() || depth == 0) return heuristic(board, me, opp);

  if (maximizing) {
    long best = std::numeric_limits<long>::min();
    for (int col : moves) {
      long value = alphabeta(drop(board, col, me), depth - 1, false, me, opp, alpha, beta);
      best = std::max(best, value);
      alpha = std::max(alpha, value);
      if (alpha >= beta) break;
    }
    return best;
  } else {
    long best = std::numeric_limits<long>::max();
    for (int col : moves) {
      long value = alphabeta(drop(board, col, opp), depth - 1, true, me, opp, alpha, beta);
      best = std::min(best, value);
      beta = std::min(beta, value);
      if (alpha >= beta) break;
    }
    return best;
  }
}

}  // namespace

int alphabeta_move(const std::vector<std::vector<int>>& board, int you) {
  int opp = you == 1 ? 2 : 1;
  auto moves = orderedMoves(board);
  int bestCol = moves[0];
  long bestScore = std::numeric_limits<long>::min();
  for (int col : moves) {
    long score = alphabeta(drop(board, col, you), DEPTH - 1, false, you, opp, std::numeric_limits<long>::min(), std::numeric_limits<long>::max());
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
}
