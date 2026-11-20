import assert from "node:assert/strict";
import test from "node:test";
import {GAMES, GUESTS, publicState} from "../scripts/games/index.mjs";
import {LIVES, MEXICO, VALUES, beats, chanceAtLeast, parseAnnounce, rank, valueOf} from "../scripts/games/mexico.mjs";
import {potOf, settleStake, stakeGame} from "../scripts/games/stakes.mjs";

/** A seeded random number generator (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const g = GAMES.mexico;

/** A state with chosen dice under the cup. */
function withDice(state, dice) {
  const next = structuredClone(state);
  next.cup = {seat: next.cup.seat, dice};
  return next;
}

test("mexico: the values rank mixed throws, then pairs, then 21 on top", () => {
  assert.equal(VALUES.length, 21);
  assert.equal(new Set(VALUES).size, 21);
  assert.equal(valueOf([1, 2]), 21);
  assert.equal(valueOf([2, 1]), 21);
  assert.equal(valueOf([6, 5]), 65);
  assert.equal(valueOf([3, 6]), 63);
  assert.equal(valueOf([4, 4]), 44);
  assert.ok(beats(66, 65), "the lowest pair beats the best mixed throw");
  assert.ok(beats(11, 65));
  assert.ok(beats(21, 66));
  assert.ok(!beats(21, 21));
  assert.ok(beats(32, 31));
  assert.ok(beats(41, 32), "the higher die first");
  assert.ok(beats(31, null));
  assert.equal(rank(31), 0);
  assert.equal(rank(21), 20);
  assert.equal(rank(12), -1);
  assert.equal(parseAnnounce("a:65"), 65);
  assert.equal(parseAnnounce("a:12"), null);
  assert.equal(parseAnnounce("a:7"), null);
  assert.equal(parseAnnounce("call"), null);
});

test("mexico: the chance of a throw being worth at least a value", () => {
  assert.equal(chanceAtLeast(31), 1);
  assert.ok(Math.abs(chanceAtLeast(21) - (2 / 36)) < 1e-9);
  assert.ok(Math.abs(chanceAtLeast(66) - (3 / 36)) < 1e-9);
  assert.equal(chanceAtLeast(99), 0);
});

test("mexico: the first player announces, everything is allowed, the next one believes or calls", () => {
  const s = g.init(seeded(1), 3);
  assert.deepEqual(s.lives, [LIVES, LIVES, LIVES]);
  assert.equal(s.phase, "announce");
  assert.equal(g.moves(s, 0).length, 21);
  assert.deepEqual(g.moves(s, 1), []);
  const next = g.play(s, 0, "a:54", seeded(2));
  assert.deepEqual(next.announced, {value: 54, seat: 0});
  assert.equal(next.turn, 1);
  assert.equal(next.phase, "decide");
  assert.deepEqual(g.moves(next, 1), ["believe", "call"]);
  assert.deepEqual(g.moves(next, 0), []);
  assert.throws(() => g.play(next, 1, "a:61", seeded(3)), /illegal/);
});

test("mexico: believing shakes new dice and the announcement has to rise", () => {
  let s = g.init(seeded(4), 2);
  s = g.play(s, 0, "a:54", seeded(2));
  const before = s.rollId;
  s = g.play(s, 1, "believe", seeded(5));
  assert.equal(s.phase, "announce");
  assert.equal(s.cup.seat, 1);
  assert.notEqual(s.rollId, before);
  const moves = g.moves(s, 1);
  assert.ok(!moves.includes("a:54") && !moves.includes("a:53") && moves.includes("a:61") && moves.includes("a:11") && moves.includes("a:21"));
  assert.ok(!moves.includes("call") && !moves.includes("believe"));
  s = g.play(s, 1, "a:61", seeded(6));
  assert.equal(s.turn, 0);
  assert.deepEqual(s.announced, {value: 61, seat: 1});
});

test("mexico: after 21 nothing beats it, the next player has to call", () => {
  let s = g.init(seeded(7), 2);
  s = g.play(s, 0, "a:21", seeded(2));
  assert.deepEqual(g.moves(s, 1), ["call"]);
});

test("mexico: lifting the cup, a true announcement costs the caller a life, a lie the announcer", () => {
  let s = withDice(g.init(seeded(8), 2), [6, 5]);
  s = g.play(s, 0, "a:64", seeded(1));
  // 65 is worth more than 64: it holds, the caller (seat 1) loses and begins
  s = g.play(s, 1, "call", seeded(9));
  assert.equal(s.reveal.holds, true);
  assert.equal(s.reveal.actual, 65);
  assert.equal(s.reveal.loser, 1);
  assert.equal(s.reveal.loss, 1);
  assert.deepEqual(s.lives, [3, 2]);
  assert.equal(s.turn, 1, "the loser begins");
  assert.equal(s.phase, "announce");
  assert.equal(s.announced, null);
  assert.equal(s.round, 2);
  assert.equal(s.cup.seat, 1);
  // A lie
  s = withDice(s, [3, 1]);
  s = g.play(s, 1, "a:55", seeded(1));
  s = g.play(s, 0, "call", seeded(9));
  assert.equal(s.reveal.holds, false);
  assert.equal(s.reveal.loser, 1);
  assert.deepEqual(s.lives, [3, 1]);
  assert.equal(s.turn, 1);
});

test("mexico: a real Mexico costs the caller two lives, a bluffed one only one", () => {
  let s = withDice(g.init(seeded(10), 2), [1, 2]);
  s = g.play(s, 0, "a:21", seeded(1));
  s = g.play(s, 1, "call", seeded(2));
  assert.equal(s.reveal.holds, true);
  assert.equal(s.reveal.loss, 2);
  assert.deepEqual(s.lives, [3, 1]);
  let t = withDice(g.init(seeded(10), 2), [6, 6]);
  t = g.play(t, 0, "a:21", seeded(1));
  t = g.play(t, 1, "call", seeded(2));
  assert.equal(t.reveal.holds, false);
  assert.equal(t.reveal.loss, 1);
  assert.deepEqual(t.lives, [2, 3]);
});

test("mexico: the last life ends the game, the last one with lives wins", () => {
  let s = withDice(g.init(seeded(11), 3), [3, 2]);
  s.lives = [1, 3, 1];
  s = g.play(s, 0, "a:51", seeded(1));
  s = g.play(s, 1, "believe", seeded(2));
  s = withDice(s, [2, 2]);
  s = g.play(s, 1, "a:22", seeded(3));
  s = g.play(s, 2, "call", seeded(4));
  assert.deepEqual(s.lives, [1, 3, 0]);
  assert.deepEqual(s.out, [false, false, true]);
  assert.equal(g.outcome(s).done, false);
  // Seat 2 is out, the loser's place goes to the next one with lives (seat 0)
  assert.equal(s.turn, 0);
  s = withDice(s, [3, 1]);
  s = g.play(s, 0, "a:55", seeded(5));
  s = g.play(s, 1, "call", seeded(6));
  assert.deepEqual(s.lives, [0, 3, 0]);
  assert.deepEqual(g.outcome(s), {done: true, winners: [1], draw: false});
  assert.deepEqual(g.moves(s, 1), []);
});

test("mexico: nobody sees the dice under the cup but its owner, the full state comes back with new dice", () => {
  let s = g.init(seeded(12), 3);
  s = g.play(s, 0, "a:44", seeded(1));
  const pub = publicState(g, s);
  assert.equal(pub.cup.dice, null);
  assert.equal(pub.cup.seat, 0);
  assert.ok(!JSON.stringify(pub).includes(`"dice":[${s.cup.dice.join(",")}]`));
  assert.deepEqual(g.peek(s, 0), s.cup.dice);
  assert.deepEqual(g.peek(s, 1), []);
  assert.deepEqual(g.peek(s, 2), []);
  const back = g.restore(pub, seeded(13));
  assert.equal(back.cup.dice.length, 2);
  assert.equal(back.cup.seat, 0);
  assert.deepEqual(back.announced, {value: 44, seat: 0});
  assert.notEqual(back.rollId, pub.rollId);
});

test("mexico: a player who leaves is out, a round with their cup starts again", () => {
  let s = g.init(seeded(14), 3);
  s = g.play(s, 0, "a:43", seeded(1));
  // Seat 0 announced and leaves: seat 1 opens a new round
  const left = g.forfeit(s, 0, seeded(2));
  assert.deepEqual(left.out, [true, false, false]);
  assert.equal(left.announced, null);
  assert.equal(left.turn, 1);
  assert.equal(left.phase, "announce");
  assert.equal(left.cup.seat, 1);
  // Seat 2 leaves while it is seat 1's turn to decide: nothing changes for the others
  const quiet = g.forfeit(s, 2, seeded(3));
  assert.equal(quiet.turn, 1);
  assert.equal(quiet.phase, "decide");
  assert.deepEqual(quiet.announced, {value: 43, seat: 0});
  const end = g.forfeit(left, 1, seeded(4));
  assert.deepEqual(g.outcome(end), {done: true, winners: [2], draw: false});
});

test("mexico: the guests play whole games and always make a legal move", () => {
  for ( let seed = 1; seed <= 12; seed++ ) {
    const seats = 2 + (seed % 3);
    const rng = seeded(seed);
    let s = g.init(rng, seats);
    let moves = 0;
    while ( !g.outcome(s).done && (moves < 3000) ) {
      const level = Object.values(GUESTS)[(moves + seed) % 3].level;
      const move = g.ai(s, s.turn, level, rng);
      assert.ok(g.moves(s, s.turn).includes(move), `seed ${seed}: ${move}`);
      s = g.play(s, s.turn, move, rng);
      moves++;
    }
    assert.equal(g.outcome(s).done, true, `seed ${seed}`);
  }
});

test("mexico: a guest calls a hopeless announcement and believes a modest one", () => {
  let s = g.init(seeded(15), 2);
  s = g.play(s, 0, "a:66", seeded(1));
  assert.equal(g.ai(s, 1, "hard", seeded(1)), "call");
  assert.equal(g.ai(s, 1, "medium", seeded(1)), "call");
  let t = g.init(seeded(15), 2);
  t = g.play(t, 0, "a:31", seeded(1));
  assert.equal(g.ai(t, 1, "hard", seeded(1)), "believe");
  assert.equal(g.ai(t, 1, "medium", seeded(1)), "believe");
  // Nothing beats 21, so the guest has to call
  let u = g.init(seeded(15), 2);
  u = g.play(u, 0, "a:21", seeded(1));
  assert.equal(g.ai(u, 1, "easy", seeded(1)), "call");
});

test("mexico: a guest announces its own throw when it beats the last one and bluffs when it does not", () => {
  let s = withDice(g.init(seeded(16), 2), [4, 3]);
  s = g.play(s, 0, "a:31", seeded(1));
  s = g.play(s, 1, "believe", seeded(2));
  s = withDice(s, [6, 5]);
  assert.equal(g.ai(s, 1, "medium", seeded(1)), "a:65");
  let t = withDice(g.init(seeded(16), 2), [4, 3]);
  t = g.play(t, 0, "a:65", seeded(1));
  t = g.play(t, 1, "believe", seeded(2));
  t = withDice(t, [3, 1]);
  const bluff = g.ai(t, 1, "medium", seeded(3));
  assert.ok(g.moves(t, 1).includes(bluff));
  assert.ok(beats(parseAnnounce(bluff), 65));
});

test("mexico: stakes go into one pot and the winner takes it", () => {
  assert.ok(stakeGame("mexico"));
  const user = name => ({kind: "user", userId: name, name});
  const guest = {kind: "guest", guest: "bertram"};
  const table = {game: "mexico", status: "done", seats: [user("a"), guest, user("b")], stake: {amount: 50, mode: "chips"},
    result: {done: true, winners: [2]}};
  assert.equal(potOf({...table, status: "playing"}), 150);
  const payout = settleStake(table);
  assert.equal(payout.pot, 150);
  assert.deepEqual(payout.credits, [0, 0, 150]);
  assert.deepEqual(payout.net, [-50, 0, 100]);
  const draw = settleStake({...table, result: {done: true, winners: [], draw: true}});
  assert.deepEqual(draw.credits, [50, 0, 50]);
  assert.ok(MEXICO === 21);
});
