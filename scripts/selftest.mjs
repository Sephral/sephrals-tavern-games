/**
 * Self-test: every game plays a whole round against itself, the socket and the table storage work.
 */

import {MODULE_ID, TESTED_VERSIONS, esc, t} from "./config.mjs";
import {GAMES, GUESTS} from "./games/index.mjs";

/**
 * Run all checks.
 * @returns {{problems: string[], checks: number}}
 */
function checkAll() {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if ( !ok ) problems.push(game.i18n.has(key) ? t(key, data) : key);
  };
  check(typeof game.socket?.emit === "function", "STG.SELFTEST.Socket");
  check(game.settings.settings.has(`${MODULE_ID}.tables`), "STG.SELFTEST.Storage");
  check(!!game.users.activeGM, "STG.SELFTEST.NoGM");
  for ( const g of Object.values(GAMES) ) {
    let ok = true;
    try {
      const rng = Math.random;
      const seats = g.seats.min === 1 ? 2 : g.seats.min;
      let state = g.init(rng, seats, {goal: 20});
      for ( let i = 0; (i < 500) && !g.outcome(state).done; i++ ) {
        const seat = state.turn;
        const move = g.guests ? g.ai(state, seat, Object.values(GUESTS)[i % 3].level, rng) : g.moves(state, seat)[i % 2];
        state = g.play(state, seat, move, rng);
      }
      ok = g.outcome(state).done;
    } catch(err) {
      console.error(`${MODULE_ID} | Self-test of ${g.id}`, err);
      ok = false;
    }
    check(ok, "STG.SELFTEST.Game", {game: t(`STG.Game.${g.id}.name`)});
  }
  return {problems, checks};
}

/**
 * Run the self-test and report the result.
 * @param {object} [options]
 * @param {boolean} [options.report=true]
 * @returns {Promise<{problems: string[], checks: number}>}
 */
export async function runSelfTest({report=true}={}) {
  const {problems, checks} = checkAll();
  const summary = problems.length ? t("STG.SELFTEST.Problems", {problems: problems.length, checks})
    : t("STG.SELFTEST.Passed", {checks});
  if ( problems.length ) ui.notifications.warn(summary, {permanent: true});
  else ui.notifications.info(summary);
  if ( report ) {
    let content = `<h3>${esc(t("STG.SELFTEST.Title"))}</h3><p>${esc(summary)}</p>`;
    if ( problems.length ) content += `<ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
    await ChatMessage.implementation.create({content, whisper: [game.user.id], speaker: {alias: game.modules.get(MODULE_ID).title}});
  }
  return {problems, checks};
}

/**
 * Tell the GM once when Foundry is newer than the version the module was verified against.
 */
export function noticeNewVersions() {
  if ( !game.user.isGM ) return;
  if ( !foundry.utils.isNewerVersion(game.version, TESTED_VERSIONS.core) ) return;
  const signature = `core ${game.version}`;
  if ( game.settings.get(MODULE_ID, "acknowledgedVersions") === signature ) return;
  game.settings.set(MODULE_ID, "acknowledgedVersions", signature);
  ui.notifications.info(t("STG.SELFTEST.NewVersions", {versions: signature}), {permanent: true});
}
