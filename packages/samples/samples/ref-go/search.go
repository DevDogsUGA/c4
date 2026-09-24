// Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
// Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness.
package main

const (
	searchCols = 8
	searchRows = 8
	searchWin  = 1_000_000
)

func searchLegalMoves(board [][]int) []int {
	moves := make([]int, 0, searchCols)
	for c := 0; c < searchCols; c++ {
		if board[c][searchRows-1] == 0 {
			moves = append(moves, c)
		}
	}
	return moves
}

func copyBoard(board [][]int) [][]int {
	next := make([][]int, len(board))
	for i, col := range board {
		next[i] = append([]int(nil), col...)
	}
	return next
}

func dropPiece(board [][]int, c int, player int) int {
	for r := 0; r < searchRows; r++ {
		if board[c][r] == 0 {
			board[c][r] = player
			return r
		}
	}
	panic("column is full")
}

var searchDirections = [4][2]int{{1, 0}, {0, 1}, {1, 1}, {1, -1}}

func isWinningMove(board [][]int, c, r, player int) bool {
	for _, d := range searchDirections {
		dc, dr := d[0], d[1]
		count := 1
		cc, rr := c+dc, r+dr
		for cc >= 0 && cc < searchCols && rr >= 0 && rr < searchRows && board[cc][rr] == player {
			count++
			cc += dc
			rr += dr
		}
		cc, rr = c-dc, r-dr
		for cc >= 0 && cc < searchCols && rr >= 0 && rr < searchRows && board[cc][rr] == player {
			count++
			cc -= dc
			rr -= dr
		}
		if count >= 4 {
			return true
		}
	}
	return false
}

func windowScore(cells [4]int, you, opponent int) int {
	k, m := 0, 0
	for _, cell := range cells {
		if cell == you {
			k++
		} else if cell == opponent {
			m++
		}
	}
	if m == 0 {
		if k == 3 {
			return 5
		}
		if k == 2 {
			return 2
		}
		return 0
	}
	if k == 0 {
		if m == 3 {
			return -4
		}
		if m == 2 {
			return -1
		}
		return 0
	}
	return 0
}

func leafEval(board [][]int, you int) int {
	opponent := 2
	if you == 2 {
		opponent = 1
	}
	score := 0

	for r := 0; r < searchRows; r++ {
		for c := 0; c <= searchCols-4; c++ {
			score += windowScore([4]int{board[c][r], board[c+1][r], board[c+2][r], board[c+3][r]}, you, opponent)
		}
	}
	for c := 0; c < searchCols; c++ {
		for r := 0; r <= searchRows-4; r++ {
			score += windowScore([4]int{board[c][r], board[c][r+1], board[c][r+2], board[c][r+3]}, you, opponent)
		}
	}
	for c := 0; c <= searchCols-4; c++ {
		for r := 0; r <= searchRows-4; r++ {
			score += windowScore([4]int{board[c][r], board[c+1][r+1], board[c+2][r+2], board[c+3][r+3]}, you, opponent)
		}
	}
	for c := 0; c <= searchCols-4; c++ {
		for r := searchRows - 1; r >= 3; r-- {
			score += windowScore([4]int{board[c][r], board[c+1][r-1], board[c+2][r-2], board[c+3][r-3]}, you, opponent)
		}
	}

	for _, c := range [2]int{3, 4} {
		for r := 0; r < searchRows; r++ {
			if board[c][r] == you {
				score += 3
			} else if board[c][r] == opponent {
				score -= 3
			}
		}
	}

	return score
}

func negamax(board [][]int, player, you, ply int) int {
	moves := searchLegalMoves(board)
	if len(moves) == 0 {
		return 0
	}

	best := -1 << 62
	for _, c := range moves {
		child := copyBoard(board)
		row := dropPiece(child, c, player)
		var score int
		if isWinningMove(child, c, row, player) {
			score = searchWin - ply
		} else if len(searchLegalMoves(child)) == 0 {
			score = 0
		} else if ply == 4 {
			raw := leafEval(child, you)
			if player == you {
				score = raw
			} else {
				score = -raw
			}
		} else {
			opponent := 2
			if player == 2 {
				opponent = 1
			}
			score = -negamax(child, opponent, you, ply+1)
		}
		if score > best {
			best = score
		}
	}
	return best
}

func searchChooseMove(board [][]int, you int) int {
	moves := searchLegalMoves(board)
	if len(moves) == 0 {
		return 0
	}

	bestCol := moves[0]
	bestScore := -1 << 62
	for _, c := range moves {
		child := copyBoard(board)
		row := dropPiece(child, c, you)
		var score int
		if isWinningMove(child, c, row, you) {
			score = searchWin - 1
		} else if len(searchLegalMoves(child)) == 0 {
			score = 0
		} else {
			opponent := 2
			if you == 2 {
				opponent = 1
			}
			score = -negamax(child, opponent, you, 2)
		}
		if score > bestScore {
			bestScore = score
			bestCol = c
		}
	}
	return bestCol
}
