// Sample bot: alpha-beta (depth ~7) with move ordering. Thin wrapper: the
// real search lives in search.go.
package main

// MoveInfo mirrors the template's declaration (see search.go's neighbors);
// kept here because this file replaces the template's bot.go wholesale.
type MoveInfo struct {
	Moves            []int
	MatchID          string
	GameNumber       int
	ClockRemainingMs int64
}

func chooseMove(board [][]int, you int, info MoveInfo) int {
	_ = info
	return alphabetaMove(board, you)
}

func legalMoves(board [][]int) []int {
	return legalMovesFor(board)
}
