import assert from "node:assert/strict";
import test from "node:test";
import {GAMES, GUESTS, game, gameOffered, publicState} from "../scripts/games/index.mjs";
import {winnerOf as tttWinner} from "../scripts/games/tictactoe.mjs";
import {COLS, dropRow, winnerOf as c4Winner} from "../scripts/games/fourinarow.mjs";
import {DECK, drawCard, handValue} from "../scripts/games/twentyone.mjs";

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

/** Play a game to its end with a move chooser per seat. */
function playOut(g, choosers, rng, seats = 2, options) {
  let state = g.init(rng, seats, options);
  for ( let guard = 0; guard < 1000 && !g.outcome(state).done; guard++ ) {
    const seat = state.turn;
    const move = choosers[seat](state, seat);
    state = g.play(state, seat, move, rng);
  }
  return state;
}
const randomMover = (g, rng) => (state, seat) => {
  const m = g.moves(state, seat);
  return m[Math.floor(rng() * m.length)];
};
const aiMover = (g, level, rng) => (state, seat) => g.ai(state, seat, level, rng);

/* -------------------------------------------- */

test("every game has the parts the tavern needs, every guest a level", () => {
  for ( const g of Object.values(GAMES) ) {
    for ( const fn of ["init", "moves", "play", "outcome"] ) assert.equal(typeof g[fn], "function", `${g.id}.${fn}`);
    if ( g.guests ) assert.equal(typeof g.ai, "function", g.id);
    assert.ok(g.seats.min >= 1 && g.seats.max >= g.seats.min, g.id);
  }
  for ( const guest of Object.values(GUESTS) ) assert.ok(["easy", "medium", "hard"].includes(guest.level));
  assert.throws(() => game("chess"), /unknownGame/);
});

test("tic-tac-toe: lines, draws, turns and illegal moves", () => {
  const g = GAMES.tictactoe;
  assert.equal(tttWinner([0, 0, 0, null, 1, 1, null, null, null]), 0);
  assert.equal(tttWinner([1, null, null, 1, 0, null, 1, 0, null]), 1);
  assert.equal(tttWinner([0, 1, 0, 0, 1, 1, 1, 0, 0]), "draw");
  let s = g.init();
  assert.deepEqual(g.moves(s, 1), [], "O may not begin");
  s = g.play(s, 0, 4);
  assert.throws(() => g.play(s, 1, 4), /illegal/, "occupied cell");
  assert.throws(() => g.play(s, 0, 0), /illegal/, "not X's turn");
  assert.equal(s.turn, 1);
});

test("tic-tac-toe: the hard guest never loses, as X or as O, against every possible opponent", () => {
  const g = GAMES.tictactoe;
  const rng = seeded(7);
  let games = 0;
  // Walk every move the opponent can make
  function explore(state, aiSeat) {
    const out = g.outcome(state);
    if ( out.done ) {
      games++;
      assert.ok(out.draw || out.winners[0] === aiSeat, `lost a game as seat ${aiSeat}: ${JSON.stringify(state.board)}`);
      return;
    }
    if ( state.turn === aiSeat ) return explore(g.play(state, aiSeat, g.ai(state, aiSeat, "hard", rng)), aiSeat);
    for ( const m of g.moves(state, state.turn) ) explore(g.play(state, state.turn, m), aiSeat);
  }
  explore(g.init(), 0);
  explore(g.init(), 1);
  assert.ok(games > 100, `${games} games`);
});

test("tic-tac-toe: the medium guest takes a win and blocks a line", () => {
  const g = GAMES.tictactoe;
  const rng = seeded(3);
  const win = {board: [1, 1, null, 0, 0, null, null, null, null], turn: 1, last: 4};
  assert.equal(g.ai(win, 1, "medium", rng), 2);
  const block = {board: [0, 0, null, null, 1, null, null, null, null], turn: 1, last: 1};
  assert.equal(g.ai(block, 1, "medium", rng), 2);
});

test("four in a row: pieces fall, all four directions win, a full board is a draw", () => {
  const g = GAMES.fourinarow;
  let s = g.init();
  s = g.play(s, 0, 3);
  assert.equal(s.board[(5 * COLS) + 3], 0, "lands at the bottom");
  s = g.play(s, 1, 3);
  assert.equal(s.board[(4 * COLS) + 3], 1, "lands on top");
  const empty = () => Array(42).fill(null);
  const horizontal = empty();
  [0, 1, 2, 3].forEach(c => { horizontal[(5 * COLS) + c] = 1; });
  assert.equal(c4Winner(horizontal), 1);
  const vertical = empty();
  [2, 3, 4, 5].forEach(r => { vertical[(r * COLS) + 6] = 0; });
  assert.equal(c4Winner(vertical), 0);
  const diagonal = empty();
  [[5, 0], [4, 1], [3, 2], [2, 3]].forEach(([r, c]) => { diagonal[(r * COLS) + c] = 1; });
  assert.equal(c4Winner(diagonal), 1);
  const anti = empty();
  [[2, 3], [3, 4], [4, 5], [5, 6]].forEach(([r, c]) => { anti[(r * COLS) + c] = 0; });
  assert.equal(c4Winner(anti), 0);
  // a full column takes no more pieces
  let t = g.init();
  for ( let i = 0; i < 6; i++ ) t = g.play(t, t.turn, 0);
  assert.ok(!g.moves(t, t.turn).includes(0));
  assert.equal(dropRow(t.board, 0), -1);
  // a full board without four in a row is a draw: columns in pairs, the pattern shifts every two rows
  const draw = [];
  for ( let r = 0; r < 6; r++ ) for ( let c = 0; c < 7; c++ ) draw.push((Math.floor(c / 2) + Math.floor(r / 2)) % 2 === 0 ? (c % 2) : 1 - (c % 2));
  const result = c4Winner(draw);
  assert.ok(result === "draw" || result === 0 || result === 1);
  assert.equal(c4Winner(Array(42).fill(null)), null);
});

test("four in a row: medium and hard guests win at once and block, and beat a random player", () => {
  const g = GAMES.fourinarow;
  const rng = seeded(11);
  const board = Array(42).fill(null);
  [0, 1, 2].forEach(c => { board[(5 * COLS) + c] = 1; });
  board[(5 * COLS) + 6] = 0;
  board[(4 * COLS) + 6] = 0;
  for ( const level of ["medium", "hard"] ) {
    assert.equal(g.ai({board, turn: 1, last: null}, 1, level, rng), 3, `${level} wins`);
    assert.equal(g.ai({board, turn: 0, last: null}, 0, level, rng), 3, `${level} blocks`);
  }
  let wins = 0;
  for ( let i = 0; i < 20; i++ ) {
    const end = playOut(g, [aiMover(g, "hard", rng), randomMover(g, rng)], rng);
    if ( g.outcome(end).winners[0] === 0 ) wins++;
  }
  assert.ok(wins >= 19, `hard won ${wins} of 20`);
});

test("matches: one to three, whoever takes the last one loses, the hard guest wins when it begins", () => {
  const g = GAMES.matches;
  const rng = seeded(5);
  let s = g.init();
  assert.equal(s.left, 15);
  assert.throws(() => g.play(s, 0, 4), /illegal/);
  s = {...s, left: 2};
  assert.deepEqual(g.moves(s, 0), [1, 2]);
  const last = g.play({...s, left: 1}, 0, 1);
  assert.deepEqual(g.outcome(last), {done: true, winners: [1], draw: false});
  for ( let i = 0; i < 200; i++ ) {
    const end = playOut(g, [aiMover(g, "hard", rng), randomMover(g, rng)], rng);
    assert.deepEqual(g.outcome(end).winners, [0], `game ${i}`);
  }
  // the hard guest leaves 4k + 1 matches
  for ( let left = 2; left <= 15; left++ ) {
    const move = g.ai({left, start: 15, turn: 0, taken: []}, 0, "hard", rng);
    if ( (left - 1) % 4 !== 0 ) assert.equal((left - move - 1) % 4, 0, `left ${left}`);
  }
});

test("pig: a one loses the turn's sum, holding banks it, the goal ends the game", () => {
  const g = GAMES.pig;
  const fixed = values => () => values.shift();
  const die = face => (face - 0.5) / 6;
  let s = g.init(null, 2, {goal: 20});
  assert.deepEqual(g.moves(s, 0), ["roll"]);
  s = g.play(s, 0, "roll", fixed([die(5)]));
  assert.equal(s.turnTotal, 5);
  s = g.play(s, 0, "roll", fixed([die(6)]));
  assert.equal(s.turnTotal, 11);
  s = g.play(s, 0, "hold");
  assert.deepEqual([s.scores[0], s.turn, s.turnTotal], [11, 1, 0]);
  s = g.play(s, 1, "roll", fixed([die(4)]));
  s = g.play(s, 1, "roll", fixed([die(1)]));
  assert.deepEqual([s.scores[1], s.turn, s.busted, s.turnTotal], [0, 0, true, 0]);
  s = g.play(s, 0, "roll", fixed([die(6)]));
  s = g.play(s, 0, "roll", fixed([die(6)]));
  s = g.play(s, 0, "hold");
  assert.deepEqual(g.outcome(s), {done: true, winners: [0], draw: false});
  assert.deepEqual(g.moves(s, 0), []);
  // guests hold at their limit and when the sum wins
  assert.equal(g.ai({...g.init(null, 2), turnTotal: 22, scores: [0, 0]}, 0, "hard", Math.random), "hold");
  assert.equal(g.ai({...g.init(null, 2), turnTotal: 5, scores: [0, 0]}, 0, "hard", Math.random), "roll");
  assert.equal(g.ai({...g.init(null, 2), turnTotal: 3, scores: [48, 0]}, 0, "easy", Math.random), "hold");
  // four players take turns in order
  let four = g.init(null, 4);
  four = g.play(four, 0, "roll", fixed([die(1)]));
  four = g.play(four, 1, "roll", fixed([die(1)]));
  four = g.play(four, 2, "roll", fixed([die(1)]));
  assert.equal(four.turn, 3);
  four = g.play(four, 3, "roll", fixed([die(1)]));
  assert.equal(four.turn, 0);
});

test("twenty-one: hand values with aces and faces", () => {
  assert.deepEqual(handValue(["AS", "KH"]), {total: 21, soft: true});
  assert.deepEqual(handValue(["AS", "AH", "9D"]), {total: 21, soft: true});
  assert.deepEqual(handValue(["AS", "AH", "9D", "5C"]), {total: 16, soft: false});
  assert.equal(handValue(["KS", "QH", "5D"]).total, 25);
  assert.equal(handValue(["10S", null]).total, 10);
  assert.equal(DECK.length, 52);
  assert.equal(new Set(DECK).size, 52);
  for ( let i = 0; i < 50; i++ ) assert.ok(!["AS", "KH"].includes(drawCard(["AS", "KH"], () => i / 50)));
  assert.equal(drawCard(DECK.filter(c => c !== "7D"), () => 0.3), "7D", "the last card left");
});

test("twenty-one: the dealer draws to 17, results per player, nobody gets a card twice", () => {
  const g = GAMES.twentyone;
  const rng = seeded(42);
  for ( let i = 0; i < 300; i++ ) {
    const seats = 1 + (i % 4);
    let s = g.init(rng, seats);
    let guard = 0;
    while ( !g.outcome(s).done && guard++ < 50 ) {
      const move = handValue(s.hands[s.turn]).total < 15 ? "hit" : "stand";
      s = g.play(s, s.turn, move, rng);
    }
    const cards = [...s.hands.flat(), ...s.dealer];
    assert.equal(new Set(cards).size, cards.length, "no duplicate card");
    const dealer = handValue(s.dealer).total;
    if ( s.busted.some(b => !b) ) assert.ok(dealer >= 17, `dealer stopped at ${dealer}`);
    s.results.forEach((r, seat) => {
      const mine = handValue(s.hands[seat]).total;
      if ( mine > 21 ) assert.equal(r, "lose");
      else if ( dealer > 21 || mine > dealer ) assert.equal(r, "win");
      else if ( mine === dealer ) assert.equal(r, "push");
      else assert.equal(r, "lose");
    });
    const out = g.outcome(s);
    assert.deepEqual(out.winners, s.results.map((r, k) => (r === "win" ? k : null)).filter(k => k !== null));
  }
});

test("twenty-one: the face down card stays hidden until the end and can be dealt again", () => {
  const g = GAMES.twentyone;
  const rng = seeded(9);
  let s;
  do s = g.init(rng, 1); while ( s.phase === "done" );
  const open = publicState(g, s);
  assert.equal(open.dealer[1], null);
  assert.equal(open.dealer[0], s.dealer[0]);
  assert.ok(s.dealer[1], "the full state keeps it");
  const restored = g.restore(open, rng);
  assert.ok(restored.dealer[1]);
  assert.ok(![...restored.hands.flat(), restored.dealer[0]].includes(restored.dealer[1]));
  s = g.play(s, 0, "stand", rng);
  assert.deepEqual(publicState(g, s), s, "nothing hidden at the end");
  assert.throws(() => g.play(s, 0, "hit", rng), /illegal/);
});

test("twenty-one: all players bust, the dealer does not draw", () => {
  const g = GAMES.twentyone;
  const state = {hands: [["KS", "QS"]], stood: [false], busted: [false], turn: 0, dealer: ["2H", "3H"], phase: "players", results: []};
  const end = g.play(state, 0, "hit", () => 0.5);
  if ( end.busted[0] ) {
    assert.deepEqual(end.dealer, ["2H", "3H"]);
    assert.deepEqual(end.results, ["lose"]);
  }
});

test("pig: a player who leaves is out, the turn skips them, the last one left wins", () => {
  const g = GAMES.pig;
  let state = g.init(seeded(3), 3);
  state = g.forfeit(state, 0);
  assert.equal(state.turn, 1, "the turn of the leaver passes on");
  assert.deepEqual(g.moves(state, 0), []);
  assert.equal(g.outcome(state).done, false);
  // Seat 1 holds after a roll, the turn goes to 2 and then past the leaver back to 1
  state = {...state, turnTotal: 4, rolls: [4]};
  state = g.play(state, 1, "hold", seeded(1));
  assert.equal(state.turn, 2);
  state = {...state, turnTotal: 5, rolls: [5]};
  state = g.play(state, 2, "hold", seeded(1));
  assert.equal(state.turn, 1, "seat 0 is skipped");
  state = g.forfeit(state, 2);
  assert.deepEqual(g.outcome(state), {done: true, winners: [1], draw: false});
});

test("pig: the score of a leaver never wins, a guest ignores leavers when it judges its lead", () => {
  const g = GAMES.pig;
  let state = {...g.init(seeded(4), 3), scores: [60, 10, 10], goal: 50};
  state.out = [true, false, false];
  assert.equal(g.outcome(state).done, false);
  // 22 in the pot: a hard guest far behind would gamble on, but the leaver's 60 does not count
  state = {...state, turn: 1, turnTotal: 22, rolls: [6, 6, 5, 5]};
  assert.equal(g.ai(state, 1, "hard", seeded(1)), "hold", "the hard guest is not behind the leaver");
});

test("twenty-one: a player who leaves loses the hand, the others play on, the dealer plays for them", () => {
  const g = GAMES.twentyone;
  let state;
  for ( let seed = 1; seed < 200; seed++ ) {
    state = g.init(seeded(seed), 2);
    if ( state.turn === 0 ) break;
  }
  state = g.forfeit(state, 0, seeded(9));
  assert.equal(state.left[0], true);
  assert.notEqual(state.turn, 0);
  if ( state.turn === 1 ) state = g.play(state, 1, "stand", seeded(9));
  assert.equal(state.phase, "done");
  assert.equal(state.results[0], "lose");
  assert.ok(["win", "lose", "push"].includes(state.results[1]));
  assert.ok(state.dealer.length >= 2);
});

test("twenty-one: when the only player leaves, the hand ends and the dealer does not draw", () => {
  const g = GAMES.twentyone;
  let state;
  for ( let seed = 1; seed < 200; seed++ ) {
    state = g.init(seeded(seed), 1);
    if ( state.turn === 0 ) break;
  }
  state = g.forfeit(state, 0, seeded(2));
  assert.equal(state.phase, "done");
  assert.deepEqual(state.results, ["lose"]);
  assert.equal(state.dealer.length, 2);
});

test("games on offer: every game unless switched off, unknown games never", () => {
  for ( const id of Object.keys(GAMES) ) assert.equal(gameOffered(id), true);
  assert.equal(gameOffered("pig", ["pig"]), false);
  assert.equal(gameOffered("tictactoe", ["pig"]), true);
  assert.equal(gameOffered("chess"), false);
  assert.equal(gameOffered("pig", null), true);
});
