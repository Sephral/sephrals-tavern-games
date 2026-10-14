/**
 * Tic-tac-toe on a board of 3 by 3. Seat 0 plays X, seat 1 plays O, X begins. Pure rules without Foundry.
 * State: {board: (0|1|null)[9], turn: 0|1, last: number|null}
 */

/** The lines that win. */
export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

/**
 * The winner of a board: 0, 1, "draw" or null while the game runs.
 * @param {(0|1|null)[]} board
 * @returns {0|1|"draw"|null}
 */
export function winnerOf(board) {
  for ( const [a, b, c] of LINES ) {
    if ( (board[a] !== null) && (board[a] === board[b]) && (board[a] === board[c]) ) return board[a];
  }
  return board.every(cell => cell !== null) ? "draw" : null;
}

/**
 * The winning line, for the board's highlight.
 * @param {(0|1|null)[]} board
 * @returns {number[]|null}
 */
export function winningLine(board) {
  return LINES.find(([a, b, c]) => (board[a] !== null) && (board[a] === board[b]) && (board[a] === board[c])) ?? null;
}

/**
 * Minimax value of a board for a seat: 1 win, 0 draw, -1 loss (perfect play from both).
 * @param {(0|1|null)[]} board
 * @param {0|1} toMove
 * @param {0|1} me
 * @returns {number}
 */
function minimax(board, toMove, me) {
  const w = winnerOf(board);
  if ( w === "draw" ) return 0;
  if ( w !== null ) return (w === me) ? 1 : -1;
  let best = (toMove === me) ? -2 : 2;
  for ( let i = 0; i < 9; i++ ) {
    if ( board[i] !== null ) continue;
    board[i] = toMove;
    const v = minimax(board, 1 - toMove, me);
    board[i] = null;
    best = (toMove === me) ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

export const tictactoe = {
  id: "tictactoe",
  seats: {min: 2, max: 2},
  guests: true,

  /** @returns {object} */
  init() {
    return {board: Array(9).fill(null), turn: 0, last: null};
  },

  /**
   * The moves a seat may make now.
   * @param {object} state
   * @param {number} seat
   * @returns {number[]}
   */
  moves(state, seat) {
    if ( (seat !== state.turn) || (winnerOf(state.board) !== null) ) return [];
    return state.board.map((cell, i) => (cell === null ? i : null)).filter(i => i !== null);
  },

  /**
   * Play a move.
   * @param {object} state
   * @param {number} seat
   * @param {number} move    Cell 0 to 8
   * @returns {object}       The new state
   */
  play(state, seat, move) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    const board = [...state.board];
    board[move] = seat;
    return {board, turn: 1 - seat, last: move};
  },

  /**
   * @param {object} state
   * @returns {{done: boolean, winners: number[], draw: boolean}}
   */
  outcome(state) {
    const w = winnerOf(state.board);
    if ( w === null ) return {done: false, winners: [], draw: false};
    if ( w === "draw" ) return {done: true, winners: [], draw: true};
    return {done: true, winners: [w], draw: false};
  },

  /**
   * A tavern guest's move.
   * @param {object} state
   * @param {number} seat
   * @param {"easy"|"medium"|"hard"} level
   * @param {() => number} rng
   * @returns {number}
   */
  ai(state, seat, level, rng) {
    const free = this.moves(state, seat);
    const pick = list => list[Math.floor(rng() * list.length) % list.length];
    if ( level === "easy" ) return pick(free);
    const board = [...state.board];
    const finishing = who => free.find(i => {
      board[i] = who;
      const done = winnerOf(board) === who;
      board[i] = null;
      return done;
    });
    if ( level === "medium" ) {
      const win = finishing(seat);
      if ( win !== undefined ) return win;
      const block = finishing(1 - seat);
      if ( block !== undefined ) return block;
      if ( free.includes(4) && (rng() < 0.6) ) return 4;
      return pick(free);
    }
    // hard: perfect play, a random one among the best moves
    let best = -2;
    let bestMoves = [];
    for ( const i of free ) {
      board[i] = seat;
      const v = minimax(board, 1 - seat, seat);
      board[i] = null;
      if ( v > best ) {
        best = v;
        bestMoves = [i];
      }
      else if ( v === best ) bestMoves.push(i);
    }
    return pick(bestMoves);
  }
};
