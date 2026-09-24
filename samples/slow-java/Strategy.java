import java.util.ArrayList;
import java.util.List;

public class Strategy {
    public static List<Integer> legalMoves(int[][] board) {
        List<Integer> moves = new ArrayList<>();
        for (int col = 0; col < board.length; col++) {
            if (board[col][board[col].length - 1] == 0) {
                moves.add(col);
            }
        }
        return moves;
    }
}
