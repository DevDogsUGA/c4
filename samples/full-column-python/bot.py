"""Stress sample: always answers with column 0, whether or not it's still
legal -- most games it becomes illegal (full) within a handful of moves,
triggering game_forfeit(invalid_move)."""


def choose_move(board, you, info=None):
    return 0
