"""Sample bot: minimax (depth 4) with a heuristic. Thin wrapper: the real
search lives in search.py."""

from search import minimax_move


def choose_move(board, you, info=None):
    return minimax_move(board, you)


def legal_moves(board):
    return [col for col, column in enumerate(board) if column[-1] == 0]
