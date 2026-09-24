/**
 * Sample bot: greedy (win now, else block, else center). Thin wrapper: the
 * real logic lives in Strategy.java so adapting to the template's eventual
 * trailing `info` argument is a one-line change here.
 */
public class Bot {
    public static int chooseMove(int[][] board, int you, MoveInfo info) {
        return Strategy.greedyMove(board, you);
    }
}
