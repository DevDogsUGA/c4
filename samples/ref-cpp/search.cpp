// Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
// Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness.
#include "search.hpp"

#include <array>
#include <limits>

namespace {

constexpr int COLS = 8;
constexpr int ROWS = 8;
constexpr long long WIN = 1'000'000;

std::vector<int> legal_moves_impl(const std::vector<std::vector<int>>& board) {
  std::vector<int> moves;
  for (int c = 0; c < COLS; c++) {
    if (board[c][ROWS - 1] == 0) {
      moves.push_back(c);
    }
  }
  return moves;
}

int drop_piece(std::vector<std::vector<int>>& board, int c, int player) {
  for (int r = 0; r < ROWS; r++) {
    if (board[c][r] == 0) {
      board[c][r] = player;
      return r;
    }
  }
  return -1;
}

constexpr std::array<std::array<int, 2>, 4> DIRECTIONS = {{{1, 0}, {0, 1}, {1, 1}, {1, -1}}};

bool is_winning_move(const std::vector<std::vector<int>>& board, int c, int r, int player) {
  for (const auto& dir : DIRECTIONS) {
    int dc = dir[0];
    int dr = dir[1];
    int count = 1;
    int cc = c + dc;
    int rr = r + dr;
    while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && board[cc][rr] == player) {
      count++;
      cc += dc;
      rr += dr;
    }
    cc = c - dc;
    rr = r - dr;
    while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && board[cc][rr] == player) {
      count++;
      cc -= dc;
      rr -= dr;
    }
    if (count >= 4) return true;
  }
  return false;
}

int window_score(const std::array<int, 4>& cells, int you, int opponent) {
  int k = 0;
  int m = 0;
  for (int cell : cells) {
    if (cell == you) k++;
    else if (cell == opponent) m++;
  }
  if (m == 0) {
    if (k == 3) return 5;
    if (k == 2) return 2;
    return 0;
  }
  if (k == 0) {
    if (m == 3) return -4;
    if (m == 2) return -1;
    return 0;
  }
  return 0;
}

int negamax(std::vector<std::vector<int>> board, int player, int you, int ply) {
  std::vector<int> moves = legal_moves_impl(board);
  if (moves.empty()) return 0;

  long long best = std::numeric_limits<long long>::min();
  for (int c : moves) {
    std::vector<std::vector<int>> child = board;
    int row = drop_piece(child, c, player);
    long long score;
    if (is_winning_move(child, c, row, player)) {
      score = WIN - ply;
    } else if (legal_moves_impl(child).empty()) {
      score = 0;
    } else if (ply == 4) {
      int raw = search_leaf_eval(child, you);
      score = (player == you) ? raw : -raw;
    } else {
      int opponent = (player == 1) ? 2 : 1;
      score = -negamax(child, opponent, you, ply + 1);
    }
    if (score > best) best = score;
  }
  return static_cast<int>(best);
}

}  // namespace

std::vector<int> search_legal_moves(const std::vector<std::vector<int>>& board) {
  return legal_moves_impl(board);
}

int search_leaf_eval(const std::vector<std::vector<int>>& board, int you) {
  int opponent = (you == 1) ? 2 : 1;
  int score = 0;

  for (int r = 0; r < ROWS; r++) {
    for (int c = 0; c <= COLS - 4; c++) {
      score += window_score({board[c][r], board[c + 1][r], board[c + 2][r], board[c + 3][r]}, you, opponent);
    }
  }
  for (int c = 0; c < COLS; c++) {
    for (int r = 0; r <= ROWS - 4; r++) {
      score += window_score({board[c][r], board[c][r + 1], board[c][r + 2], board[c][r + 3]}, you, opponent);
    }
  }
  for (int c = 0; c <= COLS - 4; c++) {
    for (int r = 0; r <= ROWS - 4; r++) {
      score += window_score({board[c][r], board[c + 1][r + 1], board[c + 2][r + 2], board[c + 3][r + 3]}, you, opponent);
    }
  }
  for (int c = 0; c <= COLS - 4; c++) {
    for (int r = ROWS - 1; r >= 3; r--) {
      score += window_score({board[c][r], board[c + 1][r - 1], board[c + 2][r - 2], board[c + 3][r - 3]}, you, opponent);
    }
  }

  for (int c : {3, 4}) {
    for (int r = 0; r < ROWS; r++) {
      if (board[c][r] == you) score += 3;
      else if (board[c][r] == opponent) score -= 3;
    }
  }

  return score;
}

int search_choose_move(const std::vector<std::vector<int>>& board, int you) {
  std::vector<int> moves = legal_moves_impl(board);
  if (moves.empty()) return 0;

  int best_col = moves[0];
  long long best_score = std::numeric_limits<long long>::min();
  for (int c : moves) {
    std::vector<std::vector<int>> child = board;
    int row = drop_piece(child, c, you);
    long long score;
    if (is_winning_move(child, c, row, you)) {
      score = WIN - 1;
    } else if (legal_moves_impl(child).empty()) {
      score = 0;
    } else {
      int opponent = (you == 1) ? 2 : 1;
      score = -negamax(child, opponent, you, 2);
    }
    if (score > best_score) {
      best_score = score;
      best_col = c;
    }
  }
  return best_col;
}
