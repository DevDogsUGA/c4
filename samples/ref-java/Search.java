import java.util.ArrayList;
import java.util.List;

/**
 * Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
 * Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness.
 */
final class Search {
    private static final int COLS = 8;
    private static final int ROWS = 8;
    private static final int WIN = 1_000_000;

    private Search() {
    }

    static List<Integer> legalMoves(int[][] board) {
        List<Integer> moves = new ArrayList<>();
        for (int c = 0; c < COLS; c++) {
            if (board[c][ROWS - 1] == 0) {
                moves.add(c);
            }
        }
        return moves;
    }

    private static int[][] copyBoard(int[][] board) {
        int[][] copy = new int[COLS][];
        for (int c = 0; c < COLS; c++) {
            copy[c] = board[c].clone();
        }
        return copy;
    }

    private static final int[][] DIRECTIONS = {{1, 0}, {0, 1}, {1, 1}, {1, -1}};

    private static boolean isWinningMove(int[][] board, int c, int r, int player) {
        for (int[] dir : DIRECTIONS) {
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
            if (count >= 4) {
                return true;
            }
        }
        return false;
    }

    private static int windowScore(int[] cells, int you, int opponent) {
        int k = 0;
        int m = 0;
        for (int cell : cells) {
            if (cell == you) {
                k++;
            } else if (cell == opponent) {
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

    static int leafEval(int[][] board, int you) {
        int opponent = you == 1 ? 2 : 1;
        int score = 0;

        for (int r = 0; r < ROWS; r++) {
            for (int c = 0; c <= COLS - 4; c++) {
                score += windowScore(new int[]{board[c][r], board[c + 1][r], board[c + 2][r], board[c + 3][r]}, you, opponent);
            }
        }
        for (int c = 0; c < COLS; c++) {
            for (int r = 0; r <= ROWS - 4; r++) {
                score += windowScore(new int[]{board[c][r], board[c][r + 1], board[c][r + 2], board[c][r + 3]}, you, opponent);
            }
        }
        for (int c = 0; c <= COLS - 4; c++) {
            for (int r = 0; r <= ROWS - 4; r++) {
                score += windowScore(new int[]{board[c][r], board[c + 1][r + 1], board[c + 2][r + 2], board[c + 3][r + 3]}, you, opponent);
            }
        }
        for (int c = 0; c <= COLS - 4; c++) {
            for (int r = ROWS - 1; r >= 3; r--) {
                score += windowScore(new int[]{board[c][r], board[c + 1][r - 1], board[c + 2][r - 2], board[c + 3][r - 3]}, you, opponent);
            }
        }

        for (int c : new int[]{3, 4}) {
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

    private static int negamax(int[][] board, int player, int you, int ply) {
        List<Integer> moves = legalMoves(board);
        if (moves.isEmpty()) {
            return 0;
        }

        int best = Integer.MIN_VALUE;
        for (int c : moves) {
            int[][] child = copyBoard(board);
            int row = drop(child, c, player);
            int score;
            if (isWinningMove(child, c, row, player)) {
                score = WIN - ply;
            } else if (legalMoves(child).isEmpty()) {
                score = 0;
            } else if (ply == 4) {
                int raw = leafEval(child, you);
                score = player == you ? raw : -raw;
            } else {
                int opponent = player == 1 ? 2 : 1;
                score = -negamax(child, opponent, you, ply + 1);
            }
            if (score > best) {
                best = score;
            }
        }
        return best;
    }

    private static int drop(int[][] board, int c, int player) {
        for (int r = 0; r < ROWS; r++) {
            if (board[c][r] == 0) {
                board[c][r] = player;
                return r;
            }
        }
        throw new IllegalStateException("column " + c + " is full");
    }

    static int chooseMove(int[][] board, int you) {
        List<Integer> moves = legalMoves(board);
        if (moves.isEmpty()) {
            return 0;
        }

        int bestCol = moves.get(0);
        int bestScore = Integer.MIN_VALUE;
        for (int c : moves) {
            int[][] child = copyBoard(board);
            int row = drop(child, c, you);
            int score;
            if (isWinningMove(child, c, row, you)) {
                score = WIN - 1;
            } else if (legalMoves(child).isEmpty()) {
                score = 0;
            } else {
                int opponent = you == 1 ? 2 : 1;
                score = -negamax(child, opponent, you, 2);
            }
            if (score > bestScore) {
                bestScore = score;
                bestCol = c;
            }
        }
        return bestCol;
    }
}
