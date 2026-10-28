import assert from "node:assert/strict";
import test from "node:test";

// The modules behind debug.mjs touch these Foundry APIs at import time
const hooks = new Map();
globalThis.Hooks = {on: (name, fn) => hooks.set(name, fn), once: () => {}, callAll: () => {}};
globalThis.foundry = {
  utils: {debounce: fn => fn, deepClone: value => structuredClone(value)},
  applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {}, DialogV2: class {}}},
  data: {fields: {NumberField: class {}}}
};

const stored = [{
  id: "t1", game: "twentyone", host: "u1", status: "playing", round: 2, created: 1, updated: 2, result: null,
  seats: [{kind: "user", userId: "u1", name: "Aria", img: "worlds/x/aria.webp"}, {kind: "guest", guest: "bertha", level: "easy", img: "g.webp"}],
  state: {turn: 0, phase: "play", hands: [["AS", "KD"]], dealer: ["7C"]}
}];
const menus = new Map();
globalThis.game = {
  system: {id: "dnd5e"},
  i18n: {lang: "en", localize: key => key, format: key => key, has: () => true},
  users: {activeGM: {id: "gm"}},
  settings: {
    get: (module, key) => ({tables: stored, disabledGames: ["pig"], chatCards: "all", uiLanguage: "default"})[key],
    registerMenu: (module, key, data) => menus.set(`${module}.${key}`, data),
    settings: new Map()
  }
};

const {MODULE_ID} = await import("../scripts/config.mjs");
const {describeState, registerDebug} = await import("../scripts/debug.mjs");

test("the menu button and the part of the debug file are registered", () => {
  registerDebug();
  const menu = menus.get(`${MODULE_ID}.debugFile`);
  assert.equal(menu.restricted, true);
  assert.equal(menu.label, "STG.DEBUG.Save");
  const provider = globalThis.sephralsDebugFiles.providers.get(MODULE_ID);
  assert.deepEqual(provider.omitSettings, ["tables"]);
  assert.equal(provider.applies({flags: {[MODULE_ID]: {card: "result"}}}), true);
  assert.equal(provider.applies({flags: {}}), false);
  assert.equal(typeof hooks.get("getChatMessageContextOptions"), "function");
});

test("the tables appear in short, without cards, names or pictures", () => {
  const state = describeState();
  assert.deepEqual(state.tables, [{id: "t1", game: "twentyone", status: "playing", round: 2, host: "u1",
    seats: ["user:u1", "guest:bertha"], turn: 0, phase: "play", result: null, created: 1, updated: 2}]);
  assert.equal(state.activeGM, "gm");
  assert.deepEqual(state.disabledGames, ["pig"]);
  const text = JSON.stringify(state);
  for ( const secret of ["AS", "KD", "7C", "Aria", "aria.webp"] ) assert.equal(text.includes(secret), false, secret);
});
