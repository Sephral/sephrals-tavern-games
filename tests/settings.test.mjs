import assert from "node:assert/strict";
import test from "node:test";

// settings.mjs and the modules it imports touch these Foundry APIs at import time
globalThis.foundry = {
  utils: {debounce: fn => fn, deepClone: value => structuredClone(value)},
  applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {}, DialogV2: class {}}},
  data: {fields: {NumberField: class {
    constructor(options) {
      Object.assign(this, options);
    }
  }}}
};
globalThis.game = {system: {id: "dnd5e"}};

const {MODULE_ID} = await import("../scripts/config.mjs");
const {FOLLOW_FOUNDRY} = await import("../scripts/language.mjs");
const {SETTINGS, registerSettings} = await import("../scripts/settings.mjs");

/**
 * Register the settings with a stub of game.settings which records every call.
 * @returns {{settings: Map<string, object>, menus: Map<string, object>}}
 */
function register() {
  const settings = new Map();
  const menus = new Map();
  globalThis.game = {system: {id: "dnd5e"}, settings: {
    register: (module, key, data) => settings.set(`${module}.${key}`, data),
    registerMenu: (module, key, data) => menus.set(`${module}.${key}`, data)
  }};
  registerSettings();
  const strip = map => new Map([...map].map(([key, data]) => [key.replace(`${MODULE_ID}.`, ""), data]));
  return {settings: strip(settings), menus: strip(menus)};
}

test("the module language comes first and follows Foundry by default", () => {
  const {settings} = register();
  assert.equal([...settings.keys()][0], "uiLanguage");
  assert.equal(settings.get("uiLanguage").scope, "client");
  assert.equal(settings.get("uiLanguage").default, FOLLOW_FOUNDRY);
});

test("every visible setting has a localized name and hint, the storage settings are hidden", () => {
  const {settings} = register();
  for ( const key of Object.keys(SETTINGS) ) {
    assert.equal(settings.get(key).name, `STG.SETTINGS.${key}.name`);
    assert.equal(settings.get(key).hint, `STG.SETTINGS.${key}.hint`);
    assert.equal(settings.get(key).config, true);
  }
  for ( const key of ["tables", "disabledGames", "acknowledgedVersions"] ) assert.equal(settings.get(key).config, false);
});

test("defaults: all chat messages, Pig to 50, the tables hidden", () => {
  const {settings} = register();
  assert.equal(settings.get("chatCards").default, "all");
  assert.equal(settings.get("pigGoal").default, 50);
  assert.equal(settings.get("tables").config, false);
});

test("the self test is a GM only menu", () => {
  const {menus} = register();
  assert.equal(menus.get("selfTest").restricted, true);
});

test("all games on offer by default, the tavern settings are a GM menu", async () => {
  const {settings, menus} = register();
  assert.deepEqual(settings.get("disabledGames").default, []);
  assert.equal(settings.get("disabledGames").scope, "world");
  assert.equal(menus.get("tavernSettings").restricted, true);
  assert.equal(menus.get("tavernSettings").icon, "fa-solid fa-gear");
  const {disabledFromForm} = await import("../scripts/config-app.mjs");
  assert.deepEqual(disabledFromForm({tictactoe: true, fourinarow: false, matches: true, pig: true}), ["fourinarow", "morris", "ship", "liars", "twentyone"]);
  assert.deepEqual(disabledFromForm(undefined).length, 8);
});
