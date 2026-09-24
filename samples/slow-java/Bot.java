import java.util.List;
import java.util.Random;

/**
 * Stress sample: burns almost the whole per-game think budget on every
 * move, so the chess clock (THINK_BUDGET_MS = 5000) runs out and the game
 * is forfeited for clock_expired.
 */
public class Bot {
    private static final Random RANDOM = new Random();

    public static int chooseMove(int[][] board, int you, MoveInfo info) {
        try {
            // Comfortably longer than any single game's remaining budget
            // divided across the handful of moves it takes to drain it.
            Thread.sleep(4500);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        List<Integer> moves = Strategy.legalMoves(board);
        return moves.get(RANDOM.nextInt(moves.size()));
    }
}
