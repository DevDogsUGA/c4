"""
Reference conformance sample bot (Python). Thin wrapper: all the algorithm
lives in search.py (see packages/samples/src/conformance/SPEC.md).
"""

from search import choose_move as _choose_move


def choose_move(board, you, info=None):
    return _choose_move(board, you)
