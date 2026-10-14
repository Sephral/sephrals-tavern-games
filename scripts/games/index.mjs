/**
 * The games of the tavern and the tavern guests who play them.
 */

import {fourinarow} from "./fourinarow.mjs";
import {liars} from "./liars.mjs";
import {matches} from "./matches.mjs";
import {morris} from "./morris.mjs";
import {pig} from "./pig.mjs";
import {ship} from "./ship.mjs";
import {tictactoe} from "./tictactoe.mjs";
import {twentyone} from "./twentyone.mjs";

/** The games by id, in the order of the menu. */
export const GAMES = {tictactoe, fourinarow, morris, matches, pig, ship, liars, twentyone};

/** Icons of the games (Font Awesome). */
export const ICONS = {tictactoe: "fa-hashtag", fourinarow: "fa-circle-dot", morris: "fa-chess-board",
  matches: "fa-grip-lines-vertical", pig: "fa-dice", ship: "fa-ship", liars: "fa-dice-d6", twentyone: "fa-clone"};

/** The tavern guests: who they are and how well they play. */
export const GUESTS = {
  bertram: {level: "easy", img: "icons/svg/mystery-man.svg"},
  mirela: {level: "medium", img: "icons/svg/mystery-man.svg"},
  jasper: {level: "hard", img: "icons/svg/mystery-man.svg"}
};

/**
 * A game by id.
 * @param {string} id
 * @returns {object}
 */
export function game(id) {
  const g = GAMES[id];
  if ( !g ) throw new Error("STG.Error.unknownGame");
  return g;
}

/**
 * Whether the tavern offers a game (the GM switches games off in the tavern settings).
 * @param {string} id
 * @param {string[]} [disabled]   Ids of the games switched off
 * @returns {boolean}
 */
export function gameOffered(id, disabled=[]) {
  return (id in GAMES) && !(disabled ?? []).includes(id);
}

/**
 * The state other users may see.
 * @param {object} g
 * @param {object} state
 * @returns {object}
 */
export function publicState(g, state) {
  return g.publicState ? g.publicState(state) : state;
}
