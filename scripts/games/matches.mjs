/**
 * The matchstick game (Nim): a row of matches, each turn takes one, two or three, whoever takes the last one loses.
 * Seat 0 begins. State: {left: number, start: number, turn: 0|1, taken: {seat, count}[]}
 */

/** Matches on the table at the start. */
export const START = 15;

export const matches = {
  id: "matches",
  seats: {min: 2, max: 2},
  guests: true,

  init() {
    return {left: START, start: START, turn: 0, taken: []};
  },

  moves(state, seat) {
    if ( (seat !== state.turn) || (state.left <= 0) ) return [];
    return [1, 2, 3].filter(n => n <= state.left);
  },

  play(state, seat, move) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    return {left: state.left - move, start: state.start, turn: 1 - seat, taken: [...state.taken, {seat, count: move}]};
  },

  /** Whoever took the last match lost. */
  outcome(state) {
    if ( state.left > 0 ) return {done: false, winners: [], draw: false};
    const loser = state.taken.at(-1)?.seat ?? 0;
    return {done: true, winners: [1 - loser], draw: false};
  },

  /**
   * hard: leaves a number of the form 4k + 1 whenever it can, medium: does so half of the time, easy: random.
   * @returns {number}
   */
  ai(state, seat, level, rng) {
    const free = this.moves(state, seat);
    const random = () => free[Math.floor(rng() * free.length) % free.length];
    const perfect = (state.left - 1) % 4;
    const good = free.includes(perfect) ? perfect : null;
    if ( level === "hard" ) return good ?? (state.left > 1 ? 1 : free[0]);
    if ( (level === "medium") && (good !== null) && (rng() < 0.5) ) return good;
    // Even an easy guest never takes the last match by choice when another move exists
    const safe = free.filter(n => n < state.left);
    if ( (level === "easy") && safe.length && (rng() < 0.7) ) return safe[Math.floor(rng() * safe.length) % safe.length];
    return random();
  }
};
