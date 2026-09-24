//! Reference conformance sample bot (Rust). Thin wrapper: all the algorithm
//! lives in search.rs (see packages/samples/src/conformance/SPEC.md).

mod search;

/// Extra per-move context, passed as `choose_move`'s third argument. Kept
/// here (unchanged from the template) since server.rs references it as
/// `bot::MoveInfo`.
#[allow(dead_code)]
pub struct MoveInfo {
    pub moves: Vec<usize>,
    pub match_id: String,
    pub game_number: u32,
    pub clock_remaining_ms: u64,
}

pub fn choose_move(board: &[Vec<u8>], you: u8, _info: &MoveInfo) -> usize {
    search::choose_move(board, you)
}

pub fn legal_moves(board: &[Vec<u8>]) -> Vec<usize> {
    search::legal_moves(board)
}
