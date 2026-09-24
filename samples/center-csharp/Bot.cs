// Sample: center-column preference. Deterministic; ties go to the lowest
// column (we scan columns left-to-right and never replace an equal-score pick).
namespace C4Bot;

public static class Bot
{
    public static int ChooseMove(int[][] board, int you)
    {
        var moves = LegalMoves(board);
        var center = (board.Length - 1) / 2.0;

        var best = moves[0];
        var bestScore = double.MaxValue;
        foreach (var col in moves)
        {
            var score = Math.Abs(col - center);
            if (score < bestScore)
            {
                bestScore = score;
                best = col;
            }
        }
        return best;
    }

    public static List<int> LegalMoves(int[][] board)
    {
        var moves = new List<int>();
        for (var col = 0; col < board.Length; col++)
        {
            if (board[col][^1] == 0)
            {
                moves.Add(col);
            }
        }
        return moves;
    }
}
