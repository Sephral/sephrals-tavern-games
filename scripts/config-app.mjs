/**
 * The settings of the tavern in one window, opened with the gear in the tavern's title bar or from the module
 * settings. The GM chooses the games on offer, the chat messages and the goal in Pig; everyone picks the module
 * language for themselves.
 */

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

import {MODULE_ID, TEMPLATES, setting, t} from "./config.mjs";
import {GAMES, ICONS} from "./games/index.mjs";
import {FOLLOW_FOUNDRY} from "./language.mjs";

/**
 * The players a game takes, as a short text.
 * @param {{min: number, max: number}} seats
 * @returns {string}
 */
function seatsText({min, max}) {
  return min === max ? t("STG.Config.seatsFixed", {count: min}) : t("STG.Config.seatsRange", {min, max});
}

/**
 * The ids of the games switched off, from the submitted form.
 * @param {Record<string, boolean>} offered   Game id -> checked
 * @returns {string[]}
 */
export function disabledFromForm(offered) {
  return Object.keys(GAMES).filter(id => !offered?.[id]);
}

export class TavernSettings extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "stg-settings",
    tag: "form",
    classes: ["stg-settings"],
    window: {title: "STG.Config.title", icon: "fa-solid fa-gear", contentClasses: ["standard-form"]},
    position: {width: 480},
    form: {handler: TavernSettings.#onSubmit, closeOnSubmit: true}
  };

  /** @override */
  static PARTS = {
    form: {template: `${TEMPLATES}/settings.hbs`},
    footer: {template: "templates/generic/form-footer.hbs"}
  };

  /** @override */
  get title() {
    return t("STG.Config.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const disabled = setting("disabledGames") ?? [];
    const language = setting("uiLanguage");
    context.isGM = game.user.isGM;
    context.games = Object.values(GAMES).map(g => ({id: g.id, icon: ICONS[g.id], name: t(`STG.Game.${g.id}.name`),
      seats: seatsText(g.seats), checked: !disabled.includes(g.id)}));
    context.chatCards = ["all", "results", "off"].map(value => ({value, label: t(`STG.SETTINGS.chatCards.${value}`),
      selected: setting("chatCards") === value}));
    context.pigGoal = setting("pigGoal");
    context.languages = [FOLLOW_FOUNDRY, "de", "en"].map(value => ({value, selected: language === value,
      label: t(`STG.LANGUAGE.${value === FOLLOW_FOUNDRY ? "default" : value}`)}));
    context.buttons = [{type: "submit", icon: "fa-solid fa-floppy-disk", label: "STG.Config.save"}];
    return context;
  }

  /**
   * Save what changed.
   * @this {TavernSettings}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const changes = [];
    if ( game.user.isGM ) {
      const disabled = disabledFromForm(data.games);
      if ( JSON.stringify(disabled) !== JSON.stringify(setting("disabledGames") ?? []) ) changes.push(["disabledGames", disabled]);
      if ( data.chatCards && (data.chatCards !== setting("chatCards")) ) changes.push(["chatCards", data.chatCards]);
      const goal = Number(data.pigGoal);
      if ( Number.isFinite(goal) && (goal !== setting("pigGoal")) ) changes.push(["pigGoal", Math.clamp(goal, 20, 100)]);
    }
    if ( data.uiLanguage && (data.uiLanguage !== setting("uiLanguage")) ) changes.push(["uiLanguage", data.uiLanguage]);
    for ( const [key, value] of changes ) await game.settings.set(MODULE_ID, key, value);
  }
}

/**
 * Open the tavern settings.
 * @returns {Promise<TavernSettings>}
 */
export async function openSettings() {
  const app = foundry.applications.instances.get(TavernSettings.DEFAULT_OPTIONS.id) ?? new TavernSettings();
  await app.render({force: true});
  app.bringToFront?.();
  return app;
}
