import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const english = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const german = JSON.parse(readFileSync(new URL("../lang/de.json", import.meta.url), "utf8"));
const values = new Map();
const DEFAULTS = {tables: [], disabledGames: [], chatCards: "all", pigGoal: 50, played: {}, introduced: [], offer: {}, breakOffer: true,
  ranking: {}, stakes: false, shareImageCredit: true};
let user = {id: "gm", isGM: true, can: () => true};
const get = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);
const fill = (text, data) => String(text).replace(/\{(\w+)\}/g, (_, k) => data?.[k] ?? `{${k}}`);

globalThis.foundry = {
  utils: {deepClone: value => structuredClone(value), randomID: () => "id00000000000001", getRoute: path => `/${path}`},
  applications: {apps: {FilePicker: {implementation: {upload: async () => ({}), browse: async () => ({}), createDirectory: async () => true}}}}
};
globalThis.CONFIG = {Dice: {randomUniform: () => 0.3}};
globalThis.ChatMessage = {implementation: {create: async content => content}};
globalThis.ui = {notifications: {info: () => {}, warn: () => {}}};
globalThis.game = {
  get user() { return user; },
  world: {id: "test", title: "The Rusty Anchor"},
  users: {filter: () => [], get: () => null},
  settings: {get: (module, key) => structuredClone(values.has(key) ? values.get(key) : DEFAULTS[key]), set: async (m, key, v) => values.set(key, v)},
  i18n: {lang: "en", localize: key => get(english, key) ?? key, format: (key, data) => fill(get(english, key) ?? key, data)}
};

const {MAX_GAMES, MAX_ROWS, IMAGE_WIDTH, THEMES, layoutShareImage, shareImageFileName, shareModel, wrapText} = await import("../scripts/share-image.mjs");
const {SHARE_FEATURES, canCopyImage, canPostImage, currentShareModel, imageFolder, shareMessageHtml} = await import("../scripts/share-actions.mjs");
const {emptyRanking, gamesOf, recordGame} = await import("../scripts/games/ranking.mjs");

const loc = (key, data) => fill(get(english, key) ?? key, data);
const measure = (text, font) => String(text).length * (Number(/(\d+)px/.exec(font)?.[1]) || 16) * 0.5;
const seat = (id, name) => ({kind: "user", userId: id, name});
const finished = (game, winner, extra = {}) => ({id: `t-${game}`, game, status: "done", started: 1, seats: [seat("a", "Anna"), seat("b", "Ben")],
  result: {done: true, winners: winner === null ? [] : [winner], draw: winner === null}, ...extra});
const row = (pos, name, wins, games, extra = {}) => ({pos, name, title: "Familiar Face", wins, games, money: "", ...extra});

function evening() {
  let r = emptyRanking();
  let n = 0;
  for ( const [game, winner] of [["pig", 0], ["pig", 0], ["pig", 1], ["mexico", 1], ["tictactoe", null]] ) {
    n++;
    r = recordGame(r, finished(game, winner, {started: n}), 1000 + n);
  }
  return r;
}

test("the evening remembers how often each game was played and who won it", () => {
  const r = evening();
  assert.deepEqual(r.session.games.pig, {n: 3, wins: {a: 2, b: 1}});
  assert.deepEqual(r.session.games.mexico, {n: 1, wins: {b: 1}});
  assert.deepEqual(r.session.games.tictactoe, {n: 1, wins: {}});
});

test("gamesOf: most played first, a leader only without a tie, old evenings have no games", () => {
  const games = gamesOf(evening().session);
  assert.deepEqual(games.map(g => g.id), ["pig", "mexico", "tictactoe"]);
  assert.deepEqual(games[0], {id: "pig", count: 3, leader: {name: "Anna", wins: 2}});
  assert.equal(games[2].leader, null);
  const tie = {players: {a: {name: "Anna"}, b: {name: "Ben"}}, games: {pig: {n: 2, wins: {a: 1, b: 1}}}};
  assert.equal(gamesOf(tie)[0].leader, null);
  assert.deepEqual(gamesOf({players: {}}), []);
  assert.deepEqual(gamesOf(null), []);
});

test("the model tells the tavern, the day, the players with their titles and a line per game", () => {
  const r = evening();
  const model = shareModel({rows: [row(1, "Anna", 2, 5), row(2, "Ben", 2, 5, {money: "won 5 gp"})], session: r.session, worldTitle: "The Rusty Anchor",
    date: "Friday, 21 November 2026", loc});
  assert.equal(model.title, "The Rusty Anchor");
  assert.equal(model.subtitle, "Friday, 21 November 2026");
  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].record, "2 of 5 won");
  assert.equal(model.rows[1].money, "won 5 gp");
  assert.equal(model.tiles.find(t => t.label === "Games").value, "5");
  assert.equal(model.tiles.find(t => t.label === "Players").value, "2");
  assert.equal(model.games.length, 3);
  assert.match(model.games[0], /^Pig: 3 played, most wins for Anna \(2\)$/);
  assert.match(model.games[2], /: 1 played$/);
  assert.equal(model.footer, "made with Sephral’s Tavern Games");
});

test("the credit line is optional, the title falls back to the name of the module", () => {
  const off = shareModel({rows: [row(1, "Anna", 1, 1)], credit: false, loc});
  assert.equal(off.footer, "");
  assert.equal(off.title, english.STG.Title);
});

test("a long evening is cut: eight players, nine games, the rest in one line each", () => {
  const rows = Array.from({length: 11}, (_, i) => row(i + 1, `Player ${i}`, 11 - i, 12));
  const games = Object.fromEntries(Array.from({length: 12}, (_, i) => [`g${i}`, {n: 12 - i, wins: {}}]));
  const model = shareModel({rows, session: {players: {}, games}, loc: (key, data) => (key.startsWith("STG.Game.") ? "Game" : loc(key, data))});
  assert.equal(model.rows.length, MAX_ROWS);
  assert.equal(model.more, "and 3 more players");
  assert.equal(model.games.length, MAX_GAMES + 1);
  assert.equal(model.games.at(-1), "and 3 more games");
});

test("wrapText breaks at words and cuts a word that is wider than the line", () => {
  assert.deepEqual(wrapText(s => s.length, "one two three", 7), ["one two", "three"]);
  assert.deepEqual(wrapText(s => s.length, "abcdefghij", 4), ["abcd", "efgh", "ij"]);
});

function layoutOf(model, theme = "dark") {
  return layoutShareImage(model, {theme, measure, family: "Test"});
}

test("layout: 1080 wide, every operation inside the picture, a medal for the first three", () => {
  const model = shareModel({rows: [row(1, "Anna", 3, 5), row(2, "Ben", 2, 5), row(3, "Cora", 1, 5), row(4, "Dan", 0, 5)], session: evening().session,
    worldTitle: "The Rusty Anchor", date: "x", loc});
  const layout = layoutOf(model);
  assert.equal(layout.width, IMAGE_WIDTH);
  assert.ok(layout.height >= 320 && layout.height <= 3600);
  for ( const op of layout.ops ) {
    if ( op.type === "text" ) {
      assert.ok(op.y > 0 && op.y <= layout.height, `${op.text} at ${op.y}`);
      const w = measure(op.text, op.font);
      const left = op.align === "right" ? op.x - w : op.align === "center" ? op.x - w / 2 : op.x;
      assert.ok(left >= 0 && left + w <= IMAGE_WIDTH + 0.5, `${op.text} sticks out (${left}..${left + w})`);
    } else assert.ok((op.x - (op.r ?? 0)) >= 0 && (op.x + (op.w ?? op.r ?? 0)) <= IMAGE_WIDTH + 0.5 && op.y >= 0, JSON.stringify(op));
  }
  const circles = layout.ops.filter(op => op.type === "circle");
  assert.deepEqual(circles.map(op => op.color), [THEMES.dark.gold, THEMES.dark.silver, THEMES.dark.bronze]);
});

test("layout: a very long player name is shortened, not drawn out of its card", () => {
  const name = "Sir Bartholomew Fitzwilliam-Throckmorton the Third of Upper Nether Wallop";
  const layout = layoutOf(shareModel({rows: [row(1, name, 3, 5, {money: "won 12 gp, lost 3 sp, won 4 chips"})], loc}));
  const drawn = layout.ops.filter(op => op.type === "text" && op.text.startsWith("Sir"));
  assert.equal(drawn.length, 1);
  assert.ok(drawn[0].text.endsWith("…"));
  assert.ok(measure(drawn[0].text, drawn[0].font) < IMAGE_WIDTH - 2 * 56 - 100);
});

test("layout: more players make it taller, no credit makes it shorter, the picture stays under the limit", () => {
  const few = layoutOf(shareModel({rows: [row(1, "Anna", 1, 1)], loc})).height;
  const many = layoutOf(shareModel({rows: Array.from({length: 8}, (_, i) => row(i + 1, `P${i}`, 1, 1)), loc})).height;
  const noCredit = layoutOf(shareModel({rows: [row(1, "Anna", 1, 1)], credit: false, loc})).height;
  assert.ok(many > few);
  assert.ok(noCredit < few);
  const huge = layoutOf(shareModel({rows: Array.from({length: 40}, (_, i) => row(i + 1, `P${i}`, 1, 1)),
    session: {players: {}, games: Object.fromEntries(Array.from({length: 40}, (_, i) => [`g${i}`, {n: 1, wins: {}}]))}, loc}));
  assert.ok(huge.height <= 3600);
});

test("layout: the light theme paints its own background", () => {
  const model = shareModel({rows: [row(1, "Anna", 1, 1)], loc});
  assert.equal(layoutOf(model, "light").ops[0].color, THEMES.light.bg);
  assert.equal(layoutOf(model, "nope").ops[0].color, THEMES.dark.bg);
});

test("file name: tavern name and day, letters and digits only", () => {
  const day = new Date("2026-11-21T20:00:00Z");
  assert.equal(shareImageFileName("The Rusty Anchor", day), "the-rusty-anchor-evening-2026-11-21.png");
  assert.equal(shareImageFileName("Schänke „Zum Löwen“!", day), "schanke-zum-lowen-evening-2026-11-21.png");
  assert.equal(shareImageFileName("", day), "tavern-evening-2026-11-21.png");
});

test("the clipboard is offered on secure pages with ClipboardItem only", () => {
  Object.assign(globalThis, {isSecureContext: true, ClipboardItem: class {}});
  Object.defineProperty(globalThis, "navigator", {value: {clipboard: {write: async () => {}}}, configurable: true});
  assert.equal(canCopyImage(), true);
  globalThis.isSecureContext = false;
  assert.equal(canCopyImage(), false);
  globalThis.isSecureContext = true;
  delete globalThis.ClipboardItem;
  assert.equal(canCopyImage(), false);
});

test("posting needs the GM or the permission to upload files", () => {
  user = {id: "gm", isGM: true, can: () => false};
  assert.equal(canPostImage(), true);
  user = {id: "p", isGM: false, can: () => false};
  assert.equal(canPostImage(), false);
  user = {id: "p", isGM: false, can: right => right === "FILES_UPLOAD"};
  assert.equal(canPostImage(), true);
  user = {id: "gm", isGM: true, can: () => true};
});

test("the pictures are kept in the module's folder of the world, the chat message is escaped", () => {
  assert.equal(imageFolder(), "worlds/test/sephrals-tavern-games/images");
  const html = shareMessageHtml("/worlds/a b/x.png?\"<", "Tom & Jerry <b>");
  assert.ok(!html.includes("<b>") && !html.includes("\"<"));
  assert.match(html, /^<div class="stg-shareimage"><a href="/);
});

test("usage counters: copied, saved, posted", () => {
  assert.deepEqual(SHARE_FEATURES, {copied: "shareImageCopied", saved: "shareImageSaved", posted: "shareImagePosted"});
});

test("the live model reads the evening: nothing before the first game, the world title after it", () => {
  assert.equal(currentShareModel(2000), null);
  values.set("ranking", evening());
  const model = currentShareModel(2000);
  assert.equal(model.title, "The Rusty Anchor");
  assert.ok(model.rows.length === 2 && model.games.length === 3);
  assert.ok(model.subtitle.length > 5);
  values.set("shareImageCredit", false);
  assert.equal(currentShareModel(2000).footer, "");
  values.delete("shareImageCredit");
  values.delete("ranking");
});

test("English and German have the same strings for the share window", () => {
  const keys = obj => Object.keys(obj.STG.Share).sort();
  const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  assert.deepEqual(keys(german), keys(english));
  assert.ok(english.STG.SETTINGS.shareImageCredit.name && german.STG.SETTINGS.shareImageCredit.name);
  for ( const key of Object.keys(english.STG.Share) ) assert.deepEqual(holes(german.STG.Share[key]), holes(english.STG.Share[key]), key);
});
