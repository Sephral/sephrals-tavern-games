/**
 * What the share window of the evening does with the picture of share-image.mjs: copy it to the clipboard, save it as
 * a file or post it in the chat. Everyone who sees the ranking may copy and save; posting needs the permission to
 * upload files (the GM always has it).
 */

import {MODULE_ID, esc, setting, t} from "./config.mjs";
import {cleanRanking, liveSession} from "./games/ranking.mjs";
import {renderShareImage, shareImageFileName, shareModel} from "./share-image.mjs";
import {eveningRows} from "./tables.mjs";
import {countFeature} from "./usage.mjs";

/** Usage counters of the picture of the evening. */
export const SHARE_FEATURES = {copied: "shareImageCopied", saved: "shareImageSaved", posted: "shareImagePosted"};

const UPLOAD_TIMEOUT_MS = 20000;
const notify = (type, key) => globalThis.ui?.notifications?.[type]?.(t(key));

/**
 * The model of the evening running now, or null when no game has finished tonight.
 * @param {number} [now]
 * @param {object} [stored]   A ranking to read instead of the world's (sample windows)
 * @returns {object|null}
 */
export function currentShareModel(now = Date.now(), stored = undefined) {
  const rows = eveningRows(now, stored);
  if ( !rows.length ) return null;
  const session = liveSession(cleanRanking(stored ?? setting("ranking")), now);
  const date = new Date(session?.start ?? now).toLocaleDateString(game.i18n.lang || undefined,
    {weekday: "long", day: "numeric", month: "long", year: "numeric"});
  return shareModel({rows, session, worldTitle: game.world?.title ?? "", date, credit: setting("shareImageCredit") !== false});
}

/** The clipboard takes pictures on secure pages only (https or localhost), and only in browsers with ClipboardItem. */
export function canCopyImage() {
  return Boolean(globalThis.isSecureContext && globalThis.navigator?.clipboard?.write && (typeof globalThis.ClipboardItem !== "undefined"));
}

function filePicker() {
  return globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

/** Uploading needs the permission to upload files and a file picker. Players usually have neither. */
export function canPostImage() {
  const user = globalThis.game?.user;
  if ( !user ) return false;
  if ( !(user.isGM || user.can?.("FILES_UPLOAD")) ) return false;
  return Boolean(filePicker()?.upload);
}

// Like Foundry's own saveDataToFile: a detached link that gets a click event, which other click handlers cannot take over.
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Saves the picture as a file in the browser's downloads. */
export async function saveEveningImage(model) {
  try {
    download(await renderShareImage(model), shareImageFileName(model.title));
    countFeature(MODULE_ID, SHARE_FEATURES.saved);
    notify("info", "STG.Share.saved");
    return "saved";
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not draw the picture of the evening`, error);
    notify("warn", "STG.Share.failed");
    return null;
  }
}

/**
 * Puts the picture on the clipboard. Where the browser refuses (plain http, no ClipboardItem, no permission) the
 * picture is saved as a file instead and the message says why.
 * @returns {Promise<"copied"|"saved"|null>}
 */
export async function copyEveningImage(model) {
  // The picture is drawn while the clipboard waits for it, so the click still counts as the user's action.
  const drawing = renderShareImage(model);
  drawing.catch(() => {});
  if ( canCopyImage() ) {
    try {
      await navigator.clipboard.write([new ClipboardItem({"image/png": drawing})]);
      countFeature(MODULE_ID, SHARE_FEATURES.copied);
      notify("info", "STG.Share.copied");
      return "copied";
    } catch (error) {
      console.debug(`${MODULE_ID} | The clipboard refused the picture`, error);
    }
  }
  try {
    download(await drawing, shareImageFileName(model.title));
    countFeature(MODULE_ID, SHARE_FEATURES.saved);
    notify("warn", "STG.Share.copyFallback");
    return "saved";
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not draw the picture of the evening`, error);
    notify("warn", "STG.Share.failed");
    return null;
  }
}

function isForge() {
  return typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge === true;
}

/** Where the pictures go: the world's data folder, on The Forge the Assets Library. */
export function imageFolder() {
  const world = game.world?.id ?? "world";
  return isForge() ? `${MODULE_ID}/${world}/images` : `worlds/${world}/${MODULE_ID}/images`;
}

// Creates the folders one level at a time: Foundry only creates the last one.
async function ensureFolder(folder) {
  const FilePicker = filePicker();
  const source = isForge() ? "forgevtt" : "data";
  if ( isForge() ) {
    try {
      await FilePicker.createDirectory(source, folder, {notify: false});
    } catch {
      // The Forge creates a missing folder on upload too.
    }
    return source;
  }
  let current = "";
  for ( const part of folder.split("/") ) {
    current = current ? `${current}/${part}` : part;
    try {
      await FilePicker.browse(source, current, {notify: false});
    } catch {
      try {
        await FilePicker.createDirectory(source, current, {notify: false});
      } catch {
        // An existing folder or a refusal: the upload decides.
      }
    }
  }
  return source;
}

function timeout(promise, ms, message) {
  let id;
  const limit = new Promise((_, reject) => { id = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(id));
}

/** The chat message for an uploaded picture. */
export function shareMessageHtml(url, title) {
  const src = esc(url);
  return `<div class="stg-shareimage"><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(title)}"></a></div>`;
}

/**
 * Uploads the picture to the world's data folder and posts it in the chat for everyone.
 * @returns {Promise<object|null>} the chat message, null when nothing was posted
 */
export async function postEveningImage(model) {
  if ( !canPostImage() ) {
    notify("warn", "STG.Share.postNoUpload");
    return null;
  }
  try {
    const blob = await renderShareImage(model);
    const folder = imageFolder();
    const source = await ensureFolder(folder);
    const name = `evening-${Date.now().toString(36)}.png`;
    const file = new File([blob], name, {type: "image/png"});
    const response = await timeout(filePicker().upload(source, folder, file, {}, {notify: false}), UPLOAD_TIMEOUT_MS,
      "Timed out while uploading the picture of the evening");
    if ( !response?.path ) throw new Error("The upload returned no file path");
    const url = (/^https?:\/\//.test(response.path) || response.path.startsWith("/")) ? response.path
      : (globalThis.foundry?.utils?.getRoute?.(response.path) ?? `/${response.path}`);
    const message = await ChatMessage.implementation.create({
      content: shareMessageHtml(url, model.title),
      speaker: {alias: t("STG.Card.speaker")},
      flags: {[MODULE_ID]: {card: "shareImage"}}
    });
    countFeature(MODULE_ID, SHARE_FEATURES.posted);
    notify("info", "STG.Share.posted");
    return message;
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not post the picture of the evening`, error);
    notify("warn", "STG.Share.postFailed");
    return null;
  }
}

/**
 * The options of the share window: the preview of the picture and the buttons to copy, save and post it.
 * @param {object} model
 * @param {string} previewUrl   Address of the picture
 * @param {string} [ratio]      The style attribute that fixes the height of the preview
 * @returns {object}
 */
export function shareDialogOptions(model, previewUrl, ratio = "") {
  const buttons = [
    {action: "copy", label: t("STG.Share.copy"), icon: "fa-solid fa-copy", default: true, callback: () => copyEveningImage(model)},
    {action: "save", label: t("STG.Share.save"), icon: "fa-solid fa-download", callback: () => saveEveningImage(model)}
  ];
  if ( canPostImage() ) buttons.push({action: "post", label: t("STG.Share.post"), icon: "fa-solid fa-comment", callback: () => postEveningImage(model)});
  buttons.push({action: "done", label: t("STG.Share.close"), icon: "fa-solid fa-xmark"});
  return {
    id: "stg-share",
    classes: ["stg-share-dialog"],
    window: {title: t("STG.Share.title"), icon: "fa-solid fa-share-nodes"},
    position: {width: 520},
    content: `<div class="stg-share"><img alt="${esc(t("STG.Share.preview"))}"${ratio}>`
      + `${canCopyImage() ? "" : `<p class="stg-note">${esc(t("STG.Share.plainHttp"))}</p>`}</div>`,
    buttons,
    // The picture is set here, a blob address inside the content string would not survive the sanitizing
    render: (event, dialog) => {
      const img = dialog.element.querySelector(".stg-share img");
      if ( img ) img.src = previewUrl;
    }
  };
}

/**
 * Opens the share window of the evening: a preview of the picture and the buttons to copy, save and post it.
 * @returns {Promise<void>}
 */
export async function openShareWindow() {
  const model = currentShareModel();
  if ( !model ) {
    ui.notifications.warn(t("STG.Share.none"));
    return;
  }
  let previewUrl = "";
  let ratio = "";
  try {
    const blob = await renderShareImage(model);
    previewUrl = URL.createObjectURL(blob);
    // The window gets its final height at once, so it opens centered and the buttons stay on the screen
    const bitmap = await createImageBitmap(blob);
    ratio = ` style="aspect-ratio: ${bitmap.width} / ${bitmap.height}; --stg-ratio: ${bitmap.width / bitmap.height}"`;
    bitmap.close?.();
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not draw the picture of the evening`, error);
    notify("warn", "STG.Share.failed");
    return;
  }
  try {
    await foundry.applications.api.DialogV2.wait({...shareDialogOptions(model, previewUrl, ratio), rejectClose: false});
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}
