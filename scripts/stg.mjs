import {MODULE_ID, t} from "./config.mjs";
import {openTavern, refreshTavern, report} from "./app.mjs";
import {GAMES, GUESTS} from "./games/index.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {registerSocket, request} from "./net.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {registerSettings} from "./settings.mjs";
import {openSettings} from "./config-app.mjs";
import {handleRequest, resumeGuests, tables} from "./tables.mjs";

/** The tool in the token controls. */
const TOOL = "stg-tavern";

Hooks.once("init", () => {
  registerSettings();
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  game.modules.get(MODULE_ID).api = {
    /** Open the tavern, optionally at a table. */
    open: openTavern,
    /** Open the tavern settings (games on offer for the GM, the module language for everyone). */
    settings: openSettings,
    /** Send a request like the window does: create, join, addGuest, start, move, rematch, leave, close. */
    request,
    /** The tables as stored. */
    tables,
    /** The games and the tavern guests. */
    games: GAMES,
    guests: GUESTS,
    /** Every game plays a round against itself (GM). */
    runSelfTest
  };
});

/** Applying a fixed module language loads its file; the rest of "ready" waits for it. */
let languageReady = Promise.resolve();

Hooks.once("i18nInit", () => {
  languageReady = applyModuleLanguage(game.settings.get(MODULE_ID, "uiLanguage"));
});

Hooks.once("ready", async () => {
  await languageReady;
  registerSocket(handleRequest);
  resumeGuests();
  noticeNewVersions();
  refreshTavern();
});

/**
 * Hook "getSceneControlButtons": the tavern in the token controls.
 * @param {Record<string, object>|object[]} controls
 */
function onGetSceneControlButtons(controls) {
  const tokens = controls?.tokens ?? (Array.isArray(controls) ? controls.find(c => c.name === "token") : null);
  if ( !tokens ) return;
  const tool = {name: TOOL, title: "STG.Title", icon: "fa-solid fa-beer-mug-empty", button: true, visible: true,
    onChange: () => openTavern()};
  if ( Array.isArray(tokens.tools) ) tokens.tools.push({...tool, onClick: tool.onChange});
  else {
    tool.order = Object.keys(tokens.tools ?? {}).length;
    tokens.tools[TOOL] = tool;
  }
}

/**
 * Hook "renderChatMessageHTML": the buttons of the tavern's chat messages.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function onRenderChatMessage(message, html) {
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  if ( !element ) return;
  for ( const button of element.querySelectorAll("button[data-stg-open]") ) {
    button.addEventListener("click", event => {
      event.preventDefault();
      openTavern({tableId: button.dataset.stgOpen});
    });
  }
  for ( const button of element.querySelectorAll("button[data-stg-join]") ) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      const tableId = button.dataset.stgJoin;
      const table = tables().find(x => x.id === tableId);
      if ( !table ) return ui.notifications.warn(t("STG.Error.tableGone"));
      const seated = table.seats.some(seat => seat.userId === game.user.id);
      if ( !seated && (table.status === "open") ) report(await request("join", {tableId}));
      openTavern({tableId});
    });
  }
}
