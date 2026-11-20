/**
 * Mia, the old bluffing game with two dice (shown as Mia, Mäxchen in German, also known as Meier or Mexico; the id stays "mexico"). Whoever is up shakes two
 * dice under a cup, looks at them alone and announces a value that must beat the announcement before, true or not.
 * The next player either believes it, shakes their own dice and announces something higher, or calls the lie. The
 * cup is lifted: when the announcement holds (the dice are worth at least as much), the caller loses a life, else the
 * announcer does. A real Mexico costs the caller two lives. The loser opens the next round. Whoever loses the last
 * life is out, the last one with lives wins. Two to four seats.
 *
 * Values, lowest to highest: the mixed throws by their higher die first (31, 32, 41 ... 65), then the pairs (11 to
 * 66), and 21, the Mexico, on top. A value is written as a two digit number, the higher die first (the Mexico as 21).
 * Moves: "a:<value>" announce, "believe", "call".
 * State: {lives: number[], out: boolean[], turn: number, phase: "decide"|"announce", announced: {value, seat}|null,
 *   cup: {seat, dice: number[]|null}, rollId: string, round: number, reveal: object|null}
 * The dice under the cup are the secret: publicState() drops them, the GM's client keeps them and tells the owner of
 * the cup on request. restore() shakes the cup again when the GM's client lost it.
 */

/** Lives per player at the start. */
export const LIVES = 3;

/** All values, lowest to highest. */
export const VALUES = [31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, 11, 22, 33, 44, 55, 66, 21];

/** The value that beats everything. */
export const MEXICO = 21;

/**
 * A die roll.
 * @param {() => number} rng
 * @returns {number}
 */
function d6(rng) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

/**
 * The value two dice are worth.
 * @param {number[]} dice
 * @returns {number}
 */
export function valueOf(dice) {
  const [a, b] = [...dice].sort((x, y) => y - x);
  return ((a === 2) && (b === 1)) ? MEXICO : (a * 10) + b;
}

/**
 * The rank of a value: 0 for the lowest, 20 for the Mexico. -1 when it is no value.
 * @param {number} value
 * @returns {number}
 */
export function rank(value) {
  return VALUES.indexOf(Number(value));
}

/**
 * Whether a value beats another one. Anything beats no announcement.
 * @param {number} value
 * @param {number|null} last
 * @returns {boolean}
 */
export function beats(value, last) {
  return (last === null) || (last === undefined) || (rank(value) > rank(last));
}

/**
 * The chance that two dice are worth at least a value.
 * @param {number} value
 * @returns {number}
 */
export function chanceAtLeast(value) {
  const need = rank(value);
  if ( need < 0 ) return 0;
  let n = 0;
  for ( let a = 1; a <= 6; a++ ) for ( let b = 1; b <= 6; b++ ) if ( rank(valueOf([a, b])) >= need ) n++;
  return n / 36;
}

/**
 * Parse an announcement move.
 * @param {string} move
 * @returns {number|null}
 */
export function parseAnnounce(move) {
  const m = /^a:(\d\d)$/.exec(String(move));
  return (m && (rank(Number(m[1])) >= 0)) ? Number(m[1]) : null;
}

/**
 * A short id for one shake of the cup.
 * @param {() => number} rng
 * @returns {string}
 */
function rollId(rng) {
  return Math.floor(rng() * 1e9).toString(36);
}

/**
 * Shake the dice of a seat under the cup.
 * @param {object} state
 * @param {number} seat
 * @param {() => number} rng
 */
function shake(state, seat, rng) {
  state.cup = {seat, dice: [d6(rng), d6(rng)]};
  state.rollId = rollId(rng);
}

/**
 * The next seat after another one that still has lives.
 * @param {object} state
 * @param {number} seat
 * @returns {number}
 */
function nextSeat(state, seat) {
  const count = state.lives.length;
  for ( let step = 1; step <= count; step++ ) {
    const i = (seat + step) % count;
    if ( state.lives[i] > 0 ) return i;
  }
  return seat;
}

/**
 * A new round: the seat shakes its dice and announces first.
 * @param {object} state
 * @param {number} seat
 * @param {() => number} rng
 */
function newRound(state, seat, rng) {
  state.announced = null;
  state.phase = "announce";
  state.turn = seat;
  shake(state, seat, rng);
}

export const mexico = {
  id: "mexico",
  seats: {min: 2, max: 4},
  guests: true,
  hidden: true,

  init(rng, seats) {
    const state = {lives: Array(seats).fill(LIVES), out: Array(seats).fill(false), turn: 0, phase: "announce",
      announced: null, cup: null, rollId: "", round: 1, reveal: null};
    shake(state, 0, rng);
    return state;
  },

  moves(state, seat) {
    if ( (seat !== state.turn) || (state.lives[seat] <= 0) || this.outcome(state).done ) return [];
    const last = state.announced?.value ?? null;
    if ( state.phase === "decide" ) return (last === MEXICO) ? ["call"] : ["believe", "call"];
    return VALUES.filter(v => beats(v, last)).map(v => `a:${v}`);
  },

  play(state, seat, move, rng) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    const next = structuredClone(state);
    if ( move === "believe" ) {
      shake(next, seat, rng);
      next.phase = "announce";
      return next;
    }
    if ( move !== "call" ) {
      next.announced = {value: parseAnnounce(move), seat};
      next.turn = nextSeat(next, seat);
      next.phase = "decide";
      return next;
    }
    // Lift the cup
    const announced = state.announced;
    const actual = valueOf(state.cup.dice);
    const holds = rank(actual) >= rank(announced.value);
    const loser = holds ? seat : announced.seat;
    const loss = (holds && (announced.value === MEXICO)) ? 2 : 1;
    next.reveal = {dice: [...state.cup.dice], announced: {...announced}, caller: seat, actual, holds, loser, loss,
      round: state.round};
    next.lives[loser] = Math.max(0, next.lives[loser] - loss);
    if ( next.lives[loser] === 0 ) next.out[loser] = true;
    next.round = state.round + 1;
    if ( this.outcome(next).done ) {
      next.announced = null;
      next.cup = {seat: loser, dice: null};
      next.turn = nextSeat(next, loser);
      return next;
    }
    newRound(next, next.lives[loser] > 0 ? loser : nextSeat(next, loser), rng);
    return next;
  },

  outcome(state) {
    const alive = state.lives.map((n, i) => (n > 0 ? i : null)).filter(i => i !== null);
    if ( alive.length === 1 ) return {done: true, winners: alive, draw: false};
    if ( !alive.length ) return {done: true, winners: [], draw: true};
    return {done: false, winners: [], draw: false};
  },

  /** A player leaves: out of the game. When the turn or the announcement was theirs, the next player opens a round. */
  forfeit(state, seat, rng) {
    const next = structuredClone(state);
    next.lives[seat] = 0;
    next.out[seat] = true;
    if ( this.outcome(next).done ) {
      next.announced = null;
      next.cup = {seat: next.cup?.seat ?? 0, dice: null};
      return next;
    }
    if ( (state.turn === seat) || (state.announced?.seat === seat) ) {
      next.round = state.round + 1;
      newRound(next, nextSeat(next, seat), rng);
    }
    return next;
  },

  /** The table without the dice under the cup. */
  publicState(state) {
    return {...state, cup: state.cup ? {seat: state.cup.seat, dice: null} : null};
  },

  /** The full state from the public one: the cup is shaken again, the announcement stays. */
  restore(state, rng) {
    const full = structuredClone(state);
    if ( this.outcome(full).done ) return full;
    shake(full, full.cup?.seat ?? full.turn, rng);
    return full;
  },

  /**
   * The dice a seat may see: only the owner of the cup.
   * @param {object} state   Full state
   * @param {number} seat
   * @returns {number[]}
   */
  peek(state, seat) {
    return (state.cup?.seat === seat) ? [...(state.cup.dice ?? [])] : [];
  },

  /**
   * The guests know their own dice and weigh the odds of the announcement before. easy: believes much, bluffs rarely,
   * medium: calls what is unlikely and bluffs when it has to, hard: weighs the odds and mixes in bluffs.
   */
  ai(state, seat, level, rng) {
    const legal = this.moves(state, seat);
    const pick = move => (legal.includes(move) ? move : legal[0]);
    const last = state.announced?.value ?? null;
    if ( state.phase === "decide" ) {
      const limit = {easy: 0.12, medium: 0.3, hard: 0.4}[level] ?? 0.3;
      const p = chanceAtLeast(last);
      // A guest who is not sharp calls now and then on a whim
      const whim = (level === "easy") && (rng() < 0.1);
      return pick(((p < limit) || whim || !legal.includes("believe")) ? "call" : "believe");
    }
    const mine = valueOf(state.cup?.dice ?? [1, 3]);
    const higher = VALUES.filter(v => beats(v, last));
    const above = (steps) => higher[Math.min(higher.length - 1, Math.floor(rng() * (steps + 1)))];
    let say = mine;
    if ( !beats(mine, last) ) {
      // The throw does not beat the announcement: bluff just above it, a bit further when sharp
      say = above({easy: 3, medium: 1, hard: 2}[level] ?? 1);
    }
    else if ( level === "hard" ) {
      // Sometimes keep the throw small, sometimes inflate it by a step
      const roll = rng();
      const index = higher.indexOf(mine);
      if ( (roll < 0.25) && (index > 0) ) say = higher[Math.floor(rng() * index)];
      else if ( (roll > 0.8) && (index < higher.length - 1) && (mine !== MEXICO) ) say = higher[index + 1];
    }
    else if ( (level === "medium") && (last === null) && (rank(mine) < 4) ) say = above(4);
    return pick(`a:${say}`);
  }
};
