/**
 * The ranking of the evening and the reputation at the tavern: the pure rules. Nothing here touches Foundry.
 *
 * Every finished game counts for the users who sat at the table (the tavern guests are not ranked): a game played, a
 * win and, when the table played for a stake, the money won or lost (kept per kind of money). An evening ("session")
 * is the span of games without a break of SESSION_GAP, or until the GM starts a new one. The wins of all evenings
 * together give a tavern title.
 * Stored shape: {session: {id, start, last, players: {userId: {name, wins, games, net}}}|null,
 *   all: {userId: {name, wins, games}}, counted: string[]}
 */

/** A break of this many milliseconds between two games ends the evening. */
export const SESSION_GAP = 8 * 60 * 60 * 1000;

/** How many finished games are remembered, so one game is never counted twice. */
const KEEP_COUNTED = 20;

/** Tavern titles by all time wins, lowest first. */
export const TIERS = [
  {id: "stranger", wins: 0},
  {id: "face", wins: 3},
  {id: "local", wins: 10},
  {id: "master", wins: 25},
  {id: "legend", wins: 50}
];

/**
 * The tavern title for a number of wins.
 * @param {number} wins
 * @returns {string}
 */
export function titleFor(wins) {
  let id = TIERS[0].id;
  for ( const tier of TIERS ) if ( (Number(wins) || 0) >= tier.wins ) id = tier.id;
  return id;
}

/**
 * An empty ranking.
 * @returns {{session: null, all: object, counted: string[]}}
 */
export function emptyRanking() {
  return {session: null, all: {}, counted: []};
}

/**
 * A stored ranking made safe to read.
 * @param {*} stored
 * @returns {{session: object|null, all: object, counted: string[]}}
 */
export function cleanRanking(stored) {
  const ranking = (stored && (typeof stored === "object")) ? stored : {};
  return {
    session: (ranking.session && (typeof ranking.session === "object") && ranking.session.players) ? ranking.session : null,
    all: (ranking.all && (typeof ranking.all === "object")) ? ranking.all : {},
    counted: Array.isArray(ranking.counted) ? ranking.counted : []
  };
}

/**
 * The evening that is still going on, or null when the last game was too long ago.
 * @param {object} ranking
 * @param {number} now
 * @returns {object|null}
 */
export function liveSession(ranking, now) {
  const session = cleanRanking(ranking).session;
  return (session && ((now - session.last) <= SESSION_GAP)) ? session : null;
}

/**
 * The seats that won a finished table.
 * @param {object} table
 * @returns {Set<number>}
 */
export function winnersOf(table) {
  const r = table?.result;
  if ( !r ) return new Set();
  if ( Array.isArray(r.results) ) return new Set(r.results.map((res, i) => (res === "win" ? i : null)).filter(i => i !== null));
  return new Set(r.winners ?? []);
}

/**
 * A key for one finished game of a table (a rematch is another game at the same table).
 * @param {object} table
 * @returns {string}
 */
export function gameKey(table) {
  return `${table?.id}:${table?.started ?? table?.round ?? 0}`;
}

/**
 * Count a finished game.
 * @param {object} stored   The ranking so far
 * @param {object} table    Finished table (with `stake.payout` when it played for money)
 * @param {number} now
 * @returns {object|null}   The new ranking, null when the game does not count
 */
export function recordGame(stored, table, now) {
  const ranking = structuredClone(cleanRanking(stored));
  const key = gameKey(table);
  const users = (table?.seats ?? []).map((seat, i) => ({seat, i})).filter(({seat}) => seat.kind === "user" && seat.userId);
  if ( (table?.status !== "done") || !users.length || ranking.counted.includes(key) ) return null;
  if ( !liveSession(ranking, now) ) ranking.session = {id: now.toString(36), start: now, last: now, players: {}};
  const session = ranking.session;
  session.last = now;
  const won = winnersOf(table);
  const mode = table.stake?.mode ?? "chips";
  const net = table.stake?.payout?.net ?? null;
  for ( const {seat, i} of users ) {
    const player = session.players[seat.userId] ??= {name: seat.name, wins: 0, games: 0, net: {}};
    const total = ranking.all[seat.userId] ??= {name: seat.name, wins: 0, games: 0};
    player.name = total.name = seat.name ?? player.name;
    player.games++;
    total.games++;
    if ( won.has(i) ) {
      player.wins++;
      total.wins++;
    }
    if ( net && Number.isFinite(net[i]) && net[i] ) player.net[mode] = (player.net[mode] ?? 0) + net[i];
  }
  ranking.counted = [...ranking.counted, key].slice(-KEEP_COUNTED);
  return ranking;
}

/**
 * Close the evening: the next game starts a new one. The wins of all evenings stay.
 * @param {object} stored
 * @returns {object}
 */
export function newEvening(stored) {
  return {...cleanRanking(stored), session: null};
}

/**
 * The standings of an evening: most wins first, then the better balance, then fewer games played.
 * @param {object|null} session
 * @returns {{key: string, name: string, wins: number, games: number, net: Record<string, number>}[]}
 */
export function standings(session) {
  const total = net => Object.values(net ?? {}).reduce((a, b) => a + b, 0);
  return Object.entries(session?.players ?? {})
    .map(([key, p]) => ({key, name: p.name, wins: p.wins, games: p.games, net: p.net ?? {}}))
    .sort((a, b) => (b.wins - a.wins) || (total(b.net) - total(a.net)) || (a.games - b.games) || a.name.localeCompare(b.name));
}
