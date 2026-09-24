// Alpha-beta (fixed depth 7) with center-first move ordering. Kept out of
// bot.go so bot.go stays a thin wrapper.
package main

import "sort"

const searchDepth = 7

var dirs = [4][2]int{{1, 0}, {0, 1}, {1, 1}, {1, -1}}

func legalMovesFor(board [][]int) []int {
	var moves []int
	for col, column := range board {
		if column[len(column)-1] == 0 {
			moves = append(moves, col)
		}
	}
	return moves
}

func dropPiece(board [][]int, col, piece int) [][]int {
	next := make([][]int, len(board))
	for c := range board {
		next[c] = append([]int(nil), board[c]...)
	}
	for r := range next[col] {
		if next[col][r] == 0 {
			next[col][r] = piece
			break
		}
	}
	return next
}

func countDir(board [][]int, col, row, dc, dr, piece int) int {
	count := 0
	for col >= 0 && col < len(board) && row >= 0 && row < len(board[0]) && board[col][row] == piece {
		count++
		col += dc
		row += dr
	}
	return count
}

func winsFor(board [][]int, piece int) bool {
	for col := range board {
		for row := range board[col] {
			if board[col][row] != piece {
				continue
			}
			for _, d := range dirs {
				if countDir(board, col, row, d[0], d[1], piece) >= 4 {
					return true
				}
			}
		}
	}
	return false
}

func heuristic(board [][]int, me, opp int) int {
	score := 0
	center := float64(len(board)-1) / 2.0
	for col := range board {
		for row := range board[col] {
			cell := board[col][row]
			if cell == 0 {
				continue
			}
			sign := 1
			if cell != me {
				sign = -1
			}
			d := float64(col) - center
			if d < 0 {
				d = -d
			}
			score += sign * int(4-d)
			for _, dir := range dirs {
				run := countDir(board, col, row, dir[0], dir[1], cell)
				if run >= 2 {
					score += sign * run * run
				}
			}
		}
	}
	return score
}

func orderedMoves(board [][]int) []int {
	moves := legalMovesFor(board)
	center := float64(len(board)-1) / 2.0
	sort.Slice(moves, func(i, j int) bool {
		di := moves[i]
		dj := moves[j]
		ai := float64(di) - center
		if ai < 0 {
			ai = -ai
		}
		aj := float64(dj) - center
		if aj < 0 {
			aj = -aj
		}
		return ai < aj
	})
	return moves
}

func alphabeta(board [][]int, depth int, maximizing bool, me, opp, alpha, beta int) int {
	if winsFor(board, me) {
		return 1_000_000 - depth
	}
	if winsFor(board, opp) {
		return -1_000_000 + depth
	}
	moves := orderedMoves(board)
	if len(moves) == 0 || depth == 0 {
		return heuristic(board, me, opp)
	}

	if maximizing {
		best := -1 << 30
		for _, col := range moves {
			value := alphabeta(dropPiece(board, col, me), depth-1, false, me, opp, alpha, beta)
			if value > best {
				best = value
			}
			if value > alpha {
				alpha = value
			}
			if alpha >= beta {
				break
			}
		}
		return best
	}
	best := 1 << 30
	for _, col := range moves {
		value := alphabeta(dropPiece(board, col, opp), depth-1, true, me, opp, alpha, beta)
		if value < best {
			best = value
		}
		if value < beta {
			beta = value
		}
		if alpha >= beta {
			break
		}
	}
	return best
}

func alphabetaMove(board [][]int, you int) int {
	opp := 1
	if you == 1 {
		opp = 2
	}
	moves := orderedMoves(board)
	bestCol := moves[0]
	bestScore := -1 << 30
	for _, col := range moves {
		score := alphabeta(dropPiece(board, col, you), searchDepth-1, false, you, opp, -1<<30, 1<<30)
		if score > bestScore {
			bestScore = score
			bestCol = col
		}
	}
	return bestCol
}
