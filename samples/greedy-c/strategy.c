/* Greedy strategy, kept out of bot.c so bot.c stays a thin wrapper. Every
 * *.c file in this folder is compiled in automatically (see the template
 * Makefile's `wildcard *.c`), so no build config changes needed. */
#include <string.h>

#include "strategy.h"

static void drop(const int board[COLS][ROWS], int col, int piece, int out[COLS][ROWS]) {
    memcpy(out, board, sizeof(int) * COLS * ROWS);
    for (int r = 0; r < ROWS; r++) {
        if (out[col][r] == 0) {
            out[col][r] = piece;
            break;
        }
    }
}

static int wins(const int board[COLS][ROWS], int piece) {
    static const int dirs[4][2] = { { 1, 0 }, { 0, 1 }, { 1, 1 }, { 1, -1 } };
    for (int col = 0; col < COLS; col++) {
        for (int row = 0; row < ROWS; row++) {
            if (board[col][row] != piece) continue;
            for (int d = 0; d < 4; d++) {
                int count = 1;
                int c = col + dirs[d][0];
                int r = row + dirs[d][1];
                while (c >= 0 && c < COLS && r >= 0 && r < ROWS && board[c][r] == piece) {
                    count++;
                    c += dirs[d][0];
                    r += dirs[d][1];
                }
                if (count >= 4) return 1;
            }
        }
    }
    return 0;
}

int greedy_move(const int board[COLS][ROWS], int you) {
    int opponent = you == 1 ? 2 : 1;
    int moves[COLS];
    int n = legal_moves(board, moves);
    int tmp[COLS][ROWS];

    for (int i = 0; i < n; i++) {
        drop(board, moves[i], you, tmp);
        if (wins(tmp, you)) return moves[i];
    }
    for (int i = 0; i < n; i++) {
        drop(board, moves[i], opponent, tmp);
        if (wins(tmp, opponent)) return moves[i];
    }
    double center = (COLS - 1) / 2.0;
    int best = moves[0];
    for (int i = 0; i < n; i++) {
        double a = moves[i] - center;
        double b = best - center;
        if ((a < 0 ? -a : a) < (b < 0 ? -b : b)) best = moves[i];
    }
    return best;
}
