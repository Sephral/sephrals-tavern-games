import assert from "node:assert/strict";
import test from "node:test";
import {GAMES} from "../scripts/games/index.mjs";
import {TIERS, cleanRanking, titleFor} from "../scripts/games/ranking.mjs";
import {OPEN_ID, SCENE_IDS, buildOpenTable, buildRanking, buildTable, sampleSeats, sampleStandings, seeded} from "../scripts/sample-tables.mjs";

const CAST = [
  {id: "ari", name: "Ari", img: "a.webp"}, {id: "mira", name: "Mira", img: "b.webp"},
  {id: "tovin", name: "Tovin", img: "c.webp"}, {id: "sela", name: "Sela", img: "d.webp"}
];
const seats = sampleSeats(CAST, "me-id");
const NOW = 1_800_000_000_000;

test("the seeded generator gives the same numbers for the same seed", () => {
  const a = seeded(7);
  const b = seeded(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(seeded(8)(), seeded(7)());
});

test("the user sits at the first hero's seat, the others are other players and guests", () => {
  assert.equal(seats.me.userId, "me-id");
  assert.equal(seats.me.name, "Ari");
  assert.equal(seats.bertram.kind, "guest");
  assert.ok(["easy", "medium", "hard"].includes(seats.jasper.level));
});

test("every game has a running table and a finished one", () => {
  for ( const id of Object.keys(GAMES) ) {
    const states = SCENE_IDS.filter(scene => scene.startsWith(`${id}-`)).map(scene => buildTable(scene, seats, NOW).table.status);
    assert.ok(states.includes("playing"), `${id} running`);
    assert.ok(states.includes("done"), `${id} finished`);
  }
});

test("a finished table has a result, a running one has none and the user's turn or a position to look at", () => {
  for ( const id of SCENE_IDS ) {
    const {table} = buildTable(id, seats, NOW);
    assert.equal(id, `${table.game}-${id.split("-")[1]}`);
    assert.equal(table.id, `sample-${id}`);
    if ( table.status === "done" ) assert.ok(table.result?.done, id);
    else {
      assert.equal(table.result, null, id);
      assert.ok(GAMES[table.game].outcome(table.state).done === false, id);
    }
    assert.ok(table.seats.some(seat => seat.userId === "me-id"), `${id} has the user`);
  }
});

test("the samples show a win, a loss and a draw", () => {
  const wins = id => buildTable(id, seats, NOW).table.result;
  assert.equal(wins("tictactoe-won").winners[0], 0);
  assert.equal(wins("tictactoe-draw").draw, true);
  assert.equal(wins("fourinarow-lost").winners[0], 1);
  const results = wins("twentyone-done").results;
  for ( const kind of ["win", "lose", "push"] ) assert.ok(results.includes(kind), kind);
});

test("the sample tables are the same every time", () => {
  const a = buildTable("liars-running", seats, NOW);
  const b = buildTable("liars-running", seats, NOW);
  assert.deepEqual(a, b);
});

test("hidden information stays hidden: no dice in the public state, the user's own dice come separately", () => {
  const liars = buildTable("liars-running", seats, NOW);
  assert.equal(liars.table.state.dice, null);
  assert.equal(liars.peek.dice.length, liars.table.state.counts[0]);
  const mexico = buildTable("mexico-running", seats, NOW);
  assert.equal(mexico.table.state.cup.dice, null);
  assert.equal(mexico.peek.dice.length, 2);
  const twentyone = buildTable("twentyone-running", seats, NOW);
  assert.equal(twentyone.table.state.dealer[1], null);
});

test("a table with a stake carries the stake, a finished one its payout", () => {
  const running = buildTable("twentyone-running", seats, NOW).table;
  assert.deepEqual([running.stake.amount, running.stake.mode], [500, "dnd5e"]);
  assert.equal(running.stake.payout, null);
  const done = buildTable("twentyone-done", seats, NOW).table;
  assert.ok(done.stake.payout.net.some(n => n > 0));
  assert.ok(done.stake.payout.net.some(n => n < 0));
  assert.ok(buildTable("mexico-won", seats, NOW).table.stake.payout.pot > 0);
  assert.equal(buildTable("tictactoe-running", seats, NOW).table.stake, undefined);
});

test("one player of the running Pig table has left", () => {
  const pig = buildTable("pig-running", seats, NOW).table;
  assert.equal(pig.seats.filter(seat => seat.left).length, 1);
  assert.equal(pig.state.out[2], true);
});

test("the open table waits for players and has room", () => {
  const open = buildOpenTable(seats, NOW);
  assert.equal(open.id, OPEN_ID);
  assert.equal(open.status, "open");
  assert.ok(open.seats.length < GAMES[open.game].seats.max);
  assert.ok(open.seats.length >= GAMES[open.game].seats.min);
});

test("the evening's ranking shows every tavern title and all the money forms", () => {
  const ranking = buildRanking(seats, NOW);
  const rows = sampleStandings(ranking, NOW);
  assert.equal(rows.length, 5);
  const titles = new Set(rows.map(row => titleFor(cleanRanking(ranking).all[row.key].wins)));
  assert.deepEqual([...titles].sort(), TIERS.map(tier => tier.id).sort());
  assert.ok(rows.some(row => row.net.dnd5e), "coins");
  assert.ok(rows.some(row => row.net.chips), "chips");
  assert.equal(rows[0].name, "Lena");
});
