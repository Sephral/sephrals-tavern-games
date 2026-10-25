import assert from "node:assert/strict";
import test from "node:test";

/** Just enough of the DOM for the chat controls: classes, children, closest and querySelector by class. */
class FakeElement {
  constructor(tag = "div", className = "") {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.listeners = [];
  }

  get classes() {
    return this.className.split(/\s+/).filter(Boolean);
  }

  matches(selector) {
    return selector.split(",").some(part => {
      const [base, not] = part.trim().split(":not(");
      const wanted = (base.match(/\.[\w-]+/g) ?? []).map(c => c.slice(1));
      const id = base.match(/#([\w-]+)/)?.[1];
      if ( id && (this.attributes.id !== id) ) return false;
      if ( !wanted.every(c => this.classes.includes(c)) ) return false;
      const excluded = not?.match(/\.[\w-]+/g)?.map(c => c.slice(1)) ?? [];
      return !excluded.some(c => this.classes.includes(c));
    });
  }

  querySelector(selector) {
    for ( const child of this.children ) {
      if ( child.matches(selector) ) return child;
      const found = child.querySelector(selector);
      if ( found ) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }

  closest(selector) {
    for ( let node = this; node; node = node.parent ) if ( node.matches(selector) ) return node;
    return null;
  }

  append(...nodes) {
    for ( const node of nodes ) {
      node.parent = this;
      this.children.push(node);
    }
  }

  prepend(node) {
    node.parent = this;
    this.children.unshift(node);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, listener) {
    this.listeners.push({type, listener});
  }

  click() {
    for ( const {type, listener} of this.listeners ) if ( type === "click" ) listener({preventDefault() {}});
  }
}

globalThis.HTMLElement = FakeElement;
globalThis.document = {createElement: tag => new FakeElement(tag), getElementById: () => null};
globalThis.Hooks = {once() {}, on() {}};
globalThis.foundry = {
  utils: {debounce: fn => fn, deepClone: value => structuredClone(value)},
  applications: {
    api: {ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {}, DialogV2: class {}},
    instances: new Map()
  }
};
globalThis.game = {user: {isGM: true}, i18n: {localize: key => ({"STG.Title": "Tavern"})[key] ?? key, format: key => key}};

const {addChatButton} = await import("../scripts/stg.mjs");

/** #chat-controls as Foundry renders it, with Export and Clear for gamemasters. */
function controls({gm}) {
  const root = new FakeElement("div");
  root.setAttribute("id", "chat-controls");
  root.append(new FakeElement("div", "split-button"));
  if ( gm ) root.append(new FakeElement("div", "control-buttons"));
  return root;
}

test("gamemasters get the mug next to Export and Clear, once", () => {
  game.user.isGM = true;
  const root = controls({gm: true});
  addChatButton(root);
  addChatButton(root);
  const buttons = root.querySelectorAll(".stg-chat-button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].parent, root.querySelector(".control-buttons"));
  assert.equal(root.querySelector(".control-buttons").children[0], buttons[0]);
  assert.equal(buttons[0].getAttribute("aria-label"), "Tavern");
  assert.match(buttons[0].className, /fa-beer-mug-empty/);
});

test("players get a group of their own, hidden while the chat floats over the canvas", () => {
  game.user.isGM = false;
  const root = controls({gm: false});
  addChatButton(root);
  const group = root.querySelector(".stg-chat-controls");
  assert.ok(group);
  assert.equal(group.classes.includes("control-buttons"), true);
  assert.equal(group.hidden, false);

  const notifications = new FakeElement("div");
  notifications.setAttribute("id", "chat-notifications");
  notifications.append(root);
  addChatButton(root);
  assert.equal(group.hidden, true);
  assert.equal(root.querySelectorAll(".stg-chat-button").length, 1);
});

test("a gamemaster without Foundry's group gets the module's own, and no element means no button", () => {
  game.user.isGM = true;
  const root = controls({gm: false});
  addChatButton(root);
  const group = root.querySelector(".stg-chat-controls");
  assert.ok(group);
  assert.equal(group.children[0].classes.includes("stg-chat-button"), true);
  assert.doesNotThrow(() => addChatButton(null));
  assert.doesNotThrow(() => addChatButton({}));
});
