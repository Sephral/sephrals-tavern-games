import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));
const en = await read("lang/en.json");
const ru = await read("lang/ru.json");
const manifest = await read("module.json");

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

const get = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);
const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test("the manifest lists the Russian language file", () => {
  assert.ok(manifest.languages.some(l => l.lang === "ru" && l.path === "lang/ru.json"));
});

test("English and Russian have the same keys", () => {
  assert.deepEqual(keysOf(ru).sort(), keysOf(en).sort());
});

test("placeholders match between English and Russian", () => {
  for ( const key of keysOf(en) ) assert.deepEqual(holes(get(ru, key)), holes(get(en, key)), key);
});

test("no Russian text is empty", () => {
  for ( const key of keysOf(ru) ) assert.ok(String(get(ru, key)).trim().length, key);
});

test("sentences about a seat have a variant for the user in Russian too", () => {
  for ( const key of ["Pig.busted", "Pig.lastHold", "Pig.lastBust", "Ship.last", "Ship.lastEmpty"] ) {
    const other = get(ru.STG, key);
    const own = get(ru.STG, `${key}You`);
    assert.ok(other?.includes("{name}"), key);
    assert.ok(own && !own.includes("{name}"), `${key}You`);
    assert.deepEqual(holes(own), holes(other).filter(h => h !== "name"), `${key}You`);
  }
});

test("the reveal at liar's dice names the bid with its face inside the sentence in Russian", () => {
  for ( const key of ["revealHolds", "revealLie"] ) assert.match(ru.STG.Liars[key], /\{count\} × \{face\}/, key);
});

test("Russian names the games and the call as agreed", () => {
  assert.equal(ru.STG.Game.liars.name, "Кости лжеца");
  assert.equal(ru.STG.Liars.call, "Не верю!");
});
