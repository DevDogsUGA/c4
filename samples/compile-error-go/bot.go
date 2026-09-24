// Stress sample: deliberate syntax error -> `go build` fails -> the Docker
// image build fails -> match_forfeit(build_failed) for this team.
package main

func chooseMove(board [][]int, you int, info MoveInfo) int {
	this is not valid go syntax :(
}
