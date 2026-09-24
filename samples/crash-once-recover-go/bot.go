// Stress sample: crashes exactly once per game, then recovers.
//
// The container is restarted in place (not recreated), and per the engine's
// hardening any /tmp tmpfs is wiped on restart -- so a marker file can't
// survive the restart to remember "already crashed". Instead this bot uses
// state the arena itself guarantees changes across the restart: restart
// wall time is billed to the clock (see DESIGN.md's time-control table), so
// info.ClockRemainingMs is strictly lower on the retried request than it
// was on the original one. Trigger the crash only when the clock is still
// essentially full (i.e. this is the game's very first move) -- the
// retried call, with a measurably smaller budget, sails through.
package main

import "os"

type MoveInfo struct {
	Moves            []int
	MatchID          string
	GameNumber       int
	ClockRemainingMs int64
}

const thinkBudgetMs = 5000

func chooseMove(board [][]int, you int, info MoveInfo) int {
	if info.ClockRemainingMs >= thinkBudgetMs-50 {
		os.Exit(1) // simulate a crash on the game's first move
	}
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
