/**
 * The evening at the tavern as a picture for sharing: the tavern's name, the day, the players with their wins and
 * tavern titles and one short line per game played, drawn on a canvas by this file alone so the picture looks the same
 * on every screen and in every theme. Model and layout are pure (no Foundry); only the rendering needs a browser.
 */

import {MODULE_ID, t} from "./config.mjs";
import {gamesOf} from "./games/ranking.mjs";

export const IMAGE_WIDTH = 1080;
export const IMAGE_SCALE = 2;
const PAD = 56;
const GAP = 20;
/** The players drawn on the picture, the rest is counted in one line. */
export const MAX_ROWS = 8;
/** The game lines drawn on the picture. */
export const MAX_GAMES = 9;
const MAX_HEIGHT = 3600;

export const THEMES = Object.freeze({
  dark: {bg: "#1c1713", card: "#2a221b", text: "#f4ecdd", muted: "#b3a692", accent: "#e0a43a", line: "#3d3226", band: "#e0a43a",
    onBand: "#1c1713", gold: "#e0a43a", silver: "#b9bcc4", bronze: "#c27d4a", onMedal: "#1c1713"},
  light: {bg: "#f6efe0", card: "#ffffff", text: "#2a2018", muted: "#6f6354", accent: "#9a4a14", line: "#e0d3b8", band: "#9a4a14",
    onBand: "#ffffff", gold: "#c9922a", silver: "#9a9ea8", bronze: "#a8643a", onMedal: "#ffffff"}
});

/**
 * The words and numbers of the picture.
 * @param {object} data
 * @param {object[]} data.rows       The standings (eveningRows): pos, name, title, wins, games, money
 * @param {object|null} data.session The evening (for the games played)
 * @param {string} data.worldTitle   The tavern's name: the title of the world
 * @param {string} data.date         The day of the evening, already formatted
 * @param {boolean} data.credit      The footer line
 * @param {function(string, object=): string} data.loc   Localizes a key
 * @returns {{label: string, title: string, subtitle: string, tiles: {value: string, label: string}[],
 *   rows: object[], more: string, gamesTitle: string, games: string[], footer: string}}
 */
export function shareModel({rows = [], session = null, worldTitle = "", date = "", credit = true, loc = t} = {}) {
  const games = gamesOf(session);
  const played = games.reduce((sum, entry) => sum + entry.count, 0);
  const shown = games.slice(0, MAX_GAMES);
  const lines = shown.map(entry => {
    const name = loc(`STG.Game.${entry.id}.name`);
    return entry.leader
      ? loc("STG.Share.gameLineLeader", {game: name, count: entry.count, name: entry.leader.name, wins: entry.leader.wins})
      : loc("STG.Share.gameLine", {game: name, count: entry.count});
  });
  if ( games.length > shown.length ) lines.push(loc("STG.Share.moreGames", {count: games.length - shown.length}));
  const topWins = rows.reduce((sum, row) => sum + row.wins, 0);
  return {
    label: loc("STG.Share.label"),
    title: String(worldTitle || loc("STG.Title")),
    subtitle: date,
    tiles: [
      {value: String(rows.length), label: loc("STG.Share.players")},
      {value: String(played || Math.max(0, ...rows.map(row => row.games))), label: loc("STG.Share.games")},
      {value: String(topWins), label: loc("STG.Rank.wins")}
    ],
    rows: rows.slice(0, MAX_ROWS).map(row => ({pos: row.pos, name: String(row.name ?? ""), title: row.title,
      record: loc("STG.Share.record", {wins: row.wins, games: row.games}), money: row.money ?? ""})),
    more: rows.length > MAX_ROWS ? loc("STG.Share.morePlayers", {count: rows.length - MAX_ROWS}) : "",
    gamesTitle: loc("STG.Share.gamesTitle"),
    games: lines,
    footer: credit ? loc("STG.Share.credit") : ""
  };
}

/** Breaks a text into lines no wider than maxWidth. A word wider than a line is cut by characters. */
export function wrapText(measure, text, maxWidth) {
  const lines = [];
  let current = "";
  const push = () => {
    if ( current ) lines.push(current);
    current = "";
  };
  for ( const word of String(text ?? "").split(/\s+/).filter(Boolean) ) {
    const attempt = current ? `${current} ${word}` : word;
    if ( measure(attempt) <= maxWidth ) {
      current = attempt;
      continue;
    }
    push();
    if ( measure(word) <= maxWidth ) {
      current = word;
      continue;
    }
    for ( const char of Array.from(word) ) {
      if ( current && measure(current + char) > maxWidth ) push();
      current += char;
    }
  }
  push();
  return lines;
}

function ellipsize(measure, line, maxWidth) {
  let value = line;
  while ( value.length > 1 && measure(`${value}…`) > maxWidth ) value = value.slice(0, -1);
  return `${value}…`;
}

// The biggest font size from max down to min at which the text fits.
function fitFont(width, value, maxWidth, max, min, weight, family) {
  for ( let size = max; size > min; size -= 2 ) {
    const f = `${weight} ${size}px ${family}`;
    if ( width(value, f) <= maxWidth ) return f;
  }
  return `${weight} ${min}px ${family}`;
}

/**
 * Positions everything. Pure: the only outside help is measure(text, font) for the width of a text.
 * @returns {{width: number, height: number, theme: object, ops: object[]}} drawing operations in picture pixels
 */
export function layoutShareImage(model, {theme = "dark", measure, family = "sans-serif"} = {}) {
  const colors = THEMES[theme] ?? THEMES.dark;
  const font = (size, weight = 400) => `${weight} ${size}px ${family}`;
  const width = (text, f) => measure(text, f);
  const inner = IMAGE_WIDTH - 2 * PAD;
  const rects = [];
  const texts = [];
  let y = 0;

  const text = (value, x, baseline, f, color, align = "left") => texts.push({type: "text", text: value, x, y: baseline, font: f, color, align});
  const paragraph = (value, x, top, maxWidth, size, weight, color, {lineHeight = Math.round(size * 1.35), maxLines = 99} = {}) => {
    const f = font(size, weight);
    let lines = wrapText(s => width(s, f), value, maxWidth);
    if ( lines.length > maxLines ) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = ellipsize(s => width(s, f), lines[maxLines - 1], maxWidth);
    }
    lines.forEach((line, index) => text(line, x, top + Math.round(size * 1.05) + index * lineHeight, f, color));
    return lines.length * lineHeight;
  };
  const oneLine = (value, x, baseline, maxWidth, max, min, weight, color, align = "left") => {
    const f = fitFont(width, value, maxWidth, max, min, weight, family);
    const shown = width(value, f) > maxWidth ? ellipsize(s => width(s, f), value, maxWidth) : value;
    text(shown, x, baseline, f, color, align);
  };

  // Header band
  rects.push({type: "rect", x: 0, y: 0, w: IMAGE_WIDTH, h: 14, color: colors.band, radius: 0});
  y = 14 + 44;
  text(String(model.label ?? "").toUpperCase(), PAD, y + 16, font(22, 700), colors.accent);
  y += 36;
  y += paragraph(model.title, PAD, y, inner, 56, 700, colors.text, {lineHeight: 64, maxLines: 2});
  if ( model.subtitle ) {
    y += 6;
    y += paragraph(model.subtitle, PAD, y, inner, 24, 400, colors.muted, {maxLines: 1});
  }
  y += 34;

  // Number tiles
  if ( model.tiles?.length ) {
    const count = model.tiles.length;
    const tileW = Math.floor((inner - GAP * (count - 1)) / count);
    const tileH = 128;
    model.tiles.forEach((tile, index) => {
      const x = PAD + index * (tileW + GAP);
      rects.push({type: "rect", x, y, w: tileW, h: tileH, color: colors.card, radius: 18, stroke: colors.line});
      text(tile.value, x + tileW / 2, y + 66, fitFont(width, tile.value, tileW - 24, 56, 30, 700, family), colors.text, "center");
      const label = String(tile.label).toUpperCase();
      text(label, x + tileW / 2, y + 106, fitFont(width, label, tileW - 24, 19, 13, 600, family), colors.muted, "center");
    });
    y += tileH + 36;
  }

  // The players, one card each; the first three wear a medal
  const medals = [colors.gold, colors.silver, colors.bronze];
  const rowH = 92;
  for ( const row of model.rows ?? [] ) {
    rects.push({type: "rect", x: PAD, y, w: inner, h: rowH, color: colors.card, radius: 18, stroke: colors.line});
    const medal = medals[row.pos - 1];
    const cx = PAD + 14 + 30;
    if ( medal ) {
      rects.push({type: "circle", x: cx, y: y + rowH / 2, r: 28, color: medal});
      text(String(row.pos), cx, y + rowH / 2 + 11, font(32, 700), colors.onMedal, "center");
    } else text(String(row.pos), cx, y + rowH / 2 + 11, font(32, 600), colors.muted, "center");
    const left = PAD + 14 + 60 + 22;
    const right = PAD + inner - 24;
    const recordFont = font(32, 700);
    const recordW = Math.ceil(width(row.record, recordFont));
    const textW = right - left - recordW - 24;
    oneLine(row.name, left, y + 40, textW, 32, 22, 700, colors.text);
    oneLine(row.title, left, y + 72, textW, 22, 15, 400, colors.accent);
    text(row.record, right, y + (row.money ? 44 : 56), recordFont, colors.text, "right");
    if ( row.money ) oneLine(row.money, right, y + 74, Math.min(textW + recordW, 420), 21, 14, 400, colors.muted, "right");
    y += rowH + 14;
  }
  if ( model.more ) {
    y += 2;
    y += paragraph(model.more, PAD, y, inner, 22, 400, colors.muted, {maxLines: 1});
  }
  if ( model.rows?.length ) y += 20;

  // A line per game played
  if ( model.games?.length ) {
    text(String(model.gamesTitle).toUpperCase(), PAD, y + 16, font(22, 700), colors.accent);
    y += 40;
    for ( const line of model.games ) {
      const f = font(26, 400);
      const lines = wrapText(s => width(s, f), line, inner - 28);
      text("•", PAD + 4, y + 28, font(26, 700), colors.accent);
      paragraph(line, PAD + 28, y, inner - 28, 26, 400, colors.text, {lineHeight: 36});
      y += lines.length * 36 + 10;
    }
    y += 18;
  }

  // Footer
  if ( model.footer ) {
    rects.push({type: "rect", x: PAD, y: y + 6, w: inner, h: 2, color: colors.line, radius: 1});
    y += 36;
    text(model.footer, IMAGE_WIDTH - PAD, y + 12, font(21, 600), colors.muted, "right");
    y += 40;
  } else {
    y += 20;
  }
  y += 24;

  const height = Math.min(MAX_HEIGHT, Math.max(320, Math.ceil(y)));
  return {
    width: IMAGE_WIDTH,
    height,
    theme: colors,
    ops: [{type: "rect", x: 0, y: 0, w: IMAGE_WIDTH, h: height, color: colors.bg, radius: 0}, ...rects, ...texts]
  };
}

/** Draws a layout on a 2d context (any canvas): scale the context first. */
export function paintShareImage(context, layout) {
  for ( const op of layout.ops ) {
    if ( op.type === "rect" ) {
      context.fillStyle = op.color;
      if ( op.radius ) {
        roundRect(context, op.x, op.y, op.w, op.h, op.radius);
        context.fill();
        if ( op.stroke ) {
          context.strokeStyle = op.stroke;
          context.lineWidth = 2;
          roundRect(context, op.x + 1, op.y + 1, op.w - 2, op.h - 2, op.radius);
          context.stroke();
        }
      } else context.fillRect(op.x, op.y, op.w, op.h);
    } else if ( op.type === "circle" ) {
      context.fillStyle = op.color;
      context.beginPath();
      context.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      context.fill();
    } else if ( op.type === "text" ) {
      context.font = op.font;
      context.fillStyle = op.color;
      context.textAlign = op.align;
      context.textBaseline = "alphabetic";
      context.fillText(op.text, op.x, op.y);
    }
  }
}

function roundRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

/** "light" or "dark", as Foundry shows its interface (the body class, then the user's setting, then the browser). */
export function foundryColorScheme() {
  try {
    const classes = globalThis.document?.body?.classList;
    if ( classes?.contains("theme-light") ) return "light";
    if ( classes?.contains("theme-dark") ) return "dark";
    const configured = globalThis.game?.settings?.get?.("core", "uiConfig")?.colorScheme?.interface;
    if ( configured === "light" || configured === "dark" ) return configured;
    if ( globalThis.matchMedia?.("(prefers-color-scheme: light)")?.matches ) return "light";
  } catch {
    // The default below.
  }
  return "dark";
}

function fontFamily() {
  const computed = globalThis.document?.body ? globalThis.getComputedStyle?.(globalThis.document.body)?.fontFamily : "";
  return `${computed ? `${computed}, ` : ""}Signika, "Segoe UI", sans-serif`;
}

/**
 * The picture as a PNG blob. Needs a browser (canvas); the layout itself is tested apart.
 * @param {object} model   from shareModel
 * @param {object} [options]
 * @param {string} [options.theme]
 * @returns {Promise<Blob>}
 */
export async function renderShareImage(model, {theme = foundryColorScheme()} = {}) {
  const family = fontFamily();
  try {
    await Promise.all(["400", "600", "700"].map(weight => globalThis.document.fonts.load(`${weight} 24px ${family}`)));
  } catch {
    // A missing font only changes the look.
  }
  const canvas = globalThis.document.createElement("canvas");
  const probe = canvas.getContext("2d");
  const layout = layoutShareImage(model, {theme, family, measure: (value, f) => {
    probe.font = f;
    return probe.measureText(value).width;
  }});
  canvas.width = layout.width * IMAGE_SCALE;
  canvas.height = layout.height * IMAGE_SCALE;
  const context = canvas.getContext("2d");
  context.scale(IMAGE_SCALE, IMAGE_SCALE);
  paintShareImage(context, layout);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if ( !blob ) throw new Error(`${MODULE_ID} | The canvas gave no picture`);
  return blob;
}

/** A file name for the picture: the tavern's name and the day, letters and digits only. */
export function shareImageFileName(title, now = new Date()) {
  const slug = String(title ?? "tavern").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "tavern";
  return `${slug}-evening-${now.toISOString().slice(0, 10)}.png`;
}
