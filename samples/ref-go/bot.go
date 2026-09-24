// Reference conformance sample bot (Go). Thin wrapper: all the algorithm
// lives in search.go (see packages/samples/src/conformance/SPEC.md).
package main

// MoveInfo carries extra per-move context, passed as chooseMove's third
// argument. Kept here (unchanged from the template) since server.go
// references it as a top-level type in package main.
type MoveInfo struct {
	Moves            []int
	MatchID          string
	GameNumber       int
	ClockRemainingMs int64
}

func chooseMove(board [][]int, you int, info MoveInfo) int {
	return searchChooseMove(board, you)
}

func legalMoves(board [][]int) []int {
	return searchLegalMoves(board)
}
