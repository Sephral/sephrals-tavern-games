/**
 * The tavern window: the tables on the left, the chosen table with its board on the right. Everyone may watch every
 * table; the players at a table make their moves here.
 */

const {ApplicationV2, HandlebarsApplicationMixin, DialogV2} = foundry.applications.api;

import {MODULE_ID, TEMPLATES, esc, setting, t} from "./config.mjs";
import {openSettings} from "./config-app.mjs";
import {GAMES, GUESTS, ICONS, gameOffered} from "./games/index.mjs";
import {COLS, ROWS, winningLine as fourLine} from "./games/fourinarow.mjs";
import {POINTS as MORRIS_POINTS} from "./games/morris.mjs";
import {THROWS, cargo} from "./games/ship.mjs";
import {winningLine as tttLine} from "./games/tictactoe.mjs";
import {handValue} from "./games/twentyone.mjs";
import {request} from "./net.mjs";
import {resultText, seatName, tables} from "./tables.mjs";

export {ICONS};

/** Die faces as Font Awesome icons. */
const DICE = ["", "fa-dice-one", "fa-dice-two", "fa-dice-three", "fa-dice-four", "fa-dice-five", "fa-dice-six"];

/** Suit symbols. */
const SUITS = {S: "♠", H: "♥", D: "♦", C: "♣"};

/**
 * Open the tavern, optionally at a table.
 * @param {object} [options]
 * @param {string} [options.tableId]
 * @returns {Promise<Tavern>}
 */
export async function openTavern({tableId}={}) {
  const app = foundry.applications.instances.get(Tavern.DEFAULT_OPTIONS.id) ?? new Tavern();
  if ( tableId ) app.tableId = tableId;
  await app.render({force: true});
  app.bringToFront?.();
  return app;
}

/** Redraw the tavern if it is open, and tell a player whose turn begins at a table. */
export function refreshTavern() {
  const app = foundry.applications.instances.get(Tavern.DEFAULT_OPTIONS.id);
  if ( app?.rendered ) app.render();
  noticeTurns(!!app?.rendered);
}

/** The tables where it was this user's turn at the last change. */
const myTurns = new Set();

/**
 * A notification when this user's turn begins at a table and the tavern is closed.
 * @param {boolean} open
 */
function noticeTurns(open) {
  const now = new Set();
  for ( const table of tables() ) {
    if ( table.status !== "playing" ) continue;
    const seat = table.seats[table.state?.turn];
    if ( (seat?.kind === "user") && (seat.userId === game.user.id) ) now.add(table.id);
  }
  for ( const id of now ) {
    if ( myTurns.has(id) || open ) continue;
    const table = tables().find(x => x.id === id);
    ui.notifications.info(t("STG.Notice.yourTurn", {game: t(`STG.Game.${table.game}.name`)}));
  }
  myTurns.clear();
  for ( const id of now ) myTurns.add(id);
}

/**
 * Show the answer of a request if it failed.
 * @param {{ok: boolean, error?: string}} result
 * @returns {boolean}
 */
export function report(result) {
  if ( result?.ok ) return true;
  const key = result?.error ?? "STG.Error.failed";
  ui.notifications.warn(game.i18n.has(key) ? t(key) : key);
  return false;
}

/**
 * A card for the view.
 * @param {string|null} card
 * @returns {{label: string, suit: string, red: boolean, hidden: boolean}}
 */
function cardView(card) {
  if ( !card ) return {hidden: true, label: "", suit: "", red: false};
  const suit = card.slice(-1);
  return {hidden: false, label: card.slice(0, -1), suit: SUITS[suit], red: (suit === "H") || (suit === "D")};
}

/* -------------------------------------------- */

export class Tavern extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stg-tavern",
    classes: ["stg-tavern"],
    window: {title: "STG.Title", icon: "fa-solid fa-beer-mug-empty", resizable: true},
    position: {width: 900, height: 640},
    actions: {
      choose: Tavern.#onChoose,
      newTable: Tavern.#onNewTable,
      join: Tavern.#onJoin,
      start: Tavern.#onStart,
      addGuest: Tavern.#onAddGuest,
      play: Tavern.#onPlay,
      rematch: Tavern.#onRematch,
      leave: Tavern.#onLeave,
      closeTable: Tavern.#onCloseTable,
      openSettings: () => openSettings(),
      toggleGuide: Tavern.#onToggleGuide,
      morrisPick: Tavern.#onMorrisPick,
      liarsBid: Tavern.#onLiarsBid
    }
  };

  /** @override */
  static PARTS = {
    main: {template: `${TEMPLATES}/tavern.hbs`}
  };

  /** The table shown. */
  tableId = null;

  /** Whether the guide of the game is shown while it runs (it always shows while a table waits). */
  showGuide = false;

  /** The man chosen to move at nine men's morris: {tableId, point}. */
  morrisFrom = null;

  /** The dice under the user's own cup at liar's dice, by table id: {rollId, dice}. */
  peeked = new Map();

  /** Tables whose dice are being asked for. */
  #peeking = new Set();

  /** @override */
  get title() {
    return t("STG.Title");
  }

  /**
   * The gear in the title bar opens the tavern settings.
   * @override
   */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const header = frame.querySelector(".window-header");
    if ( header && !header.querySelector("[data-action=openSettings]") ) {
      const gear = document.createElement("button");
      gear.type = "button";
      gear.className = "header-control icon fa-solid fa-gear";
      gear.dataset.action = "openSettings";
      const anchor = header.querySelector("[data-action=toggleControls]") ?? header.querySelector("[data-action=close]");
      if ( anchor ) anchor.before(gear);
      else header.append(gear);
    }
    return frame;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // The module language may change while the window is open
    const gear = this.window?.header?.querySelector("[data-action=openSettings]") ?? this.element.querySelector("[data-action=openSettings]");
    if ( gear ) {
      gear.dataset.tooltip = t("STG.Config.open");
      gear.setAttribute("aria-label", t("STG.Config.open"));
    }
    this.#peekDice();
  }

  /**
   * Ask the GM's client for the dice under the user's cup when the cups were shaken since the last look.
   */
  async #peekDice() {
    const table = tables().find(x => x.id === this.tableId);
    if ( !table || (table.status !== "playing") || !GAMES[table.game]?.peek ) return;
    if ( !table.seats.some(seat => (seat.userId === game.user.id) && !seat.left) ) return;
    if ( (this.peeked.get(table.id)?.rollId === table.state.rollId) || this.#peeking.has(table.id) ) return;
    this.#peeking.add(table.id);
    try {
      const answer = await request("peek", {tableId: table.id});
      if ( answer?.ok ) this.peeked.set(table.id, {rollId: table.state.rollId, dice: answer.dice});
    } finally {
      this.#peeking.delete(table.id);
    }
    if ( this.peeked.has(table.id) && this.rendered ) this.render();
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const disabled = setting("disabledGames") ?? [];
    context.canCreate = Object.keys(GAMES).some(id => gameOffered(id, disabled));
    context.isGM = game.user.isGM;
    const list = tables().sort((a, b) => {
      const rank = {playing: 0, open: 1, done: 2};
      return (rank[a.status] - rank[b.status]) || (b.updated - a.updated);
    });
    const mine = table => table.seats.some(seat => seat.userId === game.user.id);
    if ( !list.some(table => table.id === this.tableId) ) {
      this.tableId = (list.find(table => mine(table) && (table.status !== "done")) ?? list[0])?.id ?? null;
    }
    context.noGM = !game.users.activeGM;
    context.tables = list.map(table => ({
      id: table.id, icon: ICONS[table.game], game: t(`STG.Game.${table.game}.name`),
      players: table.seats.map(seatName).join(", "), status: t(`STG.Status.${table.status}`),
      statusClass: table.status, selected: table.id === this.tableId, mine: mine(table)
    }));
    const table = list.find(x => x.id === this.tableId);
    if ( table ) context.table = this.#tableView(table);
    return context;
  }

  /**
   * Everything the template needs for one table.
   * @param {object} table
   * @returns {object}
   */
  #tableView(table) {
    const g = GAMES[table.game];
    const me = table.seats.findIndex(seat => seat.userId === game.user.id);
    const state = table.state;
    const playing = table.status === "playing";
    const turn = playing ? state?.turn : null;
    const myTurn = playing && (me >= 0) && (turn === me);
    const view = {
      id: table.id, game: table.game, name: t(`STG.Game.${table.game}.name`), guide: t(`STG.Game.${table.game}.guide`),
      showGuide: (table.status === "open") || this.showGuide,
      icon: ICONS[table.game], status: table.status, myTurn, isHost: table.host === game.user.id,
      seats: table.seats.map((seat, i) => ({name: seatName(seat), img: seat.img, isTurn: turn === i, isMe: i === me,
        guest: seat.kind === "guest", level: seat.level ? t(`STG.Level.${seat.level}`) : "",
        mark: (table.game === "tictactoe") ? ["x", "o"][i] : (table.game === "fourinarow") ? ["red", "yellow"][i] : "",
        winner: !!table.result?.winners?.includes(i), left: !!seat.left}))
    };
    const left = (me >= 0) && !!table.seats[me].left;
    // What the user may do at this table
    const free = g.seats.max - table.seats.length;
    view.canJoin = (table.status === "open") && (me < 0) && (free > 0);
    view.canStart = (table.status === "open") && (view.isHost || game.user.isGM) && (table.seats.length >= g.seats.min);
    view.canAddGuest = (table.status === "open") && (view.isHost || game.user.isGM) && g.guests && (free > 0);
    view.canRematch = (table.status === "done") && (((me >= 0) && !left) || game.user.isGM)
      && gameOffered(table.game, setting("disabledGames") ?? []);
    view.canLeave = (me >= 0) && !left && (table.status !== "done");
    view.canClose = view.isHost || game.user.isGM;
    // The line under the title
    if ( table.status === "open" ) view.line = t("STG.Table.waiting", {free});
    else if ( table.status === "done" ) view.line = resultText(table);
    else if ( turn !== null && turn !== undefined ) {
      view.line = myTurn ? t("STG.Table.yourTurn") : t("STG.Table.turnOf", {name: seatName(table.seats[turn])});
    }
    if ( state ) Object.assign(view, this.#boardView(table, myTurn, me));
    return view;
  }

  /**
   * The board of a table.
   * @param {object} table
   * @param {boolean} myTurn
   * @param {number} me
   * @returns {object}
   */
  #boardView(table, myTurn, me) {
    const s = table.state;
    switch ( table.game ) {
      case "tictactoe": {
        const line = tttLine(s.board) ?? [];
        return {ttt: s.board.map((cell, i) => ({i, mark: cell === null ? null : ["x", "o"][cell],
          playable: myTurn && (cell === null), win: line.includes(i), last: s.last === i}))};
      }
      case "fourinarow": {
        const line = fourLine(s.board) ?? [];
        const rows = [];
        for ( let r = 0; r < ROWS; r++ ) {
          rows.push([...Array(COLS).keys()].map(c => {
            const i = (r * COLS) + c;
            const cell = s.board[i];
            return {mark: cell === null ? null : ["red", "yellow"][cell], win: line.includes(i), last: s.last === i};
          }));
        }
        return {four: {rows, columns: [...Array(COLS).keys()].map(c => ({c, playable: myTurn && (s.board[c] === null)}))}};
      }
      case "matches":
        return {matches: {sticks: Array.from({length: s.start}, (_, i) => ({gone: i >= s.left})), left: s.left,
          takes: [1, 2, 3].map(n => ({n, playable: myTurn && (n <= s.left)})),
          last: s.taken.at(-1) ? t("STG.Matches.took", {name: seatName(table.seats[s.taken.at(-1).seat]),
            count: s.taken.at(-1).count}) : ""}};
      case "pig":
        return {pig: {goal: s.goal, turnTotal: s.turnTotal, rolls: s.rolls.map(n => DICE[n]),
          lastRoll: s.lastRoll ? DICE[s.lastRoll] : "", busted: s.busted,
          scores: table.seats.map((seat, i) => ({name: seatName(seat), score: s.scores[i], left: !!seat.left,
            percent: Math.min(100, Math.round((s.scores[i] / s.goal) * 100)), isTurn: s.turn === i})),
          canRoll: myTurn, canHold: myTurn && (s.turnTotal > 0)}};
      case "twentyone": {
        const done = s.phase === "done";
        return {twentyone: {
          dealer: s.dealer.map(cardView), dealerTotal: done ? handValue(s.dealer).total : handValue([s.dealer[0]]).total,
          dealerName: t("STG.Guest.dealer.name"), done,
          hands: table.seats.map((seat, i) => ({name: seatName(seat), cards: s.hands[i].map(cardView),
            total: handValue(s.hands[i]).total, left: !!seat.left, busted: s.busted[i] && !seat.left,
            stood: s.stood[i] && !s.busted[i] && !seat.left,
            isTurn: s.turn === i, isMe: i === me, result: done ? t(`STG.Twentyone.${s.results[i]}`) : "",
            resultClass: done ? s.results[i] : ""})),
          canPlay: myTurn}};
      }
      case "morris": return {morris: this.#morrisView(table, myTurn, me)};
      case "liars": return {liars: this.#liarsView(table, myTurn, me)};
      case "ship": return {ship: this.#shipView(table, myTurn, me)};
    }
    return {};
  }

  /**
   * The board of nine men's morris: points on the grid, the user's men to pick and the points to move to.
   * @param {object} table
   * @param {boolean} myTurn
   * @param {number} me
   * @returns {object}
   */
  #morrisView(table, myTurn, me) {
    const s = table.state;
    const g = GAMES.morris;
    const moves = myTurn ? g.moves(s, me) : [];
    const from = (this.morrisFrom?.tableId === table.id) ? this.morrisFrom.point : null;
    const placing = myTurn && (s.phase === "turn") && (s.hand[me] > 0);
    const points = MORRIS_POINTS.map(([x, y], i) => {
      let move = null;
      let pick = false;
      if ( myTurn && (s.phase === "remove") && moves.includes(`r:${i}`) ) move = `r:${i}`;
      else if ( placing && moves.includes(`p:${i}`) ) move = `p:${i}`;
      else if ( myTurn && (s.phase === "turn") && !placing ) {
        if ( (from !== null) && moves.includes(`m:${from}-${i}`) ) move = `m:${from}-${i}`;
        else if ( (s.board[i] === me) && moves.some(m => m.startsWith(`m:${i}-`)) ) pick = true;
      }
      return {i, left: (((x + 0.5) / 7) * 100).toFixed(2), top: (((y + 0.5) / 7) * 100).toFixed(2),
        man: s.board[i] === null ? "" : ["white", "black"][s.board[i]], last: !!s.last?.includes(i), mill: !!s.mill?.includes(i),
        selected: from === i, move, pick, take: !!move?.startsWith("r:")};
    });
    let hint = "";
    if ( myTurn && (s.phase === "remove") ) hint = t("STG.Morris.take");
    else if ( myTurn && !placing ) hint = from === null ? t("STG.Morris.pick") : t("STG.Morris.target");
    return {points, hint, hands: table.seats.map((seat, i) => ({name: seatName(seat), mark: ["white", "black"][i],
      hand: t("STG.Morris.hand", {count: s.hand[i]}), board: s.board.filter(c => c === i).length}))};
  }

  /**
   * Liar's dice: the cups of everyone, the user's own dice, the bid on the table and the last lifting of the cups.
   * @param {object} table
   * @param {boolean} myTurn
   * @param {number} me
   * @returns {object}
   */
  #liarsView(table, myTurn, me) {
    const s = table.state;
    const peek = this.peeked.get(table.id);
    const mine = (peek?.rollId === s.rollId) ? peek.dice : null;
    const total = s.counts.reduce((a, b) => a + b, 0);
    const view = {
      cups: table.seats.map((seat, i) => ({name: seatName(seat), count: s.counts[i], dice: Array(s.counts[i]).fill(0),
        isTurn: s.turn === i, out: s.counts[i] === 0, isMe: i === me})),
      mine: mine?.map(n => ({icon: DICE[n]})) ?? null, seated: (me >= 0) && !table.seats[me].left && (s.counts[me] > 0),
      bid: s.bid ? t("STG.Liars.currentBid", {name: seatName(table.seats[s.bid.seat]), count: s.bid.count}) : t("STG.Liars.noBid"),
      bidFace: s.bid ? DICE[s.bid.face] : "",
      canBid: myTurn, canCall: myTurn && !!s.bid
    };
    if ( myTurn ) {
      const first = s.bid ? s.bid.count : 1;
      const suggested = s.bid ? (s.bid.face < 6 ? s.bid.face + 1 : 1) : 6;
      view.counts = Array.from({length: total - first + 1}, (_, k) => ({n: first + k,
        selected: (first + k) === (s.bid && (s.bid.face === 6) ? first + 1 : first)}));
      view.faces = [1, 2, 3, 4, 5, 6].map(n => ({n, selected: n === suggested}));
    }
    if ( s.reveal ) {
      const r = s.reveal;
      view.reveal = {
        cups: table.seats.map((seat, i) => ({name: seatName(seat), dice: (r.dice[i] ?? []).map(n => ({icon: DICE[n], hit: n === r.bid.face}))}))
          .filter(cup => cup.dice.length),
        text: t(r.holds ? "STG.Liars.revealHolds" : "STG.Liars.revealLie", {caller: seatName(table.seats[r.caller]),
          name: seatName(table.seats[r.bid.seat]), count: r.bid.count, shown: r.shown, loser: seatName(table.seats[r.loser])}),
        face: DICE[r.bid.face]
      };
    }
    return view;
  }

  /**
   * Ship, captain and crew: what is aboard, the free dice, the throws left and the cargo of everyone.
   * @param {object} table
   * @param {boolean} myTurn
   * @param {number} me
   * @returns {object}
   */
  #shipView(table, myTurn, me) {
    const s = table.state;
    const moves = myTurn ? GAMES.ship.moves(s, me) : [];
    return {
      crew: [["ship", "fa-ship"], ["captain", "fa-user-tie"], ["crew", "fa-people-group"]].map(([key, icon], k) => ({
        icon, label: t(`STG.Ship.${key}`), aboard: s[key], face: DICE[6 - k]})),
      dice: s.dice.map(n => ({icon: DICE[n]})),
      throwsLeft: t("STG.Ship.throws", {count: THROWS - s.throws}),
      cargo: s.crew ? t("STG.Ship.cargo", {value: cargo(s)}) : t("STG.Ship.noCrew"),
      scores: table.seats.map((seat, i) => ({name: seatName(seat), score: s.scores[i], played: s.scores[i] !== null,
        isTurn: s.turn === i, left: !!seat.left, winner: !!table.result?.winners?.includes(i)})),
      last: s.last ? t("STG.Ship.last", {name: seatName(table.seats[s.last.seat]), score: s.last.score}) : "",
      done: table.status === "done",
      canRoll: moves.includes("roll"), canStop: moves.includes("stop")
    };
  }

  /* -------------------------------------------- */

  /** @this {Tavern} */
  static #onChoose(event, target) {
    this.tableId = target.closest("[data-table-id]").dataset.tableId;
    this.render();
  }

  /** @this {Tavern} */
  static #onMorrisPick(event, target) {
    const point = Number(target.dataset.point);
    const same = (this.morrisFrom?.tableId === this.tableId) && (this.morrisFrom.point === point);
    this.morrisFrom = same ? null : {tableId: this.tableId, point};
    this.render();
  }

  /** @this {Tavern} */
  static async #onLiarsBid(event, target) {
    const felt = target.closest("[data-table-id]");
    const count = felt.querySelector("select[name=liarsCount]")?.value;
    const face = felt.querySelector("select[name=liarsFace]")?.value;
    for ( const b of this.element.querySelectorAll("[data-action=play], [data-action=liarsBid]") ) b.disabled = true;
    const result = await request("move", {tableId: felt.dataset.tableId, move: `b:${count}:${face}`});
    if ( !report(result) ) this.render();
  }

  /** @this {Tavern} */
  static #onToggleGuide() {
    this.showGuide = !this.showGuide;
    this.render();
  }

  /** @this {Tavern} */
  static async #onNewTable() {
    const disabled = setting("disabledGames") ?? [];
    const offered = Object.values(GAMES).filter(g => gameOffered(g.id, disabled));
    if ( !offered.length ) return ui.notifications.warn(t("STG.NoGames"));
    const games = offered.map(g => `<option value="${g.id}">${esc(t(`STG.Game.${g.id}.name`))}</option>`).join("");
    const guests = Object.entries(GUESTS).map(([id, g]) => `<option value="${id}">${esc(t(`STG.Guest.${id}.name`))} `
      + `(${esc(t(`STG.Level.${g.level}`))})</option>`).join("");
    const result = await DialogV2.prompt({
      window: {title: t("STG.Table.new")},
      content: `<div class="form-group"><label>${esc(t("STG.Table.game"))}</label><select name="game">${games}</select></div>`
        + `<div class="form-group"><label>${esc(t("STG.Table.opponent"))}</label><select name="opponent">`
        + `<option value="">${esc(t("STG.Table.players"))}</option>${guests}</select></div>`
        + `<blockquote class="stg-guide" data-stg-guide>${esc(t(`STG.Game.${offered[0].id}.guide`))}</blockquote>`
        + `<p class="hint">${esc(t("STG.Table.newHint"))}</p>`,
      rejectClose: false,
      // The guide follows the chosen game
      render: (event, dialog) => {
        const select = dialog.element.querySelector("select[name=game]");
        const guide = dialog.element.querySelector("[data-stg-guide]");
        select?.addEventListener("change", () => guide.textContent = t(`STG.Game.${select.value}.guide`));
      },
      ok: {label: t("STG.Table.open"), callback: (event, button) => ({game: button.form.elements.game.value,
        guest: button.form.elements.opponent.value || null})}
    });
    if ( !result ) return;
    const answer = await request("create", result);
    if ( report(answer) ) {
      this.tableId = answer.tableId;
      this.render();
    }
  }

  /**
   * The table id of a button.
   * @param {HTMLElement} target
   * @returns {string}
   */
  static #table(target) {
    return target.closest("[data-table-id]")?.dataset.tableId;
  }

  /** @this {Tavern} */
  static async #onJoin(event, target) {
    report(await request("join", {tableId: Tavern.#table(target)}));
  }

  /** @this {Tavern} */
  static async #onStart(event, target) {
    report(await request("start", {tableId: Tavern.#table(target)}));
  }

  /** @this {Tavern} */
  static async #onAddGuest(event, target) {
    const guests = Object.entries(GUESTS).map(([id, g]) => `<option value="${id}">${esc(t(`STG.Guest.${id}.name`))} `
      + `(${esc(t(`STG.Level.${g.level}`))})</option>`).join("");
    const guest = await DialogV2.prompt({
      window: {title: t("STG.Table.addGuest")},
      content: `<div class="form-group"><label>${esc(t("STG.Table.guest"))}</label><select name="guest">${guests}</select></div>`,
      rejectClose: false,
      ok: {label: t("STG.Table.invite"), callback: (event, button) => button.form.elements.guest.value}
    });
    if ( guest ) report(await request("addGuest", {tableId: Tavern.#table(target), guest}));
  }

  /** @this {Tavern} */
  static async #onPlay(event, target) {
    const raw = target.dataset.move;
    const move = /^\d+$/.test(raw) ? Number(raw) : raw;
    for ( const b of this.element.querySelectorAll("[data-action=play]") ) b.disabled = true;
    this.morrisFrom = null;
    const result = await request("move", {tableId: Tavern.#table(target), move});
    if ( !report(result) ) this.render();
  }

  /** @this {Tavern} */
  static async #onRematch(event, target) {
    report(await request("rematch", {tableId: Tavern.#table(target)}));
  }

  /** @this {Tavern} */
  static async #onLeave(event, target) {
    const tableId = Tavern.#table(target);
    const table = tables().find(x => x.id === tableId);
    if ( table?.status === "playing" ) {
      const ok = await DialogV2.confirm({window: {title: t("STG.Table.leave")}, content: `<p>${esc(t("STG.Table.leaveConfirm"))}</p>`,
        rejectClose: false});
      if ( !ok ) return;
    }
    report(await request("leave", {tableId}));
  }

  /** @this {Tavern} */
  static async #onCloseTable(event, target) {
    report(await request("close", {tableId: Tavern.#table(target)}));
  }
}

export const __test__ = {cardView, MODULE_ID};
