/**
 * Pig, the dice game of greed: on your turn roll a die as often as you like and add the pips, or hold and bank the
 * sum. A one ends the turn and loses its sum. Whoever banks the goal first wins. Two to four seats.
 * State: {scores: number[], turnTotal: number, turn: number, rolls: number[], goal: number, lastRoll: number|null,
 *   busted: boolean, out: boolean[], lastTurn: {seat, rolls: number[], outcome: "hold"|"bust", banked: number}|null}
 * lastTurn keeps the turn finished last, so everyone can follow a guest's quick rolls.
 * A player who leaves a running game is out: the others play on, the last one left wins.
 */

/** The goal when the world does not set another one. */
export const GOAL = 50;

/** Pause before a tavern guest rolls, a little longer than in the other games so everyone sees the dice. */
export const GUEST_DELAY = 1200;

/**
 * A die roll from a random number in [0, 1).
 * @param {() => number} rng
 * @returns {number}
 */
export function d6(rng) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

/**
 * The seat after another one that is still in the game.
 * @param {object} state
 * @param {number} seat
 * @returns {number}
 */
function nextSeat(state, seat) {
  const count = state.scores.length;
  for ( let step = 1; step <= count; step++ ) {
    const i = (seat + step) % count;
    if ( !state.out?.[i] ) return i;
  }
  return seat;
}

export const pig = {
  id: "pig",
  seats: {min: 2, max: 4},
  guests: true,
  guestDelay: GUEST_DELAY,

  /**
   * @param {() => number} rng
   * @param {number} seats
   * @param {{goal?: number}} [options]
   */
  init(rng, seats, {goal=GOAL}={}) {
    return {scores: Array(seats).fill(0), turnTotal: 0, turn: 0, rolls: [], goal, lastRoll: null, busted: false,
      out: Array(seats).fill(false), lastTurn: null};
  },

  moves(state, seat) {
    if ( (seat !== state.turn) || state.out?.[seat] || this.outcome(state).done ) return [];
    return state.turnTotal > 0 ? ["roll", "hold"] : ["roll"];
  },

  /**
   * "roll" or "hold".
   * @param {object} state
   * @param {number} seat
   * @param {string} move
   * @param {() => number} rng
   */
  play(state, seat, move, rng) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    const next = {...state, scores: [...state.scores], rolls: [...state.rolls], busted: false};
    const pass = () => {
      next.turnTotal = 0;
      next.rolls = [];
      next.turn = nextSeat(next, seat);
    };
    if ( move === "hold" ) {
      next.lastTurn = {seat, rolls: [...state.rolls], outcome: "hold", banked: state.turnTotal};
      next.scores[seat] += state.turnTotal;
      next.lastRoll = null;
      if ( next.scores[seat] < next.goal ) pass();
      else next.turnTotal = 0;
      return next;
    }
    const roll = d6(rng);
    next.lastRoll = roll;
    if ( roll === 1 ) {
      next.lastTurn = {seat, rolls: [...state.rolls, roll], outcome: "bust", banked: 0};
      next.busted = true;
      pass();
      return next;
    }
    next.turnTotal = state.turnTotal + roll;
    next.rolls.push(roll);
    return next;
  },

  outcome(state) {
    const winner = state.scores.findIndex((s, i) => (s >= state.goal) && !state.out?.[i]);
    if ( winner >= 0 ) return {done: true, winners: [winner], draw: false};
    const left = state.scores.map((_, i) => i).filter(i => !state.out?.[i]);
    if ( left.length === 1 ) return {done: true, winners: left, draw: false};
    return {done: false, winners: [], draw: false};
  },

  /**
   * A player leaves the running game: out of the game, the turn passes on when it was theirs.
   * @param {object} state
   * @param {number} seat
   * @returns {object}
   */
  forfeit(state, seat) {
    const next = {...state, scores: [...state.scores], rolls: [...state.rolls],
      out: state.out ? [...state.out] : Array(state.scores.length).fill(false)};
    next.out[seat] = true;
    if ( next.turn === seat ) {
      Object.assign(next, {turnTotal: 0, rolls: [], lastRoll: null, busted: false});
      next.turn = nextSeat(next, seat);
    }
    return next;
  },

  /** Holds at a sum that grows with the guest's nerve; holds when the sum wins the game. */
  ai(state, seat, level, rng) {
    if ( state.turnTotal === 0 ) return "roll";
    if ( (state.scores[seat] + state.turnTotal) >= state.goal ) return "hold";
    const limit = {easy: 8 + Math.floor(rng() * 6), medium: 15, hard: 20}[level] ?? 15;
    // A hard guest who falls far behind takes more risk
    const lead = Math.max(0, ...state.scores.filter((_, i) => (i !== seat) && !state.out?.[i])) - state.scores[seat];
    const target = (level === "hard") && (lead > 20) ? limit + 6 : limit;
    return state.turnTotal >= target ? "hold" : "roll";
  }
};
