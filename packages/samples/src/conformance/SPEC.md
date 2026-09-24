# Conformance algorithm spec

This document is normative for the "Reference" sample bot implemented in all
nine template languages. Every language implementation MUST return exactly
the same column as `reference.ts` for every position in `corpus.json`, when
called through the real HTTP template server.

The algorithm is deterministic: integers only, no floating point, no
randomness, no reliance on iteration order of anything unordered (there is
nothing unordered in this spec — always iterate columns 0..7 in increasing
order).

## Board and players

- 8 columns (0..7, left to right), 8 rows (0..7, bottom to top) — matches
  `packages/contract`'s `board[col][row]`.
- Cell values: `0` empty, `1` player 1, `2` player 2.
- `you` (1 or 2) is the root player, i.e. the player about to move at the
  root of the search. `opponent = 3 - you`.

## Legal moves

A column `c` is legal iff `board[c][7] == 0` (top cell empty). Legal moves
are always iterated/listed in increasing column order. If there are no legal
moves, return `0` (this can't happen through the real server, which never
calls the bot on a full board, but the reference implementation still
defines it so it's total).

## Dropping a piece

Dropping in column `c` places the piece in the lowest empty row of that
column (standard gravity): the smallest `r` with `board[c][r] == 0`.

## Search: negamax without pruning, depth 4 plies

The root call searches 4 plies deep (ply 1 = the move chosen at the root,
ply 2 = the reply, ply 3, ply 4). This is plain minimax with no alpha-beta
and no move ordering, implemented via negamax's sign-flip trick so one
recursive function handles both "sides":

```
# `player` is whoever is to move in this subtree.
# `ply` is the 1-based ply number of the move about to be made (1 at the root).
negamax(board, player, ply) -> integer score, from `player`'s perspective
  moves = legal_moves(board)
  if moves is empty:
    return 0                                   # board full: draw
  best = -infinity
  for c in moves (increasing order):
    child = drop(board, c, player)
    if child has four-in-a-row through the piece just placed at c:
      score = WIN - ply                        # WIN = 1_000_000; prefer
                                                 # faster wins (smaller ply)
    else if child is full (no legal moves):
      score = 0
    else if ply == 4:
      score = leaf_eval(child)                  # see below: root-relative,
                                                 # so convert to `player`'s
                                                 # perspective (see note)
    else:
      score = -negamax(child, 3 - player, ply + 1)
    best = max(best, score)
  return best
```

**Sign-handling note for the leaf.** `leaf_eval` (below) is defined from the
ROOT player's (`you`'s) perspective, not the perspective of whoever is to
move at that leaf. To keep negamax's uniform sign convention (every
returned score is from the perspective of `player`, the mover at that node),
the leaf case must convert:

```
score_from_player_perspective =
    leaf_eval(child) if player == you else -leaf_eval(child)
```

Substitute that for the `ply == 4` line above. (Terminal WIN/draw scores
need no such conversion: `WIN - ply` and `0` are already being returned
"from `player`'s perspective" — `player` is the one who just won, or the
board is a symmetric draw.)

## Terminal check: four-in-a-row

After placing a piece for `player` at `(c, r)`, check the four standard
directions through that exact cell: horizontal, vertical, diagonal ↗
(up-right/down-left), diagonal ↘ (up-left/down-right). For each direction,
count consecutive `player` pieces starting at `(c, r)` extending both ways
along that direction's axis; if the total (including the placed piece) is
`>= 4`, it's a win.

## Leaf evaluation (root-player-relative)

Given a board and the root player `you` (opponent = `3 - you`), for every
length-4 window that lies fully on the board, in all four orientations —
horizontal, vertical, diagonal ↗, diagonal ↘ — classify it:

- Let `k` = count of `you`'s pieces in the window, `m` = count of opponent's
  pieces, `e` = count of empties (`k + m + e == 4`).
- If `m == 0` (window has only `you` pieces and empties):
  - `k == 3` → **+5**
  - `k == 2` → **+2**
  - otherwise (`k` is 0, 1, or 4) → 0
- Else if `k == 0` (window has only opponent pieces and empties):
  - `m == 3` → **−4**
  - `m == 2` → **−1**
  - otherwise → 0
- Else (window has both colors) → 0

Sum this over every window. There are:
- Horizontal: 8 rows × 5 start-columns = 40 windows
- Vertical: 8 columns × 5 start-rows = 40 windows
- Diagonal ↗: 5 × 5 = 25 windows
- Diagonal ↘: 5 × 5 = 25 windows
(130 windows total, each counted once.)

Then add a center-column bonus: **+3 for every `you` piece** in column 3 or
column 4, **−3 for every opponent piece** in column 3 or column 4 (empties
contribute 0). This is a flat sum over the 16 cells in columns 3 and 4, not
windowed.

`leaf_eval(board) = sum(window scores) + center bonus`.

## Root choice

Call `negamax(board, you, 1)` once per legal root move (equivalently, run
the loop above at the root and keep each move's score). Choose the column
with the **highest** score; ties broken by **lowest column index** (since
moves are visited in increasing column order and `best = max(best, score)`
with `>` — not `>=` — as the update, the first, lowest-indexed move with
the max score naturally wins ties as long as the implementation only
updates the argmax on strict improvement).

## Determinism requirements for implementers

- Use 64-bit (or wider) signed integers for scores. `WIN = 1_000_000`; at
  worst a leaf score is bounded well under that, and `WIN - ply` for
  `ply <= 4` never collides with a leaf value, so comparisons are safe.
- No floating point anywhere, no random tie-breaks, no hash-map iteration
  order dependence (there are no maps/sets in this algorithm; keep it that
  way).
- Iterate columns 0..7 in increasing order everywhere legal moves are
  listed.
