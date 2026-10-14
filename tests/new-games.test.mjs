import assert from "node:assert/strict";
import test from "node:test";
import {GAMES, GUESTS, publicState} from "../scripts/games/index.mjs";
import {ADJACENT, MILLS, POINTS, __test__ as morrisTest, inMill, removable} from "../scripts/games/morris.mjs";
import {chanceAtLeast, higher, parseBid} from "../scripts/games/liars.mjs";
import {cargo} from "../scripts/games/ship.mjs";

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

/** A random number generator that returns die faces from a list, then falls back to a seeded one. */
function dice(faces, seed = 1) {
  const rest = seeded(seed);
  const queue = [...faces];
  return () => (queue.length ? (queue.shift() - 0.5) / 6 : rest());
}

/** Play a game to its end with the guests' rules on every seat. */
function guestsPlay(g, seats, levels, rng) {
  let state = g.init(rng, seats);
  let guard = 0;
  for ( ; (guard < 2000) && !g.outcome(state).done; guard++ ) {
    const seat = state.turn;
    state = g.play(state, seat, g.ai(state, seat, levels[seat % levels.length], rng), rng);
  }
  return {state, moves: guard};
}

/* -------------------------------------------- */
/*  Nine men's morris                           */
/* -------------------------------------------- */

test("morris: 24 points, 16 mills, every line joins neighbours both ways", () => {
  assert.equal(POINTS.length, 24);
  assert.equal(MILLS.length, 16);
  for ( const [i, list] of ADJACENT.entries() ) {
    assert.ok(list.length >= 2 && list.length <= 4, `point ${i}`);
    for ( const j of list ) assert.ok(ADJACENT[j].includes(i), `${i}-${j}`);
  }
  for ( const mill of MILLS ) {
    // The middle point of a mill touches both ends
    assert.ok(ADJACENT[mill[1]].includes(mill[0]) && ADJACENT[mill[1]].includes(mill[2]), String(mill));
  }
  assert.equal(new Set(POINTS.map(p => p.join())).size, 24);
});

test("morris: placing, a mill keeps the turn to take a man, men in mills are safe while others stand free", () => {
  const g = GAMES.morris;
  let s = g.init();
  assert.equal(g.moves(s, 0).length, 24);
  assert.deepEqual(g.moves(s, 1), []);
  // White builds the top row 0-1-2, black places elsewhere (but makes a mill first on the left inner side)
  s = g.play(s, 0, "p:0");
  s = g.play(s, 1, "p:16");
  s = g.play(s, 0, "p:1");
  s = g.play(s, 1, "p:23");
  s = g.play(s, 0, "p:2");
  assert.equal(s.phase, "remove");
  assert.equal(s.turn, 0, "the mill keeps the turn");
  assert.deepEqual(s.mill, [0, 1, 2]);
  assert.deepEqual(g.moves(s, 0).sort(), ["r:16", "r:23"]);
  assert.throws(() => g.play(s, 0, "r:0"), /illegal/);
  s = g.play(s, 0, "r:16");
  assert.equal(s.board[16], null);
  assert.equal(s.phase, "turn");
  assert.equal(s.turn, 1);
  assert.equal(inMill(s.board, 1), true);
  // Every white man in a mill and nothing else: any can be taken
  assert.deepEqual(removable(s.board, 0), [0, 1, 2]);
});

test("morris: moving along the lines, three men jump, fewer than three lose", () => {
  const g = GAMES.morris;
  // Nothing in hand: white has 4 men, black 3
  const board = Array(24).fill(null);
  for ( const p of [0, 1, 9, 12] ) board[p] = 0;
  for ( const p of [4, 6, 20] ) board[p] = 1;
  let s = {board, hand: [0, 0], turn: 0, phase: "turn", last: [], quiet: 0, mill: null};
  const moves = g.moves(s, 0);
  assert.ok(moves.includes("m:0-7") && moves.includes("m:9-8") && !moves.includes("m:0-5"), moves.join());
  // Black has three men: they jump anywhere
  s = {...s, turn: 1};
  assert.ok(g.moves(s, 1).includes("m:4-23"));
  // White closes the column 1-9-17 by moving 12 away? Close the mill 1-9-17 by jumping is not allowed for four men
  s = {...s, turn: 0};
  assert.ok(!g.moves(s, 0).includes("m:12-17"));
  // Black down to two men loses
  const lost = {...s, board: s.board.map((c, i) => (i === 20 ? null : c))};
  assert.deepEqual(g.outcome(lost), {done: true, winners: [0], draw: false});
});

test("morris: a player who cannot move loses, long play without a take is a draw", () => {
  const g = GAMES.morris;
  const board = Array(24).fill(null);
  // White man on 0, blocked by black on 1 and 7; white has four men so no jumping
  for ( const p of [0, 2, 4, 6] ) board[p] = 0;
  for ( const p of [1, 7, 3, 5, 9, 15, 11, 13] ) board[p] = 1;
  const s = {board, hand: [0, 0], turn: 0, phase: "turn", last: [], quiet: 0, mill: null};
  assert.deepEqual(g.moves(s, 0), []);
  assert.deepEqual(g.outcome(s), {done: true, winners: [1], draw: false});
  const quiet = {...s, turn: 1, quiet: 60};
  assert.equal(g.outcome(quiet).draw, true);
});

test("morris: the hard guest takes a mill when it can and blocks one", () => {
  const g = GAMES.morris;
  const rng = seeded(5);
  const board = Array(24).fill(null);
  board[0] = 1; board[1] = 1; // black threatens 0-1-2
  board[8] = 0; board[9] = 0; // white can close 8-9-10
  const s = {board, hand: [7, 7], turn: 0, phase: "turn", last: [], quiet: 0, mill: null};
  assert.equal(g.ai(s, 0, "hard", rng), "p:10", "closes its own mill first");
  assert.equal(g.ai(s, 0, "medium", rng), "p:10");
  const block = {...s, board: s.board.map((c, i) => ([8, 9].includes(i) ? null : c))};
  block.board[20] = 0;
  assert.equal(g.ai(block, 0, "hard", rng), "p:2", "blocks the black mill");
});

test("morris: guests play whole games to the end, hard beats easy", () => {
  const g = GAMES.morris;
  let hardWins = 0;
  for ( let seed = 1; seed <= 4; seed++ ) {
    const {state} = guestsPlay(g, 2, seed % 2 ? ["hard", "easy"] : ["easy", "hard"], seeded(seed));
    const r = g.outcome(state);
    assert.equal(r.done, true);
    const hardSeat = seed % 2 ? 0 : 1;
    if ( r.winners.includes(hardSeat) ) hardWins++;
  }
  assert.ok(hardWins >= 3, `hard won ${hardWins} of 4`);
  assert.ok(morrisTest.evaluate(g.init(), 0) === 0);
});

/* -------------------------------------------- */
/*  Liar's dice                                 */
/* -------------------------------------------- */

test("liar's dice: bids must rise, the first move cannot be a call", () => {
  const g = GAMES.liars;
  const s = g.init(seeded(2), 3);
  assert.equal(s.counts.join(), "5,5,5");
  assert.ok(s.dice.every(d => d.length === 5));
  const first = g.moves(s, 0);
  assert.ok(!first.includes("call") && first.includes("b:1:1") && first.includes("b:15:6"));
  assert.ok(higher({count: 3, face: 2}, {count: 2, face: 6}));
  assert.ok(higher({count: 2, face: 5}, {count: 2, face: 4}));
  assert.ok(!higher({count: 2, face: 4}, {count: 2, face: 4}));
  assert.deepEqual(parseBid("b:4:3"), {count: 4, face: 3});
  assert.equal(parseBid("b:4:7"), null);
  const next = g.play(s, 0, "b:3:4", seeded(1));
  assert.deepEqual(next.bid, {count: 3, face: 4, seat: 0});
  assert.equal(next.turn, 1);
  assert.ok(!g.moves(next, 1).includes("b:3:3") && g.moves(next, 1).includes("b:3:5") && g.moves(next, 1).includes("call"));
});

test("liar's dice: lifting the cups, the loser loses a die and begins, the last with dice wins", () => {
  const g = GAMES.liars;
  let s = {...g.init(seeded(3), 2)};
  s.dice = [[2, 2, 3, 4, 6], [2, 5, 5, 5, 6]];
  s = g.play(s, 0, "b:4:5", seeded(1));
  // Three fives on the table: the bid of four is a lie, the bidder (seat 0) loses
  s = g.play(s, 1, "call", seeded(4));
  assert.equal(s.reveal.shown, 3);
  assert.equal(s.reveal.holds, false);
  assert.equal(s.reveal.loser, 0);
  assert.deepEqual(s.counts, [4, 5]);
  assert.equal(s.turn, 0, "the loser begins");
  assert.equal(s.round, 2);
  assert.equal(s.dice[0].length, 4);
  // A bid that holds: the caller loses
  s.dice = [[1, 1, 1, 1], [1, 2, 3, 4, 5]];
  s = g.play(s, 0, "b:5:1", seeded(1));
  s = g.play(s, 1, "call", seeded(5));
  assert.equal(s.reveal.holds, true);
  assert.deepEqual(s.counts, [4, 4]);
  assert.equal(s.turn, 1, "the caller lost and begins");
  // Down to the last die
  s.counts = [1, 4];
  s.turn = 0;
  s.dice = [[6], [1, 2, 3, 4]];
  s = g.play(s, 0, "b:3:6", seeded(1));
  s = g.play(s, 1, "call", seeded(5));
  assert.deepEqual(g.outcome(s), {done: true, winners: [1], draw: false});
  assert.deepEqual(s.out, [true, false]);
});

test("liar's dice: nobody sees the dice of others, the full state comes back with new dice", () => {
  const g = GAMES.liars;
  const s = g.init(seeded(6), 3);
  const pub = publicState(g, s);
  assert.equal(pub.dice, null);
  assert.ok(!JSON.stringify(pub).includes(JSON.stringify(s.dice[0])) || s.dice[0].length === 0);
  assert.deepEqual(g.peek(s, 1), s.dice[1]);
  const back = g.restore(pub, seeded(7));
  assert.equal(back.dice.length, 3);
  assert.ok(back.dice.every((d, i) => d.length === s.counts[i]));
  assert.notEqual(back.rollId, pub.rollId, "a new shake gets a new id");
});

test("liar's dice: odds, a guest calls a hopeless bid and plays games to the end", () => {
  assert.equal(chanceAtLeast(10, 0), 1);
  assert.equal(chanceAtLeast(3, 4), 0);
  assert.ok(Math.abs(chanceAtLeast(1, 1) - (1 / 6)) < 1e-9);
  const g = GAMES.liars;
  let s = g.init(seeded(8), 2);
  s.dice = [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5]];
  s.bid = {count: 9, face: 6, seat: 0};
  s.turn = 1;
  assert.equal(g.ai(s, 1, "hard", seeded(1)), "call");
  for ( let seed = 1; seed <= 6; seed++ ) {
    const {state, moves} = guestsPlay(g, 2 + (seed % 3), ["easy", "medium", "hard"], seeded(seed));
    assert.equal(g.outcome(state).done, true, `seed ${seed}`);
    assert.ok(moves < 2000);
  }
});

test("liar's dice: a player who leaves is out, the cups are shaken again", () => {
  const g = GAMES.liars;
  let s = g.init(seeded(9), 3);
  s = g.play(s, 0, "b:2:3", seeded(1));
  const before = s.rollId;
  s = g.forfeit(s, 1, seeded(2));
  assert.deepEqual(s.out, [false, true, false]);
  assert.equal(s.counts[1], 0);
  assert.equal(s.bid, null);
  assert.equal(s.turn, 2, "the leaver's turn passes on");
  assert.notEqual(s.rollId, before);
  s = g.forfeit(s, 2, seeded(3));
  assert.deepEqual(g.outcome(s), {done: true, winners: [0], draw: false});
});

/* -------------------------------------------- */
/*  Ship, captain and crew                      */
/* -------------------------------------------- */

test("ship: ship, captain and crew only in order, then the cargo; three throws end the turn", () => {
  const g = GAMES.ship;
  let s = g.init(seeded(1), 2);
  assert.deepEqual(g.moves(s, 0), ["roll"]);
  // First throw: 5 4 3 2 1 has no ship, so captain and crew wait
  s = g.play(s, 0, "roll", dice([5, 4, 3, 2, 1]));
  assert.equal(s.ship, false);
  assert.equal(s.captain, false);
  assert.equal(s.dice.length, 5);
  assert.deepEqual(g.moves(s, 0), ["roll"], "no stop without a crew");
  // Second throw: 6 5 4 6 3 gives ship, captain and crew, cargo 6 + 3
  s = g.play(s, 0, "roll", dice([6, 5, 4, 6, 3]));
  assert.ok(s.ship && s.captain && s.crew);
  assert.deepEqual(s.dice, [6, 3]);
  assert.equal(cargo(s), 9);
  assert.deepEqual(g.moves(s, 0), ["roll", "stop"]);
  s = g.play(s, 0, "stop", seeded(1));
  assert.equal(s.scores[0], 9);
  assert.equal(s.turn, 1);
  // Seat 1 never finds a crew: no cargo after three throws
  s = g.play(s, 1, "roll", dice([6, 5, 1, 1, 1]));
  assert.ok(s.ship && s.captain && !s.crew);
  assert.equal(s.dice.length, 3);
  s = g.play(s, 1, "roll", dice([1, 2, 3]));
  s = g.play(s, 1, "roll", dice([1, 2, 3]));
  assert.equal(s.scores[1], 0);
  assert.equal(s.turn, null);
  assert.deepEqual(g.outcome(s), {done: true, winners: [0], draw: false});
});

test("ship: equal cargo shares the win, a player who leaves brings nothing home", () => {
  const g = GAMES.ship;
  const tie = {...g.init(seeded(1), 3), scores: [8, 8, 5], turn: null};
  assert.deepEqual(g.outcome(tie), {done: true, winners: [0, 1], draw: true});
  let s = g.init(seeded(2), 3);
  s = g.forfeit(s, 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(g.moves(s, 0), []);
  s = {...s, scores: [null, 4, 7], turn: null};
  assert.deepEqual(g.outcome(s), {done: true, winners: [2], draw: false});
});

test("ship: guests know when to drop anchor, games end for two to four", () => {
  const g = GAMES.ship;
  const s = {...g.init(seeded(1), 2), ship: true, captain: true, crew: true, dice: [6, 5], throws: 1};
  assert.equal(g.ai(s, 0, "hard"), "stop");
  assert.equal(g.ai({...s, dice: [2, 1]}, 0, "hard"), "roll");
  assert.equal(g.ai({...s, scores: [null, 12], turn: 0}, 0, "hard"), "roll", "behind the leader: throw on");
  for ( let seats = 2; seats <= 4; seats++ ) {
    const {state} = guestsPlay(g, seats, Object.values(GUESTS).map(x => x.level), seeded(seats));
    assert.equal(g.outcome(state).done, true);
    assert.ok(state.scores.every(x => x !== null));
  }
});

test("liar's dice: a guest opens with the face it holds most of", () => {
  const g = GAMES.liars;
  const s = g.init(seeded(11), 2);
  s.dice = [[5, 5, 5, 2, 1], [1, 2, 3, 4, 6]];
  const move = g.ai(s, 0, "hard", seeded(1));
  assert.match(move, /^b:\d+:5$/);
  assert.ok(Number(move.split(":")[1]) >= 3, move);
});
