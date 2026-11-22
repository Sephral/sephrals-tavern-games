// Sample windows (api.samples, contract in samples.mjs): the tavern with a table of every game running and at its end,
// the suggestion for the break, the questions of the tavern, the chat cards and the picture of the evening, all with made
// up players. Nothing here writes: the tables, the ranking and the offer live in memory, every button that would change,
// post or share something only says that it does nothing, nothing is sent over the socket, no usage counter counts.

import {MODULE_ID, esc, t} from "./config.mjs";
import {LIVE_DATA, Tavern, addGuestContent, newTableForm, stakeChoiceContent} from "./app.mjs";
import {BreakOffer} from "./offer-app.mjs";
import {GAMES} from "./games/index.mjs";
import {cleanRanking, titleFor} from "./games/ranking.mjs";
import {adapterOf} from "./stakes.mjs";
import {currentShareModel, shareDialogOptions, shareMessageHtml} from "./share-actions.mjs";
import {renderShareImage} from "./share-image.mjs";
import {OPEN_ID, SCENE_IDS, buildOpenTable, buildRanking, buildTable, sampleSeats} from "./sample-tables.mjs";
import {inviteCardHtml, rankingCardHtml, resultCardHtml, eveningRows} from "./tables.mjs";
import {markSample, openSampleChat, openSampleHtml, sampleActions, sampleBlocked, sampleCast, sampleId} from "./samples.mjs";

/** Actions of the tavern window that only look: choose a table, show the guide, pick a man, open the settings. */
const LOOKING = ["choose", "toggleGuide", "morrisPick", "openSettings"];

/** Tables around the chosen one, so the list of the tavern looks lived in. */
const COMPANY = ["fourinarow-running", "tictactoe-draw", "pig-won"];

/** The made-up world: people at the tables, the tables and the evening's ranking, built once. */
let world = null;

function sampleWorld() {
  const seats = sampleSeats(sampleCast(), game.user.id);
  if ( world?.meId === game.user.id ) return world;
  world = {meId: game.user.id, seats, tables: new Map(), open: buildOpenTable(seats), ranking: buildRanking(seats)};
  return world;
}

/** A table of the scene id, built the first time it is asked for. */
function sceneTable(id) {
  const w = sampleWorld();
  if ( !w.tables.has(id) ) w.tables.set(id, buildTable(id, w.seats));
  return w.tables.get(id);
}

/**
 * Where the tavern window gets what it shows: the tables given, the ranking of the sample evening (or none), the offer.
 * @param {object} options
 * @returns {object}
 */
function sampleData({tables, ranking = true, offer = null, noGM = false, intro = false}) {
  const w = sampleWorld();
  const now = Date.now();
  const stored = ranking ? w.ranking : null;
  return {
    ...LIVE_DATA,
    tables: () => structuredClone(tables),
    eveningRows: () => (stored ? eveningRows(now, stored) : []),
    titleOf: userId => t(`STG.Rank.tier.${titleFor(cleanRanking(w.ranking).all[userId]?.wins ?? 0)}`),
    offer: () => offer,
    balance: (adapter, seat) => (adapter.purse ? (seat.sampleBalance ?? null) : 85),
    intro: () => intro,
    noGM: () => noGM
  };
}

/** The real tavern window over made-up data held in memory. */
class SampleTavern extends Tavern {
  constructor(key, {data, tableId = null, showGuide = false, peek = null}) {
    // Taller than the real window opens, so the board of every game fits without scrolling
    super({id: sampleId(MODULE_ID, key), actions: sampleActions(Tavern, LOOKING), position: {height: 780}});
    this.data = data;
    this.tableId = tableId;
    this.showGuide = showGuide;
    // The dice under the user's own cup, as the GM's client would have answered
    if ( peek ) this.peeked = new Map([[tableId, peek]]);
    markSample(this);
  }
}

async function openTavernSample(key, options) {
  const app = new SampleTavern(key, options);
  await foundry.applications.instances.get(app.id)?.close({animate: false}).catch(() => {});
  await app.render({force: true});
  return app;
}

/** The tavern with a scene's table chosen: running tables show the two line introduction, finished ones the guide. */
function openScene(id) {
  const w = sampleWorld();
  const {table, peek} = sceneTable(id);
  const done = table.status === "done";
  const tables = [table, w.open, ...COMPANY.filter(other => other !== id).map(other => sceneTable(other).table)];
  return openTavernSample(id, {data: sampleData({tables, intro: !done}), tableId: table.id, showGuide: done, peek});
}

function openWaiting() {
  const w = sampleWorld();
  const tables = [w.open, ...COMPANY.map(id => sceneTable(id).table)];
  return openTavernSample("waiting", {data: sampleData({tables}), tableId: OPEN_ID});
}

function openNoGM() {
  const {table, peek} = sceneTable("pig-running");
  return openTavernSample("no-gm", {data: sampleData({tables: [table], noGM: true}), tableId: table.id, peek});
}

function openGmOffer() {
  const w = sampleWorld();
  const {table} = sceneTable("pig-running");
  const offer = {id: "sample-offer", game: "matches", at: Date.now(), tableId: null};
  return openTavernSample("gm-offer", {data: sampleData({tables: [table, w.open], offer}), tableId: table.id});
}

function openEmpty() {
  return openTavernSample("empty", {data: sampleData({tables: [], ranking: false})});
}

/* -------------------------------------------- */
/*  The suggestion for the break                */
/* -------------------------------------------- */

class SampleOffer extends BreakOffer {
  constructor(key, snapshot) {
    super({id: sampleId(MODULE_ID, key), actions: sampleActions(BreakOffer, [])});
    this.shown = snapshot;
    markSample(this);
  }

  /** @override */
  snapshot() {
    return this.shown;
  }
}

async function openOffer(key, snapshot) {
  const app = new SampleOffer(key, snapshot);
  await foundry.applications.instances.get(app.id)?.close({animate: false}).catch(() => {});
  await app.render({force: true});
  return app;
}

/* -------------------------------------------- */
/*  Questions                                   */
/* -------------------------------------------- */

/**
 * A question of the tavern in a plain sample window: the real form content, its buttons do nothing.
 * @param {object} options
 * @param {string} options.key
 * @param {string} options.title
 * @param {() => string} options.content   The form (built again on every render)
 * @param {Function} [options.render]      The dialog's own render function that makes the form react
 * @param {string} options.ok              Label of the confirming button
 * @param {string} [options.cancel]
 * @param {(form: HTMLElement) => void} [options.prepare]   Show a state of the form
 */
function openQuestion({key, title, content, render = null, ok, cancel = game.i18n.localize("Cancel"), prepare = null}) {
  const body = () => {
    const wrap = document.createElement("div");
    wrap.className = "standard-form";
    const form = document.createElement("div");
    form.className = "sephral-sample-allowed";
    form.innerHTML = content();
    wrap.append(form);
    render?.(null, {element: wrap, setPosition: () => {}});
    prepare?.(form);
    const footer = document.createElement("footer");
    footer.className = "form-footer";
    footer.innerHTML = `<button type="button" class="default"><i class="fa-solid fa-check" inert></i> ${esc(ok)}</button>`
      + `<button type="button"><i class="fa-solid fa-xmark" inert></i> ${esc(cancel)}</button>`;
    wrap.append(footer);
    return wrap;
  };
  return openSampleHtml({moduleId: MODULE_ID, id: key, title, body, width: 420});
}

function openNewTable() {
  const adapter = adapterOf({stake: {mode: "dnd5e"}});
  const actors = [{id: "sample-ari", name: "Ari"}, {id: "sample-sela", name: "Sela"}];
  const form = newTableForm({offered: Object.values(GAMES), stakes: true, adapter, actors, own: "sample-ari",
    balance: seat => (seat.actorId ? 1250 : 85)});
  return openQuestion({key: "new-table", title: t("STG.Table.new"), content: () => form.content, render: form.render,
    ok: t("STG.Table.open"),
    // Show the stake rows: pick a game that takes a stake
    prepare: element => {
      const select = element.querySelector("select[name=game]");
      select.value = "twentyone";
      select.dispatchEvent(new Event("change"));
    }});
}

function openAddGuest() {
  return openQuestion({key: "add-guest", title: t("STG.Table.addGuest"), content: addGuestContent, ok: t("STG.Table.invite")});
}

function openJoinStake() {
  const table = sampleWorld().open;
  const adapter = adapterOf({stake: {mode: "dnd5e"}});
  const actors = [{id: "sample-ari", name: "Ari"}, {id: "sample-sela", name: "Sela"}];
  const stakeTable = {...table, stake: {amount: 500, mode: "dnd5e"}};
  return openQuestion({key: "join-stake", title: t("STG.Stake.chooseTitle"),
    content: () => stakeChoiceContent({table: stakeTable, adapter, actors, own: "sample-ari", balance: seat => (seat.actorId === "sample-ari" ? 1250 : 640)}),
    ok: t("STG.Table.join")});
}

function openConfirm(key, title, text) {
  return openQuestion({key, title, content: () => `<p>${esc(text)}</p>`, ok: game.i18n.localize("Yes"), cancel: game.i18n.localize("No")});
}

/* -------------------------------------------- */
/*  Chat cards and the picture of the evening   */
/* -------------------------------------------- */

const card = body => `<div class="stg-chat">${body}</div>`;

function openCard(key, title, body, kind) {
  return openSampleChat({moduleId: MODULE_ID, id: key, title, content: () => card(body()), flags: {[MODULE_ID]: {card: kind}},
    speaker: {alias: t("STG.Card.speaker")}});
}

/** The model of the picture of the sample evening. */
function shareModel() {
  const stored = sampleWorld().ranking;
  return currentShareModel(Date.now(), stored);
}

/** An object address of the picture, drawn once per window. */
async function pictureUrl() {
  return URL.createObjectURL(await renderShareImage(shareModel()));
}

async function openShareCard() {
  const url = await pictureUrl();
  const model = shareModel();
  return openSampleChat({moduleId: MODULE_ID, id: "share-card", title: t("STG.Share.title"), content: () => shareMessageHtml(url, model.title),
    flags: {[MODULE_ID]: {card: "shareImage"}}, speaker: {alias: t("STG.Card.speaker")}});
}

async function openShareWindow() {
  const {DialogV2} = foundry.applications.api;
  const model = shareModel();
  const blob = await renderShareImage(model);
  const previewUrl = URL.createObjectURL(blob);
  const bitmap = await createImageBitmap(blob);
  const ratio = ` style="aspect-ratio: ${bitmap.width} / ${bitmap.height}; --stg-ratio: ${bitmap.width / bitmap.height}"`;
  bitmap.close?.();
  const options = shareDialogOptions(model, previewUrl, ratio);
  const id = sampleId(MODULE_ID, "share-window");
  await foundry.applications.instances.get(id)?.close({animate: false}).catch(() => {});
  // The buttons do nothing: no copy, no file, no upload, no chat message
  const app = markSample(new DialogV2({...options, id, buttons: options.buttons.map(button => ({...button, callback: () => sampleBlocked()}))}));
  await app.render({force: true});
  // The picture is set here: the render option of a dialog only runs for the dialog's own wait()
  const picture = app.element.querySelector(".stg-share img");
  if ( picture ) picture.src = previewUrl;
  app.addEventListener?.("close", () => URL.revokeObjectURL(previewUrl));
  app.element.addEventListener("click", event => {
    const button = event.target.closest?.("button[data-action]");
    if ( !button || (button.dataset.action === "done") || (button.dataset.action === "close") ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sampleBlocked();
  }, true);
  return app;
}

/* -------------------------------------------- */

/**
 * The sample entries of the module (api.samples).
 * @returns {{id: string, label: string, group: string, open: () => Promise<Application>}[]}
 */
export function sampleWindows() {
  const tavern = t("STG.Sample.Group.tavern");
  const offerGroup = t("STG.Sample.Group.offer");
  const questions = t("STG.Sample.Group.questions");
  const chat = t("STG.Sample.Group.chat");
  const share = t("STG.Sample.Group.share");
  const label = key => t(`STG.Sample.Label.${key}`);
  const entries = SCENE_IDS.map(id => {
    const [gameId, state] = id.split("-");
    return {id, group: tavern, open: () => openScene(id),
      label: t("STG.Sample.Label.table", {game: t(`STG.Game.${gameId}.name`), state: t(`STG.Sample.State.${state}`)})};
  });
  const open = sampleWorld().open;
  entries.push(
    {id: "waiting", group: tavern, label: label("waiting"), open: openWaiting},
    {id: "no-gm", group: tavern, label: label("noGM"), open: openNoGM},
    {id: "gm-offer", group: tavern, label: label("gmOffer"), open: openGmOffer},
    {id: "empty", group: tavern, label: label("empty"), open: openEmpty},
    {id: "offer-waiting", group: offerGroup, label: label("offerWaiting"), open: () => openOffer("offer-waiting",
      {offer: {id: "sample-offer", game: open.game, at: Date.now(), tableId: open.id}, table: open, alone: false})},
    {id: "offer-alone", group: offerGroup, label: label("offerAlone"), open: () => openOffer("offer-alone",
      {offer: {id: "sample-offer", game: "pig", at: Date.now(), tableId: null}, table: null, alone: true})},
    {id: "offer-plain", group: offerGroup, label: label("offerPlain"), open: () => openOffer("offer-plain",
      {offer: {id: "sample-offer", game: "mexico", at: Date.now(), tableId: null}, table: null, alone: false})},
    {id: "question-new-table", group: questions, label: label("newTable"), open: openNewTable},
    {id: "question-add-guest", group: questions, label: label("addGuest"), open: openAddGuest},
    {id: "question-join-stake", group: questions, label: label("joinStake"), open: openJoinStake},
    {id: "question-leave", group: questions, label: label("leave"), open: () => openConfirm("leave", t("STG.Table.leave"), t("STG.Table.leaveConfirm"))},
    {id: "question-new-evening", group: questions, label: label("newEvening"),
      open: () => openConfirm("new-evening", t("STG.Rank.newEvening"), t("STG.Rank.newEveningConfirm"))},
    {id: "card-invite", group: chat, label: label("inviteCard"), open: () => openCard("card-invite", label("inviteCard"),
      () => inviteCardHtml({...open, stake: null}), "invite")},
    {id: "card-invite-stake", group: chat, label: label("inviteStakeCard"), open: () => openCard("card-invite-stake", label("inviteStakeCard"),
      () => inviteCardHtml(open), "invite")},
    {id: "card-result-draw", group: chat, label: label("resultDraw"), open: () => openCard("card-result-draw", label("resultDraw"),
      () => resultCardHtml(sceneTable("tictactoe-draw").table), "result")},
    {id: "card-result-stake", group: chat, label: label("resultStake"), open: () => openCard("card-result-stake", label("resultStake"),
      () => resultCardHtml(sceneTable("mexico-won").table), "result")},
    {id: "card-result-twentyone", group: chat, label: label("resultTwentyone"), open: () => openCard("card-result-twentyone",
      label("resultTwentyone"), () => resultCardHtml(sceneTable("twentyone-done").table), "result")},
    {id: "card-ranking", group: chat, label: label("rankingCard"), open: () => openCard("card-ranking", label("rankingCard"),
      () => rankingCardHtml(eveningRows(Date.now(), sampleWorld().ranking)), "ranking")},
    {id: "share-card", group: share, label: label("shareCard"), open: openShareCard},
    {id: "share-window", group: share, label: label("shareWindow"), open: openShareWindow}
  );
  return entries;
}

export const __test__ = {LOOKING, COMPANY};
