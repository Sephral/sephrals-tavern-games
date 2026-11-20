/**
 * Play money for the stakes: where the money comes from. A small adapter per game system reads and writes the purse
 * of a character (dnd5e coins, PF2e coins, Crucible currency). Systems without a known purse, and worlds where the
 * GM chose so, play with chips: the module keeps a balance per user in a world setting and writes nothing to actors.
 * Only the active GM's client writes money. Amounts are whole minor units, see games/stakes.mjs.
 */

import {MODULE_ID, setting, t} from "./config.mjs";
import {addCoins, purseTotal, spendCoins, splitAmount} from "./games/stakes.mjs";

/** The coins shown and paid out in, for every system with coins. */
const SHOW = [{key: "gp", value: 100}, {key: "sp", value: 10}, {key: "cp", value: 1}];

/**
 * An error with a localization key and data for it, which the request answers with.
 * @param {string} key
 * @param {object} [data]
 * @returns {Error}
 */
export function stakeError(key, data) {
  return Object.assign(new Error(key), {data});
}

/* -------------------------------------------- */
/*  The adapters                                */
/* -------------------------------------------- */

/**
 * The coins of D&D 5e with their value in copper pieces, from the system's own exchange rates.
 * @returns {{key: string, value: number}[]}
 */
function dnd5eCoins() {
  const config = CONFIG.DND5E?.currencies ?? {};
  const rates = Object.entries(config).filter(([, c]) => Number(c.conversion) > 0);
  if ( !rates.length ) return [{key: "pp", value: 1000}, {key: "gp", value: 100}, {key: "ep", value: 50}, {key: "sp", value: 10}, {key: "cp", value: 1}];
  const max = Math.max(...rates.map(([, c]) => Number(c.conversion)));
  return rates.map(([key, c]) => ({key, value: Math.round(max / Number(c.conversion))}));
}

/** Money in the coins of a character sheet. Every method takes the actor. */
const dnd5e = {
  id: "dnd5e",
  purse: true,
  mainValue: 100,
  canHold: actor => actor?.type === "character",
  balance: actor => purseTotal(actor.system.currency ?? {}, dnd5eCoins()),
  async charge(actor, amount) {
    const next = spendCoins(actor.system.currency ?? {}, dnd5eCoins(), amount, SHOW);
    if ( !next ) return false;
    await actor.update({"system.currency": next});
    return true;
  },
  async credit(actor, amount) {
    await actor.update({"system.currency": addCoins(actor.system.currency ?? {}, SHOW, amount)});
  }
};

/** Pathfinder 2e: coins are treasure items, the inventory handles them. */
const pf2e = {
  id: "pf2e",
  purse: true,
  mainValue: 100,
  canHold: actor => (actor?.type === "character") && !!actor.inventory?.coins,
  balance: actor => Number(actor.inventory.coins.copperValue) || 0,
  async charge(actor, amount) {
    if ( this.balance(actor) < amount ) return false;
    return !!(await actor.inventory.removeCoins({cp: amount}, {byValue: true}));
  },
  async credit(actor, amount) {
    const coins = {};
    for ( const c of splitAmount(amount, SHOW) ) coins[c.key] = c.count;
    await actor.inventory.addCoins(coins);
  }
};

/** Crucible: one integer, the copper value of everything. */
const crucible = {
  id: "crucible",
  purse: true,
  mainValue: 100,
  canHold: actor => actor?.type === "hero",
  balance: actor => Number(actor.system.currency) || 0,
  async charge(actor, amount) {
    if ( this.balance(actor) < amount ) return false;
    await actor.modifyCurrency(-amount);
    return true;
  },
  async credit(actor, amount) {
    await actor.modifyCurrency(amount);
  }
};

/** Chips: a balance per user in a world setting. Every method takes the user id. */
const chips = {
  id: "chips",
  purse: false,
  mainValue: 1,
  canHold: () => true,
  balance: userId => chipBalance(userId),
  async charge(userId, amount) {
    const have = chipBalance(userId);
    if ( have < amount ) return false;
    await writeChips(userId, have - amount);
    return true;
  },
  async credit(userId, amount) {
    await writeChips(userId, chipBalance(userId) + amount);
  }
};

const ADAPTERS = {dnd5e, pf2e, crucible, chips};

/**
 * The adapter for money in this world: the purse of the game system when the module knows it, else chips. The GM can
 * choose chips everywhere.
 * @returns {object}
 */
export function moneyAdapter() {
  if ( setting("stakeMoney") === "chips" ) return chips;
  return ADAPTERS[game.system.id]?.purse ? ADAPTERS[game.system.id] : chips;
}

/**
 * The adapter a table was opened with.
 * @param {object} table
 * @returns {object}
 */
export function adapterOf(table) {
  return ADAPTERS[table?.stake?.mode] ?? chips;
}

/* -------------------------------------------- */
/*  Chips                                       */
/* -------------------------------------------- */

/**
 * The chips of a user: the stored balance, or the starting stack of a user who never played for chips.
 * @param {string} userId
 * @returns {number}
 */
export function chipBalance(userId) {
  const stored = (setting("chips") ?? {})[userId];
  return Number.isFinite(stored) ? stored : (Number(setting("chipsStart")) || 0);
}

/**
 * Store the chips of a user.
 * @param {string} userId
 * @param {number} amount
 * @returns {Promise<void>}
 */
async function writeChips(userId, amount) {
  await game.settings.set(MODULE_ID, "chips", {...(setting("chips") ?? {}), [userId]: Math.max(Math.floor(amount), 0)});
}

/**
 * Set the chips of a user (GM).
 * @param {string} userId
 * @param {number} amount
 * @returns {Promise<void>}
 */
export async function setChips(userId, amount) {
  if ( !game.user.isGM ) throw stakeError("STG.Error.notGM");
  if ( !game.users.has(userId) || !Number.isFinite(amount) || (amount < 0) ) throw stakeError("STG.Error.failed");
  await writeChips(userId, amount);
}

/* -------------------------------------------- */
/*  Seats                                       */
/* -------------------------------------------- */

/**
 * What holds the money of a seat: the character, or the user for chips.
 * @param {object} adapter
 * @param {object} seat
 * @returns {Actor|string|null}
 */
export function holderOf(adapter, seat) {
  if ( !adapter.purse ) return seat.userId ?? null;
  return seat.actorId ? (game.actors.get(seat.actorId) ?? null) : null;
}

/**
 * The money of a seat in minor units, or null when it cannot be read.
 * @param {object} adapter
 * @param {object} seat
 * @returns {number|null}
 */
export function balanceOf(adapter, seat) {
  const holder = holderOf(adapter, seat);
  if ( !holder ) return null;
  try {
    return adapter.balance(holder);
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not read the money of a seat`, err);
    return null;
  }
}

/**
 * The characters a user may bet with.
 * @param {object} adapter
 * @param {User} user
 * @returns {Actor[]}
 */
export function candidateActors(adapter, user) {
  if ( !adapter.purse ) return [];
  return game.actors.filter(actor => adapter.canHold(actor) && actor.testUserPermission(user, "OWNER"));
}

/**
 * Check the character a user wants to bet with and the money for the stake. Chips need no character.
 * @param {object} adapter
 * @param {User} user
 * @param {string|null} actorId   The chosen character, default the user's own
 * @param {number} amount
 * @returns {{actorId: string|null}}
 */
export function checkSeat(adapter, user, actorId, amount) {
  let id = null;
  if ( adapter.purse ) {
    const actor = game.actors.get(actorId ?? user.character?.id ?? "");
    if ( !actor || !adapter.canHold(actor) ) throw stakeError("STG.Error.noPurse");
    if ( !actor.testUserPermission(user, "OWNER") ) throw stakeError("STG.Error.notYourCharacter", {name: actor.name});
    id = actor.id;
  }
  const have = balanceOf(adapter, {userId: user.id, actorId: id});
  if ( !(have >= amount) ) throw stakeError("STG.Error.cantAfford", {name: id ? game.actors.get(id).name : user.name});
  return {actorId: id};
}

/**
 * Take the stake of every player at a table into escrow (active GM). Everything or nothing: when one cannot pay, what
 * was taken goes back.
 * @param {object} table   With seats and `stake: {amount, mode}`
 * @returns {Promise<number[]>}   What every seat paid
 */
export async function chargeSeats(table) {
  const adapter = adapterOf(table);
  const amount = table.stake.amount;
  const paid = table.seats.map(() => 0);
  try {
    for ( const [i, seat] of table.seats.entries() ) {
      if ( (seat.kind !== "user") || seat.left ) continue;
      const holder = holderOf(adapter, seat);
      if ( !holder ) throw stakeError("STG.Error.noPurse");
      const user = game.users.get(seat.userId);
      if ( adapter.purse && user && !holder.testUserPermission(user, "OWNER") ) {
        throw stakeError("STG.Error.notYourCharacter", {name: holder.name});
      }
      if ( !(await adapter.charge(holder, amount)) ) throw stakeError("STG.Error.cantAfford", {name: adapter.purse ? holder.name : seat.name});
      paid[i] = amount;
    }
  } catch(err) {
    await creditSeats(table, paid).catch(e => console.error(`${MODULE_ID} | Could not return a stake`, e));
    throw err;
  }
  return paid;
}

/**
 * Pay money out to the seats (active GM).
 * @param {object} table
 * @param {number[]} amounts   Per seat
 * @returns {Promise<void>}
 */
export async function creditSeats(table, amounts) {
  const adapter = adapterOf(table);
  for ( const [i, seat] of table.seats.entries() ) {
    const amount = amounts[i] ?? 0;
    if ( (seat.kind !== "user") || !(amount > 0) ) continue;
    const holder = holderOf(adapter, seat);
    if ( !holder ) throw stakeError("STG.Error.noPurse");
    await adapter.credit(holder, amount);
  }
}

/* -------------------------------------------- */
/*  Words                                       */
/* -------------------------------------------- */

/**
 * An amount as text: coins for a purse, chips otherwise.
 * @param {number} amount
 * @param {object} [adapter]
 * @returns {string}
 */
export function formatMoney(amount, adapter=moneyAdapter()) {
  if ( !adapter.purse ) return t(amount === 1 ? "STG.Money.chip" : "STG.Money.chips", {count: amount});
  const parts = splitAmount(amount, SHOW).map(c => `${c.count} ${t(`STG.Money.${c.key}`)}`);
  return parts.length ? parts.join(" ") : `0 ${t("STG.Money.gp")}`;
}
