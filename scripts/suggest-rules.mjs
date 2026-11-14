/**
 * Rules of the break suggestion, without Foundry: which game to suggest, when an offer may come and how long it
 * lasts, and who still gets the two line introduction. Kept pure so Node can test them.
 */

/** Minutes an offer stays on the players' screens. */
export const OFFER_MINUTES = 10;

/** An offer made by a pause comes at most this often (milliseconds). */
export const OFFER_COOLDOWN = 10 * 60 * 1000;

/**
 * @typedef GameInfo
 * @property {number} min      Fewest players
 * @property {number} max      Most players
 * @property {boolean} guests  A tavern guest can play it
 */

/**
 * The game to suggest: one that fits the table, the least played first (a game nobody ever started comes before
 * any other), not the one suggested last unless it is the only one.
 * @param {object} options
 * @param {Record<string, GameInfo>} options.games   All games by id
 * @param {string[]} options.offered                 Ids the GM offers
 * @param {Record<string, number>} [options.played]  Games started so far, by id
 * @param {string|null} [options.last]               The game suggested before
 * @param {number} [options.online]                  Players online (GMs not counted)
 * @param {() => number} [options.rng]
 * @returns {string|null}
 */
export function pickGame({games, offered, played={}, last=null, online=1, rng=Math.random}) {
  const known = offered.filter(id => games[id]);
  // Alone at the table a game needs a tavern guest, with company any game for two or more will do
  const fits = known.filter(id => (online >= 2 ? games[id].max >= 2 : !!games[id].guests));
  let pool = fits.length ? fits : known;
  if ( !pool.length ) return null;
  if ( (pool.length > 1) && pool.includes(last) ) pool = pool.filter(id => id !== last);
  const least = Math.min(...pool.map(id => played[id] ?? 0));
  const rarest = pool.filter(id => (played[id] ?? 0) === least);
  return rarest[Math.min(Math.floor(rng() * rarest.length), rarest.length - 1)];
}

/**
 * May a pause bring an offer now?
 * @param {object} options
 * @param {boolean} options.enabled       The GM did not turn the offers off
 * @param {boolean} options.paused        The game was just paused (not resumed)
 * @param {number} options.now
 * @param {number|null} options.lastAt    When the last offer was made
 * @param {number} [options.cooldown]
 * @param {number} [options.online]       Players online
 * @returns {boolean}
 */
export function offerAllowed({enabled, paused, now, lastAt, cooldown=OFFER_COOLDOWN, online=1}) {
  if ( !enabled || !paused || (online < 1) ) return false;
  return (lastAt === null) || (lastAt === undefined) || ((now - lastAt) >= cooldown);
}

/**
 * The offer as stored, checked.
 * @param {*} value
 * @param {string[]} gameIds
 * @returns {{id: string, game: string, at: number, tableId: string|null}|null}
 */
export function cleanOffer(value, gameIds) {
  if ( !value || (typeof value !== "object") || (typeof value.id !== "string") || !gameIds.includes(value.game) ) return null;
  return {id: value.id, game: value.game, at: Number(value.at) || 0, tableId: (typeof value.tableId === "string") ? value.tableId : null};
}

/**
 * Has an offer run out on this client? Each client counts from when it first saw the offer: the clocks of the
 * computers may differ.
 * @param {number} seenAt
 * @param {number} now
 * @param {number} [minutes]
 * @returns {boolean}
 */
export function offerExpired(seenAt, now, minutes=OFFER_MINUTES) {
  return (now - seenAt) >= (minutes * 60 * 1000);
}

/**
 * Does this user still get the short introduction at the table? Everybody does until their first game is over.
 * @param {string} userId
 * @param {string[]} introduced   Users who finished a game
 * @returns {boolean}
 */
export function needsIntro(userId, introduced) {
  return !(Array.isArray(introduced) && introduced.includes(userId));
}

/**
 * The users of the seats of a table who are new to the tavern.
 * @param {{seats: {kind: string, userId?: string}[]}} table
 * @param {string[]} introduced
 * @returns {string[]}  Ids to add to the introduced users
 */
export function newcomersOf(table, introduced) {
  return table.seats.filter(seat => (seat.kind === "user") && seat.userId && needsIntro(seat.userId, introduced))
    .map(seat => seat.userId);
}
