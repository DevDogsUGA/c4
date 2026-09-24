// Sample bot: alpha-beta (depth ~7) with move ordering. Thin wrapper: the
// real search lives in search.cpp/search.hpp.
#include "bot.hpp"
#include "search.hpp"

int choose_move(const std::vector<std::vector<int>>& board, int you, const MoveInfo& info) {
  (void)info;
  return alphabeta_move(board, you);
}

std::vector<int> legal_moves(const std::vector<std::vector<int>>& board) {
  std::vector<int> moves;
  for (size_t col = 0; col < board.size(); ++col) {
    if (board[col].back() == 0) moves.push_back(static_cast<int>(col));
  }
  return moves;
}
