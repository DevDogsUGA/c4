//! Reference conformance algorithm (see packages/samples/src/conformance/SPEC.md).
//! Negamax without pruning, depth 4 plies. Integers only, no floats, no randomness.

const COLS: usize = 8;
const ROWS: usize = 8;
const WIN: i64 = 1_000_000;

pub fn legal_moves(board: &[Vec<u8>]) -> Vec<usize> {
    (0..COLS).filter(|&c| board[c][ROWS - 1] == 0).collect()
}

fn drop_piece(board: &mut [Vec<u8>], c: usize, player: u8) -> usize {
    for r in 0..ROWS {
        if board[c][r] == 0 {
            board[c][r] = player;
            return r;
        }
    }
    panic!("column {c} is full");
}

const DIRECTIONS: [(i32, i32); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];

fn is_winning_move(board: &[Vec<u8>], c: usize, r: usize, player: u8) -> bool {
    for &(dc, dr) in DIRECTIONS.iter() {
        let mut count = 1;
        let mut cc = c as i32 + dc;
        let mut rr = r as i32 + dr;
        while cc >= 0 && cc < COLS as i32 && rr >= 0 && rr < ROWS as i32 && board[cc as usize][rr as usize] == player {
            count += 1;
            cc += dc;
            rr += dr;
        }
        cc = c as i32 - dc;
        rr = r as i32 - dr;
        while cc >= 0 && cc < COLS as i32 && rr >= 0 && rr < ROWS as i32 && board[cc as usize][rr as usize] == player {
            count += 1;
            cc -= dc;
            rr -= dr;
        }
        if count >= 4 {
            return true;
        }
    }
    false
}

fn window_score(cells: [u8; 4], you: u8, opponent: u8) -> i32 {
    let k = cells.iter().filter(|&&cell| cell == you).count();
    let m = cells.iter().filter(|&&cell| cell == opponent).count();
    if m == 0 {
        return match k {
            3 => 5,
            2 => 2,
            _ => 0,
        };
    }
    if k == 0 {
        return match m {
            3 => -4,
            2 => -1,
            _ => 0,
        };
    }
    0
}

pub fn leaf_eval(board: &[Vec<u8>], you: u8) -> i32 {
    let opponent = if you == 1 { 2 } else { 1 };
    let mut score: i32 = 0;

    for r in 0..ROWS {
        for c in 0..=COLS - 4 {
            score += window_score([board[c][r], board[c + 1][r], board[c + 2][r], board[c + 3][r]], you, opponent);
        }
    }
    for c in 0..COLS {
        for r in 0..=ROWS - 4 {
            score += window_score([board[c][r], board[c][r + 1], board[c][r + 2], board[c][r + 3]], you, opponent);
        }
    }
    for c in 0..=COLS - 4 {
        for r in 0..=ROWS - 4 {
            score += window_score(
                [board[c][r], board[c + 1][r + 1], board[c + 2][r + 2], board[c + 3][r + 3]],
                you,
                opponent,
            );
        }
    }
    for c in 0..=COLS - 4 {
        for r in (3..ROWS).rev() {
            score += window_score(
                [board[c][r], board[c + 1][r - 1], board[c + 2][r - 2], board[c + 3][r - 3]],
                you,
                opponent,
            );
        }
    }

    for &c in [3usize, 4usize].iter() {
        for r in 0..ROWS {
            if board[c][r] == you {
                score += 3;
            } else if board[c][r] == opponent {
                score -= 3;
            }
        }
    }

    score
}

fn negamax(board: &[Vec<u8>], player: u8, you: u8, ply: i32) -> i64 {
    let moves = legal_moves(board);
    if moves.is_empty() {
        return 0;
    }

    let mut best = i64::MIN;
    for c in moves {
        let mut child: Vec<Vec<u8>> = board.to_vec();
        let row = drop_piece(&mut child, c, player);
        let score: i64 = if is_winning_move(&child, c, row, player) {
            WIN - ply as i64
        } else if legal_moves(&child).is_empty() {
            0
        } else if ply == 4 {
            let raw = leaf_eval(&child, you) as i64;
            if player == you {
                raw
            } else {
                -raw
            }
        } else {
            let opponent = if player == 1 { 2 } else { 1 };
            -negamax(&child, opponent, you, ply + 1)
        };
        if score > best {
            best = score;
        }
    }
    best
}

pub fn choose_move(board: &[Vec<u8>], you: u8) -> usize {
    let moves = legal_moves(board);
    if moves.is_empty() {
        return 0;
    }

    let mut best_col = moves[0];
    let mut best_score = i64::MIN;
    for c in moves {
        let mut child: Vec<Vec<u8>> = board.to_vec();
        let row = drop_piece(&mut child, c, you);
        let score: i64 = if is_winning_move(&child, c, row, you) {
            WIN - 1
        } else if legal_moves(&child).is_empty() {
            0
        } else {
            let opponent = if you == 1 { 2 } else { 1 };
            -negamax(&child, opponent, you, 2)
        };
        if score > best_score {
            best_score = score;
            best_col = c;
        }
    }
    best_col
}
