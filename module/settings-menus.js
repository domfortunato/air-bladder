/**
 * The Configure Settings SUBMENUS — one small ApplicationV2 per SETTING_GROUPS
 * group (2026-08-22, user ruling: "one submenu per group").
 *
 * Until this, the system's settings rendered as one flat run in the main
 * settings window, and the only way to group them was a render hook that
 * inserted positional `<h3>` headers — which made registration ORDER
 * load-bearing, hid every hint behind a compact-row rule for a year, and
 * needed a MutationObserver just to follow core's search filter. Foundry's
 * first-class answer is `game.settings.registerMenu`: a button in the settings
 * list that opens an application whose layout is the system's own. Core uses
 * it for Dice Configuration, Default Sheets and Prototype Token Overrides,
 * and `applications/settings/menus/dice-config.mjs` is the skeleton copied
 * here. Native in-list grouping does not exist (core issue #8602, open, no
 * milestone), so this is the sanctioned shape, not a workaround.
 *
 * Every grouped setting is registered `config: false` — off the flat list —
 * and stays an ordinary world setting otherwise: scope, default, `onChange`
 * and `requiresReload` all behave as before, because they ride
 * `game.settings.set`, which knows nothing about the `config` flag.
 *
 * Rows and saving deliberately reuse core's machinery rather than re-invent
 * it: `_prepareContext` builds a DataField per setting exactly as
 * `SettingsConfig._prepareCategoryData` does (config.mjs:72-131) and the
 * template renders each with the `formGroup` helper, so a row here is
 * pixel-for-pixel a row there — label, control, hint beneath (the hint
 * finally rendering is the whole point). Submission mirrors
 * `SettingsConfig.#onSubmit` (config.mjs:243-263) and ends in the public
 * `SettingsConfig.reloadConfirm`, so flipping a `requiresReload` setting
 * still prompts the reload it always did.
 *
 * `registerMenu` takes a CLASS, not an instance (client-settings.mjs:185-194),
 * so `makeSettingsGroupMenu` stamps one tiny subclass per group — the same way
 * core ships three menu classes — and the group rides the subclass as a
 * static. The group declaration itself stays in settings.js, beside the
 * registrations it lists; nothing here names a key.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @typedef {object} SettingGroup
 * @property {string} id            Menu key, `<namespace>.<id>`; also the app id suffix.
 * @property {string} title         i18n key — the button's row label AND the window title.
 * @property {string} button        i18n key — the text ON the button, naming what it opens.
 * @property {string} hint          i18n key — the one-line description under the button.
 * @property {string} icon          Font Awesome classes for the button and the window.
 * @property {string[]} keys        Setting keys, in the order the rows render.
 * @property {{master: string, keys: string[]}} [subOptions]
 *   Rows that only mean something while a master checkbox is on: they are
 *   disabled (and greyed) while it is off — live if the master is in this
 *   app, from the stored value at render if it lives in another submenu.
 * @property {Record<string, string>} [boldPhrases]
 *   key → i18n key of a phrase to wrap in <strong> inside that row's label.
 */

export class SettingsGroupMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {SettingGroup} set by the subclass factory */
  static GROUP = null;
  /** @type {string} the settings namespace the group's keys live under */
  static NAMESPACE = null;

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["ab-settings-menu"],
    window: { contentClasses: ["standard-form"], title: "", icon: "fa-solid fa-gears" },
    position: { width: 600, height: "auto" },
    form: { closeOnSubmit: true, handler: SettingsGroupMenu.#onSubmit },
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/air-bladder/templates/settings/group-menu.html" },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options) {
    const ns = this.constructor.NAMESPACE;
    const fields = foundry.data.fields;
    const entries = [];
    for (const key of this.constructor.GROUP.keys) {
      const id = `${ns}.${key}`;
      const setting = game.settings.settings.get(id);
      if (!setting) continue; // a group naming an unregistered key: dev:settings reds on it
      // The same field-per-setting build as SettingsConfig (config.mjs:72-131),
      // trimmed to the shapes this system registers — Boolean, Number, String.
      // A setting registered WITH a DataField is used as-is, like core does.
      let field;
      if (setting.type instanceof fields.DataField) field = setting.type;
      else if (setting.type === Boolean) field = new fields.BooleanField({ initial: setting.default ?? false });
      else if (setting.type === Number) {
        const { min, max, step } = setting.range ?? {};
        field = new fields.NumberField({ required: true, choices: setting.choices, initial: setting.default, min, max, step });
      } else field = new fields.StringField({ required: true, choices: setting.choices });
      field.name = id;
      field.label ||= game.i18n.localize(setting.name ?? "");
      field.hint ||= game.i18n.localize(setting.hint ?? "");
      entries.push({ key, field, input: setting.input, value: game.settings.get(ns, key) });
    }
    return {
      entries,
      rootId: this.id,
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }],
    };
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    const ns = this.constructor.NAMESPACE;
    const { subOptions, boldPhrases } = this.constructor.GROUP;
    const root = this.element;
    const rowOf = (key) => root.querySelector(`[name="${ns}.${key}"]`)?.closest(".form-group");

    // Sub-options are meaningless unless their master is on, so grey them out
    // (and disable them) while it is off. When the master checkbox is in THIS
    // app it is followed live, as it is toggled, before anything is saved;
    // when it lives in another submenu (the Barebones failed career sits under
    // Hacks while "Offer Barebones sheets" is Character Generation's) the
    // STORED value decides, read at render. (Was the Barebones sub-option
    // rule in the old renderSettingsConfig hook; same behaviour, declared on
    // the group.)
    if (subOptions) {
      const master = root.querySelector(`[name="${ns}.${subOptions.master}"]`);
      const masterOn = () => (master ? !!master.checked : !!game.settings.get(ns, subOptions.master));
      const sync = () => {
        const on = masterOn();
        for (const key of subOptions.keys) {
          const input = root.querySelector(`[name="${ns}.${key}"]`);
          if (!input) continue;
          input.disabled = !on;
          rowOf(key)?.classList.toggle("cairn-setting-disabled", !on);
        }
      };
      if (master) master.addEventListener("change", sync);
      sync();
    }

    // Bold a phrase within a label (the three content-source rows name their
    // product). The phrase is LOCALIZED, not an English literal (review #6):
    // the label searched is the translated setting name, so an English phrase
    // only ever matched where a translator kept the product name verbatim. A
    // language whose label drops the phrase degrades to no bold — the i < 0
    // exit — never to a wrong one. Text nodes, because the label is plain text.
    for (const [key, phraseKey] of Object.entries(boldPhrases ?? {})) {
      const label = rowOf(key)?.querySelector("label");
      if (!label) continue;
      const phrase = game.i18n.localize(phraseKey);
      const text = label.textContent;
      const i = text.indexOf(phrase);
      if (i < 0) continue;
      const strong = document.createElement("strong");
      strong.textContent = phrase;
      label.replaceChildren(
        document.createTextNode(text.slice(0, i)),
        strong,
        document.createTextNode(text.slice(i + phrase.length)),
      );
    }
  }

  /* -------------------------------------------- */

  /**
   * Save every changed row, then prompt for the reload any of them requires.
   * Mirrors SettingsConfig.#onSubmit (config.mjs:243-263): `set` per key with
   * its error surfaced, changed-detection against the PRIOR stored value,
   * reload need accumulated by scope, one reloadConfirm at the end.
   * @this {SettingsGroupMenu}
   * @param {SubmitEvent} _event
   * @param {HTMLFormElement} _form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(_event, _form, formData) {
    let requiresClientReload = false;
    let requiresWorldReload = false;
    for (const [id, value] of Object.entries(formData.object)) {
      const setting = game.settings.settings.get(id);
      if (!setting) continue;
      const priorValue = game.settings.get(setting.namespace, setting.key, { document: true })?._source.value;
      let newSetting;
      try {
        newSetting = await game.settings.set(setting.namespace, setting.key, value, { document: true });
      } catch (error) {
        ui.notifications.error(error);
      }
      if (priorValue === newSetting?._source.value) continue;
      requiresClientReload ||= (setting.scope !== CONST.SETTING_SCOPES.WORLD) && setting.requiresReload;
      requiresWorldReload ||= (setting.scope === CONST.SETTING_SCOPES.WORLD) && setting.requiresReload;
    }
    if (requiresClientReload || requiresWorldReload) {
      await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: requiresWorldReload });
    }
  }
}

/* -------------------------------------------- */

/**
 * One subclass per group, because `registerMenu` wants a class. The subclass
 * carries nothing but its group, its namespace and the window chrome that
 * differs per group; everything else is inherited.
 * @param {string} namespace
 * @param {SettingGroup} group
 * @returns {typeof SettingsGroupMenu}
 */
export const makeSettingsGroupMenu = (namespace, group) => class extends SettingsGroupMenu {
  static GROUP = group;
  static NAMESPACE = namespace;
  static DEFAULT_OPTIONS = {
    id: `ab-settings-${group.id}`,
    window: { title: group.title, icon: group.icon },
  };
};

/**
 * Register one submenu per group, in group order — which is the order the
 * buttons appear in the settings window (menus render in registration order,
 * config.mjs:55-66). `restricted: true` because every grouped setting is
 * world-scoped: the flat list never showed them to a player either.
 * @param {string} namespace
 * @param {SettingGroup[]} groups
 */
export const registerSettingMenus = (namespace, groups) => {
  for (const group of groups) {
    game.settings.registerMenu(namespace, group.id, {
      name: group.title,
      // The button names what it opens, per group — "Configure Inventory", not
      // a shared "Configure" (user ruling 2026-08-22, after Dice So Nice's
      // per-menu buttons). `dev:settings` asserts each button's text.
      label: group.button,
      hint: group.hint,
      icon: group.icon,
      type: makeSettingsGroupMenu(namespace, group),
      restricted: true,
    });
  }
};
