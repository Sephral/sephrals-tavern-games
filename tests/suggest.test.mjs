import assert from "node:assert/strict";
import {mock, test} from "node:test";

/** A small Foundry: settings in memory, users, chat. */
const values = new Map();
const DEFAULTS = {tables: [], disabledGames: [], chatCards: "all", pigGoal: 50, played: {}, introduced: [], offer: {}, breakOffer: true};
const chat = [];
const user = (id, isGM, name) => ({id, isGM, name, active: true, character: null, avatar: "a.png"});
const users = {gm: user("GM0000000000001", true, "GM"), a: user("PlayerA00000001", false, "Anna"), b: user("PlayerB00000002", false, "Ben")};
let counter = 0;

globalThis.foundry = {utils: {deepClone: value => structuredClone(value), randomID: () => `id${String(++counter).padStart(14, "0")}`}};
globalThis.CONFIG = {Dice: {randomUniform: () => 0.3}};
globalThis.ChatMessage = {implementation: {create: async content => chat.push(content)}};
globalThis.game = {
  user: users.gm,
  users: {filter: fn => Object.values(users).filter(fn), get: id => Object.values(users).find(u => u.id === id)},
  settings: {
    get: (module, key) => structuredClone(values.has(key) ? values.get(key) : DEFAULTS[key]),
    set: async (module, key, value) => {
      values.set(key, structuredClone(value));
      return value;
    }
  },
  i18n: {localize: key => key, format: key => key}
};
globalThis.game.user.isActiveGM = true;

const tablesModule = await import("../scripts/tables.mjs");
const {ACTIONS} = tablesModule.__test__;
const {currentOffer, offerOnPause} = tablesModule;

/** Let pending work (the request queue, setting writes) finish. */
const settle = async () => {
  for ( let i = 0; i < 30; i++ ) await new Promise(resolve => setImmediate(resolve));
};

const offerWith = (game, extra={}) => values.set("offer", {id: "offer00000000001", game, at: Date.now(), tableId: null, ...extra});
const reset = () => {
  values.clear();
  chat.length = 0;
  users.a.active = true;
  users.b.active = true;
};

test("only a GM can suggest a game, and the offer holds a game that is on offer", async () => {
  reset();
  assert.deepEqual(await ACTIONS.suggest({}, users.a), {ok: false, error: "STG.Error.notGM"});
  assert.equal(currentOffer(), null);
  const result = await ACTIONS.suggest({}, users.gm);
  assert.equal(result.ok, true);
  const offer = currentOffer();
  assert.ok(offer.id && offer.game);
  assert.equal(offer.tableId, null);
  values.set("disabledGames", ["tictactoe", "fourinarow", "morris", "matches", "pig", "ship", "liars", "mexico"]);
  await ACTIONS.suggest({}, users.gm);
  assert.equal(currentOffer().game, "twentyone");
  values.set("disabledGames", ["tictactoe", "fourinarow", "morris", "matches", "pig", "ship", "liars", "mexico", "twentyone"]);
  await assert.rejects(() => ACTIONS.suggest({}, users.gm), /noGames/);
  assert.deepEqual(await ACTIONS.suggestEnd({}, users.a), {ok: false, error: "STG.Error.notGM"});
  assert.equal((await ACTIONS.suggestEnd({}, users.gm)).ok, true);
  assert.equal(currentOffer(), null);
});

test("the games started so far are counted, so the next suggestion is one nobody started", async () => {
  reset();
  users.b.active = false;
  offerWith("matches");
  await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a);
  await settle();
  assert.deepEqual(values.get("played"), {matches: 1});
  for ( let i = 0; i < 12; i++ ) {
    await ACTIONS.suggest({}, users.gm);
    assert.notEqual(currentOffer().game, "matches", "a game nobody started comes first");
  }
});

test("alone at the tavern one click starts the game against the regular, without a chat invitation", async () => {
  reset();
  users.b.active = false;
  offerWith("matches");
  const result = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a);
  assert.equal(result.ok, true);
  const table = values.get("tables").find(x => x.id === result.tableId);
  assert.equal(table.status, "playing");
  assert.deepEqual(table.seats.map(s => s.kind), ["user", "guest"]);
  assert.equal(table.seats[1].guest, "bertram");
  assert.equal(currentOffer().tableId, table.id);
  assert.equal(chat.length, 0, "the suggestion is the invitation");
  // The same player clicking again lands at the same table
  const again = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a);
  assert.equal(again.tableId, table.id);
  assert.equal(values.get("tables").length, 1);
});

test("with company the first click opens the table and the next one sits down, a game for two then starts", async () => {
  reset();
  offerWith("tictactoe");
  const first = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a);
  let table = values.get("tables").find(x => x.id === first.tableId);
  assert.equal(table.status, "open");
  assert.equal(table.seats.length, 1);
  assert.equal(chat.length, 0);
  const second = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.b);
  assert.equal(second.tableId, first.tableId);
  table = values.get("tables").find(x => x.id === first.tableId);
  assert.equal(table.status, "playing");
  assert.deepEqual(table.seats.map(s => s.userId), [users.a.id, users.b.id]);
});

test("a game for more players waits for the host to start it", async () => {
  reset();
  offerWith("pig");
  const first = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a);
  await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.b);
  const table = values.get("tables").find(x => x.id === first.tableId);
  assert.equal(table.status, "open");
  assert.equal(table.seats.length, 2);
});

test("a table already playing makes the next click open a new table, a wrong or switched off offer fails", async () => {
  reset();
  offerWith("tictactoe");
  const first = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a);
  await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.b);
  users.a.active = false;
  users.b.active = false;
  const late = {...users.a, id: "PlayerC00000003", name: "Cleo", active: true};
  users[late.id] = late;
  const third = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, late);
  assert.notEqual(third.tableId, first.tableId);
  delete users[late.id];
  assert.deepEqual(await ACTIONS.suggestJoin({offerId: "other"}, users.a), {ok: false, error: "STG.Error.offerGone"});
  values.set("disabledGames", ["tictactoe"]);
  assert.deepEqual(await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a), {ok: false, error: "STG.Error.gameOff"});
});

test("a pause brings a suggestion, once in ten minutes, and the GM can turn it off", async () => {
  reset();
  // Earlier tests made offers: the clock moves on past the pause between offers
  mock.timers.enable({apis: ["Date"], now: Date.now() + (3600 * 1000)});
  offerOnPause(false);
  await settle();
  assert.equal(currentOffer(), null, "resuming brings nothing");
  values.set("breakOffer", false);
  offerOnPause(true);
  await settle();
  assert.equal(currentOffer(), null);
  values.set("breakOffer", true);
  game.user.isActiveGM = false;
  offerOnPause(true);
  await settle();
  assert.equal(currentOffer(), null, "only the active GM makes the offer");
  game.user.isActiveGM = true;
  offerOnPause(true);
  await settle();
  const first = currentOffer();
  assert.ok(first);
  offerOnPause(true);
  await settle();
  assert.equal(currentOffer().id, first.id, "a second pause so soon brings no second offer");
  mock.timers.tick(11 * 60 * 1000);
  offerOnPause(true);
  await settle();
  assert.notEqual(currentOffer().id, first.id, "ten minutes later a pause brings the next one");
  mock.timers.reset();
});

test("a finished first game ends the introduction for everyone who played it", async () => {
  reset();
  users.b.active = false;
  offerWith("matches");
  const result = await ACTIONS.suggestJoin({offerId: "offer00000000001"}, users.a);
  assert.deepEqual(values.get("introduced") ?? [], []);
  await ACTIONS.leave({tableId: result.tableId}, users.a);
  assert.deepEqual(values.get("introduced"), [users.a.id]);
});
