/**
 * Nine men's morris: 24 points on three nested squares. Each player places nine men in turn, then moves them along the
 * lines; with only three men left a player may jump to any free point. Three men in a row (a mill) take one man of the
 * other player, preferably one outside a mill. Fewer than three men or no move left loses. Seat 0 (white) begins.
 * Moves are strings: "p:<point>" place, "m:<from>-<to>" move or jump, "r:<point>" take a man after a mill.
 * State: {board: (0|1|null)[24], hand: [number, number], turn: 0|1, phase: "turn"|"remove", last: number[],
 *   quiet: number, mill: number[]|null}
 */

/** Men per player. */
export const MEN = 9;

/** Moves without a man taken before the game is a draw. */
export const QUIET_LIMIT = 60;

/**
 * The points on a grid of 7 by 7: outer, middle and inner square, each clockwise from the top left corner.
 * @type {[number, number][]}
 */
export const POINTS = [
  [0, 0], [3, 0], [6, 0], [6, 3], [6, 6], [3, 6], [0, 6], [0, 3],
  [1, 1], [3, 1], [5, 1], [5, 3], [5, 5], [3, 5], [1, 5], [1, 3],
  [2, 2], [3, 2], [4, 2], [4, 3], [4, 4], [3, 4], [2, 4], [2, 3]
];

/** Neighbours of every point along the lines. */
export const ADJACENT = POINTS.map((_, i) => {
  const ring = Math.floor(i / 8);
  const k = i % 8;
  const list = [(ring * 8) + ((k + 1) % 8), (ring * 8) + ((k + 7) % 8)];
  if ( k % 2 ) {
    if ( ring > 0 ) list.push(i - 8);
    if ( ring < 2 ) list.push(i + 8);
  }
  return list.sort((a, b) => a - b);
});

/** Every mill: three sides per square and four lines across the squares. */
export const MILLS = [
  ...[0, 1, 2].flatMap(ring => [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0]].map(line => line.map(k => (ring * 8) + k))),
  ...[1, 3, 5, 7].map(k => [k, k + 8, k + 16])
];

/**
 * Whether a point is part of a mill of its owner.
 * @param {(0|1|null)[]} board
 * @param {number} point
 * @returns {boolean}
 */
export function inMill(board, point) {
  const who = board[point];
  if ( who === null ) return false;
  return MILLS.some(m => m.includes(point) && m.every(p => board[p] === who));
}

/**
 * The mill closed by a man that just arrived on a point, or null.
 * @param {(0|1|null)[]} board
 * @param {number} point
 * @returns {number[]|null}
 */
export function millAt(board, point) {
  const who = board[point];
  if ( who === null ) return null;
  return MILLS.find(m => m.includes(point) && m.every(p => board[p] === who)) ?? null;
}

/**
 * Men of a seat on the board.
 * @param {object} state
 * @param {number} seat
 * @returns {number}
 */
function onBoard(state, seat) {
  return state.board.filter(cell => cell === seat).length;
}

/**
 * Men of a seat that can be taken: those outside mills, or any when all stand in mills.
 * @param {(0|1|null)[]} board
 * @param {number} seat
 * @returns {number[]}
 */
export function removable(board, seat) {
  const own = board.map((cell, i) => (cell === seat ? i : null)).filter(i => i !== null);
  const free = own.filter(i => !inMill(board, i));
  return free.length ? free : own;
}

/**
 * The placing and moving moves of a seat, without the take after a mill.
 * @param {object} state
 * @param {number} seat
 * @returns {string[]}
 */
function stepMoves(state, seat) {
  const empty = state.board.map((cell, i) => (cell === null ? i : null)).filter(i => i !== null);
  if ( state.hand[seat] > 0 ) return empty.map(i => `p:${i}`);
  const own = state.board.map((cell, i) => (cell === seat ? i : null)).filter(i => i !== null);
  const flying = own.length === 3;
  const list = [];
  for ( const from of own ) {
    const targets = flying ? empty : ADJACENT[from].filter(p => state.board[p] === null);
    for ( const to of targets ) list.push(`m:${from}-${to}`);
  }
  return list;
}

/**
 * Apply a move without checks (also used by the guests' search).
 * @param {object} state
 * @param {number} seat
 * @param {string} move
 * @returns {object}
 */
function applyMove(state, seat, move) {
  const next = {...state, board: [...state.board], hand: [...state.hand], mill: null};
  const [kind, arg] = move.split(":");
  if ( kind === "r" ) {
    const point = Number(arg);
    next.board[point] = null;
    next.phase = "turn";
    next.turn = 1 - seat;
    next.quiet = 0;
    next.last = [point];
    return next;
  }
  let to;
  if ( kind === "p" ) {
    to = Number(arg);
    next.hand[seat] -= 1;
    next.last = [to];
  }
  else {
    const [from, target] = arg.split("-").map(Number);
    to = target;
    next.board[from] = null;
    next.last = [from, to];
  }
  next.board[to] = seat;
  next.quiet = (state.quiet ?? 0) + 1;
  const mill = millAt(next.board, to);
  if ( mill ) {
    next.phase = "remove";
    next.mill = mill;
  }
  else {
    next.phase = "turn";
    next.turn = 1 - seat;
  }
  return next;
}

/**
 * Who won, from the view of the seat to move: a seat with fewer than three men (after placing) or without a move loses.
 * @param {object} state
 * @returns {{done: boolean, winners: number[], draw: boolean}}
 */
function result(state) {
  for ( const seat of [0, 1] ) {
    if ( (state.hand[seat] === 0) && (onBoard(state, seat) < 3) ) return {done: true, winners: [1 - seat], draw: false};
  }
  if ( (state.phase === "turn") && !stepMoves(state, state.turn).length ) {
    return {done: true, winners: [1 - state.turn], draw: false};
  }
  if ( (state.quiet ?? 0) >= QUIET_LIMIT ) return {done: true, winners: [], draw: true};
  return {done: false, winners: [], draw: false};
}

/**
 * A value of a position for a seat: men, men in hand, mills, open twos and freedom to move.
 * @param {object} state
 * @param {number} me
 * @returns {number}
 */
function evaluate(state, me) {
  const r = result(state);
  if ( r.done ) return r.draw ? 0 : (r.winners[0] === me ? 10000 : -10000);
  let score = 0;
  for ( const seat of [0, 1] ) {
    const sign = seat === me ? 1 : -1;
    const men = onBoard(state, seat) + state.hand[seat];
    let open = 0;
    for ( const m of MILLS ) {
      const mine = m.filter(p => state.board[p] === seat).length;
      const empty = m.filter(p => state.board[p] === null).length;
      if ( (mine === 2) && (empty === 1) ) open++;
    }
    const mills = MILLS.filter(m => m.every(p => state.board[p] === seat)).length;
    const mobility = state.hand[seat] > 0 ? 0 : stepMoves(state, seat).length;
    score += sign * ((men * 100) + (mills * 12) + (open * 18) + (Math.min(mobility, 12) * 3));
  }
  // A take pending is worth a man
  if ( state.phase === "remove" ) score += (state.turn === me ? 90 : -90);
  return score;
}

/**
 * Alpha-beta search.
 * @param {object} state
 * @param {number} depth
 * @param {number} alpha
 * @param {number} beta
 * @param {number} me
 * @returns {number}
 */
function search(state, depth, alpha, beta, me) {
  if ( (depth === 0) || result(state).done ) return evaluate(state, me);
  const seat = state.turn;
  const moves = morris.moves(state, seat);
  if ( seat === me ) {
    let best = -Infinity;
    for ( const move of moves ) {
      best = Math.max(best, search(applyMove(state, seat, move), depth - 1, alpha, beta, me));
      alpha = Math.max(alpha, best);
      if ( alpha >= beta ) break;
    }
    return best;
  }
  let best = Infinity;
  for ( const move of moves ) {
    best = Math.min(best, search(applyMove(state, seat, move), depth - 1, alpha, beta, me));
    beta = Math.min(beta, best);
    if ( alpha >= beta ) break;
  }
  return best;
}

export const morris = {
  id: "morris",
  seats: {min: 2, max: 2},
  guests: true,

  init() {
    return {board: Array(24).fill(null), hand: [MEN, MEN], turn: 0, phase: "turn", last: [], quiet: 0, mill: null};
  },

  moves(state, seat) {
    if ( (seat !== state.turn) || result(state).done ) return [];
    if ( state.phase === "remove" ) return removable(state.board, 1 - seat).map(p => `r:${p}`);
    return stepMoves(state, seat);
  },

  play(state, seat, move) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    return applyMove(state, seat, move);
  },

  outcome(state) {
    return result(state);
  },

  /**
   * easy: closes or blocks a mill now and then, otherwise random. medium: looks one move ahead with the value of the
   * position. hard: searches three moves ahead (two while men are placed).
   */
  ai(state, seat, level, rng) {
    const moves = this.moves(state, seat);
    const pick = list => list[Math.floor(rng() * list.length) % list.length];
    if ( level === "easy" ) {
      if ( rng() < 0.5 ) {
        const mill = moves.find(move => applyMove(state, seat, move).phase === "remove");
        if ( mill ) return mill;
      }
      return pick(moves);
    }
    const depth = level === "hard" ? ((state.hand[0] + state.hand[1]) > 6 ? 2 : 3) : 1;
    let best = -Infinity;
    let bestMoves = [];
    for ( const move of moves ) {
      const next = applyMove(state, seat, move);
      // A mill keeps the turn: the take is searched as part of the same move
      const v = search(next, next.turn === seat ? depth : depth - 1, -Infinity, Infinity, seat);
      if ( v > best ) {
        best = v;
        bestMoves = [move];
      }
      else if ( v === best ) bestMoves.push(move);
    }
    return pick(bestMoves.length ? bestMoves : moves);
  }
};

export const __test__ = {applyMove, evaluate, stepMoves};
