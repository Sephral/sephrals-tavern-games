/**
 * Liar's dice: everybody shakes five dice under a cup and looks only at their own. In turn each player bids how many
 * dice of one face lie on the whole table, always higher than the bid before (more dice, or as many of a higher face),
 * or calls the last bid a lie. Then all cups are lifted: when the bid holds, the caller loses a die, otherwise the
 * bidder. The loser begins the next round. Whoever loses the last die is out, the last one with dice wins.
 * Two to four seats. Moves: "b:<count>:<face>" bid, "call" call the lie.
 * State: {dice: number[][], counts: number[], turn: number, bid: {count, face, seat}|null, round: number,
 *   rollId: string, reveal: object|null, out: boolean[]}
 * Nobody may see the dice of the others: publicState() drops them, the GM's client keeps them and tells each player
 * their own dice on request. restore() shakes the cups again when the GM's client lost them.
 */

/** Dice per player at the start. */
export const DICE = 5;

/**
 * A die roll.
 * @param {() => number} rng
 * @returns {number}
 */
function d6(rng) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

/**
 * A short id for one shake of the cups.
 * @param {() => number} rng
 * @returns {string}
 */
function rollId(rng) {
  return Math.floor(rng() * 1e9).toString(36);
}

/**
 * Shake every cup that still holds dice.
 * @param {object} state
 * @param {() => number} rng
 */
function shake(state, rng) {
  state.dice = state.counts.map(n => Array.from({length: n}, () => d6(rng)).sort((a, b) => a - b));
  state.rollId = rollId(rng);
}

/**
 * The next seat after another one that still has dice.
 * @param {object} state
 * @param {number} seat
 * @returns {number}
 */
function nextSeat(state, seat) {
  const count = state.counts.length;
  for ( let step = 1; step <= count; step++ ) {
    const i = (seat + step) % count;
    if ( state.counts[i] > 0 ) return i;
  }
  return seat;
}

/**
 * Whether a bid is higher than another.
 * @param {{count: number, face: number}} bid
 * @param {{count: number, face: number}|null} last
 * @returns {boolean}
 */
export function higher(bid, last) {
  if ( !last ) return true;
  return (bid.count > last.count) || ((bid.count === last.count) && (bid.face > last.face));
}

/**
 * Parse a bid move.
 * @param {string} move
 * @returns {{count: number, face: number}|null}
 */
export function parseBid(move) {
  const m = /^b:(\d+):([1-6])$/.exec(String(move));
  return m ? {count: Number(m[1]), face: Number(m[2])} : null;
}

/**
 * The chance that at least `need` of `n` unknown dice show one face.
 * @param {number} n
 * @param {number} need
 * @returns {number}
 */
export function chanceAtLeast(n, need) {
  if ( need <= 0 ) return 1;
  if ( need > n ) return 0;
  let p = 0;
  let comb = 1;
  for ( let k = 0; k <= n; k++ ) {
    if ( k > 0 ) comb = (comb * (n - k + 1)) / k;
    if ( k >= need ) p += comb * ((1 / 6) ** k) * ((5 / 6) ** (n - k));
  }
  return p;
}

export const liars = {
  id: "liars",
  seats: {min: 2, max: 4},
  guests: true,
  hidden: true,

  init(rng, seats) {
    const state = {dice: [], counts: Array(seats).fill(DICE), turn: 0, bid: null, round: 1, rollId: "",
      reveal: null, out: Array(seats).fill(false)};
    shake(state, rng);
    return state;
  },

  moves(state, seat) {
    if ( (seat !== state.turn) || (state.counts[seat] <= 0) || this.outcome(state).done ) return [];
    const total = state.counts.reduce((a, b) => a + b, 0);
    const list = [];
    for ( let count = 1; count <= total; count++ ) {
      for ( let face = 1; face <= 6; face++ ) if ( higher({count, face}, state.bid) ) list.push(`b:${count}:${face}`);
    }
    if ( state.bid ) list.push("call");
    return list;
  },

  play(state, seat, move, rng) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    const next = structuredClone(state);
    if ( move !== "call" ) {
      const bid = parseBid(move);
      next.bid = {...bid, seat};
      next.turn = nextSeat(next, seat);
      return next;
    }
    // Lift the cups
    const bid = state.bid;
    const shown = state.dice.flat().filter(d => d === bid.face).length;
    const holds = shown >= bid.count;
    const loser = holds ? seat : bid.seat;
    next.reveal = {dice: structuredClone(state.dice), bid: {...bid}, caller: seat, shown, holds, loser, round: state.round};
    next.counts[loser] = Math.max(0, next.counts[loser] - 1);
    if ( next.counts[loser] === 0 ) next.out[loser] = true;
    next.bid = null;
    next.round = state.round + 1;
    next.turn = next.counts[loser] > 0 ? loser : nextSeat(next, loser);
    shake(next, rng);
    return next;
  },

  outcome(state) {
    const alive = state.counts.map((n, i) => (n > 0 ? i : null)).filter(i => i !== null);
    if ( alive.length === 1 ) return {done: true, winners: alive, draw: false};
    if ( !alive.length ) return {done: true, winners: [], draw: true};
    return {done: false, winners: [], draw: false};
  },

  /** A player leaves: out of the game, the cups are shaken again and the next player opens. */
  forfeit(state, seat, rng) {
    const next = structuredClone(state);
    next.counts[seat] = 0;
    next.out[seat] = true;
    if ( this.outcome(next).done ) {
      next.dice = next.counts.map(() => []);
      return next;
    }
    next.bid = null;
    next.round = state.round + 1;
    next.turn = (state.turn === seat) || (state.bid?.seat === seat) ? nextSeat(next, seat) : state.turn;
    shake(next, rng);
    return next;
  },

  /** The table without anybody's dice. */
  publicState(state) {
    const {dice, ...rest} = state;
    return {...rest, dice: null};
  },

  /** The full state from the public one: the cups are shaken again. */
  restore(state, rng) {
    const full = structuredClone(state);
    shake(full, rng);
    return full;
  },

  /**
   * The dice a seat may see.
   * @param {object} state   Full state
   * @param {number} seat
   * @returns {number[]}
   */
  peek(state, seat) {
    return [...(state.dice?.[seat] ?? [])];
  },

  /**
   * The guests know their own dice and guess the rest. easy: bids on a whim and calls late, medium: weighs the odds
   * roughly, hard: weighs the odds exactly and bluffs a little.
   */
  ai(state, seat, level, rng) {
    const own = state.dice[seat] ?? [];
    const total = state.counts.reduce((a, b) => a + b, 0);
    const unknown = total - own.length;
    const ownOf = face => own.filter(d => d === face).length;
    const chance = (count, face) => chanceAtLeast(unknown, count - ownOf(face));
    const last = state.bid;
    // Call the lie when the last bid is unlikely
    if ( last ) {
      const p = chance(last.count, last.face);
      const limit = {easy: 0.15, medium: 0.35, hard: 0.45}[level] ?? 0.35;
      if ( p < limit ) return "call";
    }
    // The opening bid: the face one holds most of, as many as one holds plus a fair share of the others' dice
    if ( !last ) {
      const faces = [6, 5, 4, 3, 2, 1].sort((a, b) => ownOf(b) - ownOf(a));
      const face = level === "easy" ? faces[Math.floor(rng() * 3) % 3] : faces[0];
      const count = Math.max(1, ownOf(face) + Math.floor(unknown / 6) - (level === "hard" ? 0 : 1));
      return `b:${Math.min(count, total)}:${face}`;
    }
    // The cheapest higher bid of every face, with its chance
    const options = [];
    for ( let face = 1; face <= 6; face++ ) {
      const count = (face > last.face) ? last.count : last.count + 1;
      if ( count > total ) continue;
      options.push({count, face, p: chance(count, face)});
    }
    if ( !options.length ) return "call";
    if ( level === "easy" ) {
      const pick = options[Math.floor(rng() * options.length) % options.length];
      return `b:${pick.count}:${pick.face}`;
    }
    options.sort((a, b) => (b.p - a.p) || (a.count - b.count));
    // A hard guest sometimes bluffs with the second best face
    const choice = (level === "hard") && (options.length > 1) && (options[1].p > 0.5) && (rng() < 0.2) ? options[1] : options[0];
    if ( choice.p < 0.3 ) return "call";
    return `b:${choice.count}:${choice.face}`;
  }
};
