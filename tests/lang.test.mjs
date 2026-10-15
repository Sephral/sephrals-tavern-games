import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {GAMES, GUESTS} from "../scripts/games/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * All keys of a nested translation object, dotted.
 * @param {object} object
 * @param {string} [prefix]
 * @returns {string[]}
 */
function keysOf(object, prefix="") {
  return Object.entries(object).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return (value && (typeof value === "object")) ? keysOf(value, full) : [full];
  });
}

/**
 * All files of a folder, recursively.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function files(dir) {
  const list = await readdir(dir, {withFileTypes: true});
  return (await Promise.all(list.map(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])))).flat();
}

const en = JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8"));
const de = JSON.parse(await readFile(path.join(root, "lang/de.json"), "utf8"));
const enKeys = new Set(keysOf(en));

test("English and German have the same keys", () => {
  assert.deepEqual([...keysOf(de)].sort(), [...enKeys].sort());
});

test("no key is both a text and a group", () => {
  for ( const key of enKeys ) assert.ok(![...enKeys].some(other => other.startsWith(`${key}.`)), key);
});

test("placeholders match between English and German", () => {
  const get = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);
  const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for ( const key of enKeys ) assert.deepEqual(holes(get(de, key)), holes(get(en, key)), key);
});

test("every key used by scripts and templates exists", async () => {
  const sources = [...await files(path.join(root, "scripts")), ...await files(path.join(root, "templates"))];
  const used = new Set();
  for ( const file of sources ) {
    const text = await readFile(file, "utf8");
    for ( const match of text.matchAll(/["'`](STG\.[A-Za-z0-9_.]+)["'`]/g) ) used.add(match[1]);
  }
  for ( const key of Object.keys(en.STG.SETTINGS) ) {
    used.add(`STG.SETTINGS.${key}.name`);
    used.add(`STG.SETTINGS.${key}.hint`);
  }
  // Keys built from parts
  for ( const id of Object.keys(GAMES) ) {
    used.add(`STG.Game.${id}.name`);
    used.add(`STG.Game.${id}.guide`);
  }
  for ( const id of [...Object.keys(GUESTS), "dealer"] ) used.add(`STG.Guest.${id}.name`);
  for ( const g of Object.values(GUESTS) ) used.add(`STG.Level.${g.level}`);
  for ( const s of ["open", "playing", "done"] ) used.add(`STG.Status.${s}`);
  for ( const r of ["win", "lose", "push"] ) {
    used.add(`STG.Twentyone.${r}`);
    used.add(`STG.Result.twentyone.${r}`);
  }
  for ( const key of used ) if ( key.endsWith(".") ) used.delete(key);
  const missing = [...used].filter(key => !enKeys.has(key) && ![...enKeys].some(k => k.startsWith(`${key}.`)));
  assert.deepEqual(missing, []);
});


test("sentences about a seat have a variant for the user, with the same placeholders but the name", () => {
  const get = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);
  const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for ( const key of ["Pig.busted", "Pig.lastHold", "Pig.lastBust", "Ship.last", "Ship.lastEmpty"] ) {
    for ( const lang of [en, de] ) {
      const other = get(lang.STG, key);
      const own = get(lang.STG, `${key}You`);
      assert.ok(other?.includes("{name}"), key);
      assert.ok(own && !own.includes("{name}"), `${key}You`);
      assert.deepEqual(holes(own), holes(other).filter(h => h !== "name"), `${key}You`);
    }
  }
});

test("the reveal at liar's dice names the bid with its face inside the sentence", () => {
  for ( const lang of [en, de] ) {
    for ( const key of ["revealHolds", "revealLie"] ) assert.match(lang.STG.Liars[key], /\{count\} × \{face\}/, key);
  }
});

test("German calls Pig Schweinchen and Bertram has a name that fits into sentences", () => {
  const strings = keysOf(de).map(key => key.split(".").reduce((o, k) => o[k], de));
  assert.deepEqual(strings.filter(s => /\bPig\b/.test(s)), []);
  assert.equal(de.STG.Game.pig.name, "Schweinchen");
  assert.equal(de.STG.Guest.bertram.name, "Bertram Graubart");
  assert.equal(en.STG.Game.pig.name, "Pig");
  assert.equal(en.STG.Guest.bertram.name, "Old Bertram");
});
