import assert from "node:assert/strict";
import {test} from "node:test";
import {SESSION_GAP, TIERS, emptyRanking, liveSession, newEvening, recordGame, standings, titleFor, winnersOf}
  from "../scripts/games/ranking.mjs";

/** A small Foundry: settings in memory, users, chat. */
const values = new Map();
const DEFAULTS = {tables: [], disabledGames: [], chatCards: "all", pigGoal: 50, played: {}, introduced: [], offer: {}, breakOffer: true,
  ranking: {}, stakes: false};
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
  i18n: {localize: key => key, format: (key, data) => `${key} ${JSON.stringify(data ?? {})}`}
};
globalThis.game.user.isActiveGM = true;

const tablesModule = await import("../scripts/tables.mjs");
const {ACTIONS} = tablesModule.__test__;

const seatOf = (id, name) => ({kind: "user", userId: id, name});
const guest = {kind: "guest", guest: "bertram"};
const done = (extra={}) => ({id: "t1", game: "liars", status: "done", started: 1, seats: [seatOf("a", "Anna"), seatOf("b", "Ben"), guest],
  result: {done: true, winners: [1], draw: false}, ...extra});
const HOUR = 60 * 60 * 1000;

test("ranking: the tavern title follows the wins of all evenings", () => {
  assert.equal(titleFor(0), "stranger");
  assert.equal(titleFor(2), "stranger");
  assert.equal(titleFor(3), "face");
  assert.equal(titleFor(10), "local");
  assert.equal(titleFor(24), "local");
  assert.equal(titleFor(25), "master");
  assert.equal(titleFor(500), "legend");
  assert.equal(titleFor(undefined), "stranger");
  assert.deepEqual(TIERS.map(t => t.wins), [0, 3, 10, 25, 50]);
});

test("ranking: a finished game counts games and wins for the users, not for the guests", () => {
  const r = recordGame(emptyRanking(), done(), 1000);
  assert.deepEqual(Object.keys(r.session.players).sort(), ["a", "b"]);
  assert.deepEqual(r.session.players.a, {name: "Anna", wins: 0, games: 1, net: {}});
  assert.equal(r.session.players.b.wins, 1);
  assert.deepEqual(r.all.b, {name: "Ben", wins: 1, games: 1});
});

test("ranking: one game is counted once, a rematch at the same table is another game", () => {
  let r = recordGame(emptyRanking(), done(), 1000);
  assert.equal(recordGame(r, done(), 1100), null);
  r = recordGame(r, done({started: 2}), 1200);
  assert.equal(r.session.players.b.games, 2);
  assert.equal(r.all.b.wins, 2);
});

test("ranking: games that are not finished or have no user do not count", () => {
  assert.equal(recordGame(emptyRanking(), done({status: "playing"}), 1), null);
  assert.equal(recordGame(emptyRanking(), done({seats: [guest, guest]}), 1), null);
});

test("ranking: twenty-one counts a win per player, a tie or a loss is no win", () => {
  const table = done({game: "twentyone", seats: [seatOf("a", "Anna"), seatOf("b", "Ben")],
    result: {done: true, winners: [], draw: false, results: ["win", "push"]}});
  assert.deepEqual([...winnersOf(table)], [0]);
  const r = recordGame(emptyRanking(), table, 5);
  assert.equal(r.session.players.a.wins, 1);
  assert.equal(r.session.players.b.wins, 0);
  assert.equal(r.session.players.b.games, 1);
});

test("ranking: a draw gives no win", () => {
  const r = recordGame(emptyRanking(), done({result: {done: true, winners: [], draw: true}}), 5);
  assert.equal(r.session.players.a.wins + r.session.players.b.wins, 0);
});

test("ranking: money won and lost is kept per kind of money", () => {
  const table = done({stake: {amount: 50, mode: "chips", payout: {pot: 150, credits: [0, 150, 0], net: [-50, 100, 0], paid: true}}});
  let r = recordGame(emptyRanking(), table, 10);
  assert.deepEqual(r.session.players.a.net, {chips: -50});
  assert.deepEqual(r.session.players.b.net, {chips: 100});
  r = recordGame(r, done({started: 2, stake: {amount: 10, mode: "dnd5e", payout: {net: [-10, 20, 0]}}}), 20);
  assert.deepEqual(r.session.players.b.net, {chips: 100, dnd5e: 20});
  // A game for honor adds nothing
  r = recordGame(r, done({started: 3}), 30);
  assert.deepEqual(r.session.players.b.net, {chips: 100, dnd5e: 20});
});

test("ranking: a long break ends the evening, the wins of all evenings stay", () => {
  let r = recordGame(emptyRanking(), done(), 1000);
  assert.equal(liveSession(r, 1000 + SESSION_GAP).id, r.session.id);
  assert.equal(liveSession(r, 1001 + SESSION_GAP), null);
  r = recordGame(r, done({started: 2}), 1000 + (9 * HOUR));
  assert.equal(r.session.players.b.games, 1, "a new evening starts from nothing");
  assert.equal(r.all.b.games, 2);
  assert.equal(r.all.b.wins, 2);
});

test("ranking: the GM closes the evening, the titles stay", () => {
  const r = recordGame(emptyRanking(), done(), 1000);
  const closed = newEvening(r);
  assert.equal(closed.session, null);
  assert.equal(closed.all.b.wins, 1);
  assert.equal(liveSession(closed, 1001), null);
  assert.deepEqual(newEvening(undefined), emptyRanking());
});

test("ranking: most wins first, then the better balance, then fewer games", () => {
  const session = {players: {
    a: {name: "Anna", wins: 2, games: 5, net: {chips: -10}},
    b: {name: "Ben", wins: 3, games: 5, net: {}},
    c: {name: "Cleo", wins: 2, games: 4, net: {chips: 40}},
    d: {name: "Dirk", wins: 2, games: 3, net: {chips: 40}}
  }};
  assert.deepEqual(standings(session).map(row => row.name), ["Ben", "Dirk", "Cleo", "Anna"]);
  assert.deepEqual(standings(null), []);
});

test("ranking: the active GM records finished games, posts the summary on request and closes the evening", async () => {
  values.clear();
  chat.length = 0;
  const dice = [];
  // Two players at Mexico, every die shows 2: the announcer says 22 and tells the truth, the caller loses
  const created = await ACTIONS.create({game: "mexico"}, users.a);
  const id = created.tableId;
  assert.equal((await ACTIONS.join({tableId: id}, users.b)).ok, true);
  assert.equal((await ACTIONS.start({tableId: id}, users.a)).ok, true);
  const order = [[users.a, users.b], [users.b, users.a], [users.a, users.b], [users.b, users.a], [users.a, users.b]];
  for ( const [announcer, caller] of order ) {
    assert.equal((await ACTIONS.move({tableId: id, move: "a:22"}, announcer)).ok, true);
    dice.push(await ACTIONS.move({tableId: id, move: "call"}, caller));
  }
  const table = values.get("tables")[0];
  assert.equal(table.status, "done");
  assert.deepEqual(table.result.winners, [0]);
  const ranking = values.get("ranking");
  assert.equal(ranking.session.players[users.a.id].wins, 1);
  assert.equal(ranking.session.players[users.a.id].games, 1);
  assert.equal(ranking.session.players[users.b.id].wins, 0);
  assert.equal(ranking.all[users.a.id].wins, 1);
  assert.equal(chat.length, 2, "the invitation and the result card");
  // Summary for the chat: GM only
  assert.deepEqual(await ACTIONS.postRanking({}, users.a), {ok: false, error: "STG.Error.notGM"});
  assert.equal((await ACTIONS.postRanking({}, users.gm)).ok, true);
  assert.equal(chat.length, 3);
  assert.match(chat[2].content, /STG\.Rank\.cardTitle/);
  assert.match(chat[2].content, /Anna/);
  assert.deepEqual(await ACTIONS.newEvening({}, users.b), {ok: false, error: "STG.Error.notGM"});
  assert.equal((await ACTIONS.newEvening({}, users.gm)).ok, true);
  assert.equal(values.get("ranking").session, null);
  assert.equal(values.get("ranking").all[users.a.id].wins, 1);
  // Nothing to post once the evening is closed
  await assert.rejects(() => ACTIONS.postRanking({}, users.gm), /noRanking/);
});

test("ranking: every title and game has its texts in all languages", async () => {
  const {readFile} = await import("node:fs/promises");
  for ( const lang of ["en", "de", "ru"] ) {
    const strings = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url), "utf8")).STG;
    for ( const tier of TIERS ) assert.ok(strings.Rank.tier[tier.id], `${lang} ${tier.id}`);
    for ( const key of ["name", "guide"] ) assert.ok(strings.Game.mexico[key], `${lang} ${key}`);
    assert.ok(strings.Intro.mexico, lang);
  }
});
