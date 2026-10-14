/**
 * Twenty-one against the house: one to four players draw cards against the dealer, a tavern guest. Closest to 21
 * without going over wins; aces count 1 or 11, faces 10. The dealer draws to 17. One deck of 52 cards.
 * The dealer's second card is face down until the players are done: publicState() hides it, restore() deals a new one
 * when the GM's client lost it (a face down card nobody has seen is as good as any other).
 * State: {hands: string[][], stood: boolean[], busted: boolean[], turn: number|null, dealer: (string|null)[],
 *   phase: "players"|"done", results: ("win"|"lose"|"push")[], left: boolean[]}
 * A player who leaves the running hand loses it; the others play on against the dealer.
 */

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = ["S", "H", "D", "C"];
export const DECK = SUITS.flatMap(s => RANKS.map(r => `${r}${s}`));

/**
 * The best total of some cards, and whether an ace counts 11 in it.
 * @param {string[]} cards
 * @returns {{total: number, soft: boolean}}
 */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for ( const card of cards.filter(Boolean) ) {
    const rank = card.slice(0, -1);
    if ( rank === "A" ) {
      aces++;
      total += 1;
    }
    else total += ["J", "Q", "K"].includes(rank) ? 10 : Number(rank);
  }
  const soft = (aces > 0) && ((total + 10) <= 21);
  return {total: soft ? total + 10 : total, soft};
}

/**
 * Draw a card that is not on the table yet.
 * @param {string[]} used
 * @param {() => number} rng
 * @returns {string}
 */
export function drawCard(used, rng) {
  const left = DECK.filter(card => !used.includes(card));
  return left[Math.floor(rng() * left.length) % left.length];
}

/**
 * Every card on the table.
 * @param {object} state
 * @returns {string[]}
 */
function onTable(state) {
  return [...state.hands.flat(), ...state.dealer].filter(Boolean);
}

/**
 * The next player who still draws, or null.
 * @param {object} state
 * @param {number} from
 * @returns {number|null}
 */
function nextTurn(state, from) {
  for ( let i = from; i < state.hands.length; i++ ) if ( !state.stood[i] ) return i;
  return null;
}

/**
 * The dealer plays and the hands are compared.
 * @param {object} state
 * @param {() => number} rng
 */
function finish(state, rng) {
  // The dealer only draws when a player is still in the game
  if ( state.busted.some((b, i) => !b && !state.left?.[i]) ) {
    while ( handValue(state.dealer).total < 17 ) state.dealer.push(drawCard(onTable(state), rng));
  }
  const dealer = handValue(state.dealer).total;
  state.results = state.hands.map((hand, i) => {
    if ( state.busted[i] || state.left?.[i] ) return "lose";
    const mine = handValue(hand).total;
    if ( (dealer > 21) || (mine > dealer) ) return "win";
    return (mine === dealer) ? "push" : "lose";
  });
  state.phase = "done";
  state.turn = null;
}

export const twentyone = {
  id: "twentyone",
  seats: {min: 1, max: 4},
  guests: false,
  dealer: true,

  init(rng, seats) {
    const state = {hands: Array.from({length: seats}, () => []), stood: Array(seats).fill(false),
      busted: Array(seats).fill(false), turn: 0, dealer: [], phase: "players", results: [], left: Array(seats).fill(false)};
    for ( let round = 0; round < 2; round++ ) {
      for ( const hand of state.hands ) hand.push(drawCard(onTable(state), rng));
      state.dealer.push(drawCard(onTable(state), rng));
    }
    // Twenty-one with the first two cards stands at once
    state.hands.forEach((hand, i) => {
      if ( handValue(hand).total === 21 ) state.stood[i] = true;
    });
    state.turn = nextTurn(state, 0);
    if ( state.turn === null ) finish(state, rng);
    return state;
  },

  moves(state, seat) {
    if ( (state.phase !== "players") || (state.turn !== seat) ) return [];
    return ["hit", "stand"];
  },

  play(state, seat, move, rng) {
    if ( !this.moves(state, seat).includes(move) ) throw new Error("STG.Error.illegal");
    const next = structuredClone(state);
    if ( move === "hit" ) {
      next.hands[seat].push(drawCard(onTable(next), rng));
      const total = handValue(next.hands[seat]).total;
      if ( total > 21 ) {
        next.busted[seat] = true;
        next.stood[seat] = true;
      }
      else if ( total === 21 ) next.stood[seat] = true;
    }
    else next.stood[seat] = true;
    next.turn = next.stood[seat] ? nextTurn(next, seat + 1) : seat;
    if ( next.turn === null ) finish(next, rng);
    return next;
  },

  /**
   * A player leaves the running hand: it is lost, the turn passes on when it was theirs.
   * @param {object} state
   * @param {number} seat
   * @param {() => number} rng
   * @returns {object}
   */
  forfeit(state, seat, rng) {
    if ( state.phase === "done" ) return structuredClone(state);
    const next = structuredClone(state);
    next.left ??= Array(next.hands.length).fill(false);
    next.left[seat] = true;
    next.stood[seat] = true;
    if ( next.turn === seat ) next.turn = nextTurn(next, seat + 1);
    if ( next.turn === null ) finish(next, rng);
    return next;
  },

  outcome(state) {
    if ( state.phase !== "done" ) return {done: false, winners: [], draw: false};
    const winners = state.results.map((r, i) => (r === "win" ? i : null)).filter(i => i !== null);
    return {done: true, winners, draw: !winners.length && state.results.every(r => r === "push"), results: state.results};
  },

  /** The table without the dealer's face down card. */
  publicState(state) {
    if ( state.phase === "done" ) return state;
    return {...state, dealer: [state.dealer[0], null]};
  },

  /** A full state from the public one, dealing a new face down card if needed. */
  restore(state, rng) {
    if ( (state.phase === "done") || state.dealer[1] ) return structuredClone(state);
    const full = structuredClone(state);
    full.dealer[1] = drawCard(onTable(full), rng);
    return full;
  }
};
