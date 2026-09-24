/* Sample bot: greedy (win now, else block, else center). Thin wrapper: the
 * real logic lives in strategy.c/strategy.h. */
#include "bot.h"
#include "strategy.h"

int choose_move(const int board[COLS][ROWS], int you, const MoveInfo *info) {
    (void)info;
    return greedy_move(board, you);
}

int legal_moves(const int board[COLS][ROWS], int out_cols[COLS]) {
    int n = 0;
    for (int col = 0; col < COLS; col++) {
        if (board[col][ROWS - 1] == 0) {
            out_cols[n++] = col;
        }
    }
    return n;
}
