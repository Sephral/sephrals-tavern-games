import assert from "node:assert/strict";
import test from "node:test";

// tables.mjs reads the Pig goal and Foundry's random numbers when a game starts
const queue = [0.1 / 52, 0.1 / 51, 7.1 / 50, 0.1 / 49];
globalThis.game = {settings: {get: () => 50}};
globalThis.CONFIG = {Dice: {randomUniform: () => (queue.length ? queue.shift() : 0.5)}};
globalThis.foundry = {utils: {deepClone: value => structuredClone(value)}};

const {__test__} = await import("../scripts/tables.mjs");

test("a game decided by the deal is finished at once: twenty-one with ace and ten alone against the house", () => {
  const table = __test__.start({id: "t1", game: "twentyone", status: "open", seats: [{kind: "user", userId: "u1", name: "A"}], state: null, result: null});
  assert.deepEqual(table.state.hands[0], ["AS", "10S"]);
  assert.equal(table.status, "done");
  assert.ok(table.result?.done);
  assert.equal(table.state.phase, "done");
});

test("a normal start stays running", () => {
  const table = __test__.start({id: "t2", game: "tictactoe", status: "open", seats: [{kind: "user", userId: "u1"}, {kind: "user", userId: "u2"}], state: null, result: null});
  assert.equal(table.status, "playing");
  assert.equal(table.result, null);
});
