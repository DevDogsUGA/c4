"""
Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness.
"""

COLS = 8
ROWS = 8
WIN = 1_000_000


def legal_moves(board):
    """Columns that aren't full yet, in increasing order."""
    return [c for c in range(COLS) if board[c][ROWS - 1] == 0]


def _drop(board, c, player):
    """Returns (new_board, row) with player's piece dropped into column c.

    Performance note (not a behavior change): only column `c` actually
    changes, so we shallow-copy the outer list of columns and deep-copy just
    that one column, instead of deep-copying all 8 columns every call. The
    other 7 column lists are shared (never mutated in place) between parent
    and child boards, which is safe precisely because every mutation here
    creates a fresh list for the touched column rather than editing one that
    might be aliased elsewhere.
    """
    new_column = board[c][:]
    for r in range(ROWS):
        if new_column[r] == 0:
            new_column[r] = player
            new_board = board[:]
            new_board[c] = new_column
            return new_board, r
    raise ValueError(f"column {c} is full")


_DIRECTIONS = ((1, 0), (0, 1), (1, 1), (1, -1))


def _is_winning_move(board, c, r, player):
    for dc, dr in _DIRECTIONS:
        count = 1
        cc, rr = c + dc, r + dr
        while 0 <= cc < COLS and 0 <= rr < ROWS and board[cc][rr] == player:
            count += 1
            cc += dc
            rr += dr
        cc, rr = c - dc, r - dr
        while 0 <= cc < COLS and 0 <= rr < ROWS and board[cc][rr] == player:
            count += 1
            cc -= dc
            rr -= dr
        if count >= 4:
            return True
    return False


# Lookup table for "3 you + 1 empty" / "2 you + 2 empty" / mirror for
# opponent, indexed by (you_count, opponent_count). Equivalent to
# _window_score's if/elif ladder, just avoids the per-call branching and
# (in leaf_eval) the temporary 4-element list -- same classification, same
# results, just faster in the interpreter's hot loop.
_WINDOW_SCORE = {
    (3, 0): 5,
    (2, 0): 2,
    (0, 3): -4,
    (0, 2): -1,
}


def _window_score(cells, you, opponent):
    k = 0
    m = 0
    for cell in cells:
        if cell == you:
            k += 1
        elif cell == opponent:
            m += 1
    return _WINDOW_SCORE.get((k, m), 0)


def leaf_eval(board, you):
    """Leaf evaluation from `you`'s perspective."""
    opponent = 2 if you == 1 else 1
    score = 0
    get_score = _WINDOW_SCORE.get

    for r in range(ROWS):
        for c in range(COLS - 3):
            a, b, cc2, d = board[c][r], board[c + 1][r], board[c + 2][r], board[c + 3][r]
            k = (a == you) + (b == you) + (cc2 == you) + (d == you)
            m = (a == opponent) + (b == opponent) + (cc2 == opponent) + (d == opponent)
            score += get_score((k, m), 0)

    for c in range(COLS):
        for r in range(ROWS - 3):
            a, b, cc2, d = board[c][r], board[c][r + 1], board[c][r + 2], board[c][r + 3]
            k = (a == you) + (b == you) + (cc2 == you) + (d == you)
            m = (a == opponent) + (b == opponent) + (cc2 == opponent) + (d == opponent)
            score += get_score((k, m), 0)

    for c in range(COLS - 3):
        for r in range(ROWS - 3):
            a, b, cc2, d = board[c][r], board[c + 1][r + 1], board[c + 2][r + 2], board[c + 3][r + 3]
            k = (a == you) + (b == you) + (cc2 == you) + (d == you)
            m = (a == opponent) + (b == opponent) + (cc2 == opponent) + (d == opponent)
            score += get_score((k, m), 0)

    for c in range(COLS - 3):
        for r in range(ROWS - 1, 2, -1):
            a, b, cc2, d = board[c][r], board[c + 1][r - 1], board[c + 2][r - 2], board[c + 3][r - 3]
            k = (a == you) + (b == you) + (cc2 == you) + (d == you)
            m = (a == opponent) + (b == opponent) + (cc2 == opponent) + (d == opponent)
            score += get_score((k, m), 0)

    for c in (3, 4):
        for r in range(ROWS):
            if board[c][r] == you:
                score += 3
            elif board[c][r] == opponent:
                score -= 3

    return score


def _negamax(board, player, you, ply, moves=None):
    if moves is None:
        moves = legal_moves(board)
    if not moves:
        return 0

    best = None
    for c in moves:
        child, row = _drop(board, c, player)
        if _is_winning_move(child, c, row, player):
            score = WIN - ply
        else:
            child_moves = legal_moves(child)
            if not child_moves:
                score = 0
            elif ply == 4:
                raw = leaf_eval(child, you)
                score = raw if player == you else -raw
            else:
                opponent = 2 if player == 1 else 1
                score = -_negamax(child, opponent, you, ply + 1, child_moves)
        if best is None or score > best:
            best = score
    return best


def choose_move(board, you):
    """Chooses the root move: highest score, ties broken by lowest column index."""
    moves = legal_moves(board)
    if not moves:
        return 0

    best_col = moves[0]
    best_score = None
    for c in moves:
        child, row = _drop(board, c, you)
        if _is_winning_move(child, c, row, you):
            score = WIN - 1
        elif not legal_moves(child):
            score = 0
        else:
            opponent = 2 if you == 1 else 1
            score = -_negamax(child, opponent, you, 2)
        if best_score is None or score > best_score:
            best_score = score
            best_col = c
    return best_col
