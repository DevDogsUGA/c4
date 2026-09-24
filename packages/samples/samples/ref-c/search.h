/* Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
 * Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness. */
#ifndef SEARCH_H
#define SEARCH_H

#include "bot.h" /* for COLS, ROWS */

int search_legal_moves(const int board[COLS][ROWS], int out_cols[COLS]);
int search_leaf_eval(const int board[COLS][ROWS], int you);
int search_choose_move(const int board[COLS][ROWS], int you);

#endif
