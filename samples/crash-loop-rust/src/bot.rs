//! Stress sample: unbounded recursion (stack overflow) once the game has a
//! few moves in it. The process dies every time this board shape recurs, so
//! after enough restarts the clock drains -> game_forfeit(crash_loop).

pub struct MoveInfo {
    pub moves: Vec<usize>,
    pub match_id: String,
    pub game_number: u32,
    pub clock_remaining_ms: u64,
}

#[inline(never)]
fn blow_the_stack(depth: u64) -> u64 {
    // No base case: guaranteed SIGSEGV from stack exhaustion. `depth` is
    // threaded through (and returned) purely so the compiler can't prove
    // this is unreachable and optimize it away.
    1 + blow_the_stack(depth + 1)
}

pub fn choose_move(board: &[Vec<u8>], _you: u8, info: &MoveInfo) -> usize {
    if info.moves.len() >= 3 {
        blow_the_stack(0);
    }
    legal_moves(board)[0]
}

pub fn legal_moves(board: &[Vec<u8>]) -> Vec<usize> {
    board
        .iter()
        .enumerate()
        .filter(|(_, column)| *column.last().unwrap() == 0)
        .map(|(col, _)| col)
        .collect()
}
