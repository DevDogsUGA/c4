/* Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
 * Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness. */
#include "search.h"

#include <limits.h>
#include <string.h>

#define WIN 1000000LL

static void copy_board(const int src[COLS][ROWS], int dst[COLS][ROWS]) {
    memcpy(dst, src, sizeof(int) * COLS * ROWS);
}

static int drop_piece(int board[COLS][ROWS], int c, int player) {
    for (int r = 0; r < ROWS; r++) {
        if (board[c][r] == 0) {
            board[c][r] = player;
            return r;
        }
    }
    return -1;
}

static const int DIRECTIONS[4][2] = {{1, 0}, {0, 1}, {1, 1}, {1, -1}};

static int is_winning_move(const int board[COLS][ROWS], int c, int r, int player) {
    for (int d = 0; d < 4; d++) {
        int dc = DIRECTIONS[d][0];
        int dr = DIRECTIONS[d][1];
        int count = 1;
        int cc = c + dc, rr = r + dr;
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
        if (count >= 4) {
            return 1;
        }
    }
    return 0;
}

static int window_score(const int cells[4], int you, int opponent) {
    int k = 0, m = 0;
    for (int i = 0; i < 4; i++) {
        if (cells[i] == you) {
            k++;
        } else if (cells[i] == opponent) {
            m++;
        }
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

int search_legal_moves(const int board[COLS][ROWS], int out_cols[COLS]) {
    int n = 0;
    for (int c = 0; c < COLS; c++) {
        if (board[c][ROWS - 1] == 0) {
            out_cols[n++] = c;
        }
    }
    return n;
}

int search_leaf_eval(const int board[COLS][ROWS], int you) {
    int opponent = (you == 1) ? 2 : 1;
    int score = 0;

    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c <= COLS - 4; c++) {
            int cells[4] = {board[c][r], board[c + 1][r], board[c + 2][r], board[c + 3][r]};
            score += window_score(cells, you, opponent);
        }
    }
    for (int c = 0; c < COLS; c++) {
        for (int r = 0; r <= ROWS - 4; r++) {
            int cells[4] = {board[c][r], board[c][r + 1], board[c][r + 2], board[c][r + 3]};
            score += window_score(cells, you, opponent);
        }
    }
    for (int c = 0; c <= COLS - 4; c++) {
        for (int r = 0; r <= ROWS - 4; r++) {
            int cells[4] = {board[c][r], board[c + 1][r + 1], board[c + 2][r + 2], board[c + 3][r + 3]};
            score += window_score(cells, you, opponent);
        }
    }
    for (int c = 0; c <= COLS - 4; c++) {
        for (int r = ROWS - 1; r >= 3; r--) {
            int cells[4] = {board[c][r], board[c + 1][r - 1], board[c + 2][r - 2], board[c + 3][r - 3]};
            score += window_score(cells, you, opponent);
        }
    }

    int center_cols[2] = {3, 4};
    for (int i = 0; i < 2; i++) {
        int c = center_cols[i];
        for (int r = 0; r < ROWS; r++) {
            if (board[c][r] == you) {
                score += 3;
            } else if (board[c][r] == opponent) {
                score -= 3;
            }
        }
    }

    return score;
}

static long long negamax(const int board[COLS][ROWS], int player, int you, int ply) {
    int moves[COLS];
    int n = search_legal_moves(board, moves);
    if (n == 0) {
        return 0;
    }

    long long best = LLONG_MIN;
    for (int i = 0; i < n; i++) {
        int c = moves[i];
        int child[COLS][ROWS];
        copy_board(board, child);
        int row = drop_piece(child, c, player);
        long long score;
        int child_moves[COLS];
        int child_n = search_legal_moves(child, child_moves);
        if (is_winning_move(child, c, row, player)) {
            score = WIN - ply;
        } else if (child_n == 0) {
            score = 0;
        } else if (ply == 4) {
            int raw = search_leaf_eval(child, you);
            score = (player == you) ? raw : -raw;
        } else {
            int opponent = (player == 1) ? 2 : 1;
            score = -negamax(child, opponent, you, ply + 1);
        }
        if (score > best) {
            best = score;
        }
    }
    return best;
}

int search_choose_move(const int board[COLS][ROWS], int you) {
    int moves[COLS];
    int n = search_legal_moves(board, moves);
    if (n == 0) {
        return 0;
    }

    int best_col = moves[0];
    long long best_score = LLONG_MIN;
    for (int i = 0; i < n; i++) {
        int c = moves[i];
        int child[COLS][ROWS];
        copy_board(board, child);
        int row = drop_piece(child, c, you);
        long long score;
        int child_moves[COLS];
        int child_n = search_legal_moves(child, child_moves);
        if (is_winning_move(child, c, row, you)) {
            score = WIN - 1;
        } else if (child_n == 0) {
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
