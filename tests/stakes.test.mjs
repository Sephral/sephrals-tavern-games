import assert from "node:assert/strict";
import test from "node:test";
import {STAKE_MAX, addCoins, hasEscrow, isNatural, parseStake, potOf, purseTotal, settleStake, spendCoins, splitAmount,
  stakeGame, twentyoneWin, validStake} from "../scripts/games/stakes.mjs";

const DND = [{key: "pp", value: 1000}, {key: "gp", value: 100}, {key: "ep", value: 50}, {key: "sp", value: 10}, {key: "cp", value: 1}];
const SHOW = DND.filter(d => ["gp", "sp", "cp"].includes(d.key));

const user = (name, extra={}) => ({kind: "user", userId: name, name, ...extra});
const guest = {kind: "guest", guest: "bertram"};

test("a stake is a whole number of minor units within the limit", () => {
  assert.ok(validStake(1));
  assert.ok(validStake(STAKE_MAX));
  for ( const bad of [0, -5, 1.5, STAKE_MAX + 1, NaN, "5", null, undefined] ) assert.equal(validStake(bad), false, String(bad));
});

test("a stake typed in the main unit becomes minor units", () => {
  assert.equal(parseStake("5", 100), 500);
  assert.equal(parseStake("0,5", 100), 50);
  assert.equal(parseStake("2.25", 100), 225);
  assert.equal(parseStake("10", 1), 10);
  assert.equal(parseStake("0", 100), null);
  assert.equal(parseStake("abc", 100), null);
  assert.equal(parseStake("", 1), null);
  assert.equal(parseStake("-3", 1), null);
  assert.equal(parseStake("0.001", 100), null);
});

test("a purse is worth the sum of its coins", () => {
  assert.equal(purseTotal({pp: 1, gp: 2, ep: 1, sp: 3, cp: 4}, DND), 1000 + 200 + 50 + 30 + 4);
  assert.equal(purseTotal({}, DND), 0);
  assert.equal(purseTotal(null, DND), 0);
});

test("an amount is split into the largest coins first", () => {
  assert.deepEqual(splitAmount(1234, SHOW), [{key: "gp", count: 12}, {key: "sp", count: 3}, {key: "cp", count: 4}]);
  assert.deepEqual(splitAmount(0, SHOW), []);
  assert.deepEqual(splitAmount(5, SHOW), [{key: "cp", count: 5}]);
});

test("paying takes the smallest coins first", () => {
  const purse = {pp: 0, gp: 10, ep: 0, sp: 5, cp: 3};
  assert.deepEqual(spendCoins(purse, DND, 53, SHOW), {pp: 0, gp: 10, ep: 0, sp: 0, cp: 0});
  assert.deepEqual(spendCoins(purse, DND, 100, SHOW), {pp: 0, gp: 9, ep: 0, sp: 5, cp: 3});
  assert.deepEqual(spendCoins(purse, DND, 3, SHOW), {pp: 0, gp: 10, ep: 0, sp: 5, cp: 0});
});

test("a coin that has to be broken gives change in the payout coins", () => {
  const purse = {pp: 0, gp: 2, ep: 0, sp: 0, cp: 0};
  const next = spendCoins(purse, DND, 150, SHOW);
  assert.deepEqual(next, {pp: 0, gp: 0, ep: 0, sp: 5, cp: 0});
  assert.equal(purseTotal(next, DND), 50);
  // Platinum is broken into gold
  const rich = spendCoins({pp: 1}, DND, 1, SHOW);
  assert.equal(purseTotal(rich, DND), 999);
  assert.equal(rich.pp, 0);
});

test("paying more than the purse holds changes nothing", () => {
  assert.equal(spendCoins({gp: 1, sp: 5}, DND, 151, SHOW), null);
  assert.equal(spendCoins({}, DND, 1, SHOW), null);
  assert.equal(purseTotal(spendCoins({gp: 1, sp: 5}, DND, 150, SHOW), DND), 0);
});

test("paying never loses or invents money", () => {
  for ( let total = 0; total < 40; total++ ) {
    const purse = {pp: 1, gp: total % 4, ep: total % 3, sp: total % 7, cp: total % 11};
    const have = purseTotal(purse, DND);
    for ( const amount of [1, 7, 10, 49, 50, 99, 100, 101, 333] ) {
      const next = spendCoins(purse, DND, amount, SHOW);
      if ( amount > have ) assert.equal(next, null);
      else {
        assert.equal(purseTotal(next, DND), have - amount, `${JSON.stringify(purse)} - ${amount}`);
        assert.ok(Object.values(next).every(n => Number.isInteger(n) && (n >= 0)));
      }
    }
  }
});

test("a payout is added in gold, silver and copper and leaves the rest alone", () => {
  assert.deepEqual(addCoins({pp: 2, gp: 1, ep: 1, sp: 0, cp: 0}, SHOW, 1234), {pp: 2, gp: 13, ep: 1, sp: 3, cp: 4});
  assert.deepEqual(addCoins({gp: 1}, SHOW, 0), {gp: 1});
});

test("a win at twenty-one pays one to one, a natural three to two rounded down", () => {
  assert.equal(twentyoneWin(10, false), 10);
  assert.equal(twentyoneWin(10, true), 15);
  assert.equal(twentyoneWin(5, true), 7);
  assert.ok(isNatural(["AS", "KH"]));
  assert.equal(isNatural(["5S", "6H", "KH"]), false);
  assert.equal(isNatural(["10S", "9H"]), false);
});

/**
 * A finished table at twenty-one.
 * @param {string[]} results
 * @param {string[][]} hands
 * @param {object[]} seats
 * @returns {object}
 */
function bj(results, hands, seats, stake=100) {
  return {game: "twentyone", status: "done", seats, stake: {amount: stake, mode: "dnd5e"},
    state: {hands, results, phase: "done"}, result: {done: true, results}};
}

test("twenty-one pays every player against the house", () => {
  const table = bj(["win", "lose", "push", "win"], [["10S", "9H"], ["10S", "8H"], ["10S", "7H"], ["AS", "KH"]],
    [user("a"), user("b"), user("c"), user("d")], 100);
  const pay = settleStake(table);
  assert.deepEqual(pay.credits, [200, 0, 100, 250]);
  assert.deepEqual(pay.net, [100, -100, 0, 150]);
});

test("a player who left the hand loses the stake", () => {
  const table = bj(["win", "win"], [["10S", "9H"], ["10S", "9H"]], [user("a", {left: true}), user("b")]);
  assert.deepEqual(settleStake(table).credits, [0, 200]);
});

test("twenty-one against a forfeit result keeps the stake of the others", () => {
  const table = bj(["lose", "push"], [["10S", "9H"], ["10S", "9H"]], [user("a"), user("b")]);
  const pay = settleStake(table);
  assert.deepEqual(pay.credits, [0, 100]);
  assert.deepEqual(pay.net, [-100, 0]);
});

test("liar's dice puts every stake into one pot for the winner", () => {
  const table = {game: "liars", status: "done", seats: [user("a"), user("b"), guest], stake: {amount: 50, mode: "chips"},
    result: {done: true, winners: [1], draw: false}};
  const pay = settleStake(table);
  assert.equal(pay.pot, 150);
  assert.deepEqual(pay.credits, [0, 150, 0]);
  assert.deepEqual(pay.net, [-50, 100, 0]);
});

test("a guest who wins at liar's dice keeps the pot for the house", () => {
  const table = {game: "liars", status: "done", seats: [user("a"), guest], stake: {amount: 50, mode: "chips"},
    result: {done: true, winners: [1], draw: false}};
  const pay = settleStake(table);
  assert.deepEqual(pay.credits, [0, 0]);
  assert.deepEqual(pay.net, [-50, 0]);
});

test("nobody winning at liar's dice returns the stakes", () => {
  const table = {game: "liars", status: "done", seats: [user("a"), user("b")], stake: {amount: 50, mode: "chips"},
    result: {done: true, winners: [], draw: true}};
  const pay = settleStake(table);
  assert.deepEqual(pay.credits, [50, 50]);
  assert.deepEqual(pay.net, [0, 0]);
});

test("the winner of liar's dice against a guest takes the guest's stake too", () => {
  const table = {game: "liars", status: "done", seats: [user("a"), guest], stake: {amount: 40, mode: "chips"},
    result: {done: true, winners: [0], draw: false}};
  const pay = settleStake(table);
  assert.equal(pay.credits[0], 80);
  assert.equal(pay.net[0], 40);
});

test("games without stake rules and tables without a stake settle nothing", () => {
  assert.equal(settleStake({game: "pig", seats: [], stake: {amount: 5}}), null);
  assert.equal(settleStake({game: "liars", seats: [user("a")], result: {winners: [0]}}), null);
  assert.equal(settleStake({game: "liars", seats: [user("a")], stake: {amount: 0}, result: {winners: [0]}}), null);
  assert.ok(stakeGame("twentyone") && stakeGame("liars"));
  assert.equal(stakeGame("tictactoe"), false);
});

test("the pot is only a thing at liar's dice", () => {
  assert.equal(potOf({game: "liars", seats: [user("a"), guest, guest], stake: {amount: 20}}), 60);
  assert.equal(potOf({game: "twentyone", seats: [user("a")], stake: {amount: 20}}), 0);
  assert.equal(potOf({game: "liars", seats: [user("a")]}), 0);
});

test("a stake is in escrow until it is paid out or returned", () => {
  const base = {stake: {amount: 10, paid: [10, 0]}};
  assert.ok(hasEscrow(base));
  assert.equal(hasEscrow({stake: {amount: 10, paid: [0, 0]}}), false);
  assert.equal(hasEscrow({stake: {amount: 10}}), false);
  assert.equal(hasEscrow({stake: {...base.stake, payout: {credits: [20, 0], paid: true}}}), false);
  assert.equal(hasEscrow({}), false);
});
