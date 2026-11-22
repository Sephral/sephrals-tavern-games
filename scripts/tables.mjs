/**
 * The tables of the tavern. The active GM's client runs every table: it checks each request, plays the moves of the
 * tavern guests and keeps the tables in a world setting, which every client shows. Hidden cards (the dealer's face
 * down card in twenty-one) stay in the GM's memory and never go into the setting.
 */

import {MODULE_ID, esc, setting, t as loc} from "./config.mjs";
import {GAMES, GUESTS, gameOffered, game as rules, publicState} from "./games/index.mjs";
import {cleanRanking, liveSession, newEvening, recordGame, standings, titleFor} from "./games/ranking.mjs";
import {hasEscrow, settleStake, stakeGame, validStake} from "./games/stakes.mjs";
import {adapterOf, checkSeat, chargeSeats, creditSeats, formatMoney, moneyAdapter} from "./stakes.mjs";
import {cleanOffer, newcomersOf, offerAllowed, pickGame} from "./suggest-rules.mjs";
import {countFeature} from "./usage.mjs";

/** Finished tables kept in the list. */
const KEEP_DONE = 8;

/** Usage counters by game, counted once per game started (also a rematch). */
export const GAME_FEATURES = {tictactoe: "gameTictactoe", fourinarow: "gameFourinarow", morris: "gameMorris",
  matches: "gameMatches", pig: "gamePig", ship: "gameShip", liars: "gameLiars", mexico: "gameMexico", twentyone: "gameTwentyone"};

/** Usage counters of the stakes: a table opened with a stake, a stake paid out at the end of a game. */
export const STAKE_FEATURES = {table: "stakeTable", paid: "stakePaid"};

/** Usage counter of the ranking: looked at once per browser session. */
export const RANKING_FEATURES = {viewed: "rankingViewed"};

/** Usage counters of the break suggestion. */
export const OFFER_FEATURES = {offer: "breakOffer", join: "breakJoin"};

/** Pause before a tavern guest moves, so everyone can follow. A game may set its own (guestDelay). */
const GUEST_DELAY = 900;

/** Full states with hidden information, by table id (active GM only). */
const full = new Map();

/** Requests run one after another. */
let queue = Promise.resolve();

/** When and which game the last break suggestion was (active GM). */
let lastOfferAt = null;
let lastOfferGame = null;

/** Counting the games started, one after another. */
let playedQueue = Promise.resolve();

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
 * @param {string|null} [actorId]   The character who bets
 * @returns {object}
 */
function userSeat(user, actorId=null) {
  const seat = {kind: "user", userId: user.id, name: user.character?.name || user.name,
    img: user.character?.img || user.avatar || "icons/svg/mystery-man.svg"};
  // The character whose purse pays the stake
  if ( actorId ) seat.actorId = actorId;
  return seat;
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
  if ( GAME_FEATURES[table.game] ) countFeature(MODULE_ID, GAME_FEATURES[table.game]);
  rememberPlayed(table.game);
  // A game can be decided by the deal alone (twenty-one with two cards for everyone)
  return settle({...table, status: "playing", result: null, started: Date.now()}, state);
}

/**
 * The stake a table really plays for: the GM may have switched the stakes off since the table was opened.
 * @param {object} table
 * @returns {{amount: number, mode: string}|null}
 */
function activeStake(table) {
  return (table.stake && setting("stakes") && validStake(table.stake.amount) && stakeGame(table.game)) ? table.stake : null;
}

/**
 * Take the stakes into escrow, then start the game (active GM). Nobody pays when somebody cannot.
 * @param {object} table
 * @returns {Promise<object>}
 */
async function begin(table) {
  if ( !activeStake(table) ) return start({...table, stake: null});
  const paid = await chargeSeats(table);
  const next = {...table, stake: {...table.stake, paid, payout: null, refunded: false}};
  try {
    return start(next);
  } catch(err) {
    await creditSeats(next, paid).catch(e => console.error(`${MODULE_ID} | Could not return a stake`, e));
    throw err;
  }
}

/**
 * A finished table with what the stakes pay, still to be paid out.
 * @param {object} table
 * @returns {object}
 */
function withPayout(table) {
  if ( !table.stake || table.stake.payout || (table.status !== "done") ) return table;
  const payout = settleStake(table);
  return payout ? {...table, stake: {...table.stake, payout: {...payout, paid: false}}} : table;
}

/**
 * Pay out the stakes of a finished table (active GM), once. The table is marked first: a failing payment is reported
 * rather than paid twice.
 * @param {object} table
 * @returns {Promise<object>}
 */
async function payOut(table) {
  const payout = table.stake?.payout;
  if ( !payout || payout.paid ) return table;
  const next = await update(table.id, t => ({...t, stake: {...t.stake, payout: {...t.stake.payout, paid: true}}}));
  try {
    await creditSeats(next, payout.credits);
    if ( payout.credits.some(amount => amount > 0) ) countFeature(MODULE_ID, STAKE_FEATURES.paid);
  } catch(err) {
    console.error(`${MODULE_ID} | A payout failed`, err);
    ui.notifications.error(loc("STG.Error.payoutFailed"), {permanent: true});
  }
  return next;
}

/**
 * Count a game started in the world (the break suggestion prefers games nobody played yet).
 * @param {string} gameId
 */
function rememberPlayed(gameId) {
  playedQueue = playedQueue.then(async () => {
    const played = {...(setting("played") ?? {})};
    played[gameId] = (played[gameId] ?? 0) + 1;
    await game.settings.set(MODULE_ID, "played", played);
  }).catch(err => console.warn(`${MODULE_ID} | Could not count a game`, err));
}

/**
 * Remember the users of a finished table: they know the tavern now and no longer get the short introduction.
 * @param {object} table
 * @returns {Promise<void>}
 */
async function markIntroduced(table) {
  const current = setting("introduced") ?? [];
  const add = newcomersOf(table, current);
  if ( add.length ) await game.settings.set(MODULE_ID, "introduced", [...current, ...add]);
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
    return withPayout(next);
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
  const money = stakeLine(table);
  const more = money ? ` ${money}` : "";
  if ( table.game === "twentyone" ) {
    return r.results.map((res, i) => loc(`STG.Result.twentyone.${res}`, {name: names[i]})).join(" · ") + (money ? `. ${money}` : "");
  }
  if ( r.draw ) return loc("STG.Result.draw", {names: names.join(", "), game: gameName}) + more;
  const winner = names[r.winners[0]];
  const others = names.filter((_, i) => !r.winners.includes(i));
  return loc("STG.Result.win", {winner, others: others.join(", "), game: gameName}) + more;
}

/**
 * The payout of a finished table in one sentence, empty without a stake.
 * @param {object} table
 * @returns {string}
 */
export function stakeLine(table) {
  const payout = table.stake?.payout;
  if ( !payout ) return "";
  const adapter = adapterOf(table);
  const money = amount => formatMoney(amount, adapter);
  if ( table.game === "twentyone" ) {
    const parts = [];
    table.seats.forEach((seat, i) => {
      const net = payout.net[i];
      if ( (seat.kind !== "user") || !net ) return;
      parts.push(loc(net > 0 ? "STG.Stake.wins" : "STG.Stake.loses", {name: seatName(seat), amount: money(Math.abs(net))}));
    });
    return parts.length ? loc("STG.Stake.payout", {text: parts.join(", ")}) : loc("STG.Stake.returned");
  }
  const winner = table.result?.winners?.[0];
  if ( (winner === undefined) || !table.result?.winners?.length ) return loc("STG.Stake.returned");
  return loc("STG.Stake.potTaken", {name: seatName(table.seats[winner]), amount: money(payout.pot)});
}

/**
 * Tell the table about a finished game.
 * @param {object} table
 * @returns {Promise<void>}
 */
async function postResult(table) {
  table = await payOut(table);
  await markIntroduced(table);
  await recordRanking(table);
  await postCard("result", resultCardHtml(table));
}

/**
 * The chat card of a finished game.
 * @param {object} table
 * @returns {string}
 */
export function resultCardHtml(table) {
  return `<p class="stg-card-title"><i class="fa-solid fa-trophy" inert></i> ${esc(loc(`STG.Game.${table.game}.name`))}</p>`
    + `<p>${esc(resultText(table))}</p><button type="button" data-stg-open="${esc(table.id)}"><i class="fa-solid fa-beer-mug-empty" inert></i> `
    + `${esc(loc("STG.Card.open"))}</button>`;
}

/**
 * The chat card that invites to a table still waiting for players.
 * @param {object} table   An open table with its host in the first seat
 * @returns {string}
 */
export function inviteCardHtml(table) {
  const key = table.stake ? "STG.Card.inviteStake" : "STG.Card.invite";
  return `<p class="stg-card-title"><i class="fa-solid fa-beer-mug-empty" inert></i> `
    + `${esc(loc(key, {name: seatName(table.seats[0]), game: loc(`STG.Game.${table.game}.name`),
      stake: table.stake ? formatMoney(table.stake.amount, adapterOf(table)) : ""}))}</p>`
    + `<button type="button" data-stg-join="${esc(table.id)}"><i class="fa-solid fa-chair" inert></i> ${esc(loc("STG.Table.join"))}</button>`;
}

/* -------------------------------------------- */
/*  Ranking of the evening and reputation       */
/* -------------------------------------------- */

/**
 * Count a finished game for the ranking (active GM), once.
 * @param {object} table
 * @returns {Promise<void>}
 */
async function recordRanking(table) {
  try {
    const next = recordGame(setting("ranking"), table, Date.now());
    if ( next ) await game.settings.set(MODULE_ID, "ranking", next);
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not count a game for the ranking`, err);
  }
}

/**
 * The tavern title of a user, from the wins of all evenings.
 * @param {string} userId
 * @returns {string}
 */
export function titleOfUser(userId) {
  const total = cleanRanking(setting("ranking")).all[userId];
  return loc(`STG.Rank.tier.${titleFor(total?.wins ?? 0)}`);
}

/**
 * The money of a player in the evening as a short text, empty without stakes.
 * @param {Record<string, number>} net   Balance per kind of money
 * @returns {string}
 */
export function netText(net) {
  return Object.entries(net ?? {}).filter(([, amount]) => amount).map(([mode, amount]) =>
    loc(amount > 0 ? "STG.Rank.won" : "STG.Rank.lost", {amount: formatMoney(Math.abs(amount), adapterOf({stake: {mode}}))})).join(", ");
}

/**
 * The ranking of the evening that is still going on.
 * @param {number} [now]
 * @param {object} [stored]   A ranking to read instead of the world's (sample windows)
 * @returns {{pos: number, name: string, title: string, wins: number, games: number, money: string}[]}
 */
export function eveningRows(now=Date.now(), stored=undefined) {
  const ranking = cleanRanking(stored ?? setting("ranking"));
  return standings(liveSession(ranking, now)).map((row, i) => ({pos: i + 1, name: row.name,
    title: loc(`STG.Rank.tier.${titleFor(ranking.all[row.key]?.wins ?? 0)}`), wins: row.wins, games: row.games, money: netText(row.net)}));
}

/**
 * The chat card with the standings of the evening.
 * @param {{pos: number, name: string, title: string, wins: number, games: number, money: string}[]} rows
 * @returns {string}
 */
export function rankingCardHtml(rows) {
  const lines = rows.map(row => `<li>${esc(loc("STG.Rank.line", {pos: row.pos, name: row.name, title: row.title, wins: row.wins,
    games: row.games, money: row.money ? `, ${row.money}` : ""}))}</li>`).join("");
  return `<p class="stg-card-title"><i class="fa-solid fa-ranking-star" inert></i> ${esc(loc("STG.Rank.cardTitle"))}</p><ol>${lines}</ol>`;
}

/**
 * The summary of the evening for the chat (active GM).
 * @returns {Promise<void>}
 */
async function postRanking() {
  const rows = eveningRows();
  if ( !rows.length ) throw new Error("STG.Error.noRanking");
  await ChatMessage.implementation.create({content: `<div class="stg-chat">${rankingCardHtml(rows)}</div>`,
  speaker: {alias: loc("STG.Card.speaker")}, flags: {[MODULE_ID]: {card: "ranking"}}});
}

/* -------------------------------------------- */
/*  Requests                                    */
/* -------------------------------------------- */

const ok = (extra={}) => ({ok: true, ...extra});
const fail = (error, data) => ({ok: false, error, ...(data ? {data} : {})});

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
      if ( key.startsWith("STG.") ) return fail(key, err.data);
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

/**
 * Open a table for a user.
 * @param {User} user
 * @param {string} gameId
 * @param {string|null} [guest]            A tavern guest who sits down at once
 * @param {object} [options]
 * @param {boolean} [options.silent]       No invitation in the chat (the break suggestion is the invitation)
 * @param {number|null} [options.stake]    Stake in minor units, when the table plays for money
 * @param {string|null} [options.actorId]  The character who bets
 * @returns {Promise<object>}
 */
async function openTable(user, gameId, guest=null, {silent=false, stake=null, actorId=null}={}) {
  const g = rules(gameId);
  if ( !gameOffered(gameId, setting("disabledGames")) ) throw new Error("STG.Error.gameOff");
  const seats = [userSeat(user)];
  let stakeInfo = null;
  if ( (stake !== null) && (stake !== undefined) ) {
    if ( !setting("stakes") ) throw new Error("STG.Error.stakesOff");
    if ( !stakeGame(gameId) ) throw new Error("STG.Error.noStakeGame");
    if ( !validStake(stake) ) throw new Error("STG.Error.badStake");
    const adapter = moneyAdapter();
    const checked = checkSeat(adapter, user, actorId, stake);
    seats[0] = userSeat(user, checked.actorId);
    stakeInfo = {amount: stake, mode: adapter.id};
  }
  if ( guest && g.guests ) seats.push(guestSeat(guest));
  let table = {id: foundry.utils.randomID(), game: gameId, host: user.id, status: "open", seats, state: null,
    result: null, created: Date.now(), updated: Date.now(), round: 1};
  if ( stakeInfo ) table.stake = stakeInfo;
  // Against a guest the game starts at once; at twenty-one a guest means playing alone against the house
  const ready = !!guest;
  if ( ready ) table = await begin(table);
  await save([...tables(), table]);
  if ( stakeInfo ) countFeature(MODULE_ID, STAKE_FEATURES.table);
  if ( table.status === "done" ) await postResult(table);
  if ( !ready && !silent ) {
    await postCard("invite", inviteCardHtml(table));
  }
  return table;
}

/* -------------------------------------------- */
/*  The suggestion for the break                */
/* -------------------------------------------- */

/**
 * The suggestion as stored, or null.
 * @returns {{id: string, game: string, at: number, tableId: string|null}|null}
 */
export function currentOffer() {
  return cleanOffer(setting("offer"), Object.keys(GAMES));
}

/**
 * Suggest one game to the table (active GM): a game that fits the players online, the least played first.
 * @returns {Promise<object>}
 */
async function makeOffer() {
  const disabled = setting("disabledGames") ?? [];
  const info = Object.fromEntries(Object.values(GAMES).map(g => [g.id, {min: g.seats.min, max: g.seats.max, guests: !!g.guests}]));
  const id = pickGame({games: info, offered: Object.keys(GAMES).filter(gameId => gameOffered(gameId, disabled)),
    played: setting("played") ?? {}, last: lastOfferGame, online: game.users.filter(u => u.active && !u.isGM).length, rng});
  if ( !id ) throw new Error("STG.Error.noGames");
  const offer = {id: foundry.utils.randomID(), game: id, at: Date.now(), tableId: null};
  lastOfferAt = offer.at;
  lastOfferGame = id;
  await game.settings.set(MODULE_ID, "offer", offer);
  countFeature(MODULE_ID, OFFER_FEATURES.offer);
  return offer;
}

/**
 * Hook "pauseGame": a pause brings the suggestion for the break, if the GM did not turn it off.
 * @param {boolean} paused
 */
export function offerOnPause(paused) {
  if ( !game.user.isActiveGM ) return;
  const online = game.users.filter(u => u.active && !u.isGM).length;
  if ( !offerAllowed({enabled: setting("breakOffer") !== false, paused: !!paused, now: Date.now(), lastAt: lastOfferAt, online}) ) return;
  queue = queue.then(() => makeOffer()).catch(err => console.warn(`${MODULE_ID} | No suggestion for the break`, err));
}

const ACTIONS = {

  /** Open a table, against a guest or waiting for other players. */
  async create({game: gameId, guest, stake, actorId}, user) {
    const table = await openTable(user, gameId, guest, {stake: stake ?? null, actorId: actorId ?? null});
    return ok({tableId: table.id});
  },

  /** GM: suggest a game to the table now, as a pause does. */
  async suggest(payload, user) {
    if ( !user.isGM ) return fail("STG.Error.notGM");
    await makeOffer();
    return ok();
  },

  /** GM: post the ranking of the evening to the chat. */
  async postRanking(payload, user) {
    if ( !user.isGM ) return fail("STG.Error.notGM");
    await postRanking();
    return ok();
  },

  /** GM: close the evening, the next game starts a new ranking. */
  async newEvening(payload, user) {
    if ( !user.isGM ) return fail("STG.Error.notGM");
    await game.settings.set(MODULE_ID, "ranking", newEvening(setting("ranking")));
    return ok();
  },

  /** GM: take the suggestion back. */
  async suggestEnd(payload, user) {
    if ( !user.isGM ) return fail("STG.Error.notGM");
    await game.settings.set(MODULE_ID, "offer", {});
    return ok();
  },

  /**
   * One click on the suggestion: sit down at the suggested table. The first one opens it (alone at the tavern with
   * Old Bertram, and the game starts at once), the others sit down next to them.
   */
  async suggestJoin({offerId}, user) {
    const offer = currentOffer();
    if ( !offer || (offer.id !== offerId) ) return fail("STG.Error.offerGone");
    if ( !gameOffered(offer.game, setting("disabledGames")) ) return fail("STG.Error.gameOff");
    const open = offer.tableId ? tableById(offer.tableId) : null;
    if ( open && (open.status !== "done") && (seatOf(open, user) >= 0) ) return ok({tableId: open.id});
    countFeature(MODULE_ID, OFFER_FEATURES.join);
    if ( open && (open.status === "open") && (open.seats.length < rules(open.game).seats.max) ) {
      return ACTIONS.join({tableId: open.id}, user);
    }
    const alone = game.users.filter(u => u.active && !u.isGM).length < 2;
    const table = await openTable(user, offer.game, (alone && rules(offer.game).guests) ? "bertram" : null, {silent: true});
    await game.settings.set(MODULE_ID, "offer", {...offer, tableId: table.id});
    return ok({tableId: table.id});
  },

  /** Take a seat at an open table; a two player table starts when it is full. */
  async join({tableId, actorId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( table.status !== "open" ) return fail("STG.Error.notOpen");
    if ( seatOf(table, user) >= 0 ) return fail("STG.Error.seated");
    const g = rules(table.game);
    if ( table.seats.length >= g.seats.max ) return fail("STG.Error.full");
    // At a table with a stake the player names the character whose purse pays it, and must be able to pay
    const stake = activeStake(table);
    const checked = stake ? checkSeat(adapterOf(table), user, actorId ?? null, stake.amount) : null;
    const seated = {...table, seats: [...table.seats, userSeat(user, checked?.actorId ?? null)]};
    const started = (seated.seats.length >= g.seats.max) && (g.seats.max === 2) ? await begin(seated) : seated;
    const next = await update(tableId, () => started);
    if ( next.status === "done" ) await postResult(next);
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
    const seated = {...table, seats: [...table.seats, guestSeat(guest)]};
    const started = (seated.seats.length >= g.seats.max) && (g.seats.max === 2) ? await begin(seated) : seated;
    const next = await update(tableId, () => started);
    if ( next.status === "done" ) await postResult(next);
    return ok({tableId});
  },

  /** Host: start with the seats taken. */
  async start({tableId}, user) {
    const table = tableById(tableId);
    if ( !table ) return fail("STG.Error.tableGone");
    if ( (table.host !== user.id) && !user.isGM ) return fail("STG.Error.notHost");
    if ( table.status !== "open" ) return fail("STG.Error.notOpen");
    if ( table.seats.length < rules(table.game).seats.min ) return fail("STG.Error.tooFew");
    const started = await begin(table);
    const next = await update(tableId, () => started);
    if ( next.status === "done" ) await postResult(next);
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
    const seats = (stay.length === 2) ? [stay[1], stay[0]] : stay;
    const started = await begin({...table, seats, round: (table.round ?? 1) + 1});
    const next = await update(tableId, () => started);
    if ( next.status === "done" ) await postResult(next);
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
      const next = await update(tableId, t => withPayout({...t, status: "done", result: {done: true, winners, draw: false,
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
    // A table taken away in the middle of a game gives the stakes back
    if ( hasEscrow(table) ) await creditSeats(table, table.stake.paid);
    full.delete(tableId);
    await update(tableId, () => null);
    return ok();
  }
};

/**
 * The pause before a tavern guest moves in a game.
 * @param {string} gameId
 * @returns {number}
 */
function guestDelay(gameId) {
  return rules(gameId).guestDelay ?? GUEST_DELAY;
}

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
    await new Promise(resolve => setTimeout(resolve, guestDelay(table.game)));
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

export const __test__ = {ACTIONS, guestDelay, GUEST_DELAY, start};
