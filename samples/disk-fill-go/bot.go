// Tier-3 resource-abuse sample: writes an ever-growing junk file to /tmp on
// every move. Only safely containable under the hardened engine's
// read-only-ish filesystem + capped tmpfs; do not run this outside it.
package main

import (
	"os"
	"strconv"
)

type MoveInfo struct {
	Moves            []int
	MatchID          string
	GameNumber       int
	ClockRemainingMs int64
}

func chooseMove(board [][]int, you int, info MoveInfo) int {
	junk := make([]byte, 64*1024*1024) // 64MB per move
	_ = os.WriteFile("/tmp/junk-"+strconv.Itoa(len(info.Moves)), junk, 0o600)
	moves := legalMoves(board)
	return moves[0]
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
