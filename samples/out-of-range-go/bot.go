// Stress sample: always answers an out-of-range column -> game_forfeit(invalid_move).
package main

type MoveInfo struct {
	Moves            []int
	MatchID          string
	GameNumber       int
	ClockRemainingMs int64
}

func chooseMove(board [][]int, you int, info MoveInfo) int {
	_ = board
	_ = you
	_ = info
	return 99
}

func legalMoves(board [][]int) []int {
	var moves []int
	for col, column := range board {
		if column[len(column)-1] == 0 {
			moves = append(moves, col)
		}
	}
	return moves
}
