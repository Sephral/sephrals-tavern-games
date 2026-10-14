/**
 * Ship, captain and crew: each player has three throws of five dice. A six is the ship, then a five the captain, then a
 * four the crew, and they must come in that order; dice found are set aside. With ship, captain and crew aboard, the
 * two other dice are the cargo, and the player may throw them again or stop. Without a crew there is no cargo. Every
 * player has one turn, the richest cargo wins; equal cargo shares the win. Two to four seats.
 * Moves: "roll" and "stop". State: {scores: (number|null)[], turn: number, throws: number, dice: number[],
 *   ship: boolean, captain: boolean, crew: boolean, out: boolean[], last: {seat, score}|null}
 */

/** Throws per turn. */
export const THROWS = 3;

/**
 * A die roll.
 * @param {() => number} rng
 * @returns {number}
 */
function d6(rng) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

/**
 * The cargo of a turn: the sum of the two free dice once the crew is aboard, else 0.
 * @param {object} state
 * @returns {number}
 */
export function cargo(state) {
  return state.crew ? state.dice.reduce((a, b) => a + b, 0) : 0;
}

/**
 * The first seat from a seat on that still has to play, or null.
 * @param {object} state
 * @param {number} from
 * @returns {number|null}
 */
function nextToPlay(state, from) {
  for ( let i = from; i < state.scores.length; i++ ) if ( (state.scores[i] === null) && !state.out[i] ) return i;
  return null;
}

/**
 * End the turn of a seat with its cargo and hand the dice on.
 * @param {object} state
 * @param {number} seat
 * @param {number|null} score
 */
function endTurn(state, seat, score) {
  state.scores[seat] = score;
  state.last = {seat, score};
  Object.assign(state, {throws: 0, dice: [], ship: false, captain: false, crew: false});
  state.turn = nextToPlay(state, seat + 1);
}

export const ship = {
  id: "ship",
  seats: {min: 2, max: 4},
  guests: true,

  init(rng, seats) {
    return {scores: Array(seats).fill(null), turn: 0, throws: 0, dice: [], ship: false, captain: false, crew: false,
      out: Array(seats).fill(false), last: null};
  },

  moves(state, seat) {
    if ( (state.turn === null) || (seat !== state.turn) || state.out[seat] ) return [];
    const list = state.throws < THROWS ? ["roll"] : [];
    if ( state.crew && (state.throws > 0) ) list.push("stop");
    return list;
  },

  play(state, seat, move, rng) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    const next = structuredClone(state);
    if ( move === "stop" ) {
      endTurn(next, seat, cargo(next));
      return next;
    }
    const free = 5 - [next.ship, next.captain, next.crew].filter(Boolean).length;
    const dice = Array.from({length: free}, () => d6(rng));
    // Ship, captain and crew in this order, each takes one die
    for ( const [key, face] of [["ship", 6], ["captain", 5], ["crew", 4]] ) {
      if ( next[key] ) continue;
      const i = dice.indexOf(face);
      if ( i < 0 ) break;
      next[key] = true;
      dice.splice(i, 1);
    }
    next.dice = dice.sort((a, b) => b - a);
    next.throws += 1;
    if ( next.throws >= THROWS ) endTurn(next, seat, cargo(next));
    return next;
  },

  outcome(state) {
    const playing = state.scores.map((_, i) => i).filter(i => !state.out[i]);
    if ( playing.some(i => state.scores[i] === null) && (playing.length > 1) ) return {done: false, winners: [], draw: false};
    if ( playing.length === 1 ) return {done: true, winners: playing, draw: false};
    const best = Math.max(...playing.map(i => state.scores[i]));
    const winners = playing.filter(i => state.scores[i] === best);
    return {done: true, winners, draw: winners.length > 1};
  },

  /** A player leaves: no cargo for them, the next one takes the dice. */
  forfeit(state, seat) {
    const next = structuredClone(state);
    next.out[seat] = true;
    if ( next.turn === seat ) {
      Object.assign(next, {throws: 0, dice: [], ship: false, captain: false, crew: false});
      next.turn = nextToPlay(next, seat + 1);
    }
    return next;
  },

  /**
   * Throw on until the crew is aboard. easy: stops at seven or more, medium: at eight or more, hard: stops when the
   * cargo beats everyone before and is good enough against those still to come.
   */
  ai(state, seat, level) {
    if ( !state.crew || (state.throws === 0) ) return "roll";
    if ( state.throws >= THROWS ) return "stop";
    const value = cargo(state);
    const best = Math.max(0, ...state.scores.filter((s, i) => (s !== null) && (i !== seat) && !state.out[i]));
    const toCome = state.scores.filter((s, i) => (s === null) && (i !== seat) && !state.out[i]).length;
    if ( level === "easy" ) return value >= 7 ? "stop" : "roll";
    if ( level === "medium" ) return (value >= 8) && (value >= best) ? "stop" : "roll";
    if ( value < best ) return "roll";
    if ( !toCome ) return value > best ? "stop" : "roll";
    return value >= (toCome > 1 ? 9 : 8) ? "stop" : "roll";
  }
};
