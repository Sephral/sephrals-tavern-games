/**
 * Requests to the active GM over the module socket. The server names the sender of every socket message, so the GM
 * knows for sure who asked (also on Foundry 13), and a client only accepts answers from a GM.
 */

import {SOCKET} from "./config.mjs";

/** Requests waiting for an answer, by id. */
const waiting = new Map();

/** The GM's handler of requests. */
let handler = null;

/**
 * Install the socket listener. Call once in "ready".
 * @param {(action: string, payload: object, user: User) => Promise<object>} handle
 */
export function registerSocket(handle) {
  handler = handle;
  game.socket.on(SOCKET, (message, senderId) => onMessage(message ?? {}, game.users.get(senderId)));
}

/**
 * Handle a socket message.
 * @param {object} message
 * @param {User|undefined} sender
 */
async function onMessage(message, sender) {
  if ( !sender ) return;
  if ( message.type === "request" ) {
    if ( !game.user.isActiveGM ) return;
    const result = await handler(message.action, message.payload ?? {}, sender);
    game.socket.emit(SOCKET, {type: "reply", id: message.id, result}, {recipients: [sender.id]});
  }
  else if ( (message.type === "reply") && sender.isGM ) {
    const resolve = waiting.get(message.id);
    if ( !resolve ) return;
    waiting.delete(message.id);
    resolve(message.result);
  }
}

/**
 * Ask the active GM to do something.
 * @param {string} action
 * @param {object} [payload]
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export function request(action, payload={}) {
  if ( game.user.isActiveGM ) return handler(action, payload, game.user);
  const gm = game.users.activeGM;
  if ( !gm ) return Promise.resolve({ok: false, error: "STG.Error.noGM"});
  const id = foundry.utils.randomID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve({ok: false, error: "STG.Error.timeout"});
    }, 15000);
    waiting.set(id, result => {
      clearTimeout(timer);
      resolve(result);
    });
    game.socket.emit(SOCKET, {type: "request", id, action, payload}, {recipients: [gm.id]});
  });
}
