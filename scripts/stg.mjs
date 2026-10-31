import {MODULE_ID, TESTED_VERSIONS, t} from "./config.mjs";
import {openTavern, refreshTavern, report} from "./app.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {registerHubModule} from "./hub.mjs";
import {GAMES, GUESTS} from "./games/index.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {registerSocket, request} from "./net.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {registerSettings} from "./settings.mjs";
import {openSettings} from "./config-app.mjs";
import {GAME_FEATURES, handleRequest, resumeGuests, tables} from "./tables.mjs";
import {registerUsage} from "./usage.mjs";

/** The tool in the token controls. */
const TOOL = "stg-tavern";

Hooks.once("init", () => {
  registerHubModule({moduleId: MODULE_ID, tested: TESTED_VERSIONS});
  registerSettings();
  registerDebug();
  registerUsage(MODULE_ID, {features: Object.values(GAME_FEATURES), settings: ["chatCards", "pigGoal"]});
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("renderChatInput", (app, elements) => addChatButton(elements?.["#chat-controls"]));
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
    runSelfTest,
    /** Save the debug file of Sephral's modules (GM): about one chat message, or without an id the latest picture. */
    saveDebugFile: messageId => saveDebugFile(messageId ?? null, {moduleId: MODULE_ID})
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
  addChatButton(document.getElementById("chat-controls"));
});

/**
 * The tavern button in the chat controls, for everyone. Foundry ignores the token controls while no scene is shown,
 * so in theater of the mind this is the way in. Gamemasters get it next to Export and Clear, which Foundry hides
 * while the chat floats over the canvas; players get their own group, hidden the same way.
 * @param {HTMLElement|null} controls   The element #chat-controls, which Foundry moves between sidebar and canvas
 */
export function addChatButton(controls) {
  if ( !(controls instanceof HTMLElement) ) return;
  let button = controls.querySelector(".stg-chat-button");
  if ( !button ) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "ui-control icon fa-solid fa-beer-mug-empty stg-chat-button";
    button.dataset.tooltip = "";
    button.addEventListener("click", event => {
      event.preventDefault();
      openTavern();
    });
    const core = game.user.isGM ? controls.querySelector(".control-buttons:not(.stg-chat-controls)") : null;
    if ( core ) core.prepend(button);
    else {
      const group = document.createElement("div");
      group.className = "control-buttons stg-chat-controls";
      group.append(button);
      controls.append(group);
    }
  }
  button.setAttribute("aria-label", t("STG.Title"));
  const group = button.closest(".stg-chat-controls");
  if ( group ) group.hidden = !!controls.closest("#chat-notifications");
}

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
