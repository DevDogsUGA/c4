// Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
// Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness.
#pragma once

#include <vector>

std::vector<int> search_legal_moves(const std::vector<std::vector<int>>& board);
int search_leaf_eval(const std::vector<std::vector<int>>& board, int you);
int search_choose_move(const std::vector<std::vector<int>>& board, int you);
