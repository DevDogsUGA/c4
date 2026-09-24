"""Tier-3 resource-abuse sample: on every move, tries to reach the public
internet and a well-known internal address, logs whether either succeeded,
and then still plays a legal move regardless. Meaningful only once the
per-match internal network hardening lands (this bot should NEVER succeed at
egress there); do not run this outside the hardened engine."""

import socket


def _try_connect(host, port, timeout=1.0):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def choose_move(board, you, info=None):
    internet_ok = _try_connect("8.8.8.8", 53)
    lan_ok = _try_connect("172.17.0.1", 80)
    print(f"[egress-attempt] internet={internet_ok} lan={lan_ok}", flush=True)
    return legal_moves(board)[0]


def legal_moves(board):
    return [col for col, column in enumerate(board) if column[-1] == 0]
