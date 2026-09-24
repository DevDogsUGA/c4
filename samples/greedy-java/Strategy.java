import java.util.ArrayList;
import java.util.List;

// Greedy strategy, kept out of Bot.java so Bot.java stays a thin wrapper.
// javac compiles every *.java in the build context, so this file is picked
// up automatically (no Dockerfile change needed).
public class Strategy {
    private static final int[][] DIRS = { { 1, 0 }, { 0, 1 }, { 1, 1 }, { 1, -1 } };

    public static List<Integer> legalMoves(int[][] board) {
        List<Integer> moves = new ArrayList<>();
        for (int col = 0; col < board.length; col++) {
            if (board[col][board[col].length - 1] == 0) {
                moves.add(col);
            }
        }
        return moves;
    }

    private static int[][] drop(int[][] board, int col, int piece) {
        int[][] next = new int[board.length][];
        for (int c = 0; c < board.length; c++) {
            next[c] = board[c].clone();
        }
        for (int r = 0; r < next[col].length; r++) {
            if (next[col][r] == 0) {
                next[col][r] = piece;
                break;
            }
        }
        return next;
    }

    private static boolean wins(int[][] board, int piece) {
        int w = board.length, h = board[0].length;
        for (int col = 0; col < w; col++) {
            for (int row = 0; row < h; row++) {
                if (board[col][row] != piece) continue;
                for (int[] d : DIRS) {
                    int count = 1;
                    int c = col + d[0], r = row + d[1];
                    while (c >= 0 && c < w && r >= 0 && r < h && board[c][r] == piece) {
                        count++;
                        c += d[0];
                        r += d[1];
                    }
                    if (count >= 4) return true;
                }
            }
        }
        return false;
    }

    public static int greedyMove(int[][] board, int you) {
        int opponent = you == 1 ? 2 : 1;
        List<Integer> moves = legalMoves(board);
        double center = (board.length - 1) / 2.0;

        for (int col : moves) {
            if (wins(drop(board, col, you), you)) return col;
        }
        for (int col : moves) {
            if (wins(drop(board, col, opponent), opponent)) return col;
        }
        int best = moves.get(0);
        for (int col : moves) {
            if (Math.abs(col - center) < Math.abs(best - center)) best = col;
        }
        return best;
    }
}
