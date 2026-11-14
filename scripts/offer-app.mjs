/**
 * The suggestion for the break on the players' screens: a small friendly window with one suggested game and one
 * button to sit down. The GM's client writes the offer into a world setting (when the game is paused or when the GM
 * asks for it), every client shows it. Nothing pops up for the GM, and a player can wave it away with "Not now".
 */

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

import {TEMPLATES, setting, t} from "./config.mjs";
import {GUESTS, ICONS, game as rules, gameOffered} from "./games/index.mjs";
import {openTavern, report} from "./app.mjs";
import {request} from "./net.mjs";
import {OFFER_MINUTES, offerExpired} from "./suggest-rules.mjs";
import {currentOffer, seatName, tables} from "./tables.mjs";

/** When this client first saw each offer: the clocks of the computers may differ, so each counts for itself. */
const seen = new Map();

/** Offers this player waved away or accepted. */
const dismissed = new Set();

/** Closes the window when the offer runs out. */
let expiry = null;

/** The window while it exists. A window only shows up in Foundry's list once it is rendered, and two changes of the
 * settings in a row must not open two. */
let current = null;

export class BreakOffer extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stg-offer",
    classes: ["stg-offer"],
    window: {title: "STG.Offer.title", icon: "fa-solid fa-beer-mug-empty", resizable: false, minimizable: false},
    position: {width: 340, height: "auto", top: 110},
    actions: {join: BreakOffer.#onJoin, later: BreakOffer.#onLater}
  };

  /** @override */
  static PARTS = {
    body: {template: `${TEMPLATES}/offer.hbs`}
  };

  /** @override */
  get title() {
    return t("STG.Offer.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const offer = currentOffer();
    const table = offer?.tableId ? tables().find(x => x.id === offer.tableId) : null;
    const waiting = table && (table.status === "open") && (table.seats.length < rules(table.game).seats.max);
    const alone = game.users.filter(u => u.active && !u.isGM).length < 2;
    context.icon = ICONS[offer?.game] ?? "fa-dice";
    context.lead = offer ? t("STG.Offer.lead", {game: t(`STG.Game.${offer.game}.name`)}) : "";
    context.waiting = waiting ? t("STG.Offer.waiting", {names: table.seats.map(seatName).join(", ")}) : "";
    context.alone = (!waiting && alone) ? t("STG.Offer.alone", {name: t(`STG.Guest.${Object.keys(GUESTS)[0]}.name`)}) : "";
    return context;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Bottom middle of the screen's upper part, where it does not cover the board
    const width = this.position.width;
    this.setPosition({left: Math.max((window.innerWidth - width) / 2, 0)});
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if ( current === this ) current = null;
  }

  /** @this {BreakOffer} */
  static async #onJoin() {
    const offer = currentOffer();
    if ( !offer ) return this.close();
    const result = await request("suggestJoin", {offerId: offer.id});
    if ( !report(result) ) {
      if ( result?.error === "STG.Error.offerGone" ) this.close();
      return;
    }
    dismissed.add(offer.id);
    await this.close();
    openTavern({tableId: result.tableId});
  }

  /** @this {BreakOffer} */
  static #onLater() {
    const offer = currentOffer();
    if ( offer ) dismissed.add(offer.id);
    this.close();
  }
}

/**
 * Does this user sit at a table that is not over?
 * @returns {boolean}
 */
function seated() {
  return tables().some(table => (table.status !== "done") && table.seats.some(seat => (seat.userId === game.user.id) && !seat.left));
}

/**
 * Show, update or close the offer on this client. Call after a change of the offer or the tables and on "ready".
 */
export function syncOffer() {
  const app = current ?? foundry.applications.instances.get(BreakOffer.DEFAULT_OPTIONS.id);
  const shown = !!app && ((app.state === ApplicationV2.RENDER_STATES.RENDERED) || (app.state === ApplicationV2.RENDER_STATES.RENDERING));
  const close = () => {
    clearTimeout(expiry);
    if ( shown ) app.close();
  };
  const offer = currentOffer();
  if ( game.user.isGM || !offer || dismissed.has(offer.id) || !gameOffered(offer.game, setting("disabledGames") ?? []) || seated() ) {
    return close();
  }
  if ( !seen.has(offer.id) ) seen.set(offer.id, Date.now());
  const left = (OFFER_MINUTES * 60 * 1000) - (Date.now() - seen.get(offer.id));
  if ( offerExpired(seen.get(offer.id), Date.now()) ) return close();
  clearTimeout(expiry);
  expiry = setTimeout(syncOffer, left + 500);
  if ( shown ) app.render();
  else {
    current = app ?? new BreakOffer();
    current.render({force: true});
  }
}
