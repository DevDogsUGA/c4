//! Sample bot: minimax (depth 4), same algorithm as the TypeScript sample.
//! Thin wrapper: the real search lives in search.rs.
mod search;

pub struct MoveInfo {
    pub moves: Vec<usize>,
    pub match_id: String,
    pub game_number: u32,
    pub clock_remaining_ms: u64,
}

pub fn choose_move(board: &[Vec<u8>], you: u8, _info: &MoveInfo) -> usize {
    search::minimax_move(board, you)
}

pub fn legal_moves(board: &[Vec<u8>]) -> Vec<usize> {
    search::legal_moves(board)
}
