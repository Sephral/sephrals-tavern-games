/**
 * The tavern's part of the debug file of Sephral's modules: the tables in short (game, status, round, whose turn, who
 * sits there), the games on offer and the active GM who runs the tables. The stored tables hold only what everyone
 * sees, hidden dice and the dealer's face down card stay in the GM's memory and never reach the file.
 */

import {MODULE_ID, setting, t} from "./config.mjs";
import {registerDebugMenu, registerDebugProvider} from "./debug-file.mjs";
import {tables} from "./tables.mjs";

/**
 * A seat without names or pictures: a user by id, a tavern guest by its id.
 * @param {object} seat
 * @returns {string}
 */
function seatInfo(seat) {
  return seat?.kind === "guest" ? `guest:${seat.guest}` : `user:${seat?.userId ?? "?"}`;
}

/**
 * One table in short.
 * @param {object} table
 * @returns {object}
 */
export function tableInfo(table) {
  return {
    id: table.id,
    game: table.game,
    status: table.status,
    round: table.round ?? null,
    host: table.host ?? null,
    seats: (table.seats ?? []).map(seatInfo),
    turn: table.state?.turn ?? null,
    phase: table.state?.phase ?? null,
    result: table.result ?? null,
    created: table.created ?? null,
    updated: table.updated ?? null
  };
}

/**
 * The state of the tavern.
 * @returns {object}
 */
export function describeState() {
  return {
    activeGM: game.users?.activeGM?.id ?? null,
    disabledGames: setting("disabledGames") ?? [],
    chatCards: setting("chatCards") ?? null,
    tables: tables().map(tableInfo)
  };
}

/**
 * Register the menu button and the part of the debug file. Call in "init". t() follows a fixed module language.
 */
export function registerDebug() {
  registerDebugMenu(MODULE_ID, {name: "STG.DEBUG.Title", label: "STG.DEBUG.Save", hint: "STG.DEBUG.Hint"});
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => t("STG.DEBUG.Entry"),
    notice: file => t("STG.DEBUG.Saved", {file}),
    // The invitation and result cards of the tavern
    applies: message => !!message?.flags?.[MODULE_ID]?.card,
    message: message => ({card: message.flags[MODULE_ID].card, tavern: describeState()}),
    recent: () => ({details: describeState()}),
    // The stored tables are summarized above
    omitSettings: ["tables"]
  });
}
