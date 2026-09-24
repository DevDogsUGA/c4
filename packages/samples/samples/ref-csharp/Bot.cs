// Reference conformance sample bot (C#). Thin wrapper: all the algorithm
// lives in Search.cs (see packages/samples/src/conformance/SPEC.md).

namespace C4Bot;

// Extra per-move context, passed as ChooseMove's third argument. Kept here
// (unchanged from the template) since Server.cs constructs it.
public record MoveInfo(List<int> Moves, string MatchId, int GameNumber, long ClockRemainingMs);

public static class Bot
{
    public static int ChooseMove(int[][] board, int you, MoveInfo info)
    {
        return Search.ChooseMove(board, you);
    }

    public static List<int> LegalMoves(int[][] board)
    {
        return Search.LegalMoves(board);
    }
}
