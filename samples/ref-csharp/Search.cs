// Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
// Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness.

namespace C4Bot;

public static class Search
{
    private const int Cols = 8;
    private const int Rows = 8;
    private const long Win = 1_000_000;

    public static List<int> LegalMoves(int[][] board)
    {
        var moves = new List<int>();
        for (var c = 0; c < Cols; c++)
        {
            if (board[c][Rows - 1] == 0)
            {
                moves.Add(c);
            }
        }
        return moves;
    }

    private static int[][] CopyBoard(int[][] board)
    {
        var copy = new int[Cols][];
        for (var c = 0; c < Cols; c++)
        {
            copy[c] = (int[])board[c].Clone();
        }
        return copy;
    }

    private static readonly (int dc, int dr)[] Directions = { (1, 0), (0, 1), (1, 1), (1, -1) };

    private static bool IsWinningMove(int[][] board, int c, int r, int player)
    {
        foreach (var (dc, dr) in Directions)
        {
            var count = 1;
            var cc = c + dc;
            var rr = r + dr;
            while (cc >= 0 && cc < Cols && rr >= 0 && rr < Rows && board[cc][rr] == player)
            {
                count++;
                cc += dc;
                rr += dr;
            }
            cc = c - dc;
            rr = r - dr;
            while (cc >= 0 && cc < Cols && rr >= 0 && rr < Rows && board[cc][rr] == player)
            {
                count++;
                cc -= dc;
                rr -= dr;
            }
            if (count >= 4)
            {
                return true;
            }
        }
        return false;
    }

    private static int WindowScore(int[] cells, int you, int opponent)
    {
        var k = 0;
        var m = 0;
        foreach (var cell in cells)
        {
            if (cell == you) k++;
            else if (cell == opponent) m++;
        }
        if (m == 0)
        {
            if (k == 3) return 5;
            if (k == 2) return 2;
            return 0;
        }
        if (k == 0)
        {
            if (m == 3) return -4;
            if (m == 2) return -1;
            return 0;
        }
        return 0;
    }

    public static int LeafEval(int[][] board, int you)
    {
        var opponent = you == 1 ? 2 : 1;
        var score = 0;

        for (var r = 0; r < Rows; r++)
        {
            for (var c = 0; c <= Cols - 4; c++)
            {
                score += WindowScore(new[] { board[c][r], board[c + 1][r], board[c + 2][r], board[c + 3][r] }, you, opponent);
            }
        }
        for (var c = 0; c < Cols; c++)
        {
            for (var r = 0; r <= Rows - 4; r++)
            {
                score += WindowScore(new[] { board[c][r], board[c][r + 1], board[c][r + 2], board[c][r + 3] }, you, opponent);
            }
        }
        for (var c = 0; c <= Cols - 4; c++)
        {
            for (var r = 0; r <= Rows - 4; r++)
            {
                score += WindowScore(new[] { board[c][r], board[c + 1][r + 1], board[c + 2][r + 2], board[c + 3][r + 3] }, you, opponent);
            }
        }
        for (var c = 0; c <= Cols - 4; c++)
        {
            for (var r = Rows - 1; r >= 3; r--)
            {
                score += WindowScore(new[] { board[c][r], board[c + 1][r - 1], board[c + 2][r - 2], board[c + 3][r - 3] }, you, opponent);
            }
        }

        foreach (var c in new[] { 3, 4 })
        {
            for (var r = 0; r < Rows; r++)
            {
                if (board[c][r] == you) score += 3;
                else if (board[c][r] == opponent) score -= 3;
            }
        }

        return score;
    }

    private static int DropPiece(int[][] board, int c, int player)
    {
        for (var r = 0; r < Rows; r++)
        {
            if (board[c][r] == 0)
            {
                board[c][r] = player;
                return r;
            }
        }
        throw new InvalidOperationException($"column {c} is full");
    }

    private static long Negamax(int[][] board, int player, int you, int ply)
    {
        var moves = LegalMoves(board);
        if (moves.Count == 0)
        {
            return 0;
        }

        var best = long.MinValue;
        foreach (var c in moves)
        {
            var child = CopyBoard(board);
            var row = DropPiece(child, c, player);
            long score;
            if (IsWinningMove(child, c, row, player))
            {
                score = Win - ply;
            }
            else if (LegalMoves(child).Count == 0)
            {
                score = 0;
            }
            else if (ply == 4)
            {
                var raw = LeafEval(child, you);
                score = player == you ? raw : -raw;
            }
            else
            {
                var opponent = player == 1 ? 2 : 1;
                score = -Negamax(child, opponent, you, ply + 1);
            }
            if (score > best)
            {
                best = score;
            }
        }
        return best;
    }

    public static int ChooseMove(int[][] board, int you)
    {
        var moves = LegalMoves(board);
        if (moves.Count == 0)
        {
            return 0;
        }

        var bestCol = moves[0];
        var bestScore = long.MinValue;
        foreach (var c in moves)
        {
            var child = CopyBoard(board);
            var row = DropPiece(child, c, you);
            long score;
            if (IsWinningMove(child, c, row, you))
            {
                score = Win - 1;
            }
            else if (LegalMoves(child).Count == 0)
            {
                score = 0;
            }
            else
            {
                var opponent = you == 1 ? 2 : 1;
                score = -Negamax(child, opponent, you, 2);
            }
            if (score > bestScore)
            {
                bestScore = score;
                bestCol = c;
            }
        }
        return bestCol;
    }
}
