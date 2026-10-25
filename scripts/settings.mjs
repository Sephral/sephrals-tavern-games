/**
 * Settings of the module. Like in every Sephral module, all options appear in Foundry's settings dialog under this
 * module, starting with the module language.
 */

import {MODULE_ID, t} from "./config.mjs";
import {refreshTavern} from "./app.mjs";
import {FOLLOW_FOUNDRY, applyModuleLanguage} from "./language.mjs";
import {runSelfTest} from "./selftest.mjs";
import {TavernSettings} from "./config-app.mjs";

/**
 * The settings of the module, in the order they appear in the settings dialog.
 * @type {Record<string, object>}
 */
export const SETTINGS = {
  uiLanguage: {type: String, default: FOLLOW_FOUNDRY, scope: "client", onChange: onLanguageChange, choices: {
    [FOLLOW_FOUNDRY]: "STG.LANGUAGE.default", de: "STG.LANGUAGE.de", en: "STG.LANGUAGE.en"}},
  chatCards: {type: String, default: "all", choices: {
    all: "STG.SETTINGS.chatCards.all", results: "STG.SETTINGS.chatCards.results", off: "STG.SETTINGS.chatCards.off"}},
  pigGoal: {type: Number, default: 50, range: {min: 20, max: 100, step: 10}}
};

/**
 * Switch the module strings when the user picks another module language.
 * @param {string} value
 */
function onLanguageChange(value) {
  applyModuleLanguage(value).then(() => {
    // The window title is part of the frame, which a normal redraw keeps
    foundry.applications.instances.get("stg-tavern")?.render({window: {title: t("STG.Title")}});
    document.querySelector("#chat-controls .stg-chat-button")?.setAttribute("aria-label", t("STG.Title"));
    refreshTavern();
    ui.controls?.render({reset: true});
    if ( game.settings.sheet?.rendered ) game.settings.sheet.render();
  });
}

/** The menu button which runs the self-test. */
class TavernSelfTestMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await runSelfTest();
    return this;
  }
}

/**
 * Register all settings of the module and the self-test menu button.
 */
export function registerSettings() {
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    game.settings.register(MODULE_ID, key, {
      name: `STG.SETTINGS.${key}.name`,
      hint: `STG.SETTINGS.${key}.hint`,
      scope: def.scope ?? "world",
      config: true,
      type: def.range ? new foundry.data.fields.NumberField({...def.range, initial: def.default}) : def.type,
      choices: def.choices,
      default: def.default,
      onChange: def.onChange
    });
  }
  // The tables, written by the active GM's client; every change redraws the tavern
  game.settings.register(MODULE_ID, "tables", {scope: "world", config: false, type: Array, default: [],
    onChange: () => refreshTavern()});
  // The games the GM switched off in the tavern settings; a new game of a later version is on offer at once
  game.settings.register(MODULE_ID, "disabledGames", {scope: "world", config: false, type: Array, default: [],
    onChange: () => refreshTavern()});
  game.settings.register(MODULE_ID, "acknowledgedVersions", {scope: "client", config: false, type: String, default: ""});
  game.settings.registerMenu(MODULE_ID, "tavernSettings", {
    name: "STG.Config.title",
    label: "STG.Config.menuLabel",
    hint: "STG.Config.menuHint",
    icon: "fa-solid fa-gear",
    type: TavernSettings,
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "STG.SELFTEST.Title",
    label: "STG.SELFTEST.Run",
    hint: "STG.SELFTEST.Hint",
    icon: "fa-solid fa-stethoscope",
    type: TavernSelfTestMenu,
    restricted: true
  });
}
