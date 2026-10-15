import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {GAMES, publicState} from "../scripts/games/index.mjs";
import {__test__ as tablesTest} from "../scripts/tables.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A random number generator that returns die faces from a list. */
function dice(faces) {
  const queue = [...faces];
  return () => (queue.shift() - 0.5) / 6;
}

/* -------------------------------------------- */
/*  Pig: the turn finished last                 */
/* -------------------------------------------- */

test("pig: a new game has no last turn", () => {
  assert.equal(GAMES.pig.init(null, 3).lastTurn, null);
});

test("pig: holding keeps the rolls and the banked sum of the turn", () => {
  const g = GAMES.pig;
  let s = g.init(null, 2);
  s = g.play(s, 0, "roll", dice([4]));
  s = g.play(s, 0, "roll", dice([6]));
  assert.equal(s.lastTurn, null, "a turn still running is not the last turn");
  s = g.play(s, 0, "hold");
  assert.deepEqual(s.lastTurn, {seat: 0, rolls: [4, 6], outcome: "hold", banked: 10});
  assert.equal(s.turn, 1);
});

test("pig: a one keeps the rolls up to the one and tells who lost the turn", () => {
  const g = GAMES.pig;
  let s = g.init(null, 3);
  s = g.play(s, 0, "roll", dice([3]));
  s = g.play(s, 0, "hold");
  s = g.play(s, 1, "roll", dice([4]));
  s = g.play(s, 1, "roll", dice([3]));
  s = g.play(s, 1, "roll", dice([1]));
  assert.deepEqual(s.lastTurn, {seat: 1, rolls: [4, 3, 1], outcome: "bust", banked: 0});
  assert.equal(s.busted, true);
  assert.equal(s.turn, 2);
  // The next player's rolls leave the last turn alone until their turn ends
  s = g.play(s, 2, "roll", dice([5]));
  assert.equal(s.busted, false);
  assert.deepEqual(s.lastTurn, {seat: 1, rolls: [4, 3, 1], outcome: "bust", banked: 0});
  // A one on the first roll
  s = g.play(s, 2, "hold");
  s = g.play(s, 0, "roll", dice([1]));
  assert.deepEqual(s.lastTurn, {seat: 0, rolls: [1], outcome: "bust", banked: 0});
});

test("pig: the winning hold is the last turn, the public state keeps it", () => {
  const g = GAMES.pig;
  let s = {...g.init(null, 2, {goal: 20}), scores: [15, 0]};
  s = g.play(s, 0, "roll", dice([6]));
  s = g.play(s, 0, "hold");
  assert.equal(g.outcome(s).done, true);
  assert.deepEqual(s.lastTurn, {seat: 0, rolls: [6], outcome: "hold", banked: 6});
  assert.deepEqual(publicState(g, s).lastTurn, s.lastTurn);
});

test("pig: a player who leaves does not change the last turn", () => {
  const g = GAMES.pig;
  let s = g.init(null, 3);
  s = g.play(s, 0, "roll", dice([5]));
  s = g.play(s, 0, "hold");
  s = g.play(s, 1, "roll", dice([2]));
  s = g.forfeit(s, 1);
  assert.deepEqual(s.lastTurn, {seat: 0, rolls: [5], outcome: "hold", banked: 5});
  assert.equal(s.turn, 2);
});

/* -------------------------------------------- */
/*  Ship, captain and crew: the turn finished   */
/* -------------------------------------------- */

test("ship: the last turn keeps the cargo dice, the crew and the throws", () => {
  const g = GAMES.ship;
  let s = g.init(null, 3);
  assert.equal(s.last, null);
  s = g.play(s, 0, "roll", dice([6, 5, 4, 6, 3]));
  s = g.play(s, 0, "stop");
  assert.deepEqual(s.last, {seat: 0, score: 9, crew: true, dice: [6, 3], throws: 1});
  // Three throws end the turn on their own
  s = g.play(s, 1, "roll", dice([6, 5, 4, 2, 1]));
  s = g.play(s, 1, "roll", dice([3, 2]));
  s = g.play(s, 1, "roll", dice([5, 4]));
  assert.deepEqual(s.last, {seat: 1, score: 9, crew: true, dice: [5, 4], throws: 3});
  // No crew: nothing aboard, no cargo dice
  s = g.play(s, 2, "roll", dice([6, 5, 1, 1, 1]));
  s = g.play(s, 2, "roll", dice([2, 2, 2]));
  s = g.play(s, 2, "roll", dice([3, 3, 3]));
  assert.deepEqual(s.last, {seat: 2, score: 0, crew: false, dice: [], throws: 3});
  assert.deepEqual(publicState(g, s).last, s.last);
});

/* -------------------------------------------- */
/*  The regulars roll slower at the dice games  */
/* -------------------------------------------- */

test("guests: 1.2 seconds per roll at Pig and ship, the other games keep 0.9 seconds", () => {
  const {guestDelay, GUEST_DELAY} = tablesTest;
  assert.equal(GUEST_DELAY, 900);
  assert.equal(guestDelay("pig"), 1200);
  assert.equal(guestDelay("ship"), 1200);
  for ( const id of ["tictactoe", "fourinarow", "morris", "matches", "liars", "twentyone"] ) assert.equal(guestDelay(id), 900, id);
});

/* -------------------------------------------- */
/*  The tavern window                           */
/* -------------------------------------------- */

test("template: only seated players get the game buttons, the box of the last round folds", async () => {
  const hbs = await readFile(path.join(root, "templates/tavern.hbs"), "utf8");
  const lines = hbs.split(/\r?\n/);
  const buttons = lines.map((line, i) => (/class="stg-buttons/.test(line) ? i : -1)).filter(i => i >= 0);
  assert.equal(buttons.length, 5, "matches, Pig, liar's dice, ship and twenty-one");
  for ( const i of buttons ) assert.match(lines[i - 1], /\{\{#if table\.(liars\.)?seated\}\}/, lines[i]);
  assert.match(hbs, /<details class="stg-reveal[^>]*\{\{#if table\.liars\.reveal\.open\}\}open\{\{\/if\}\}>/);
  assert.match(hbs, /<summary>.*table\.liars\.reveal\.label/);
  // The die of the bid sits inside the sentence
  assert.match(hbs, /\{\{table\.liars\.reveal\.before\}\}<i [^>]*table\.liars\.reveal\.face[^>]*><\/i>\{\{table\.liars\.reveal\.after\}\}/);
});
