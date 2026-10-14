/**
 * Four in a row on an upright board of 7 columns and 6 rows; pieces fall to the lowest free place. Seat 0 begins.
 * State: {board: (0|1|null)[42] row by row from the top, turn: 0|1, last: number|null}
 */

export const COLS = 7;
export const ROWS = 6;

/**
 * The lowest free cell of a column, or -1.
 * @param {(0|1|null)[]} board
 * @param {number} col
 * @returns {number}
 */
export function dropRow(board, col) {
  for ( let r = ROWS - 1; r >= 0; r-- ) if ( board[(r * COLS) + col] === null ) return r;
  return -1;
}

/**
 * The four cells of a finished line through any cell, or null.
 * @param {(0|1|null)[]} board
 * @returns {number[]|null}
 */
export function winningLine(board) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for ( let r = 0; r < ROWS; r++ ) {
    for ( let c = 0; c < COLS; c++ ) {
      const who = board[(r * COLS) + c];
      if ( who === null ) continue;
      for ( const [dr, dc] of dirs ) {
        const cells = [];
        for ( let k = 0; k < 4; k++ ) {
          const rr = r + (dr * k);
          const cc = c + (dc * k);
          if ( (rr < 0) || (rr >= ROWS) || (cc < 0) || (cc >= COLS) || (board[(rr * COLS) + cc] !== who) ) break;
          cells.push((rr * COLS) + cc);
        }
        if ( cells.length === 4 ) return cells;
      }
    }
  }
  return null;
}

/**
 * The winner: 0, 1, "draw" or null.
 * @param {(0|1|null)[]} board
 * @returns {0|1|"draw"|null}
 */
export function winnerOf(board) {
  const line = winningLine(board);
  if ( line ) return board[line[0]];
  return board.every(cell => cell !== null) ? "draw" : null;
}

/**
 * A rough value of a board for a seat: open windows of four, weighted by how full they are.
 * @param {(0|1|null)[]} board
 * @param {0|1} me
 * @returns {number}
 */
function score(board, me) {
  let total = 0;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for ( let r = 0; r < ROWS; r++ ) {
    for ( let c = 0; c < COLS; c++ ) {
      for ( const [dr, dc] of dirs ) {
        let mine = 0;
        let theirs = 0;
        let ok = true;
        for ( let k = 0; k < 4; k++ ) {
          const rr = r + (dr * k);
          const cc = c + (dc * k);
          if ( (rr < 0) || (rr >= ROWS) || (cc < 0) || (cc >= COLS) ) {
            ok = false;
            break;
          }
          const v = board[(rr * COLS) + cc];
          if ( v === me ) mine++;
          else if ( v !== null ) theirs++;
        }
        if ( !ok || (mine && theirs) ) continue;
        total += [0, 1, 4, 16, 1000][mine] - [0, 1, 5, 20, 1000][theirs];
      }
    }
  }
  // The middle column is worth a little more
  for ( let r = 0; r < ROWS; r++ ) if ( board[(r * COLS) + 3] === me ) total += 3;
  return total;
}

/**
 * Minimax with alpha-beta pruning to a depth.
 * @returns {number}
 */
function search(board, toMove, me, depth, alpha, beta) {
  const w = winnerOf(board);
  if ( w === me ) return 100000 + depth;
  if ( (w !== null) && (w !== "draw") ) return -100000 - depth;
  if ( (w === "draw") || (depth === 0) ) return score(board, me);
  const order = [3, 2, 4, 1, 5, 0, 6];
  if ( toMove === me ) {
    let best = -Infinity;
    for ( const c of order ) {
      const r = dropRow(board, c);
      if ( r < 0 ) continue;
      board[(r * COLS) + c] = toMove;
      best = Math.max(best, search(board, 1 - toMove, me, depth - 1, alpha, beta));
      board[(r * COLS) + c] = null;
      alpha = Math.max(alpha, best);
      if ( alpha >= beta ) break;
    }
    return best;
  }
  let best = Infinity;
  for ( const c of order ) {
    const r = dropRow(board, c);
    if ( r < 0 ) continue;
    board[(r * COLS) + c] = toMove;
    best = Math.min(best, search(board, 1 - toMove, me, depth - 1, alpha, beta));
    board[(r * COLS) + c] = null;
    beta = Math.min(beta, best);
    if ( alpha >= beta ) break;
  }
  return best;
}

export const fourinarow = {
  id: "fourinarow",
  seats: {min: 2, max: 2},
  guests: true,

  init() {
    return {board: Array(COLS * ROWS).fill(null), turn: 0, last: null};
  },

  /** Columns that still take a piece. */
  moves(state, seat) {
    if ( (seat !== state.turn) || (winnerOf(state.board) !== null) ) return [];
    return [...Array(COLS).keys()].filter(c => dropRow(state.board, c) >= 0);
  },

  /** Drop a piece into a column. */
  play(state, seat, move) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    const board = [...state.board];
    const cell = (dropRow(board, move) * COLS) + move;
    board[cell] = seat;
    return {board, turn: 1 - seat, last: cell};
  },

  outcome(state) {
    const w = winnerOf(state.board);
    if ( w === null ) return {done: false, winners: [], draw: false};
    if ( w === "draw" ) return {done: true, winners: [], draw: true};
    return {done: true, winners: [w], draw: false};
  },

  /** easy: mostly random, medium: wins, blocks and thinks two moves ahead, hard: thinks five moves ahead. */
  ai(state, seat, level, rng) {
    const free = this.moves(state, seat);
    const board = [...state.board];
    const pick = list => list[Math.floor(rng() * list.length) % list.length];
    const wins = who => free.find(c => {
      const r = dropRow(board, c);
      board[(r * COLS) + c] = who;
      const done = winnerOf(board) === who;
      board[(r * COLS) + c] = null;
      return done;
    });
    if ( level === "easy" ) {
      const win = wins(seat);
      if ( (win !== undefined) && (rng() < 0.5) ) return win;
      return pick(free);
    }
    const depth = (level === "hard") ? 5 : 2;
    let best = -Infinity;
    let bestMoves = [];
    for ( const c of free ) {
      const r = dropRow(board, c);
      board[(r * COLS) + c] = seat;
      const v = search(board, 1 - seat, seat, depth - 1, -Infinity, Infinity);
      board[(r * COLS) + c] = null;
      if ( v > best ) {
        best = v;
        bestMoves = [c];
      }
      else if ( v === best ) bestMoves.push(c);
    }
    return pick(bestMoves);
  }
};
