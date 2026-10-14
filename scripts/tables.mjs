/**
 * The tables of the tavern. The active GM's client runs every table: it checks each request, plays the moves of the
 * tavern guests and keeps the tables in a world setting, which every client shows. Hidden cards (the dealer's face
 * down card in twenty-one) stay in the GM's memory and never go into the setting.
 */

import {MODULE_ID, esc, setting, t as loc} from "./config.mjs";
import {GUESTS, gameOffered, game as rules, publicState} from "./games/index.mjs";

/** Finished tables kept in the list. */
const KEEP_DONE = 8;

/** Pause before a tavern guest moves, so everyone can follow. */
const GUEST_DELAY = 900;

/** Full states with hidden information, by table id (active GM only). */
const full = new Map();

/** Requests run one after another. */
let queue = Promise.resolve();

/**
 * A random number in [0, 1), the same source Foundry's dice use.
 * @returns {number}
 */
function rng() {
  return (CONFIG.Dice?.randomUniform ?? Math.random)();
}

/**
 * The tables as stored.
 * @returns {object[]}
 */
export function tables() {
  return foundry.utils.deepClone(setting("tables") ?? []);
}

/**
 * One table.
 * @param {string} id
 * @returns {object|null}
 */
export function tableById(id) {
  return tables().find(table => table.id === id) ?? null;
}

/**
 * Write the tables.
 * @param {object[]} list
 * @returns {Promise<void>}
 */
async function save(list) {
  // Drop old finished tables
  const done = list.filter(table => table.status === "done").sort((a, b) => b.updated - a.updated);
  const drop = new Set(done.slice(KEEP_DONE).map(table => table.id));
  await game.settings.set(MODULE_ID, "tables", list.filter(table => !drop.has(table.id)));
}

/**
 * Change one table and write it.
 * @param {string} id
 * @param {(table: object) => object|null} change   Returns the new table, or null to remove it
 * @returns {Promise<object|null>}
 */
async function update(id, change) {
  const list = tables();
  const index = list.findIndex(table => table.id === id);
  if ( index < 0 ) throw new Error("STG.Error.tableGone");
  const next = change(list[index]);
  if ( next ) list[index] = {...next, updated: Date.now()};
  else list.splice(index, 1);
  await save(list);
  return next;
}

/**
 * The seat of a user.
 * @param {User} user
 * @returns {object}
 */
function userSeat(user) {
  return {kind: "user", userId: user.id, name: user.character?.name || user.name,
    img: user.character?.img || user.avatar || "icons/svg/mystery-man.svg"};
}

/**
 * The seat of a tavern guest.
 * @param {string} guestId
 * @returns {object}
 */
function guestSeat(guestId) {
  const guest = GUESTS[guestId];
  if ( !guest ) throw new Error("STG.Error.unknownGuest");
  return {kind: "guest", guest: guestId, level: guest.level, img: guest.img};
}

/**
 * The full state of a table, restored if the GM's client lost it.
 * @param {object} table
 * @returns {object}
 */
function fullState(table) {
  const g = rules(table.game);
  if ( !full.has(table.id) ) {
    full.set(table.id, g.restore ? g.restore(table.state, rng) : structuredClone(table.state));
    // Cups shaken again: the table tells the players, so they ask for their new dice
    if ( g.hidden ) queue = queue.then(() => syncPublic(table.id)).catch(() => {});
  }
  return full.get(table.id);
}

/**
 * Write the public state of a table from the full one.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function syncPublic(id) {
  const table = tableById(id);
  if ( !table || (table.status !== "playing") || !full.has(id) ) return;
  const g = rules(table.game);
  await update(id, t => ({...t, state: publicState(g, full.get(id))}));
}

/**
 * Start a game at a table: a new state, everyone in place.
 * @param {object} table
 * @returns {object}
 */
function start(table) {
  const g = rules(table.game);
  const state = g.init(rng, table.seats.length, {goal: setting("pigGoal")});
  full.set(table.id, state);
  return {...table, status: "playing", state: publicState(g, state), result: null, started: Date.now()};
}

/**
 * Apply a move and see whether the game ended.
 * @param {object} table
 * @param {number} seat
 * @param {*} move
 * @returns {object}
 */
function apply(table, seat, move) {
  const g = rules(table.game);
  return settle({...table, lastMove: {seat, move}}, g.play(fullState(table), seat, move, rng));
}

/**
 * Store a new state of a table and see whether the game ended.
 * @param {object} table
 * @param {object} state
 * @returns {object}
 */
function settle(table, state) {
  const g = rules(table.game);
  full.set(table.id, state);
  const outcome = g.outcome(state);
  const next = {...table, state: publicState(g, state)};
  if ( outcome.done ) {
    next.status = "done";
    next.result = outcome;
    full.delete(table.id);
  }
  return next;
}

/* -------------------------------------------- */
/*  Names and chat messages                     */
/* -------------------------------------------- */

/**
 * The name of a seat on this client.
 * @param {object} seat
 * @returns {string}
 */
export function seatName(seat) {
  return seat?.kind === "guest" ? loc(`STG.Guest.${seat.guest}.name`) : (seat?.name ?? "?");
}

/**
 * Post a chat message, as the world chose.
 * @param {string} kind     "invite" or "result"
 * @param {string} body
 * @returns {Promise<void>}
 */
async function postCard(kind, body) {
  const mode = setting("chatCards");
  if ( (mode === "off") || ((mode === "results") && (kind !== "result")) ) return;
  await ChatMessage.implementation.create({content: `<div class="stg-chat">${body}</div>`,
    speaker: {alias: loc("STG.Card.speaker")}, flags: {[MODULE_ID]: {card: kind}}});
}

/**
 * The result line of a finished table.
 * @param {object} table
 * @returns {string}
 */
export function resultText(table) {
  const names = table.seats.map(seatName);
  const gameName = loc(`STG.Game.${table.game}.name`);
  const r = table.result;
  if ( !r ) return "";
  if ( table.game === "twentyone" ) {
    return r.results.map((res, i) => loc(`STG.Result.twentyone.${res}`, {name: names[i]})).join(" · ");
  }
  if ( r.draw ) return loc("STG.Result.draw", {names: names.join(", "), game: gameName});
  const winner = names[r.winners[0]];
  const others = names.filter((_, i) => !r.winners.includes(i));
  return loc("STG.Result.win", {winner, others: others.join(", "), game: gameName});
}

/**
 * Tell the table about a finished game.
 * @param {object} table
 * @returns {Promise<void>}
 */
async function postResult(table) {
  await postCard("result", `<p class="stg-card-title"><i class="fa-solid fa-trophy" inert></i> ${esc(loc(`STG.Game.${table.game}.name`))}</p>`
    + `<p>${esc(resultText(table))}</p><button type="button" data-stg-open="${esc(table.id)}"><i class="fa-solid fa-beer-mug-empty" inert></i> `
    + `${esc(loc("STG.Card.open"))}</button>`);
}

/* -------------------------------------------- */
/*  Requests                                    */
/* -------------------------------------------- */

const ok = (extra={}) => ({ok: true, ...extra});
const fail = error => ({ok: false, error});

/**
 * Handle a request (active GM).
 * @param {string} action
 * @param {object} payload
 * @param {User} user
 * @returns {Promise<object>}
 */
export function handleRequest(action, payload, user) {
  const run = queue.then(async () => {
    const fn = ACTIONS[action];
    if ( !fn ) return fail("STG.Error.unknownAction");
    try {
      return await fn(payload ?? {}, user);
    } catch(err) {
      const key = String(err?.message ?? "");
      if ( key.startsWith("STG.") ) return fail(key);
      console.error(`${MODULE_ID} | ${action} failed`, err);
      return fail("STG.Error.failed");
    }
  });
  queue = run.catch(() => {});
  // The guests move after the answer, so the player's click is not held up
  run.then(result => {
    if ( result?.ok && result.tableId ) guestTurns(result.tableId);
  });
  return run;
}

/**
 * Seat index of a user at a table.
 * @param {object} table
 * @param {User} user
 * @returns {number}
 */
function seatOf(table, user) {
  return table.seats.findIndex(seat => (seat.kind === "user") && (seat.userId === user.id));
}

const ACTIONS = {

  /** Open a table, against a guest or waiting for other players. */
  async create({game: gameId, guest}, user) {
    const g = rules(gameId);
    if ( !gameOffered(gameId, setting("disabledGames")) ) return fail("STG.Error.gameOff");
    const seats = [userSeat(user)];
    if ( guest && g.guests ) seats.push(guestSeat(guest));
    let table = {id: foundry.utils.randomID(), game: gameId, host: user.id, status: "open", seats, state: null,
      result: null, created: Date.now(), updated: Date.now(), round: 1};
    // Against a guest the game starts at once; at twenty-one a guest means playing alone against the house
    const ready = !!guest;
    if ( ready ) table = start(table);
    await save([...tables(), table]);
    if ( !ready ) {
      await postCard("invite", `<p class="stg-card-title"><i class="fa-solid fa-beer-mug-empty" inert></i> `
        + `${esc(loc("STG.Card.invite", {name: seatName(seats[0]), game: loc(`STG.Game.${gameId}.name`)}))}</p>`
        + `<button type="button" data-stg-join="${esc(table.id)}"><i class="fa-solid fa-chair" inert></i> ${esc(loc("STG.Table.join"))}</button>`);
    }
    return ok({tableId: table.id});
  },

  /** Take a seat at an open table; a two player table starts when it is full. */
  async join({tableId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( table.status !== "open" ) return fail("STG.Error.notOpen");
    if ( seatOf(table, user) >= 0 ) return fail("STG.Error.seated");
    const g = rules(table.game);
    if ( table.seats.length >= g.seats.max ) return fail("STG.Error.full");
    const next = await update(tableId, t => {
      const seated = {...t, seats: [...t.seats, userSeat(user)]};
      return (seated.seats.length >= g.seats.max) && (g.seats.max === 2) ? start(seated) : seated;
    });
    return ok({tableId: next.id});
  },

  /** Host: a tavern guest takes a free seat (games for more than two). */
  async addGuest({tableId, guest}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( (table.host !== user.id) && !user.isGM ) return fail("STG.Error.notHost");
    const g = rules(table.game);
    if ( (table.status !== "open") || !g.guests ) return fail("STG.Error.notOpen");
    if ( table.seats.length >= g.seats.max ) return fail("STG.Error.full");
    await update(tableId, t => {
      const seated = {...t, seats: [...t.seats, guestSeat(guest)]};
      return (seated.seats.length >= g.seats.max) && (g.seats.max === 2) ? start(seated) : seated;
    });
    return ok({tableId});
  },

  /** Host: start with the seats taken. */
  async start({tableId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( (table.host !== user.id) && !user.isGM ) return fail("STG.Error.notHost");
    if ( table.status !== "open" ) return fail("STG.Error.notOpen");
    if ( table.seats.length < rules(table.game).seats.min ) return fail("STG.Error.tooFew");
    await update(tableId, start);
    return ok({tableId});
  },

  /** A move of the player whose turn it is. */
  async move({tableId, move}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( table.status !== "playing" ) return fail("STG.Error.notPlaying");
    const seat = seatOf(table, user);
    if ( seat < 0 ) return fail("STG.Error.notSeated");
    if ( !rules(table.game).moves(fullState(table), seat).includes(move) ) return fail("STG.Error.illegal");
    const next = await update(tableId, t => apply(t, seat, move));
    if ( next.status === "done" ) await postResult(next);
    return ok({tableId});
  },

  /** Play again with the same seats; in games for two the other one begins. */
  async rematch({tableId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( table.status !== "done" ) return fail("STG.Error.notDone");
    if ( ((seatOf(table, user) < 0) || table.seats[seatOf(table, user)].left) && !user.isGM ) return fail("STG.Error.notSeated");
    if ( !gameOffered(table.game, setting("disabledGames")) ) return fail("STG.Error.gameOff");
    // Who left the table does not play again
    const stay = table.seats.filter(seat => !seat.left);
    if ( stay.length < rules(table.game).seats.min ) return fail("STG.Error.tooFew");
    await update(tableId, t => {
      const seats = (stay.length === 2) ? [stay[1], stay[0]] : stay;
      return start({...t, seats, round: (t.round ?? 1) + 1});
    });
    return ok({tableId});
  },

  /** Leave a table: an open seat is freed, a running game is lost. */
  async leave({tableId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    const seat = seatOf(table, user);
    if ( seat < 0 ) return fail("STG.Error.notSeated");
    if ( table.status === "open" ) {
      if ( table.host === user.id ) {
        await update(tableId, () => null);
        return ok();
      }
      await update(tableId, t => ({...t, seats: t.seats.filter((_, i) => i !== seat)}));
      return ok({tableId});
    }
    if ( (table.status === "playing") && table.seats[seat].left ) return fail("STG.Error.notSeated");
    const g = rules(table.game);
    // Games for more players go on without whoever leaves, as long as somebody is left to play against the house or
    // another player still sits at the table (the regulars do not play on alone)
    const players = table.seats.filter((s, i) => (i !== seat) && (s.kind === "user") && !s.left).length;
    if ( (table.status === "playing") && g.forfeit && (g.dealer || (players > 0)) ) {
      const next = await update(tableId, t => settle({...t, seats: t.seats.map((s, i) => (i === seat ? {...s, left: true} : s))},
        g.forfeit(fullState(t), seat, rng)));
      if ( next.status === "done" ) await postResult(next);
      return ok({tableId});
    }
    if ( table.status === "playing" ) {
      const winners = table.seats.map((_, i) => i).filter(i => (i !== seat) && !table.seats[i].left);
      const next = await update(tableId, t => ({...t, status: "done", result: {done: true, winners, draw: false,
        forfeit: seat, results: (t.game === "twentyone") ? t.seats.map((_, i) => (i === seat ? "lose" : "push")) : undefined}}));
      full.delete(tableId);
      await postResult(next);
      return ok({tableId});
    }
    return ok({tableId});
  },

  /** The dice under the user's own cup (games with hidden dice). */
  async peek({tableId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    const g = rules(table.game);
    const seat = seatOf(table, user);
    if ( !g.peek || (seat < 0) || (table.status !== "playing") ) return fail("STG.Error.notSeated");
    const state = fullState(table);
    return ok({dice: g.peek(state, seat), round: state.round, rollId: state.rollId});
  },

  /** Host or GM: take the table away. */
  async close({tableId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( (table.host !== user.id) && !user.isGM ) return fail("STG.Error.notHost");
    full.delete(tableId);
    await update(tableId, () => null);
    return ok();
  }
};

/**
 * Let the tavern guests play while it is their turn.
 * @param {string} tableId
 */
async function guestTurns(tableId) {
  for ( let guard = 0; guard < 60; guard++ ) {
    const table = tableById(tableId);
    if ( !table || (table.status !== "playing") || !game.user.isActiveGM ) return;
    const seat = table.state?.turn;
    const occupant = table.seats[seat];
    if ( (seat === null) || (seat === undefined) || (occupant?.kind !== "guest") ) return;
    await new Promise(resolve => setTimeout(resolve, GUEST_DELAY));
    const done = await (queue = queue.then(async () => {
      const current = tableById(tableId);
      if ( !current || (current.status !== "playing") || (current.state.turn !== seat) ) return true;
      const g = rules(current.game);
      const move = g.ai(fullState(current), seat, occupant.level, rng);
      const next = await update(tableId, t => apply(t, seat, move));
      if ( next.status === "done" ) await postResult(next);
      return next.status === "done";
    }).catch(err => {
      console.error(`${MODULE_ID} | A guest's move failed`, err);
      return true;
    }));
    if ( done ) return;
  }
}

/**
 * Active GM after a reload: let the guests continue where they stopped.
 */
export function resumeGuests() {
  if ( !game.user.isActiveGM ) return;
  for ( const table of tables() ) {
    if ( table.status !== "playing" ) continue;
    // Games with hidden dice get their cups back at once
    if ( rules(table.game).hidden ) fullState(table);
    guestTurns(table.id);
  }
}

export const __test__ = {ACTIONS};
