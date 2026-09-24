// Reference conformance sample bot (C++). Thin wrapper: all the algorithm
// lives in search.hpp/search.cpp (see packages/samples/src/conformance/SPEC.md).
#include "bot.hpp"
#include "search.hpp"

int choose_move(const std::vector<std::vector<int>>& board, int you, const MoveInfo& info) {
  (void)info;
  return search_choose_move(board, you);
}

std::vector<int> legal_moves(const std::vector<std::vector<int>>& board) {
  return search_legal_moves(board);
}
