"""Minimax (depth 4) with a simple positional heuristic. Kept out of bot.py
so bot.py stays a thin wrapper -- and to exercise the python template's
Dockerfile glob (`COPY *.py ./`), which must pick this file up automatically.
"""

DEPTH = 4
WIDTH = 8
HEIGHT = 8
DIRS = [(1, 0), (0, 1), (1, 1), (1, -1)]


def legal_moves(board):
    return [col for col, column in enumerate(board) if column[-1] == 0]


def drop(board, col, piece):
    next_board = [list(c) for c in board]
    for row in range(HEIGHT):
        if next_board[col][row] == 0:
            next_board[col][row] = piece
            break
    return next_board


def count_dir(board, col, row, dc, dr, piece):
    count = 0
    while 0 <= col < WIDTH and 0 <= row < HEIGHT and board[col][row] == piece:
        count += 1
        col += dc
        row += dr
    return count


def wins(board, piece):
    for col in range(WIDTH):
        for row in range(HEIGHT):
            if board[col][row] != piece:
                continue
            for dc, dr in DIRS:
                if count_dir(board, col, row, dc, dr, piece) >= 4:
                    return True
    return False


def heuristic(board, me, opp):
    score = 0
    center = (WIDTH - 1) / 2
    for col in range(WIDTH):
        for row in range(HEIGHT):
            cell = board[col][row]
            if cell == 0:
                continue
            sign = 1 if cell == me else -1
            score += sign * (4 - abs(col - center))
            for dc, dr in DIRS:
                run = count_dir(board, col, row, dc, dr, cell)
                if run >= 2:
                    score += sign * run * run
    return score


def minimax(board, depth, maximizing, me, opp, alpha, beta):
    if wins(board, me):
        return 1_000_000 - depth
    if wins(board, opp):
        return -1_000_000 + depth
    moves = legal_moves(board)
    if not moves or depth == 0:
        return heuristic(board, me, opp)

    if maximizing:
        best = float("-inf")
        for col in moves:
            value = minimax(drop(board, col, me), depth - 1, False, me, opp, alpha, beta)
            best = max(best, value)
            alpha = max(alpha, value)
            if alpha >= beta:
                break
        return best
    else:
        best = float("inf")
        for col in moves:
            value = minimax(drop(board, col, opp), depth - 1, True, me, opp, alpha, beta)
            best = min(best, value)
            beta = min(beta, value)
            if alpha >= beta:
                break
        return best


def minimax_move(board, you):
    opp = 2 if you == 1 else 1
    moves = legal_moves(board)
    best_col = moves[0]
    best_score = float("-inf")
    for col in moves:
        score = minimax(drop(board, col, you), DEPTH - 1, False, you, opp, float("-inf"), float("inf"))
        if score > best_score:
            best_score = score
            best_col = col
    return best_col
