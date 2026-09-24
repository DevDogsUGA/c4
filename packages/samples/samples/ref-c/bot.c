/* Reference conformance sample bot (C). Thin wrapper: all the algorithm
 * lives in search.h/search.c (see packages/samples/src/conformance/SPEC.md). */
#include "bot.h"
#include "search.h"

int choose_move(const int board[COLS][ROWS], int you, const MoveInfo *info) {
    (void)info;
    return search_choose_move(board, you);
}

int legal_moves(const int board[COLS][ROWS], int out_cols[COLS]) {
    return search_legal_moves(board, out_cols);
}
