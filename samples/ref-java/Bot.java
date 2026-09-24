/**
 * Reference conformance sample bot (Java). Thin wrapper: all the algorithm
 * lives in Search.java (see packages/samples/src/conformance/SPEC.md).
 */
public class Bot {
    public static int chooseMove(int[][] board, int you, MoveInfo info) {
        return Search.chooseMove(board, you);
    }
}
