/**
 * Stakes with play money: the pure rules. Nothing here touches Foundry.
 *
 * Money is counted in whole "minor units": copper pieces where a purse has coins, single chips otherwise. A stake is
 * paid into escrow when a game starts and settled when it ends:
 *  - twenty-one: every player bets the stake against the house. A win pays 1:1, a natural (21 with the first two
 *    cards) pays 3:2 (rounded down), a tie returns the stake, a loss goes to the house.
 *  - liar's dice and Mexico: everyone puts the stake into the pot, the tavern guests too (the house pays for them), the winner
 *    takes the pot. When nobody wins the stakes are returned.
 * A game takes part by an entry in RULES: a function from the finished table to what every seat gets back.
 */

import {handValue} from "./twentyone.mjs";

/** Largest stake the tavern accepts, in minor units. */
export const STAKE_MAX = 1000000000;

/**
 * Whether a number is a usable stake.
 * @param {*} amount
 * @returns {boolean}
 */
export function validStake(amount) {
  return Number.isInteger(amount) && (amount >= 1) && (amount <= STAKE_MAX);
}

/**
 * A stake typed in the main unit (for example gold pieces), as minor units. Null when it is no usable stake.
 * @param {*} input
 * @param {number} mainValue   Minor units in one main unit (100 for gold pieces counted in copper, 1 for chips)
 * @returns {number|null}
 */
export function parseStake(input, mainValue=1) {
  const n = Number(String(input ?? "").replace(",", "."));
  if ( !Number.isFinite(n) ) return null;
  const amount = Math.round(n * mainValue);
  return validStake(amount) ? amount : null;
}

/* -------------------------------------------- */
/*  Coins                                       */
/* -------------------------------------------- */

/**
 * The value of a purse in minor units.
 * @param {Record<string, number>} purse
 * @param {{key: string, value: number}[]} denoms
 * @returns {number}
 */
export function purseTotal(purse, denoms) {
  return denoms.reduce((sum, d) => sum + ((Number(purse?.[d.key]) || 0) * d.value), 0);
}

/**
 * Split an amount into coins, the largest first.
 * @param {number} amount
 * @param {{key: string, value: number}[]} denoms   Coins to use
 * @returns {{key: string, count: number}[]}
 */
export function splitAmount(amount, denoms) {
  const list = [];
  let rest = Math.max(Math.floor(amount), 0);
  for ( const d of [...denoms].sort((a, b) => b.value - a.value) ) {
    const count = Math.floor(rest / d.value);
    if ( count > 0 ) list.push({key: d.key, count});
    rest -= count * d.value;
  }
  return list;
}

/**
 * Take an amount out of a purse. The smallest coins go first; when a bigger coin has to be broken, the change comes
 * back in the payout coins. Null when the purse holds less.
 * @param {Record<string, number>} purse
 * @param {{key: string, value: number}[]} denoms   All coins of the system, with their value in minor units
 * @param {number} amount
 * @param {{key: string, value: number}[]} [change]   Coins the change is made in (default all)
 * @returns {Record<string, number>|null}   The new purse
 */
export function spendCoins(purse, denoms, amount, change=denoms) {
  if ( purseTotal(purse, denoms) < amount ) return null;
  const coins = Object.fromEntries(denoms.map(d => [d.key, Math.max(Math.floor(Number(purse?.[d.key]) || 0), 0)]));
  const asc = [...denoms].sort((a, b) => a.value - b.value);
  let rest = amount;
  for ( const d of asc ) {
    const take = Math.min(coins[d.key], Math.floor(rest / d.value));
    coins[d.key] -= take;
    rest -= take * d.value;
  }
  if ( rest > 0 ) {
    // Break the smallest coin that is left, it is worth more than what is still owed
    const d = asc.find(x => coins[x.key] > 0);
    if ( !d ) return null;
    coins[d.key] -= 1;
    for ( const c of splitAmount(d.value - rest, change) ) coins[c.key] += c.count;
  }
  return {...purse, ...coins};
}

/**
 * Add an amount to a purse in the payout coins.
 * @param {Record<string, number>} purse
 * @param {{key: string, value: number}[]} payout
 * @param {number} amount
 * @returns {Record<string, number>}
 */
export function addCoins(purse, payout, amount) {
  const next = {...purse};
  for ( const c of splitAmount(amount, payout) ) next[c.key] = (Number(next[c.key]) || 0) + c.count;
  return next;
}

/* -------------------------------------------- */
/*  Payouts                                     */
/* -------------------------------------------- */

/**
 * What a bet at twenty-one pays on top of the returned stake.
 * @param {number} stake
 * @param {boolean} natural
 * @returns {number}
 */
export function twentyoneWin(stake, natural) {
  return natural ? Math.floor((stake * 3) / 2) : stake;
}

/**
 * Whether a hand is a natural: 21 with exactly two cards.
 * @param {string[]} hand
 * @returns {boolean}
 */
export function isNatural(hand) {
  return (hand?.length === 2) && (handValue(hand).total === 21);
}

/**
 * Twenty-one: the stake of every player against the house.
 * @param {object} table   A finished table: seats, state and result
 * @param {number} stake
 * @returns {{pot: number, credits: number[], net: number[]}}
 */
function twentyone(table, stake) {
  const results = table.result?.results ?? table.state?.results ?? [];
  const credits = [];
  const net = [];
  table.seats.forEach((seat, i) => {
    if ( seat.kind !== "user" ) {
      credits.push(0);
      net.push(0);
      return;
    }
    const result = seat.left ? "lose" : (results[i] ?? "lose");
    if ( result === "win" ) {
      const gain = twentyoneWin(stake, isNatural(table.state?.hands?.[i]));
      credits.push(stake + gain);
      net.push(gain);
    }
    else if ( result === "push" ) {
      credits.push(stake);
      net.push(0);
    }
    else {
      credits.push(0);
      net.push(-stake);
    }
  });
  return {pot: 0, credits, net};
}

/**
 * Liar's dice: the pot goes to the winner.
 * @param {object} table
 * @param {number} stake
 * @returns {{pot: number, credits: number[], net: number[]}}
 */
function liars(table, stake) {
  const pot = stake * table.seats.length;
  const winners = table.result?.winners ?? [];
  const credits = table.seats.map(() => 0);
  const net = table.seats.map(seat => (seat.kind === "user" ? -stake : 0));
  if ( !winners.length ) {
    // Nobody won: everyone gets the stake back, the house its own
    table.seats.forEach((seat, i) => {
      if ( seat.kind === "user" ) {
        credits[i] = stake;
        net[i] = 0;
      }
    });
    return {pot, credits, net};
  }
  const share = Math.floor(pot / winners.length);
  for ( const i of winners ) {
    if ( table.seats[i].kind !== "user" ) continue;
    credits[i] = share;
    net[i] = share - stake;
  }
  return {pot, credits, net};
}

/** The games that can be played for a stake, with the function that settles a finished table. */
export const RULES = {twentyone, liars, mexico: liars};

/** The games whose stakes go into one pot for the winner. */
const POT_GAMES = ["liars", "mexico"];

/**
 * Whether a game can be played for a stake.
 * @param {string} gameId
 * @returns {boolean}
 */
export function stakeGame(gameId) {
  return gameId in RULES;
}

/**
 * What every seat gets back from the escrow when a table is finished. The credits are paid out to the users, the
 * house keeps the rest. `net` is the gain or loss of a seat.
 * @param {object} table   Finished table with `stake.amount`
 * @returns {{pot: number, credits: number[], net: number[]}|null}
 */
export function settleStake(table) {
  const stake = table?.stake?.amount;
  if ( !validStake(stake) || !RULES[table.game] ) return null;
  return RULES[table.game](table, stake);
}

/**
 * The pot at a table that runs: what the winner of liar's dice or Mexico takes.
 * @param {object} table
 * @returns {number}
 */
export function potOf(table) {
  const stake = table?.stake?.amount;
  return POT_GAMES.includes(table?.game) && validStake(stake) ? stake * table.seats.length : 0;
}

/**
 * Whether a user's stake at a table is in escrow and not settled or returned yet.
 * @param {object} table
 * @returns {boolean}
 */
export function hasEscrow(table) {
  return !!table?.stake?.paid?.some(n => n > 0) && !table.stake.payout && !table.stake.refunded;
}
