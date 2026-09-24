"""Tier-3 resource-abuse sample: a background thread spins the CPU while the
bot still answers /move legally on the request thread. Only meaningful under
the hardened engine's 1-CPU cap; do not run this outside it."""

import threading


def _spin():
    while True:
        pass


threading.Thread(target=_spin, daemon=True).start()


def choose_move(board, you, info=None):
    return legal_moves(board)[0]


def legal_moves(board):
    return [col for col, column in enumerate(board) if column[-1] == 0]
