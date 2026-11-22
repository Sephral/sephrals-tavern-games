/**
 * Made-up tables for the sample windows (api.samples): real positions, played with the rules of scripts/games/ by the
 * tavern guests' own moves from a fixed seed, so every position is one a real game can reach and the same every time.
 * Pure: no Foundry, nothing is written. sample-windows.mjs puts them into the windows.
 */

import {GAMES, publicState} from "./games/index.mjs";
import {handValue} from "./games/twentyone.mjs";
import {cleanRanking, liveSession, standings} from "./games/ranking.mjs";
import {settleStake} from "./games/stakes.mjs";

/** The id of the pretend table that waits for players. */
export const OPEN_ID = "sample-open";

/** A small seeded random number generator (mulberry32), so a sample looks the same on every screen. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The people at the sample tables: the first hero sits for the user who opens the sample, the others are other players
 * and the tavern guests. Names of the heroes come from the shared cast.
 * @param {{id: string, name: string, img: string, player?: string}[]} cast
 * @param {string} meId   The id of the user
 * @returns {Record<string, object>}
 */
export function sampleSeats(cast, meId) {
  const hero = id => cast.find(member => member.id === id);
  const user = (id, userId, balance) => ({kind: "user", userId, name: hero(id).name, img: hero(id).img, sampleBalance: balance});
  return {
    me: user("ari", meId, 1250),
    tom: user("mira", "sample-tom", 900),
    sam: user("tovin", "sample-sam", 640),
    jo: user("sela", "sample-jo", 300),
    bertram: {kind: "guest", guest: "bertram", level: "easy", img: "icons/svg/mystery-man.svg"},
    mirela: {kind: "guest", guest: "mirela", level: "medium", img: "icons/svg/mystery-man.svg"},
    jasper: {kind: "guest", guest: "jasper", level: "hard", img: "icons/svg/mystery-man.svg"}
  };
}

/**
 * Play a game with the guests' moves for every seat until the check says stop. Every seed is tried in turn, the first
 * that reaches the wanted position wins.
 * @param {string} gameId
 * @param {number} count                        Seats
 * @param {(state: object, outcome: object, step: number) => boolean} check   Is this the position?
 * @param {object} [options]
 * @param {number} [options.maxSteps]
 * @param {number} [options.seeds]
 * @param {string[]} [options.levels]           How well each seat plays (easy, medium, hard), default medium
 * @returns {{state: object, outcome: object, seed: number, steps: number}}
 */
export function playUntil(gameId, count, check, {maxSteps = 600, seeds = 600, levels = []} = {}) {
  const g = GAMES[gameId];
  for ( let seed = 1; seed <= seeds; seed++ ) {
    const rng = seeded(seed);
    let state = g.init(rng, count, {goal: 50});
    for ( let step = 0; step <= maxSteps; step++ ) {
      const outcome = g.outcome(state);
      if ( check(state, outcome, step) ) return {state, outcome, seed, steps: step};
      if ( outcome.done || (state.turn === null) || (state.turn === undefined) ) break;
      const seat = state.turn;
      const move = (gameId === "twentyone") ? (handValue(state.hands[seat]).total < 16 ? "hit" : "stand") : g.ai(state, seat, levels[seat] ?? "medium", rng);
      state = g.play(state, seat, move, rng);
    }
  }
  throw new Error(`No sample position found for ${gameId}`);
}

/** The positions the samples show: per entry, how many seats and what to look for. */
const SCENES = {
  "tictactoe-running": {game: "tictactoe", seats: ["me", "bertram"], find: (s, o, n) => !o.done && (n === 4) && (s.turn === 0)},
  "tictactoe-won": {game: "tictactoe", seats: ["me", "mirela"], find: (s, o) => o.done && !o.draw && (o.winners[0] === 0)},
  "tictactoe-draw": {game: "tictactoe", seats: ["me", "mirela"], find: (s, o) => o.done && o.draw},
  "fourinarow-running": {game: "fourinarow", seats: ["me", "mirela"], find: (s, o, n) => !o.done && (n >= 12) && (s.turn === 0)},
  "fourinarow-lost": {game: "fourinarow", seats: ["me", "jasper"], find: (s, o) => o.done && !o.draw && (o.winners[0] === 1)},
  "morris-running": {game: "morris", seats: ["me", "jasper"], find: (s, o) => !o.done && (s.phase === "remove") && (s.turn === 0) && (s.hand[0] < 6)},
  "morris-won": {game: "morris", seats: ["me", "mirela"], find: (s, o) => o.done && !o.draw && (o.winners[0] === 0)},
  "matches-running": {game: "matches", seats: ["me", "bertram"], find: (s, o, n) => !o.done && (n >= 3) && (s.turn === 0)},
  "matches-lost": {game: "matches", seats: ["me", "mirela"], find: (s, o) => o.done && (o.winners[0] === 1)},
  "pig-running": {game: "pig", seats: ["me", "tom", "sam", "bertram"], find: (s, o) => !o.done && s.busted && (s.turn === 0) && (s.lastTurn?.seat !== 0) && (s.scores[0] > 8)},
  "pig-won": {game: "pig", seats: ["me", "tom", "bertram"], find: (s, o) => o.done && (o.winners[0] === 0) && (s.lastTurn?.outcome === "hold") && (s.lastTurn?.seat === 0)},
  "ship-running": {game: "ship", seats: ["tom", "me", "mirela"], find: (s, o) => !o.done && (s.turn === 1) && (s.throws === 1) && s.last && s.crew},
  "ship-won": {game: "ship", seats: ["me", "tom", "mirela"], find: (s, o) => o.done && !o.draw && (o.winners[0] === 0)},
  "liars-running": {game: "liars", seats: ["me", "tom", "bertram"], find: (s, o) => !o.done && s.reveal && s.bid && (s.turn === 0) && (s.round >= 2) && (s.reveal.holds === false)},
  "liars-lost": {game: "liars", seats: ["me", "tom", "mirela"], find: (s, o) => o.done && (o.winners[0] === 1)},
  "mexico-running": {game: "mexico", seats: ["me", "tom", "jasper"], find: (s, o) => !o.done && s.reveal && !s.announced && (s.turn === 0) && (s.cup?.seat === 0) && (s.phase === "announce") && s.reveal.holds},
  "mexico-won": {game: "mexico", seats: ["me", "mirela", "bertram"], find: (s, o) => o.done && (o.winners[0] === 0)},
  "twentyone-running": {game: "twentyone", seats: ["tom", "me", "sam"], find: (s, o) => !o.done && (s.turn === 1) && s.stood[0] && !s.busted[0] && (s.hands[1].length === 2)},
  "twentyone-done": {game: "twentyone", seats: ["me", "tom", "sam"], find: (s, o) => o.done && ["win", "lose", "push"].every(r => s.results.includes(r)) && (s.results[0] === "win")}
};

/** The ids of the scenes (every one is a table of the samples). */
export const SCENE_IDS = Object.keys(SCENES);

/** Stakes by scene: the amount in the smallest unit and the kind of money. */
const STAKES = {
  "liars-running": {amount: 20, mode: "chips"},
  "twentyone-running": {amount: 500, mode: "dnd5e"},
  "twentyone-done": {amount: 500, mode: "dnd5e"},
  "mexico-won": {amount: 15, mode: "chips"}
};

/**
 * The pictures of the cups under which the user sees their own dice: the dice of the user's seat in the full state.
 * @param {string} id   Scene id
 * @param {object} state   The full state
 * @returns {{rollId: string, dice: number[]}|null}
 */
function peekOf(id, state) {
  const g = GAMES[SCENES[id].game];
  if ( !g.peek || (!state.dice && !state.cup) ) return null;
  return {rollId: state.rollId, dice: g.peek(state, 0)};
}

/**
 * One table of the samples as the world would keep it: the public state, the seats, the result and the stake.
 * @param {string} id        Scene id
 * @param {Record<string, object>} seats   From sampleSeats
 * @param {number} [now]
 * @returns {{table: object, peek: {rollId: string, dice: number[]}|null}}
 */
export function buildTable(id, seats, now = Date.now()) {
  const scene = SCENES[id];
  const g = GAMES[scene.game];
  // The players play like beginners, the tavern guests like their own level
  const levels = scene.seats.map(key => (seats[key].kind === "guest" ? seats[key].level : "easy"));
  const found = playUntil(scene.game, scene.seats.length, scene.find, {levels});
  let state = found.state;
  let outcome = found.outcome;
  let left = null;
  // A player who left the running game: their seat is greyed out
  if ( id === "pig-running" ) {
    state = g.forfeit(state, 2);
    outcome = g.outcome(state);
    left = 2;
  }
  const people = scene.seats.map((key, i) => ({...seats[key], ...((i === left) ? {left: true} : {})}));
  const done = outcome.done;
  const table = {id: `sample-${id}`, game: scene.game, host: people[0].userId ?? seats.me.userId, status: done ? "done" : "playing",
    seats: people, state: publicState(g, state), result: done ? outcome : null, created: now - 600000, updated: now - 1000, round: 1,
    started: now - 500000};
  const stake = STAKES[id];
  if ( stake ) {
    table.stake = {...stake, paid: people.map(person => (person.kind === "user" ? stake.amount : 0)), payout: null, refunded: false};
    if ( done ) {
      const payout = settleStake(table);
      if ( payout ) table.stake.payout = {...payout, paid: true};
    }
  }
  return {table, peek: done ? null : peekOf(id, state)};
}

/**
 * A table that waits for players, with a stake in chips.
 * @param {Record<string, object>} seats
 * @param {number} [now]
 * @returns {object}
 */
export function buildOpenTable(seats, now = Date.now()) {
  return {id: OPEN_ID, game: "liars", host: seats.tom.userId, status: "open", seats: [seats.tom, seats.sam], state: null, result: null,
    created: now - 120000, updated: now - 60000, round: 1, stake: {amount: 20, mode: "chips"}};
}

/**
 * The ranking of an evening in the shape the world stores it: five players of every tavern title, what was played and
 * who won it, and the money of those who played for stakes.
 * @param {Record<string, object>} seats
 * @param {number} [now]
 * @returns {object}
 */
export function buildRanking(seats, now = Date.now()) {
  const ids = {lena: seats.me.userId, tom: seats.tom.userId, sam: seats.sam.userId, jo: seats.jo.userId, pia: "sample-pia"};
  return {
    session: {id: "sample", start: now - (3 * 60 * 60 * 1000), last: now - 60000, players: {
      [ids.lena]: {name: "Lena", wins: 5, games: 8, net: {dnd5e: 350, chips: 20}},
      [ids.tom]: {name: "Tom", wins: 3, games: 7, net: {dnd5e: -200}},
      [ids.sam]: {name: "Sam", wins: 2, games: 7, net: {chips: -35}},
      [ids.jo]: {name: "Jo", wins: 1, games: 5, net: {}},
      [ids.pia]: {name: "Pia", wins: 0, games: 3, net: {}}
    }, games: {
      tictactoe: {n: 3, wins: {[ids.lena]: 2, [ids.tom]: 1}},
      pig: {n: 3, wins: {[ids.sam]: 1, [ids.lena]: 1}},
      liars: {n: 2, wins: {[ids.lena]: 1, [ids.tom]: 1}},
      mexico: {n: 2, wins: {[ids.lena]: 1}},
      twentyone: {n: 4, wins: {}},
      ship: {n: 1, wins: {[ids.jo]: 1}}
    }},
    all: {
      [ids.lena]: {name: "Lena", wins: 52, games: 90},
      [ids.tom]: {name: "Tom", wins: 26, games: 61},
      [ids.sam]: {name: "Sam", wins: 11, games: 40},
      [ids.jo]: {name: "Jo", wins: 4, games: 22},
      [ids.pia]: {name: "Pia", wins: 0, games: 3}
    },
    counted: []
  };
}

/**
 * The standings of the sample evening.
 * @param {object} ranking
 * @param {number} now
 * @returns {object[]}
 */
export function sampleStandings(ranking, now = Date.now()) {
  return standings(liveSession(cleanRanking(ranking), now));
}

export const __test__ = {SCENES, STAKES};
