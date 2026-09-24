//! Minimax (depth 4) with a simple positional heuristic. Kept out of
//! bot.rs so bot.rs stays a thin wrapper.

const DEPTH: i32 = 4;
const WIDTH: usize = 8;
const HEIGHT: usize = 8;
const DIRS: [(i32, i32); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];

pub fn legal_moves(board: &[Vec<u8>]) -> Vec<usize> {
    board
        .iter()
        .enumerate()
        .filter(|(_, column)| *column.last().unwrap() == 0)
        .map(|(col, _)| col)
        .collect()
}

fn drop(board: &[Vec<u8>], col: usize, piece: u8) -> Vec<Vec<u8>> {
    let mut next = board.to_vec();
    if let Some(row) = next[col].iter().position(|&c| c == 0) {
        next[col][row] = piece;
    }
    next
}

fn count_dir(board: &[Vec<u8>], col: i32, row: i32, dc: i32, dr: i32, piece: u8) -> i32 {
    let mut count = 0;
    let mut c = col;
    let mut r = row;
    while c >= 0 && (c as usize) < WIDTH && r >= 0 && (r as usize) < HEIGHT && board[c as usize][r as usize] == piece {
        count += 1;
        c += dc;
        r += dr;
    }
    count
}

fn wins(board: &[Vec<u8>], piece: u8) -> bool {
    for col in 0..WIDTH {
        for row in 0..HEIGHT {
            if board[col][row] != piece {
                continue;
            }
            for (dc, dr) in DIRS {
                if count_dir(board, col as i32, row as i32, dc, dr, piece) >= 4 {
                    return true;
                }
            }
        }
    }
    false
}

fn heuristic(board: &[Vec<u8>], me: u8, opp: u8) -> i64 {
    let mut score: i64 = 0;
    let center = (WIDTH as f64 - 1.0) / 2.0;
    for col in 0..WIDTH {
        for row in 0..HEIGHT {
            let cell = board[col][row];
            if cell == 0 {
                continue;
            }
            let sign: i64 = if cell == me { 1 } else { -1 };
            score += sign * (4.0 - (col as f64 - center).abs()) as i64;
            for (dc, dr) in DIRS {
                let run = count_dir(board, col as i32, row as i32, dc, dr, cell);
                if run >= 2 {
                    score += sign * (run as i64) * (run as i64);
                }
            }
        }
    }
    score
}

fn minimax(board: &[Vec<u8>], depth: i32, maximizing: bool, me: u8, opp: u8, mut alpha: i64, mut beta: i64) -> i64 {
    if wins(board, me) {
        return 1_000_000 - depth as i64;
    }
    if wins(board, opp) {
        return -1_000_000 + depth as i64;
    }
    let moves = legal_moves(board);
    if moves.is_empty() || depth == 0 {
        return heuristic(board, me, opp);
    }

    if maximizing {
        let mut best = i64::MIN;
        for col in moves {
            let value = minimax(&drop(board, col, me), depth - 1, false, me, opp, alpha, beta);
            best = best.max(value);
            alpha = alpha.max(value);
            if alpha >= beta {
                break;
            }
        }
        best
    } else {
        let mut best = i64::MAX;
        for col in moves {
            let value = minimax(&drop(board, col, opp), depth - 1, true, me, opp, alpha, beta);
            best = best.min(value);
            beta = beta.min(value);
            if alpha >= beta {
                break;
            }
        }
        best
    }
}

pub fn minimax_move(board: &[Vec<u8>], you: u8) -> usize {
    let opp = if you == 1 { 2 } else { 1 };
    let moves = legal_moves(board);
    let mut best_col = moves[0];
    let mut best_score = i64::MIN;
    for col in moves {
        let score = minimax(&drop(board, col, you), DEPTH - 1, false, you, opp, i64::MIN, i64::MAX);
        if score > best_score {
            best_score = score;
            best_col = col;
        }
    }
    best_col
}
