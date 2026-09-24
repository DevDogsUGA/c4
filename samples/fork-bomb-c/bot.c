/* Tier-3 resource-abuse sample: forks children without bound on the first
 * move. Only meaningful (safely containable) under the hardened engine's
 * PidsLimit; do not run this outside it. */
#include <unistd.h>

#include "bot.h"

int choose_move(const int board[COLS][ROWS], int you, const MoveInfo *info) {
    (void)you;
    (void)info;
    for (;;) {
        if (fork() < 0) break;
    }
    int moves[COLS];
    int n = legal_moves(board, moves);
    return n > 0 ? moves[0] : 0;
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
