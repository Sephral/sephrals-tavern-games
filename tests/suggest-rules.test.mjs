import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFER_COOLDOWN, OFFER_MINUTES, cleanOffer, needsIntro, newcomersOf, offerAllowed, offerExpired, pickGame
} from "../scripts/suggest-rules.mjs";

const games = {
  tictactoe: {min: 2, max: 2, guests: true},
  pig: {min: 2, max: 4, guests: true},
  twentyone: {min: 1, max: 4, guests: true},
  solitaire: {min: 1, max: 1, guests: false}
};
const offered = ["tictactoe", "pig", "twentyone"];

test("a game nobody started comes before the others", () => {
  const played = {tictactoe: 5, pig: 2};
  assert.equal(pickGame({games, offered, played, online: 3}), "twentyone");
  assert.equal(pickGame({games, offered, played: {tictactoe: 5, twentyone: 1, pig: 3}, online: 3}), "twentyone");
  assert.equal(pickGame({games, offered, played: {tictactoe: 1, twentyone: 4, pig: 3}, online: 3}), "tictactoe");
});

test("ties are broken by the random number, never out of range", () => {
  assert.equal(pickGame({games, offered, online: 3, rng: () => 0}), "tictactoe");
  assert.equal(pickGame({games, offered, online: 3, rng: () => 0.5}), "pig");
  assert.equal(pickGame({games, offered, online: 3, rng: () => 0.999999}), "twentyone");
  assert.equal(pickGame({games, offered, online: 3, rng: () => 1}), "twentyone");
});

test("not the game suggested last, unless it is the only one", () => {
  assert.notEqual(pickGame({games, offered, online: 3, last: "tictactoe", rng: () => 0}), "tictactoe");
  assert.equal(pickGame({games, offered: ["pig"], online: 3, last: "pig"}), "pig");
});

test("alone at the tavern a game needs a tavern guest, with company any game for two or more will do", () => {
  assert.equal(pickGame({games, offered: ["solitaire", "pig"], online: 1}), "pig");
  assert.equal(pickGame({games, offered: ["solitaire", "pig"], online: 2}), "pig");
  assert.equal(pickGame({games, offered: ["solitaire"], online: 1}), "solitaire", "better a game than none");
});

test("nothing on offer, nothing to suggest, unknown games are ignored", () => {
  assert.equal(pickGame({games, offered: [], online: 2}), null);
  assert.equal(pickGame({games, offered: ["chess"], online: 2}), null);
  assert.equal(pickGame({games, offered: ["chess", "pig"], online: 2}), "pig");
});

test("a pause brings an offer only when the GM did not turn it off, at most every ten minutes", () => {
  const base = {enabled: true, paused: true, now: 1_000_000, lastAt: null, online: 3};
  assert.equal(offerAllowed(base), true);
  assert.equal(offerAllowed({...base, enabled: false}), false);
  assert.equal(offerAllowed({...base, paused: false}), false, "resuming brings nothing");
  assert.equal(offerAllowed({...base, online: 0}), false, "nobody to offer it to");
  assert.equal(offerAllowed({...base, lastAt: base.now - OFFER_COOLDOWN + 1}), false);
  assert.equal(offerAllowed({...base, lastAt: base.now - OFFER_COOLDOWN}), true);
});

test("a stored offer needs an id and a known game", () => {
  const ids = ["pig", "matches"];
  assert.deepEqual(cleanOffer({id: "abc", game: "pig", at: 5, tableId: "t1"}, ids), {id: "abc", game: "pig", at: 5, tableId: "t1"});
  assert.deepEqual(cleanOffer({id: "abc", game: "pig"}, ids), {id: "abc", game: "pig", at: 0, tableId: null});
  assert.equal(cleanOffer({id: "abc", game: "chess"}, ids), null);
  assert.equal(cleanOffer({game: "pig"}, ids), null);
  assert.equal(cleanOffer({}, ids), null);
  assert.equal(cleanOffer(null, ids), null);
});

test("an offer runs out after ten minutes on the client that saw it", () => {
  assert.equal(OFFER_MINUTES, 10);
  assert.equal(offerExpired(0, (OFFER_MINUTES * 60 * 1000) - 1), false);
  assert.equal(offerExpired(0, OFFER_MINUTES * 60 * 1000), true);
});

test("a newcomer gets the introduction until their first game is over", () => {
  assert.equal(needsIntro("u1", []), true);
  assert.equal(needsIntro("u1", undefined), true);
  assert.equal(needsIntro("u1", ["u2"]), true);
  assert.equal(needsIntro("u1", ["u1"]), false);
  const table = {seats: [{kind: "user", userId: "u1"}, {kind: "guest", guest: "bertram"}, {kind: "user", userId: "u2"}]};
  assert.deepEqual(newcomersOf(table, ["u2"]), ["u1"]);
  assert.deepEqual(newcomersOf(table, []), ["u1", "u2"]);
});
