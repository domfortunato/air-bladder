import { resolveGearItem } from "../gear.js";
import { previewBackground, duplicateBackgroundToWorld } from "../character-generator.js";
import { t } from "../i18n-content.js";
import { TRANSPORT_KINDS } from "../icons.js";
import { bindEditorClickAwaySave, sourceLabel } from "../utils.js";
import { pickArt } from "../art-picker.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** HTML-escape for report text built by hand (not through Handlebars). */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Badge markup for a resolved/unresolved gear reference kind. */
const kindBadge = (kind) => {
  const map = {
    snapshot: ["fa-camera", "ok", "CAIRN.BgAuthor.KindSnapshot"],
    name: ["fa-check", "ok", "CAIRN.BgAuthor.KindName"],
    rolled: ["fa-dice", "ok", "CAIRN.BgAuthor.KindRolled"],
    missing: ["fa-triangle-exclamation", "bad", "CAIRN.BgAuthor.KindMissing"],
    empty: ["fa-minus", "warn", "CAIRN.BgAuthor.KindEmpty"],
  };
  const [icon, cls, label] = map[kind] ?? map.empty;
  return `<span class="bg-kind ${cls}" title="${esc(game.i18n.localize(label))}"><i class="fas ${icon}"></i></span>`;
};

/**
 * Render a previewBackground() report to HTML for the Test-×10 dialog: a problems
 * banner (errors then warnings, or a green all-clear), the starting gear with
 * resolution badges, and each table's options with how often each fired across the
 * sample plus the choice-gold spread.
 */
const renderPreviewReport = (r) => {
  const parts = [];
  if (!r.problems.length) {
    parts.push(`<p class="bg-preview-ok"><i class="fas fa-check-circle"></i> ${esc(game.i18n.localize("CAIRN.BgAuthor.LintClean"))}</p>`);
  } else {
    const row = (p) => `<li class="bg-preview-${p.level}"><i class="fas ${p.level === "error" ? "fa-circle-xmark" : "fa-circle-exclamation"}"></i> ${esc(p.msg)}</li>`;
    const errs = r.problems.filter((p) => p.level === "error");
    const warns = r.problems.filter((p) => p.level === "warn");
    parts.push(`<ul class="bg-preview-problems">${errs.map(row).join("")}${warns.map(row).join("")}</ul>`);
  }

  if (r.gear.length) {
    parts.push(`<h4>${esc(game.i18n.localize("CAIRN.BackgroundStartingGear"))}</h4>`);
    parts.push(`<ul class="bg-preview-gear">${r.gear.map((g) => `<li>${kindBadge(g.kind)} ${esc(g.name) || `<em>${esc(game.i18n.localize("CAIRN.BgAuthor.Unnamed"))}</em>`}</li>`).join("")}</ul>`);
  }

  r.tables.forEach((t) => {
    parts.push(`<h4>${esc(t.question) || `<em>${esc(game.i18n.localize("CAIRN.BgAuthor.Unnamed"))}</em>`}</h4>`);
    const rows = t.options.map((o, i) => {
      const items = o.items.map((it) => `${kindBadge(it.kind)} ${esc(it.name)}`).join(", ");
      const gold = o.bonusGold ? ` <span class="bg-preview-gold">+${o.bonusGold}g</span>` : "";
      const fired = `<span class="bg-preview-fired">${t.fired[i]}/${r.sampling.n}</span>`;
      const desc = esc(o.description) || `<em class="bg-preview-blank">${esc(game.i18n.localize("CAIRN.BgAuthor.EmptyOption"))}</em>`;
      return `<li>${fired} ${desc}${gold}${items ? `<div class="bg-preview-items">${items}</div>` : ""}</li>`;
    });
    parts.push(`<ol class="bg-preview-options">${rows.join("")}</ol>`);
  });

  parts.push(`<p class="bg-preview-sample">${esc(game.i18n.format("CAIRN.BgAuthor.GoldSpread", { avg: r.sampling.goldAvg, min: r.sampling.goldMin, max: r.sampling.goldMax }))}</p>`);
  return `<div class="bg-preview">${parts.join("")}</div>`;
};

/** A custom 2e background always has exactly two d6 question tables, six options
 *  each — a fixed form, not an open-ended builder (see docs/custom-backgrounds-plan.md
 *  §6 Fork B). The generator's `applyChoiceTables` rolls `1d<options.length>`, so
 *  six options == a d6. */
const TABLE_COUNT = 2;
const OPTIONS_PER_TABLE = 6;

/** The extra tab each item type carries beyond Description, if any. */
const EXTRA_TABS = {
  item: { id: "crit-dmg", label: "CAIRN.CriticalDamage" },
  weapon: { id: "crit-dmg", label: "CAIRN.CriticalDamage" },
  background: { id: "details", label: "CAIRN.BackgroundDetails" },
};

/**
 * Recharge, for relics. Keyed on the DOCUMENT rather than the type — which is the
 * whole point of `relic` being a flag: a relic is equally an item, a weapon, an
 * armor or an object, so no entry in EXTRA_TABS above could express it.
 */
const RELIC_TAB = { id: "recharge", label: "CAIRN.Recharge" };

/**
 * Derive the display tags (Armor / Damage / bulky / petty / uses) for a gear row
 * from an item's system data. Works for both a resolved pack document and a
 * snapshot's frozen system copy, so an authored one-off reads the same way a
 * shipped item does.
 */
const gearTags = (s = {}, usesOverride) => {
  const tags = [];
  // Format keys, not "<number> <noun>" — and the same two the marketplace chips
  // use, which had drifted to the opposite word order ("Armor 1" there, "1 Armor"
  // here) for the identical fact.
  if (s.armor) tags.push(game.i18n.format("CAIRN.NArmor", { n: s.armor }));
  if (s.damageFormula) tags.push(game.i18n.format("CAIRN.NDamage", { n: s.damageFormula }));
  if (s.bulky) tags.push(game.i18n.localize("CAIRN.Bulky"));
  if (s.weightless) tags.push(game.i18n.localize("CAIRN.Weightless"));
  const uses = usesOverride ?? s.uses?.max ?? 0;
  if (uses) tags.push(game.i18n.format("CAIRN.NUses", { n: uses }));
  return tags;
};

/**
 * A frozen, portable copy of a dropped item — enough to rebuild an owned item at
 * generation, nothing document-specific (no _id / ownership / effects). This is
 * the "snapshot on drop" that makes a custom background self-contained and
 * shareable (docs/custom-backgrounds-plan.md §6 Fork A).
 */
const snapshotItem = (item) => {
  const o = item.toObject();
  return { name: o.name, type: o.type, img: o.img, system: o.system };
};

/**
 * The item sheet, on ApplicationV2.
 *
 * One class serves all seven item types; the template and the tab set are chosen
 * per render from `item.type` (see _configureRenderParts / _getTabsConfig).
 *
 * Two AppV1 behaviours are re-declared here rather than inherited, because
 * DocumentSheetV2 defaults them the other way and the sheet silently stops
 * working without them:
 *
 *  - `form.submitOnChange` — the whole UX is "edit a field and it sticks".
 *    AppV1's ItemSheet set this; DocumentSheetV2 defaults it to false.
 *  - `window.resizable` — AppV1's ItemSheet set it; ApplicationV2 defaults false.
 *
 * There is no `submitOnClose` in ApplicationV2 at all, so a field edited and left
 * un-blurred is no longer saved by closing the window. That is a deliberate
 * behaviour change, not an oversight: `submitOnChange` covers every normal edit.
 *
 * @extends {ItemSheetV2}
 */
export class CairnItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["cairn", "sheet", "item"],
    position: { width: 480, height: 480 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      // OVERRIDES core's `editImage`, which opens a bare FilePicker. Every item
      // template's portrait carries data-action="editImage", so declaring it
      // here routes all seven of them — gear, weapons, armor, spellbooks,
      // objects, transports and backgrounds — through the system's art picker
      // instead, which is where the Game-Icons gallery lives.
      editImage: CairnItemSheet.#onEditImage,
      duplicateBackground: CairnItemSheet.#onDuplicateBackground,
      testBackground: CairnItemSheet.#onTestBackground,
      addName: CairnItemSheet.#onAddName,
      removeName: CairnItemSheet.#onRemoveName,
      addGear: CairnItemSheet.#onAddGear,
      removeGear: CairnItemSheet.#onRemoveGear,
      removeOptionItem: CairnItemSheet.#onRemoveOptionItem,
    },
  };

  /**
   * Replaced per render by _configureRenderParts. Declared because
   * HandlebarsApplicationMixin validates it at construction.
   * @override
   */
  static PARTS = {};

  /** @override */
  static TABS = {
    primary: {
      tabs: [{ id: "description", label: "CAIRN.Description" }],
      initial: "description",
    },
  };

  /* -------------------------------------------- */

  /**
   * The background authoring form is a tall, multi-section editor; give it room.
   * Done here rather than in the constructor because `position` is derived from
   * the options during initialization.
   * @override
   */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    if (options.document?.type === "background") applied.position.height = 640;
    return applied;
  }

  /**
   * One template per item type, chosen at render. `static PARTS` cannot vary by
   * document, so this is the hook for it.
   * @override
   */
  _configureRenderParts(_options) {
    return {
      form: {
        template: `systems/air-bladder/templates/item/${this.item.type}-sheet.html`,
        templates: [],
      },
    };
  }

  /**
   * Description is universal; item/weapon add Critical Damage and a background
   * adds Details.
   * @override
   */
  _getTabsConfig(group) {
    const config = foundry.utils.deepClone(super._getTabsConfig(group));
    if (!config) return config;
    const extra = EXTRA_TABS[this.item.type];
    if (extra) config.tabs.push(extra);
    if (this.item.system?.relic) config.tabs.push(RELIC_TAB);
    // Unticking Relic removes the tab you are standing on. Exactly the failure the
    // actor sheet's Containers tab has, and it carries the same guard with the same
    // comment: `_prepareTabs` only defaults the group when it is UNSET (`??=`), so
    // without this the group keeps pointing at "recharge", nothing matches, no panel
    // gets `.active`, and core's `.tab[data-tab]:not(.active){display:none}` hides the
    // entire sheet body with no error. `submitOnChange` re-renders on the untick, so
    // it is immediate. Add a guard here alongside any future document-dependent tab.
    if (!config.tabs.some((t) => t.id === this.tabGroups[group])) this.tabGroups[group] = config.initial;
    return config;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    // Live model, not `toObject(false)`: a TypeDataModel resolves that against the
    // SCHEMA, so prepareData's derived values (isEquipable, hasPlusMinus, isFatigue,
    // grantLabel, icon, useItemIcons) never reach the template. Spreading the live
    // model restores stored + derived together.
    context.system = { ...this.item.system };
    // Per-window id prefix for label[for]/input[id] pairs. With two item sheets
    // open, clicking "Bulky" on the second toggled the FIRST item's checkbox and
    // submitOnChange saved it. DocumentSheetV2 already computes a unique id per
    // window as `rootId`, so this is now an alias rather than a hand-rolled one.
    context.idp = context.rootId;

    // Content localization for READ-ONLY (locked pack) entries only. An editable
    // sheet — an owned item, or an unlocked pack a Warden is editing — keeps the
    // canonical English so a save never writes a translated string back onto the
    // document. The name is left to the compendium list; here we localize the
    // description (a display-only derived field, never the stored value).
    const localize = !this.isEditable;
    const descNs = this.item.type === "background" ? "bg.desc" : "item.desc";
    const descSrc = localize ? t(descNs, this.item.system.description) : this.item.system.description;
    const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
    context.enrichedDescription = await enrich(descSrc, { relativeTo: this.item });
    context.enrichedCriticalDamage = await enrich(this.item.system.criticalDamage, { relativeTo: this.item });
    context.enrichedRecharge = await enrich(this.item.system.recharge ?? "", { relativeTo: this.item });

    // "Charges" and "Uses" are ONE counter. Across all 46 shipped relics the
    // distinction is exactly this: a relic that states a recharge condition has
    // charges, one that does not has uses, and none has both. So the label follows
    // `recharge` rather than a second field or a mode flag — nothing to keep in
    // step, and a relic that can never be recharged just reads "uses".
    const recharges = !!foundry.utils.getProperty(this.item, "system.recharge");
    context.usesLabel = recharges ? "CAIRN.Charges" : "CAIRN.Uses";
    context.maxUsesLabel = recharges ? "CAIRN.MaxCharges" : "CAIRN.MaxUses";

    // Transport kind pick-list for the transport sheet's <select>; keys are
    // stored, values are localized by selectOptions. The vocabulary lives in
    // icons.js, which is where the kinds are documented and where the art is
    // keyed off them.
    if (this.item.type === "transport") context.transportKinds = TRANSPORT_KINDS;
    if (this.item.type === "background") {
      context.isGM = game.user.isGM;
      if (this.isEditable) await this._prepareBackgroundEditor(context);
      else await this._prepareBackgroundReadOnly(context, localize);
    }
    return context;
  }

  /**
   * Read-only background view (locked shipped packs): resolve each gear name to
   * its pool document and derive the display tags, so the sheet reads "Chainmail
   * (2 Armor, bulky)" rather than a bare list. A snapshot row derives its tags
   * from the frozen copy it carries. Unresolvable names still list, tagless.
   * @private
   */
  async _prepareBackgroundReadOnly(context, localize) {
    context.startingGearRows = await Promise.all(
      (this.item.system.startingGear ?? []).map(async (g) => {
        if (g.itemData) {
          return { name: localize ? t("item.name", g.name) : g.name, tags: gearTags(g.itemData.system, g.uses) };
        }
        const doc = await resolveGearItem(g.name, { uses: g.uses });
        const tags = doc ? gearTags(doc.system, g.uses) : [];
        return { name: localize ? t("item.name", g.name) : g.name, tags };
      })
    );
  }

  /**
   * Editable authoring form: pick-lists, the current names, gear rows (with
   * resolved/derived tags and a snapshot marker), and the two d6 tables padded to
   * the fixed 2×6 shape for display. Nothing here is persisted — the padded shape
   * only reaches the document when the GM edits a field (handlers write a
   * normalized array via _normalizedTables).
   * @private
   */
  async _prepareBackgroundEditor(context) {
    context.isBackgroundEditor = true;
    // Keyed by the STORED English identity (that is what goes on the document);
    // only the label is localized. CAIRN.Archetype.* already existed for the
    // background picker — this dropdown was the one place still showing English.
    context.archetypeChoices = Object.fromEntries(
      ["Wizard", "Fighter", "Thief"].map((a) => [a, game.i18n.localize(`CAIRN.Archetype.${a}`)])
    );
    // Source is FIXED for a custom background — it is always Cairn 2e (that is the
    // whole feature; Barebones authoring is out of scope, and only source "2e" is
    // discovered). Shown read-only, never an editable pick-list, so a GM can't
    // silently make their background undiscoverable by choosing another source.
    // `|| "2e"` matches the schema default, so a background whose source somehow
    // reads empty shows the edition it will actually be discovered under rather
    // than a blank. Shared with the actor sheet — see utils.js `sourceLabel`.
    context.sourceLabel = sourceLabel(this.item.system.source || "2e");
    context.editNames = [...(this.item.system.names ?? [])];
    context.editGear = await Promise.all(
      (this.item.system.startingGear ?? []).map(async (g) => {
        if (g.itemData) {
          return { name: g.name, uses: g.uses ?? "", isSnapshot: true, tags: gearTags(g.itemData.system, g.uses) };
        }
        const doc = await resolveGearItem(g.name, { uses: g.uses });
        return { name: g.name, uses: g.uses ?? "", isSnapshot: false, tags: doc ? gearTags(doc.system, g.uses) : [], missing: !doc && !!g.name };
      })
    );
    const tables = this.item.system.tables ?? [];
    context.editTables = Array.from({ length: TABLE_COUNT }, (_, ti) => {
      const st = tables[ti] ?? {};
      return {
        question: st.question ?? "",
        options: Array.from({ length: OPTIONS_PER_TABLE }, (_, oi) => {
          const so = st.options?.[oi] ?? {};
          return {
            description: so.description ?? "",
            bonusGold: so.bonusGold ?? 0,
            items: (so.items ?? []).map((it) => ({ name: it.name, isSnapshot: !!it.itemData })),
          };
        }),
      };
    });
  }

  /**
   * A deep clone of the background's tables padded to the fixed 2×6 shape,
   * preserving each option's real items (with their itemData snapshots) and
   * containers. Handlers mutate this and write it back, so editing one field on a
   * blank background materializes the full structure without dropping any data.
   * @private
   */
  _normalizedTables() {
    const src = foundry.utils.deepClone(this.item.system.tables ?? []);
    return Array.from({ length: TABLE_COUNT }, (_, ti) => {
      const st = src[ti] ?? {};
      return {
        question: st.question ?? "",
        options: Array.from({ length: OPTIONS_PER_TABLE }, (_, oi) => {
          const so = st.options?.[oi] ?? {};
          return {
            description: so.description ?? "",
            bonusGold: so.bonusGold ?? 0,
            items: so.items ?? [],
            containers: so.containers ?? [],
          };
        }),
      };
    });
  }

  /* -------------------------------------------- */

  /**
   * Non-click listeners only. Clicks are declared as `actions` in DEFAULT_OPTIONS
   * and wired by ApplicationV2; everything here is a `change` handler, which the
   * action system does not cover.
   * @override
   */
  /**
   * Frame-level listeners, bound once. The frame survives re-render, so binding
   * these in `_onRender` would stack a duplicate on every redraw.
   *
   * NOTE there is deliberately no `_preClose` editor save here. The item templates
   * use `<prose-mirror toggled>`, and a toggled editor commits only through its own
   * save button — which looks like it should mean "type a description, hit ✕, lose
   * it". Measured (`npm run dev:notes-editor`), it does not: on close the element's
   * `disconnectedCallback` calls `save()` (prosemirror-editor.mjs:130-138), the
   * resulting `change` still bubbles to the form inside the detached subtree, and
   * ApplicationV2 accepts a submit while the application is CLOSING
   * (application.mjs:2159-2161). Adding a `_preClose` save changed nothing, so it
   * was removed rather than shipped as insurance against a bug that isn't there.
   * @override
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    bindEditorClickAwaySave(this.element);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!this.isEditable) return;
    const el = this.element;

    // If it's bulky it cannot be weightless too. These fire on the input during
    // the target phase, before the change bubbles to the form and submitOnChange
    // serializes it — so unchecking the sibling here is what gets saved.
    const exclusive = (a, b) => {
      el.querySelector(`[name='system.${a}']`)?.addEventListener("change", (e) => {
        if (!e.target.checked) return;
        const other = el.querySelector(`[name='system.${b}']`);
        if (other) other.checked = false;
      });
    };
    exclusive("bulky", "weightless");
    exclusive("weightless", "bulky");

    if (this.item.type === "background") this._activateBackgroundListeners(el);
  }

  /**
   * Wire the authoring form's `change` handlers. Names, gear and table fields are
   * class-managed (no form `name=`), so they never round-trip through Foundry's
   * form serialization — each edit surgically updates one array element and
   * preserves the snapshots the DOM can't carry. Archetype/source are native
   * `name=` selects (Foundry saves those).
   * @private
   */
  _activateBackgroundListeners(el) {
    const item = this.item;
    const on = (selector, handler) =>
      el.querySelectorAll(selector).forEach((node) => node.addEventListener("change", handler));

    // --- Example names ---------------------------------------------------------
    on(".bg-name-input", async (ev) => {
      const names = [...(item.system.names ?? [])];
      names[Number(ev.currentTarget.dataset.i)] = ev.currentTarget.value;
      await item.update({ "system.names": names });
    });

    // --- Starting gear ---------------------------------------------------------
    on(".bg-gear-name", async (ev) => {
      const gear = foundry.utils.deepClone(item.system.startingGear ?? []);
      const i = Number(ev.currentTarget.dataset.i);
      gear[i].name = ev.currentTarget.value;
      // Typing a name over a snapshot converts the row back to a by-name pointer.
      delete gear[i].itemData;
      await item.update({ "system.startingGear": gear });
    });
    on(".bg-gear-uses", async (ev) => {
      const gear = foundry.utils.deepClone(item.system.startingGear ?? []);
      const i = Number(ev.currentTarget.dataset.i);
      const v = parseInt(ev.currentTarget.value, 10);
      if (Number.isNaN(v) || v <= 0) delete gear[i].uses;
      else gear[i].uses = v;
      await item.update({ "system.startingGear": gear });
    });

    // --- The two d6 tables -----------------------------------------------------
    on(".bg-table-question", async (ev) => {
      const tables = this._normalizedTables();
      tables[Number(ev.currentTarget.dataset.t)].question = ev.currentTarget.value;
      await item.update({ "system.tables": tables });
    });
    on(".bg-option-desc", async (ev) => {
      const tables = this._normalizedTables();
      tables[Number(ev.currentTarget.dataset.t)].options[Number(ev.currentTarget.dataset.o)].description = ev.currentTarget.value;
      await item.update({ "system.tables": tables });
    });
    on(".bg-option-gold", async (ev) => {
      const tables = this._normalizedTables();
      const v = parseInt(ev.currentTarget.value, 10);
      tables[Number(ev.currentTarget.dataset.t)].options[Number(ev.currentTarget.dataset.o)].bonusGold = Number.isNaN(v) ? 0 : Math.max(0, v);
      await item.update({ "system.tables": tables });
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * "Test ×10": a dry-run report on this draft — resolution lint plus a sampled
   * option/gold spread — shown in a dialog. Reuses the real generator logic
   * (previewBackground), so it doubles as the pre-share self-contained linter.
   * @this {CairnItemSheet}
   */
  static async #onTestBackground(event) {
    event.preventDefault();
    const report = await previewBackground(this.item, 10);
    new foundry.applications.api.DialogV2({
      window: { title: game.i18n.format("CAIRN.BgAuthor.TestTitle", { name: this.item.name }), icon: "fas fa-flask" },
      position: { width: 560 },
      content: renderPreviewReport(report),
      buttons: [{ action: "close", label: game.i18n.localize("CAIRN.Close"), default: true }],
    }).render(true);
  }

  /**
   * The item art picker, in place of core's bare FilePicker.
   *
   * Two galleries: the Warden's custom folder and Game-Icons. No Aspeheim —
   * those are character portraits, and a longsword has no face. The URL row and
   * the Browse escape are still there, so nothing a Warden could do before is
   * taken away; core's FilePicker was only ever the Browse half of this.
   *
   * Items carry no token, so this writes `img` alone — the actor pickers pair a
   * token with it, and copying that here would put a texture on a document that
   * has nowhere to keep one.
   * @this {CairnItemSheet}
   */
  static async #onEditImage(event) {
    event.preventDefault();
    await pickArt({
      current: this.item.img,
      title: game.i18n.localize("CAIRN.ChooseItemArt"),
      custom: true,
      gameIcons: true,
      browseStart: this.item.img,
      onPick: (src) => this.item.update({ img: src }),
    });
  }

  /**
   * "Duplicate into my backgrounds": copy this background into the GM's editable
   * world compendium (created on first use) as a starting point, and open the copy.
   * Available on locked shipped backgrounds — the intended way to fork one.
   * @this {CairnItemSheet}
   */
  static async #onDuplicateBackground(event) {
    event.preventDefault();
    const copy = await duplicateBackgroundToWorld(this.item);
    if (!copy) return;
    ui.notifications.info(game.i18n.format("CAIRN.BgAuthor.Duplicated", { name: copy.name }));
    copy.sheet.render(true);
  }

  /** @this {CairnItemSheet} */
  static async #onAddName() {
    await this.item.update({ "system.names": [...(this.item.system.names ?? []), ""] });
  }

  /** @this {CairnItemSheet} */
  static async #onRemoveName(event, target) {
    const names = [...(this.item.system.names ?? [])];
    names.splice(Number(target.dataset.i), 1);
    await this.item.update({ "system.names": names });
  }

  /** @this {CairnItemSheet} */
  static async #onAddGear() {
    await this.item.update({ "system.startingGear": [...(this.item.system.startingGear ?? []), { name: "" }] });
  }

  /** @this {CairnItemSheet} */
  static async #onRemoveGear(event, target) {
    const gear = foundry.utils.deepClone(this.item.system.startingGear ?? []);
    gear.splice(Number(target.dataset.i), 1);
    await this.item.update({ "system.startingGear": gear });
  }

  /** @this {CairnItemSheet} */
  static async #onRemoveOptionItem(event, target) {
    const { t: ti, o, i } = target.dataset;
    const tables = this._normalizedTables();
    tables[Number(ti)].options[Number(o)].items.splice(Number(i), 1);
    await this.item.update({ "system.tables": tables });
  }

  /* -------------------------------------------- */

  /**
   * Snapshot a dragged Item onto the authoring form. The drop zone under the
   * cursor decides where it lands: a table option (`data-drop="option"`) or, by
   * default, starting gear.
   *
   * Only backgrounds react. Everything else falls through to ItemSheetV2, which
   * in v14 handles ActiveEffect drops — AppV1's version did nothing, so this
   * delegation is new behaviour rather than a translation.
   * @override
   */
  async _onDrop(event) {
    if (this.item.type !== "background" || !this.isEditable) return super._onDrop(event);
    let data;
    try {
      data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    } catch (_e) {
      return;
    }
    if (data?.type !== "Item") return super._onDrop(event);
    const dropped = await Item.implementation.fromDropData(data);
    if (!dropped) return;
    if (dropped.type === "background") {
      ui.notifications.warn(game.i18n.localize("CAIRN.BgAuthor.NoBackgroundDrop"));
      return;
    }
    const snap = snapshotItem(dropped);
    const zone = event.target.closest("[data-drop]");
    if (zone?.dataset.drop === "option") {
      const tables = this._normalizedTables();
      tables[Number(zone.dataset.t)].options[Number(zone.dataset.o)].items.push({ name: snap.name, itemData: snap });
      await this.item.update({ "system.tables": tables });
    } else {
      const gear = foundry.utils.deepClone(this.item.system.startingGear ?? []);
      gear.push({ name: snap.name, itemData: snap });
      await this.item.update({ "system.startingGear": gear });
    }
  }
}
