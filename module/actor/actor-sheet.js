import { regenerateActor, canRegenerateContainers, drawBond, bondRecordFrom, withGrantSource, mentionsSecondBond, resolveRefs, replaceGrantedContainers, promptBackground, changeBackground, promptFailedCareer, rollFailedCareerName, buildFailedCareerItem, getPortraitManifest, pairedTokenFor, getCustomPortraitPaths, refreshCustomPortraits, regenerateHireling, rerollHirelingProfession, rerollHirelingName, rollNameFromTable, rollAge } from "../character-generator.js";
import { openMarketplace, TRANSPORTS_CATEGORY } from "../marketplace.js";
import { evaluateFormula, cleanDescription, bindEditorClickAwaySave, sourceLabel } from "../utils.js";
import { resultText } from "../compendium.js";
import { SETTINGS_NS } from "../settings.js";
import { CONTAINER_ART_CHOICES, CONTAINER_CLASSES, TRANSPORT_KINDS, containerClassSlots, containerClass, containerClassAnimate } from "../icons.js";
import { localizeNameDesc, t } from "../i18n-content.js";
import { FATIGUE_NAME } from "../item/item.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * The checkbox names on the add/edit-feature dialog, which are also the keys the
 * feature record stores them under. Create and Edit read the same form template,
 * so they must read the same list — it used to be declared twice, inline.
 */
const FEATURE_FLAGS = ["str", "dex", "wil", "hp", "armor", "dmg", "crit", "deprived", "blast"];

/** Tab labels by id. The nav itself is hand-written in each template, because
 *  every label carries live data (slot counts, container counts, and a Notes tab
 *  that renames itself once a background is attached). */
const TAB_LABELS = {
  items: "CAIRN.Items",
  // The tab ID stays `containers` -- it is internal, and renaming it would touch
  // both templates, the `show-containers-tab` setting and the tab filter for no
  // gain anyone can see. What a person READS is "Connected", because once a
  // container is just an NPC with a `connectedTo`, the tab is not about
  // containers: it lists mounts, vehicles, loot piles AND hirelings, who have
  // never had a link back to whoever hired them.
  containers: "CAIRN.Connected",
  description: "CAIRN.Description",
  notes: "CAIRN.Notes",
};

/** Which tabs each actor type shows, in order. `containers` is dropped unless
 *  the actor actually has the Containers tab enabled (see _getTabsConfig). */
const TAB_IDS = {
  character: ["items", "containers", "description", "notes"],
  npc: ["items", "containers", "description", "notes"],
  // Same set as npc: one sheet, one tab set. A hireling used to get only
  // items+notes, so anything written in its Description was unreachable.
  hireling: ["items", "containers", "description", "notes"],
  container: ["items", "description"],
};

/**
 * Memoized compendium reads for the sheet's static pick-lists (traits, scars, omens).
 *
 * `_prepareContext` runs on EVERY render, and `submitOnChange` is on — so every
 * field edit, every item add/remove and every damage application re-read a pack and
 * constructed all 11 tables-2e RollTables from scratch.
 *
 * These are shipped tables that do not change during play. The hooks below cover the
 * one case that isn't true: a Warden unlocking the pack and editing a table.
 *
 * The PROMISE is cached, so concurrent renders share a single round-trip, and what
 * it resolves to is the RAW documents — translation stays per-render, so switching
 * language still re-localizes for free.
 */
const PACK_DOC_CACHE = new Map();

const cachedPackDocuments = (packName) => {
  if (!PACK_DOC_CACHE.has(packName)) {
    const pack = game.packs.get(packName);
    // Drop a rejection rather than caching it forever; the caller sees the same
    // error it would have seen before, and the next render retries.
    const p = pack
      ? pack.getDocuments().catch((err) => { PACK_DOC_CACHE.delete(packName); throw err; })
      : Promise.resolve([]);
    PACK_DOC_CACHE.set(packName, p);
  }
  return PACK_DOC_CACHE.get(packName);
};

// TableResult as well as RollTable: adding a row to a table fires ONLY
// createTableResult — the parent RollTable is not updated — so a Warden who
// unlocked the pack and added a Scar, an Omen or a trait watched the sheet's
// pick-lists keep serving the cached table for the rest of the session. Editing
// or deleting a row is the same story.
for (const hook of [
  "createRollTable", "updateRollTable", "deleteRollTable",
  "createTableResult", "updateTableResult", "deleteTableResult",
]) {
  Hooks.on(hook, () => PACK_DOC_CACHE.clear());
}

/* -------------------------------------------- */
/*  Row animations (replacing jQuery slideUp/slideDown)                         */
/* -------------------------------------------- */

/** Collapse `el` to nothing over 200ms, then run `after`. The animation is
 *  cosmetic; `after` is the real work, so it runs even if animation is
 *  unavailable or interrupted. */
const slideUp = (el, after = () => {}) => {
  el.style.overflow = "hidden";
  const anim = el.animate(
    [{ height: `${el.offsetHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }],
    { duration: 200, easing: "ease-out" }
  );
  anim.finished.then(after, after);
};

/** Reveal `el` from nothing over 200ms. */
const slideDown = (el) => {
  const height = el.scrollHeight;
  el.style.overflow = "hidden";
  el.animate(
    [{ height: "0px", opacity: 0 }, { height: `${height}px`, opacity: 1 }],
    { duration: 200, easing: "ease-out" }
  ).finished.then(() => { el.style.overflow = ""; }, () => { el.style.overflow = ""; });
};

/**
 * Wrap an action handler so it does nothing on a non-editable sheet.
 *
 * AppV1 simply never bound any of these listeners when `options.editable` was
 * false — `activateListeners` returned early — so an observer's sheet was inert
 * beyond Foundry's own controls. ApplicationV2 wires `actions` regardless of
 * editability, so preserving that behaviour means guarding at the handler.
 */
const owned = (fn) => function (event, target) {
  if (!this.isEditable) return undefined;
  return fn.call(this, event, target);
};

/**
 * The actor sheet, on ApplicationV2.
 *
 * One class serves all four actor types; the template and the tab set are chosen
 * per render from `actor.type` (see _configureRenderParts / _getTabsConfig).
 *
 * Two AppV1 behaviours are re-declared rather than inherited, because
 * DocumentSheetV2 defaults them the other way and the sheet silently stops
 * working without them:
 *
 *  - `form.submitOnChange` — the whole UX is "edit a field and it sticks".
 *    AppV1's ActorSheet set this; DocumentSheetV2 defaults it to false.
 *  - `window.resizable` — AppV1's ActorSheet set it; ApplicationV2 defaults false.
 *
 * ApplicationV2 has no `submitOnClose`, so a field edited and left un-blurred is
 * no longer saved by closing the window. `submitOnChange` covers every normal
 * edit; see _processFormData for the one place that mattered.
 *
 * @extends {ActorSheetV2}
 */
export class CairnActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["cairn", "sheet", "actor"],
    position: { width: 600, height: 750 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      // Header
      rollActor: owned(CairnActorSheet.#onRollActor),
      toggleGeneration: owned(CairnActorSheet.#onToggleGeneration),
      // Portrait + name
      editPortrait: owned(CairnActorSheet.#onEditPortrait),
      rollPortrait: owned(CairnActorSheet.#onRollPortrait),
      rollName: owned(CairnActorSheet.#onRollName),
      rollProfession: owned(CairnActorSheet.#onRollProfession),
      // Inventory
      itemCreate: owned(CairnActorSheet.#onItemCreate),
      itemShop: owned(CairnActorSheet.#onItemShop),
      itemEdit: owned(CairnActorSheet.#onItemEdit),
      itemDelete: owned(CairnActorSheet.#onItemDelete),
      itemToggleEquipped: owned(CairnActorSheet.#onItemToggleEquipped),
      itemAddUse: owned(CairnActorSheet.#onItemAddUse),
      itemRemoveUse: owned(CairnActorSheet.#onItemRemoveUse),
      itemDescription: owned(CairnActorSheet.#onItemDescription),
      addFatigue: owned(CairnActorSheet.#onAddFatigue),
      removeFatigue: owned(CairnActorSheet.#onRemoveFatigue),
      rollDamage: owned(CairnActorSheet.#onRollDamage),
      // Containers
      containerShop: owned(CairnActorSheet.#onContainerShop),
      containerCreate: owned(CairnActorSheet.#onContainerCreate),
      containerUnlink: owned(CairnActorSheet.#onContainerUnlink),
      // Features
      featureCreate: owned(CairnActorSheet.#onFeatureCreate),
      featureEdit: owned(CairnActorSheet.#onFeatureEdit),
      featureDelete: owned(CairnActorSheet.#onFeatureDelete),
      featureDescription: owned(CairnActorSheet.#onFeatureDescription),
      // Header counters + buttons
      rollAbility: owned(CairnActorSheet.#onRollAbility),
      toggleCritical: owned(CairnActorSheet.#onToggleCritical),
      armorReset: owned(CairnActorSheet.#onArmorReset),
      rest: owned(CairnActorSheet.#onRest),
      restoreAbilities: owned(CairnActorSheet.#onRestoreAbilities),
      dieOfFate: owned(CairnActorSheet.#onDieOfFate),
      // Description tab
      rollAge: owned(CairnActorSheet.#onRollAge),
      rollOmen: owned(CairnActorSheet.#onRollOmen),
      toggleTraits: owned(CairnActorSheet.#onToggleTraits),
      toggleScars: owned(CairnActorSheet.#onToggleScars),
      // Background / failed career
      rollBackground: owned(CairnActorSheet.#onRollBackground),
      pickBackground: owned(CairnActorSheet.#onPickBackground),
      rollFailedCareer: owned(CairnActorSheet.#onRollFailedCareer),
      pickFailedCareer: owned(CairnActorSheet.#onPickFailedCareer),
      rollFailedCareerItem: owned(CairnActorSheet.#onRollFailedCareerItem),
      // Notes tab
      rerollBond: owned(CairnActorSheet.#onRerollBond),
      addBond: owned(CairnActorSheet.#onAddBond),
      removeBond: owned(CairnActorSheet.#onRemoveBond),
      rerollQuestion: owned(CairnActorSheet.#onRerollQuestion),
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
      tabs: [{ id: "items", label: TAB_LABELS.items }],
      initial: "items",
    },
  };

  /* -------------------------------------------- */

  /**
   * The hireling sheet's old <form> carried a `hireling` class, which the whole
   * `.hireling …` block in css/cairn.css hangs off (the stripped name/profession/
   * day-rate stack, and HP joining the ability column). ApplicationV2 owns the
   * form element, so the class has to come from the options instead.
   *
   * Only this one type is added. Adding every type mechanically would put a bare
   * `.container` / `.character` on the window, which is exactly the kind of
   * generic class name a framework stylesheet is liable to claim.
   * @override
   */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    // Both non-player types share one sheet, so both need the class its layout is
    // scoped to. PREFIXED deliberately: the old name was `hireling`, which stopped
    // describing anything once npc used the same template, and a bare `.npc` is
    // exactly the generic token the note above warns about.
    if (["npc", "hireling"].includes(options.document?.type)) {
      applied.classes.push("cairn-npc-sheet");
    }
    return applied;
  }

  /**
   * One template per actor type, chosen at render. `static PARTS` cannot vary by
   * document, so this is the hook for it. The shared partials must be declared
   * so HandlebarsApplicationMixin preloads them.
   * @override
   */
  _configureRenderParts(_options) {
    // `hireling` renders the NPC sheet: the two types are one thing now (see
    // ACTOR_DATA_MODELS), so there is one template rather than two that had to be
    // kept in step by hand.
    const t = this.actor.type === "hireling" ? "npc" : this.actor.type;
    return {
      form: {
        template: `systems/air-bladder/templates/actor/${t}-sheet.html`,
        templates: [
          "systems/air-bladder/templates/parts/items-list.html",
          "systems/air-bladder/templates/parts/container-list.html",
          "systems/air-bladder/templates/parts/feature-list.html",
        ],
      },
    };
  }

  /**
   * The tab set varies by actor type, and the Containers tab comes and goes with
   * the actor's containers.
   * @override
   */
  _getTabsConfig(group) {
    const config = foundry.utils.deepClone(super._getTabsConfig(group));
    if (!config) return config;
    const ids = (TAB_IDS[this.actor.type] ?? ["items"])
      .filter((id) => id !== "containers" || this.actor.system.showContainersTab);
    config.tabs = ids.map((id) => ({ id, label: TAB_LABELS[id] }));
    // Losing your last container removes the tab you were standing on.
    // `_prepareTabs` only defaults the group when it is unset (`??=`), so without
    // this the group keeps pointing at a tab that is no longer rendered and NO
    // panel is active — a blank sheet body with no error.
    if (!ids.includes(this.tabGroups[group])) this.tabGroups[group] = config.initial;
    return config;
  }

  /**
   * Rows are dragged to reorder an inventory or to hand an item to another actor.
   * ActorSheetV2 hardcodes `.draggable` with no dropSelector, so the whole
   * application is the drop zone (which is what we want) but the drag selector
   * has to be replaced. Overriding the getter is preferable to adding a
   * `draggable` class to every row — that class carries Foundry styling of its own.
   * @override
   */
  get _dragDrop() {
    return this.#dragDrop ??= new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".cairn-items-list-row",
      permissions: {
        dragstart: this._canDragStart.bind(this),
        drop: this._canDragDrop.bind(this),
      },
      callbacks: {
        dragstart: this._onDragStart.bind(this),
        dragover: this._onDragOver.bind(this),
        drop: this._onDrop.bind(this),
      },
    });
  }

  #dragDrop = null;

  /* -------------------------------------------- */

  /**
   * Roll Character and the Randomization toggle, INLINE in the title bar.
   *
   * These were briefly `window.controls`, which is the tidier declaration — but
   * v14 renders controls into the ⋮ dropdown only (`_renderHeaderControl` builds
   * `<li>` elements for a ContextMenu), and burying a control the Warden uses
   * every session behind a menu is a downgrade from what AppV1 showed. Frame
   * buttons are the supported way back: core's own `_getFrameButtons`
   * (`api/application.mjs:738`) renders straight into `.window-header`, and
   * `DocumentSheetV2` already ships two of them (Copy UUID, Import).
   *
   * Two consequences, both handled rather than lived with:
   *
   *  - Frame buttons are built in `_renderFrame`, which runs ONLY on first
   *    render. So state cannot be expressed by re-returning a different array
   *    the way header controls could — #syncGenerationButtons keeps them in
   *    step on every render instead. That is a far cry from AppV1's surgery
   *    (which rewrote the header's innerHTML and had to namespace jQuery events
   *    to stop handlers stacking): these are elements we created once, and only
   *    their label, icon and hidden state move.
   *  - There is no `ownership` filter on frame buttons, unlike header controls,
   *    so the ownership gate is explicit below.
   *
   * `show-generate-header` is `requiresReload: true`, so reading it once at
   * frame time is correct — it cannot change under an open sheet.
   * @override
   */
  _getFrameButtons(options) {
    const buttons = super._getFrameButtons(options);

    // Pop Out is a shortcut to the ⋮ menu's Detach, which opens the sheet in its
    // own browser window. `detach` is CORE's action (application.mjs:72, :86) —
    // this only surfaces it, so there is no behaviour of ours to get wrong.
    // Every actor type gets it and it is NOT gated by `show-generate-header`:
    // it is a plain window control with nothing to do with generation, and
    // hiding it behind that setting would be arbitrary.
    const popOut = { action: "detach", icon: "fas fa-arrow-up-right-from-square", label: "CAIRN.PopOut" };

    const isChar = this.actor.type === "character";
    // npc and hireling are one thing, so both get the NPC generation controls.
    const isHireling = ["hireling", "npc"].includes(this.actor.type);
    const generates = (isChar || isHireling)
      && this.actor.isOwner
      && game.settings.get(SETTINGS_NS, "show-generate-header");
    if (!generates) return [popOut, ...buttons];

    // Roll Character and the toggle are both ALWAYS created. Roll Character is
    // hidden in place when Randomization is off rather than omitted, so the
    // toggle can reveal it without rebuilding the frame — which first render is
    // the only chance to do.
    return [
      // Character → "Roll Character"; hireling → "Roll NPC". Same control, same
      // action; only the wording differs.
      { action: "rollActor", icon: "fas fa-dice-d6", label: isHireling ? "CAIRN.RollNpc" : "CAIRN.RegenerateCharacter" },
      { action: "toggleGeneration", icon: "fas fa-toggle-on", label: "CAIRN.RandomizationOn" },
      popOut,
      ...buttons,
    ];
  }

  /* -------------------------------------------- */

  /**
   * Give our two frame buttons visible text.
   *
   * `templates/generic/frame-buttons.hbs` renders icon-only buttons and puts the
   * label in `aria-label`, which is right for Foundry's own (Copy UUID, Import)
   * and wrong for these: "Randomization: On" is a STATE READOUT, and a readout
   * you have to hover to read is not a readout. So the labels are added after
   * core has built the frame — decorating elements core owns, not replacing its
   * template.
   * @override
   */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    for (const action of ["rollActor", "toggleGeneration", "detach"]) {
      const button = frame.querySelector(`.window-header button[data-action="${action}"]`);
      if (!button) continue;
      // The template puts the glyph on the BUTTON as classes and leaves it
      // empty. Text needs the glyph in a child instead, so move it.
      const glyph = [...button.classList].filter((c) => c === "fas" || c.startsWith("fa-"));
      button.classList.remove(...glyph, "icon");
      button.classList.add("cairn-header-button");
      const icon = document.createElement("i");
      icon.className = glyph.join(" ");
      // A tooltip that repeats text already on screen is noise. `data-tooltip`
      // is valueless in the template and falls back to aria-label, so drop it.
      button.removeAttribute("data-tooltip");
      button.append(icon, document.createTextNode(button.getAttribute("aria-label") ?? ""));
    }

    // Send the ⋮ menu to the right-hand end, next to ✕.
    //
    // It is not a frame button — `_renderFrame` writes it into the header's
    // static markup between the title and ✕ (application.mjs:848-850), and
    // `_renderFrameButtons` then inserts everything else `beforebegin` of ✕
    // (:887). So anything we add necessarily lands to its RIGHT, leaving ⋮
    // stranded at the front of a row of labelled buttons.
    //
    // Its ContextMenu is bound by selector to the application root
    // (application.mjs:1887), and `#window.controls` holds this element, so
    // moving the node breaks neither.
    const header = frame.querySelector(".window-header");
    const controls = header?.querySelector('button[data-action="toggleControls"]');
    const close = header?.querySelector('button[data-action="close"]');
    if (controls && close) close.before(controls);

    this.#syncGenerationButtons(frame);
    return frame;
  }

  /* -------------------------------------------- */

  /**
   * Hide Pop Out once the sheet is already popped out, and bring it back when it
   * re-docks.
   *
   * Detaching does NOT re-render — `render()` short-circuits to `#move`
   * (application.mjs:537) — so `_onRender` never fires and the button cannot
   * update itself the way the Randomization toggle does. `_updateFrame` looks
   * like the answer and is not: `#move` calls it BEFORE the async
   * window-opening work that sets `window.windowId`, so `_canDetach()` still
   * reads true at that point and the button stays visible. Measured, not
   * assumed — that was the first attempt.
   *
   * These two are the hooks core fires once the move has actually happened
   * (application.mjs:1323, :1427).
   *
   * Re-docking itself stays in the ⋮ menu, where core puts Attach and keeps it
   * correct; a frame button is built once and cannot follow.
   * @override
   */
  _onDetach(from, to) {
    super._onDetach(from, to);
    this.#syncPopOut();
  }

  /** @override */
  _onAttach(from, to) {
    super._onAttach(from, to);
    this.#syncPopOut();
  }

  /**
   * Show Pop Out exactly when core would offer Detach in the ⋮ menu, using
   * core's own predicate rather than a second opinion about what "detached"
   * means.
   */
  #syncPopOut() {
    this.element?.querySelector('.window-header button[data-action="detach"]')
      ?.classList.toggle("cairn-header-hidden", !this._canDetach());
  }

  /* -------------------------------------------- */

  /**
   * Keep the two title-bar buttons in step with generation mode: the toggle's
   * own label and icon, and whether Roll Character is showing at all — hiding it
   * while Randomization is off is that toggle's entire purpose.
   *
   * Called from both `_renderFrame` (first paint) and `_onRender` (every
   * subsequent one), because the frame is built once and the content many times.
   * @param {HTMLElement} [root] The frame, when it is not yet `this.element`.
   */
  #syncGenerationButtons(root = this.element) {
    const roll = root?.querySelector('.window-header button[data-action="rollActor"]');
    const toggle = root?.querySelector('.window-header button[data-action="toggleGeneration"]');
    if (!roll && !toggle) return;
    // Legacy actors predate the field, so absent means enabled.
    const on = this.actor.system.generationEnabled !== false;
    roll?.classList.toggle("cairn-header-hidden", !on);
    if (!toggle) return;
    const label = game.i18n.localize(on ? "CAIRN.RandomizationOn" : "CAIRN.RandomizationOff");
    toggle.setAttribute("aria-label", label);
    toggle.lastChild.textContent = label;
    toggle.querySelector("i")?.classList.replace(
      on ? "fa-toggle-off" : "fa-toggle-on",
      on ? "fa-toggle-on" : "fa-toggle-off"
    );
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;
    // Whether this user can DELETE a connected actor. Foundry gates Actor
    // deletion by ROLE (Assistant+, and isGM is exactly role >= ASSISTANT) with
    // no player-grantable permission — so a player's trash icon on the
    // Connected tab was an affordance for an action the server always refuses
    // (review #5). The template hides it; unlink and edit remain theirs.
    context.canDeleteActors = game.user.isGM;
    // Per-window id prefix for label[for]/input[id] pairs. Templates hardcoded the
    // field path as the DOM id ("system.gold"), so every open sheet of a type used
    // the SAME ids — and `label[for]` resolves against the first match in tree
    // order, so with two sheets open a click on the second sheet's label toggled
    // the FIRST sheet's checkbox, which submitOnChange then saved. DocumentSheetV2
    // already computes a unique id per window as `rootId`.
    context.idp = context.rootId;

    // Live model, not `toObject(false)`: a TypeDataModel resolves that against the
    // SCHEMA, so prepareData's derived values (slotsUsed, slotsMax, encumbered,
    // armor, coinsPerSlot, containerObjects, goldSlots, showBio…) never reach the
    // template and each renders blank with no error anywhere. Spreading the live
    // model yields stored + derived together as one plain object.
    //
    // Plain COPIES, deliberately: the content-localization pass below rewrites
    // item names and descriptions for display, and must never touch the documents.
    context.system = { ...this.actor.system };
    // Recomputed at RENDER time, not taken from prepareDerivedData.
    //
    // The Connected list is derived from other actors' `connectedTo`, and nothing
    // re-prepares THIS actor when a different one is created, connected or
    // deleted — Foundry only re-prepares the document that changed. So the
    // prepared copy goes stale the moment a background grants a mount or a
    // purchase lands, and the tab shows the previous state until something else
    // happens to touch the owner. Rebuilding it here costs one pass over
    // game.actors per render and cannot be stale by construction.
    context.system.containerObjects = this.actor.connectedActors();
    let items = this.actor.items.map((i) => ({
      _id: i.id,
      name: i.name,
      type: i.type,
      img: i.img,
      sort: i.sort,
      system: { ...i.system },
    }));

    if (game.settings.get(SETTINGS_NS, "enable-inventory-reorder")) {
      // Manual order: honour each item's stored `sort` (Foundry's native field,
      // written by the drag-to-reorder handler), falling back to name. Fatigue is
      // NOT forced last here — with reorder on, the player controls placement.
      items.sort((a, b) =>
        (a.sort ?? 0) - (b.sort ?? 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      );
    } else {
      items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      items.sort((a, b) =>
        a.system.equipped && !b.system.equipped
          ? -1
          : a.system.equipped === b.system.equipped
          ? 0
          : 1
      );
      items.sort((a, b) => (a.name === FATIGUE_NAME ? 1 : b.name === FATIGUE_NAME ? -1 : 0));
    }

    // Display-only content localization: translate inventory item names/descriptions
    // into the active language for rendering only. These are plain data copies (not
    // the stored documents, which stay English), so name-matching elsewhere is
    // unaffected. A no-op in an English world (overlay null); a miss shows English.
    // An NPC monster stores its attacks/features as embedded items; the extractor
    // files those under monster.itemName/monster.itemDesc, not the gear item.*
    // namespaces. Characters/hirelings/containers hold gear → item.* (the default).
    const itemNs =
      this.actor.type === "npc"
        ? { nameNs: "monster.itemName", descNs: "monster.itemDesc" }
        : undefined;
    items = items.map((i) => localizeNameDesc(i, itemNs));
    // Fatigue is STORED in English (see FATIGUE_NAME) so its identity survives a
    // mixed-language table. Its label is localized here, at display time, from the
    // UI key every language file already carries — so a Spanish player still reads
    // "Fatiga" without the stored document ever being translated.
    const fatigueLabel = game.i18n.localize("CAIRN.Fatigue");
    context.items = items.map((i) => (i.name === FATIGUE_NAME ? { ...i, name: fatigueLabel } : i));

    const enrich = (html) =>
      foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { relativeTo: this.actor });

    // Compendium monsters have "description" instead of "biography"
    if (this.actor.system.showBio) {
      context.enrichedBiography = await enrich(this.actor.system.biography);
    } else {
      // An NPC monster's description translates via the monster.desc namespace —
      // display only, enriched into a derived field, never written back to the doc.
      const rawDescription =
        this.actor.type === "npc"
          ? t("monster.desc", this.actor.system.description)
          : this.actor.system.description;
      context.enrichedDescription = await enrich(rawDescription);
    }
    context.enrichedNotes = await enrich(this.actor.system.notes);

    if (this.actor.type === "character") await this._prepareCharacterContext(context);

    // The container's Type pick-list. Blank is offered because a hand-made
    // container legitimately has no kind — it is a chest on the floor — and
    // because the field has always defaulted to empty.
    if (this.actor.type === "container") context.transportKinds = TRANSPORT_KINDS;

    // Non-player actors reuse the character's STR/DEX/WIL/HP behaviour and
    // tooltips, but none of the background/traits/bonds machinery. npc is here
    // too now that it shares the sheet — without it the per-field dice and the
    // ability tooltips were simply absent on an NPC.
    if (["hireling", "npc"].includes(this.actor.type)) {
      this._computeStatContext(context);
      // Same random-generation switch as a character: gates the per-field dice
      // (name, profession, portrait).
      context.generationEnabled = this.actor.system.generationEnabled !== false;
    }

    // Tooltips that have an NPC wording must resolve through `_wording` like the
    // dialogs do. npc-sheet.html used to hardcode `CAIRN.DeprivedTipNpc`, which
    // bypassed the rule entirely and so stayed English in every language no matter
    // what a translator did — while the Panicked tooltip beside it, which has no
    // variant, was translated. Resolving here keeps ONE rule and lets the template
    // stay dumb.
    context.deprivedTipKey = this._wording("CAIRN.DeprivedTip");
    context.panickedTipKey = this._wording("CAIRN.PanickedTip");
    return context;
  }

  /**
   * Description tab: traits (pick-lists + sentence), Omen, Scars, plus the 2e
   * background header/description; and the Notes tab's bonds and questions.
   * Character-only — NPCs and containers have none of it.
   * @private
   */
  async _prepareCharacterContext(context) {
    // Trait pick-lists: each trait's source table (from the 2e biography config,
    // which already points at air-bladder.tables-2e) supplies a <select> of
    // options so a player can pick a value (or keep an off-table one).
    const mapping = CONFIG.Cairn?.characterGenerator2e?.biography?.items ?? {};
    const byPack = {};
    for (const ref of Object.values(mapping)) {
      const [packName] = ref.split(";");
      if (!(packName in byPack)) byPack[packName] = await cachedPackDocuments(packName);
    }
    context.traitRows = Object.entries(mapping).map(([key, ref]) => {
      const [packName, tableName] = ref.split(";");
      const table = (byPack[packName] ?? []).find((tbl) => tbl.name === tableName);
      const value = this.actor.system.traits?.[key] ?? "";
      const texts = table ? table.results.map(resultText).sort() : [];
      return {
        key,
        // The trait-category label IS a tables-2e table name (Physique, Skin…),
        // so localize it via the same table.name namespace as the compendium list.
        label: t("table.name", tableName),
        value,
        // Display-only: the <option> VALUE stays the English trait text (what
        // system.traits.<key> stores on save), only the visible label is
        // localized. So picking a Spanish option never bakes a Spanish string,
        // and `selected` still matches English↔English. (See i18n-content.js.)
        options: texts.map((text) => ({ value: text, display: t("table.result", text), selected: text === value })),
        // An off-table value (legacy free-typed) is preserved as its own option
        // so switching to a dropdown never silently drops it.
        customValue: value && !texts.includes(value) ? value : "",
        customDisplay: value && !texts.includes(value) ? t("table.result", value) : "",
      };
    });

    // Live constructed trait sentence + collapsible pick-lists (transient
    // sheet state; defaults collapsed so the sentence is the clean default view).
    context.traitSentence = this._buildTraitSentence(this.actor.system.traits, this.actor.system.age);
    context.traitsCollapsed = this._traitsCollapsed ?? true;

    // Scars pick-list from the same tables-2e pack. Neither Omen nor Scar is
    // generated: a player ticks the field's checkbox to enable it, then rolls
    // (Omen) or checks scars. Both are descriptive only.
    const tables2e = byPack["air-bladder.tables-2e"] ?? (await cachedPackDocuments("air-bladder.tables-2e"));
    const scarTable = tables2e.find((tbl) => tbl.name === "Scars");
    const selectedScars = this.actor.system.scars ?? [];
    context.scarOptions = scarTable
      ? scarTable.results.map((r) => ({
          name: resultText(r),
          description: r.flags?.["air-bladder"]?.description ?? "",
          selected: selectedScars.includes(resultText(r)),
        }))
      : [];
    context.scarDisplay = selectedScars.length ? selectedScars.join(", ") : null;
    context.scarsCollapsed = this._scarsCollapsed ?? false;

    // Background description (from the linked Item) + a friendly source label,
    // shown in the sheet header. "2e" -> "Cairn 2e".
    const bgUuid = this.actor.system.backgroundUuid;
    const bg = bgUuid ? await fromUuid(bgUuid) : null;
    context.backgroundDescription = bg?.system?.description
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          t("bg.desc", bg.system.description), { relativeTo: this.actor })
      : "";
    // Translated background name for the header (generated case). The editable
    // input for a hand-made character keeps the raw system.background so a Warden
    // never edits a translated string.
    context.backgroundName = t("bg.name", this.actor.system.background ?? "");
    context.contentSourceLabel = sourceLabel(this.actor.system.contentSource);

    // A generated background (either edition) is a linked document, so its name
    // is a header rather than a free-text field; a hand-made character keeps the
    // editable input.
    context.is2eBackground = this.actor.system.contentSource === "2e";
    context.isBarebonesBackground = this.actor.system.contentSource === "barebones";
    context.hasGeneratedBackground = !!this.actor.system.backgroundUuid;
    // A generated character's Notes tab also carries its bonds and background
    // questions, so the tab is titled for both; a hand-made one is just notes.
    context.showBackgroundNotesLabel = context.is2eBackground || context.isBarebonesBackground;
    // Scars and Age are never generated — a player fills each in by hand after
    // the fact — so they are NOT edition-specific and show on both. Only
    // character CREATION differs between 2e and Barebones (see CLAUDE.md).
    context.showScars = true;
    context.showAge = true;
    // Omen is the one exception, and it is a CONTENT question rather than a rule:
    // Barebones ships no omens table, so a Warden opts in to lending it 2e's, the
    // same way they can lend it 2e's bonds. Nothing about generation changes —
    // an omen is never rolled at creation in either edition.
    context.showOmen =
      this.actor.system.contentSource !== "barebones" ||
      game.settings.get(SETTINGS_NS, "show-omens-barebones");
    // Barebones-only flavour: the career that didn't work out. Grants nothing.
    // Read the setting live, so a Warden switching it off hides the line on an
    // already-generated character rather than only affecting the next one.
    context.failedCareer = this.actor.system.failedCareer ?? "";
    context.showFailedCareer =
      this.actor.system.contentSource === "barebones" &&
      game.settings.get(SETTINGS_NS, "barebones-failed-career");
    // The single keepsake item the failed career left (grantSource
    // "failed-career") — shown on its own line under the career, with a re-roll
    // dice. It also appears in the inventory tagged "Failed Career" + "Petty".
    context.failedCareerItem =
      this.actor.items.find((i) => i.getFlag("air-bladder", "grantSource") === "failed-career")?.name ?? "";

    // Random-generation mode (default on): gates the per-field dice rollers
    // (age, omen). Legacy characters lack the field -> default to enabled.
    context.generationEnabled = this.actor.system.generationEnabled !== false;

    // Notes tab: bonds (a character can hold several) + the background's
    // re-rollable questions. Questions are 2e; bonds are 2e by default but a
    // Warden can lend them to Barebones (show-bonds-barebones), so show the
    // section whenever the character actually has one.
    // Translate bond prose for display (bonds are drawn from the Bonds table →
    // table.result). A composed bond string that doesn't match a source key
    // falls back to English; the count/entitlement below is unaffected.
    context.bonds = this._effectiveBonds()
      .map((b) => ({ ...b, description: t("table.result", b.description) }));
    context.showBonds = context.is2eBackground || context.bonds.length > 0;
    // "Add a bond" shows only while below the background's entitlement (base 1,
    // plus a second for Fieldwarden / Outrider's debt option). A fresh character
    // starts AT its entitlement, so the link is normally hidden.
    context.canAddBond = context.bonds.length < (await this._bondEntitlement(bg));
    // Divider between the bonds/questions area and the free-form notes editor.
    context.showNotesDivider = context.showBonds;
    // Questions render from a translated copy (template iterates `questions`, not
    // system.questions): each prompt is a bg.question, each answer a background
    // option description (bg.optionDesc). Misses fall back to English.
    context.questions = (this.actor.system.questions ?? []).map((q) => ({
      ...q,
      question: t("bg.question", q.question ?? ""),
      answer: t("bg.optionDesc", q.answer ?? ""),
    }));

    // Attribute-loss statuses, ability tooltips, peril/low cues, critical skull.
    this._computeStatContext(context);
  }

  /**
   * Ability/HP peril + "low" cues, the STR-critical skull toggle, per-ability save
   * tooltips, and the attribute-loss status banners (Dead / STR Critical /
   * Paralyzed / Delirious / Overburdened). STR 0 = Dead, DEX 0 = Paralyzed,
   * WIL 0 = Delirious are automatic (derived); Critical Damage is a manual skull.
   * @private
   */
  _computeStatContext(context) {
    // An INANIMATE actor has no stat block, so it has no derived conditions
    // either -- and this is a correctness guard, not a cosmetic one. Every
    // condition below is derived from an ability being at or below zero
    // (`dead = STR <= 0`), which is exactly the state a crate or a loot pile
    // sits in permanently. Without this the sheet would announce that a barrel
    // is Dead, Paralyzed and Delirious, all three at once, and the red peril
    // cues would paint a stat block the template is not even drawing.
    //
    // Everything is still defined rather than left undefined: the template
    // reads these keys unconditionally in a few places, and a missing lookup in
    // Handlebars is silently empty, which would hide a future mistake here.
    if (this.actor.system.inanimate) {
      context.abilityPeril = {};
      context.abilityLow = {};
      context.hpLow = false;
      context.criticalToggle = {};
      context.criticalActive = {};
      context.abilityTips = {};
      context.statusBanners = [];
      return;
    }

    const ab = this.actor.system.abilities ?? {};
    const val = (k) => Number(ab[k]?.value);
    const max = (k) => Number(ab[k]?.max);
    const dead = val("STR") <= 0;
    const paralyzed = val("DEX") <= 0;
    const delirious = val("WIL") <= 0;
    // Legacy-safe: only a strict boolean true counts as the STR Critical Damage
    // flag. Death overrides it.
    const strCritical = this.actor.system.critical === true && !dead;

    context.abilityPeril = { STR: dead || strCritical, DEX: paralyzed, WIL: delirious };
    // "Low" = current below max but not in peril: amber "reduced" cue (peril's red
    // takes precedence). HP uses it too.
    context.abilityLow = {};
    for (const k of ["STR", "DEX", "WIL"]) context.abilityLow[k] = val(k) < max(k) && !context.abilityPeril[k];
    context.hpLow = Number(this.actor.system.hp?.value) < Number(this.actor.system.hp?.max);
    // Skull offered when STR is damaged and still alive, or already marked.
    context.criticalToggle = { STR: (val("STR") < max("STR") && val("STR") > 0) || strCritical };
    context.criticalActive = { STR: strCritical };

    const L = (k) => game.i18n.localize(k);
    context.abilityTips = { STR: L("CAIRN.StrTip"), DEX: L("CAIRN.DexTip"), WIL: L("CAIRN.WilTip") };

    const banners = [];
    if (dead) {
      banners.push({ key: "dead", icon: "fa-skull", label: L("CAIRN.Dead"), text: L("CAIRN.DeadBanner") });
    } else {
      if (strCritical)
        // One format key rather than "<status> — STR": the ability name is
        // itself localized (STR/FUE), and a translation may not want it last.
        banners.push({
          key: "critical",
          icon: "fa-heart-crack",
          label: game.i18n.format("CAIRN.CriticalDamageStatusFor", { key: L("STR") }),
          text: L("CAIRN.CriticalDamageBanner"),
        });
      if (paralyzed)
        banners.push({ key: "paralyzed", icon: "fa-lock", label: L("CAIRN.Paralyzed"), text: L("CAIRN.ParalyzedBanner") });
      if (delirious)
        banners.push({ key: "delirious", icon: "fa-brain", label: L("CAIRN.Delirious"), text: L("CAIRN.DeliriousBanner") });
    }
    // Encumbrance is a carry state, not an ability loss, but likewise forces HP
    // to 0, so surface it as a persistent banner too. Suppressed when dead.
    if (!dead && this.actor.system.encumbered)
      banners.push({ key: "encumbered", icon: "fa-weight-hanging", label: L("CAIRN.Overburdened"), text: L("CAIRN.OverburdenedBanner") });
    context.statusBanners = banners;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * Everything that is not a click: `change` handlers for the class-managed
   * fields, the two double-click affordances, and the editor click-away save.
   * Clicks are declared as `actions` in DEFAULT_OPTIONS and wired by
   * ApplicationV2 — the action system covers no other event type.
   * @override
   */
  /**
   * Listeners that belong to the FRAME, which is built once and survives every
   * re-render. Binding these in `_onRender` instead would stack a duplicate on
   * each redraw — and this sheet redraws on every committed keystroke, because
   * `submitOnChange` is on.
   * @override
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    bindEditorClickAwaySave(this.element);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;

    // The title-bar generation buttons live on the frame, which is built once —
    // so their state is re-applied here, on every render of the content.
    this.#syncGenerationButtons();

    // When drag-to-reorder is enabled, mark the sheet so item rows show a grab
    // cursor and the reorder hint appears.
    el.classList.toggle(
      "cairn-reorder-enabled",
      game.settings.get(SETTINGS_NS, "enable-inventory-reorder")
    );
    // When grant-source tags are on, mark the sheet so the footer hint under the
    // inventory explains the Background / Bond / Question chips. Character-only:
    // those chips are set at character generation, so no other actor type has them.
    el.classList.toggle(
      "cairn-grant-tags-enabled",
      game.settings.get(SETTINGS_NS, "show-grant-tags") && this.actor.type === "character"
    );

    if (!this.isEditable) return;

    const on = (selector, type, handler) =>
      el.querySelectorAll(selector).forEach((node) => node.addEventListener(type, handler));

    // Double-click to open an item's own sheet, on the same title that
    // single-clicks to expand its description.
    on(".cairn-item-title", "dblclick", (ev) => this._openItemSheet(ev.currentTarget));

    // Double-click the Items tab label to set this character's equipment limit,
    // when the Warden has enabled per-character limits.
    on("#set-equipment-limit", "dblclick", (ev) => this._onSetEquipmentLimit(ev));

    // Stat inputs (HP + abilities, current & max) are numeric and capped 0-18.
    on(".stat-input", "change", (ev) => {
      const input = ev.currentTarget;
      let n = Math.round(Number(input.value));
      if (!Number.isFinite(n)) n = 0;
      n = Math.min(18, Math.max(0, n));
      if (String(n) !== input.value) input.value = n;
    });

    // Armor is class-managed (no form name): the field shows the effective Armor
    // (derived from gear, or an override). Typing a 0-3 value stores an override
    // that supersedes the gear value; clearing it — or the reset icon — returns
    // to auto (system.armorOverride = null).
    on(".armor-input", "change", async (ev) => {
      const raw = ev.currentTarget.value.trim();
      if (raw === "") {
        await this.actor.update({ "system.armorOverride": null });
        return;
      }
      let n = Math.trunc(Number(raw));
      if (!Number.isFinite(n)) n = 0;
      n = Math.min(3, Math.max(0, n));
      await this.actor.update({ "system.armorOverride": n });
    });

    // Deprived / Panicked are class-managed (no form name): toggling ON asks for
    // confirmation that reiterates the condition's tooltip; declining reverts.
    // Toggling OFF (recovering) applies immediately.
    const condition = (selector, field, titleKey, tipKey, questionKey) =>
      on(selector, "change", async (ev) => {
        const desired = ev.currentTarget.checked;
        if (desired && !(await this._confirmAction(titleKey, tipKey, questionKey))) {
          this.render(false);
          return;
        }
        await this.actor.update({ [field]: desired });
      });
    condition(".deprived-check", "system.deprived", "CAIRN.Deprived", "CAIRN.DeprivedTip", "CAIRN.DeprivedConfirm");
    condition(".panicked-check", "system.panicked", "CAIRN.Panicked", "CAIRN.PanickedTip", "CAIRN.PanickedConfirm");

    // Enabling Omen reveals the field; disabling it clears the stored omen so the
    // field resets to the placeholder hint (not a hidden value).
    on(".omen-enable", "change", async (ev) => {
      const enabled = ev.currentTarget.checked;
      const data = { "system.omenEnabled": enabled };
      if (!enabled) data["system.omen"] = "";
      await this.actor.update(data);
    });

    // Enabling Scars reveals the checklist; disabling it clears every picked scar.
    on(".scar-enable", "change", async (ev) => {
      const enabled = ev.currentTarget.checked;
      const data = { "system.scarEnabled": enabled };
      if (!enabled) data["system.scars"] = [];
      await this.actor.update(data);
    });

    // Scars are a checkbox list: persist the set of checked names (including
    // empty). Managed here rather than via form serialization so unchecking the
    // last one reliably stores an empty array. render:false keeps scroll/state.
    on(".scar-check", "change", async () => {
      const scars = [...el.querySelectorAll(".scar-check:checked")].map((o) => o.value);
      await this.actor.update({ "system.scars": scars }, { render: false });
    });

    // Placeholder prompt in an empty editor. ProseMirror has no placeholder of
    // its own, and an "empty" document is `<p><br></p>`, so :empty never
    // matches — the state is carried on a data attribute instead and kept in
    // step as the player types.
    for (const editor of el.querySelectorAll("prose-mirror[data-placeholder]")) {
      // The prompt is drawn by `.editor-container::before`, one level down,
      // because <prose-mirror> starts at the top of the MENU BAR — anchoring it
      // there puts the hint on the toolbar. `attr()` only reads the element the
      // pseudo belongs to, so the text is handed down as a custom property,
      // which inherits and so is in place whenever ProseMirror gets round to
      // building that container (it is created on activation, not at render).
      editor.style.setProperty("--ab-placeholder", JSON.stringify(editor.dataset.placeholder));
      const sync = () => editor.classList.toggle(
        "cairn-editor-empty",
        !(editor.querySelector(".editor-content")?.textContent ?? "").trim()
      );
      sync();
      editor.addEventListener("input", sync);
      editor.addEventListener("change", sync);
    }
  }

  /* -------------------------------------------- */
  /*  Shared helpers                              */
  /* -------------------------------------------- */

  /** The inventory row a control sits in. */
  static #row(target) {
    return target.closest(".cairn-items-list-row");
  }

  /**
   * A yes/no confirmation whose body reiterates the action's tooltip, then asks
   * the question, so the player re-reads the rule before committing.
   * @param {String} titleKey  i18n key for the dialog title
   * @param {String} tipKey    i18n key for the explanatory text (may be HTML)
   * @param {String} questionKey  i18n key for the yes/no question
   * @returns {Promise<Boolean>}
   * @private
   */
  async _confirmAction(titleKey, tipKey, questionKey) {
    const k = (key) => this._wording(key);
    return foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(titleKey) },
      content: `<div class="cairn-confirm">${game.i18n.localize(k(tipKey))}<p class="cairn-confirm-q">${game.i18n.localize(k(questionKey))}</p></div>`,
      rejectClose: false,
      modal: true,
    });
  }

  /**
   * Prefer the NPC wording of a string when this sheet is a non-player actor.
   *
   * Rest, Restore, Deprived and Panicked are shared with the character sheet, and
   * their prompts were written for a player: "Is your character deprived?", and a
   * Deprived rule that says "A PC that lacks a crucial need". Asked of a wolf or a
   * hired blacksmith that reads as a bug.
   *
   * Resolved by key EXISTENCE rather than a lookup table, so a string only diverges
   * where the wording genuinely differs -- `CAIRN.PanickedTip` and `CAIRN.RestTip`
   * already say "character" and "the party", and duplicating them under a second key
   * would just be two strings for a translator to keep in step (and would trip
   * `i18n:check`'s equal-to-English report).
   *
   * **`has(npcKey, false)`, not `has(npcKey)`.** The default is `fallback: true`,
   * which consults `_fallback` — the English strings — as well as the active
   * language (client/helpers/localization.mjs:390-396). Since every `…Npc` variant
   * exists in en.json, the test was unconditionally true in EVERY language, and the
   * NPC sheet served the English variant in place of a base key the translator had
   * already done. Not a missing translation: a working one, discarded.
   *
   * It was a regression, not a pre-existing gap. Before the Hireling→NPC fold the
   * hireling sheet used the base keys, so those strings rendered in Spanish in
   * 0.1.7 and in English afterwards. And because only SOME variants exist —
   * `RestTipNpc` and `PanickedTipNpc` do not — a dialog came out half-translated:
   * the tip in Spanish, the question beneath it in English.
   *
   * With `fallback: false` the rule reads the way the name does: use the NPC wording
   * when THIS language has it, otherwise the translated base string, and English
   * only when the language has neither. A translator adding `…Npc` keys turns the
   * NPC wording on for their language with no code change.
   * @param {String} key
   * @returns {String} the same key, or its `…Npc` variant
   * @private
   */
  _wording(key) {
    if (this.actor.type === "character") return key;
    const npcKey = `${key}Npc`;
    return game.i18n.has(npcKey, false) ? npcKey : key;
  }

  /** Open the own sheet of the item (or owned container) a row represents. */
  _openItemSheet(target) {
    const row = CairnActorSheet.#row(target);
    if (!row) return;
    if (row.dataset.isContainer) {
      this.actor.getOwnedContainer(row.dataset.itemId)?.sheet.render(true);
      return;
    }
    const item = this.actor.getOwnedItem(row.dataset.itemId);
    if (!item || item.name === FATIGUE_NAME) return;
    item.sheet.render(true);
  }

  /**
   * Expand or collapse a row's description panel. `build` returns the panel
   * element for the closed→open direction; nothing else differs between an item,
   * a container and a feature.
   * @private
   */
  _toggleRowDescription(row, build) {
    if (row.classList.contains("expanded")) {
      const summary = row.querySelector(":scope > .item-description");
      if (summary) slideUp(summary, () => summary.remove());
    } else {
      const panel = build();
      if (!panel) return;
      row.append(panel);
      slideDown(panel);
    }
    row.classList.toggle("expanded");
  }

  /**
   * The actor's bonds as an array, copied so callers can splice it freely.
   *
   * This used to fold a legacy singular `system.bond` into a one-element list.
   * That shim went with the data-model move: `bond`/`bondGold` were never
   * declared as schema fields, no world was ever built on the version that wrote
   * them, and a strict schema drops them anyway.
   * @returns {{id: String, description: String, gold: Number}[]}
   * @private
   */
  _effectiveBonds() {
    return foundry.utils.duplicate(this.actor.system.bonds ?? []);
  }

  /**
   * How many bonds this character may hold: the base one, plus any the background
   * grants -- Fieldwarden's description and Outrider's "Always pay your debts"
   * answer each carry "roll a second time on the Bonds table". Mirrors the
   * generator's bond count so the sheet and generation agree.
   * @param {CairnItem} [bg] the background item, if already fetched (else looked up)
   * @returns {Promise<Number>}
   * @private
   */
  async _bondEntitlement(bg = undefined) {
    if (bg === undefined) {
      bg = this.actor.system.backgroundUuid ? await fromUuid(this.actor.system.backgroundUuid) : null;
    }
    // Barebones gets exactly one bond, and only when the Warden lends it 2e's
    // Bonds table — it has no second-bond options of its own.
    if (this.actor.system.contentSource === "barebones") {
      return game.settings.get(SETTINGS_NS, "show-bonds-barebones") ? 1 : 0;
    }
    // The authoring checkbox OR the prose sentence — one extra either way, never two
    // (generate2eCharacter counts it the same way).
    const bgSecond =
      bg?.system?.secondBond || (bg?.system?.description && mentionsSecondBond(bg.system.description)) ? 1 : 0;
    const qSecond = (this.actor.system.questions ?? []).filter((q) => mentionsSecondBond(q.answer ?? "")).length;
    return 1 + bgSecond + qSecond;
  }

  /**
   * A background dropped on a sheet: swap to it, after asking.
   *
   * Only a character HAS a background — `NpcData` carries no `background` or
   * `backgroundUuid` — so any other actor type says so rather than silently doing
   * nothing or, as before, pocketing the document as gear.
   *
   * A background of the OTHER edition is refused the same way. "A character does not
   * change edition" is the rule the picker already follows (#onPickBackground only ever
   * offers this character's own source), and the drop was the one way around it.
   * Refusing is also the only correct answer to what it actually did when measured: a
   * Barebones character keeps its generated Rations/Torch/weapon/armor — none of which
   * the 2e background knows to remove — so it ended up carrying BOTH loadouts, with
   * duplicates.
   *
   * Confirmed because it is destructive and a drop is easy to do by accident:
   * `changeBackground` deletes everything the old background granted (its starting
   * gear, its rolled answers' items and containers) and re-rolls the new one's. The
   * prompt names the background, since the likeliest mistake is dropping the wrong one.
   * Bonds and the portrait survive — that is `changeBackground`'s contract, shared with
   * the picker.
   * @param {CairnItem} bg
   * @returns {Promise<null>} never an item: nothing is added to the inventory
   */
  async _onDropBackground(bg) {
    if (!this.isEditable) return null;
    if (this.actor.type !== "character") {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.BackgroundNotCharacter"));
      return null;
    }
    const bgSource = bg.system?.source || "2e";
    const mySource = this.actor.system.contentSource || "2e";
    if (bgSource !== mySource) {
      // Named for what they CARRY, not for where they came from: both are edition
      // labels, and a translator reading en.json alone could only guess that from
      // `{background}` / `{character}`, which read like a background and a
      // character name.
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.BackgroundWrongSource", {
        backgroundEdition: sourceLabel(bgSource),
        characterEdition: sourceLabel(mySource),
      }));
      return null;
    }
    if (!this._mayChangeBackground()) return null;
    // Through the content overlay, like every other background-name surface: the
    // sheet header (_prepareContext), the picker and the failed-career list all
    // show `t("bg.name", …)`, so naming the raw English here would ask a Spanish
    // Warden about "Aeronaut" the moment after their own sheet called it
    // "Aeronauta". Latent while lang/content/es.json is empty — and this is the one
    // call site that would NOT come along when the content phase lands.
    //
    // Escaped because the result is interpolated into HTML. `bg.name` is a stored
    // document field, and a world Item is creatable by any player a Warden has
    // granted Create Item to — the same player→GM path as the feature-description
    // XSS, and this dialog renders in the GM's client.
    const bgName = foundry.utils.escapeHTML(t("bg.name", bg.name));
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CAIRN.ChangeBackgroundTitle") },
      content:
        `<div class="cairn-confirm">${game.i18n.localize("CAIRN.ChangeBackgroundTip")}` +
        `<p class="cairn-confirm-q">${game.i18n.format("CAIRN.ChangeBackgroundQ", { name: bgName })}</p></div>`,
      rejectClose: false,
      modal: true,
    });
    if (!ok) return null;
    await changeBackground(this.actor, bg);
    return null;
  }

  /**
   * May this user swap this character's background at all? Ask BEFORE offering the
   * swap, not after.
   *
   * `changeBackground` already refuses when the answer is no, and warns — but it
   * refuses at the very top, after the UI has already asked. So a player in a
   * containers-on world was shown "change this character's background to X? this
   * deletes its granted gear", answered yes, and got a warning and no change. A
   * destructive question that cannot be honoured is worse than a plain refusal: it
   * tells the player the swap is theirs to make, and then takes it back.
   *
   * The refusal itself is correct and is not the bug — containers are Actors and
   * Foundry gates Actor deletion on ASSISTANT, so no player can regenerate them
   * (see `canRegenerateContainers`). Note how blunt that guard is: with the
   * Containers tab ON it refuses for EVERY non-GM, whatever the character is
   * carrying, because a fresh roll might mint one. So this is not rare — it is
   * every player in such a world, every time.
   *
   * Both places the sheet offers the swap call this first: the drop, above, and the
   * magnifier's picker, which otherwise let a player browse the whole background
   * list before refusing the one they chose. `#onRollBackground` deliberately does
   * NOT — it asks nothing, so `changeBackground`'s own guard is the first and only
   * refusal, and a second copy here would be dead code that reads as protection.
   * The warning key is passed explicitly. `canRegenerateContainers` was written for
   * the REGENERATE path and its default sentence ends "ask them to re-roll it for
   * you" — which, on a background swap, tells a player to request an operation that
   * would discard their abilities, HP and traits when all they did was try to change
   * a background. Same refusal, different thing being refused, so a different
   * sentence.
   * @returns {Boolean} false, having already warned, if the swap would be refused
   */
  _mayChangeBackground() {
    return canRegenerateContainers(this.actor, null, "CAIRN.Notify.NoContainerBackground");
  }

  /**
   * The bonds table this character's background names, or "" for the shipped 2e one.
   * Re-rolling and adding a bond must draw from the SAME table generation used, or a
   * custom background's bonds silently become 2e bonds the first time a player uses
   * the d20 beside one.
   * @returns {Promise<String>}
   */
  async _bondsTableName() {
    const uuid = this.actor.system.backgroundUuid;
    const bg = uuid ? await fromUuid(uuid) : null;
    return bg?.system?.bondsTable ?? "";
  }

  /**
   * Delete the actor's items previously granted by `source` and create the new
   * ones in their place, so re-rolling a bond/question keeps the inventory tab in
   * sync. render:false -- the pending actor.update re-renders once.
   * @param {String} source  e.g. "bond:ab12" or "question:1"
   * @param {Object[]} newItems  resolved + withGrantSource() item data
   * @private
   */
  async _replaceGrantedItems(source, newItems) {
    const oldIds = this.actor.items
      .filter((i) => i.getFlag("air-bladder", "grantSource") === source)
      .map((i) => i.id);
    if (oldIds.length) {
      await this.actor.deleteEmbeddedDocuments("Item", oldIds, { render: false });
    }
    if (newItems.length) {
      await this.actor.createEmbeddedDocuments("Item", newItems, { render: false });
    }
  }

  /** Replace the character's single failed-career keepsake with a fresh random
   *  pick from `careerName`'s gear (or clear it when the career has none). The
   *  item is Petty, so it never affects slots or fatigue. */
  async _grantFailedCareerItem(careerName) {
    // Guard against overlapping re-rolls: each does an async delete+create, so a
    // second click mid-flight would try to delete an item the first already removed.
    if (this._grantingFailedCareerItem) return;
    this._grantingFailedCareerItem = true;
    try {
      const item = careerName ? await buildFailedCareerItem(careerName) : null;
      await this._replaceGrantedItems("failed-career", item ? [item] : []);
      // _replaceGrantedItems renders nothing (render:false, so a trailing update can
      // re-render once); the bond/question re-rolls have that trailing update, this
      // path does not — so refresh the sheet explicitly or the line looks dead.
      this.render(false);
    } finally {
      this._grantingFailedCareerItem = false;
    }
  }

  /**
   * Build the live "You have a ... Physique, ..." sentence from the current trait
   * values + age, so it always reflects the dropdowns. Empty traits are skipped.
   * @param {Object} traits
   * @param {String} age
   * @returns {String}
   * @private
   */
  _buildTraitSentence(traits = {}, age = "") {
    // i18n-driven so the whole sentence localizes: each clause/conjunction is a
    // CAIRN.Bio.* key (English defaults reproduce the original wording exactly),
    // and each trait VALUE goes through the content overlay (table.result), so a
    // Spanish world reads coherent Spanish once both the UI keys and the trait
    // tables are translated. Age is a number and is never overlaid.
    const F = (k, data) => game.i18n.format(k, data);
    const val = (key) => {
      const raw = String(traits?.[key] ?? "").trim();
      return raw ? t("table.result", raw) : "";
    };
    const sep = game.i18n.localize("CAIRN.Bio.ListSep");
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const andList = (arr) =>
      arr.length <= 1 ? (arr[0] ?? "")
      : arr.length === 2 ? F("CAIRN.Bio.ListTwo", { first: arr[0], second: arr[1] })
      : F("CAIRN.Bio.ListMore", { init: arr.slice(0, -1).join(sep), last: arr[arr.length - 1] });

    const parts = [];
    const physical = [
      val("physique") && F("CAIRN.Bio.Physique", { value: val("physique") }),
      val("skin") && F("CAIRN.Bio.Skin", { value: val("skin") }),
      val("hair") && F("CAIRN.Bio.Hair", { value: val("hair") }),
    ].filter(Boolean);
    if (physical.length) parts.push(F("CAIRN.Bio.Physical", { list: andList(physical) }));

    const faceSpeech = [
      val("face") && F("CAIRN.Bio.Face", { value: val("face") }),
      val("speech") && F("CAIRN.Bio.Speech", { value: val("speech") }),
    ].filter(Boolean);
    // Capitalize the assembled sentence, not a fragment, so it works in any language.
    if (faceSpeech.length) parts.push(cap(F("CAIRN.Bio.FaceSpeech", { list: faceSpeech.join(sep) })));

    if (val("clothing")) parts.push(F("CAIRN.Bio.Clothing", { value: val("clothing") }));

    const viceVirtue = [val("vice"), val("virtue")].filter(Boolean);
    if (viceVirtue.length) parts.push(F("CAIRN.Bio.ViceVirtue", { list: andList(viceVirtue) }));

    const ageStr = String(age ?? "").trim();
    if (ageStr) parts.push(F("CAIRN.Bio.Age", { value: ageStr }));

    return parts.join(" ");
  }

  /**
   * Set the actor portrait and its token together. The token is the shipped
   * prepped art paired with the portrait by filename; for a custom image with no
   * paired token, the portrait itself is used so the token is never left stale.
   * @private
   */
  async _setPortrait(img) {
    const tokenSrc = (await pairedTokenFor(img)) ?? img;
    await this.actor.update({ img, "prototypeToken.texture.src": tokenSrc });
    for (const token of this.actor.getActiveTokens()) {
      await token.document.update({ "texture.src": tokenSrc });
    }
  }

  /**
   * Set a container's art and its token together. Unlike a character portrait
   * there is no paired token file -- the same image serves both.
   * @private
   */
  /**
   * Re-art a container, and record WHAT IT IS while we are at it.
   *
   * Picking from the gallery is not really picking a picture — it is saying "this
   * is a barrel". The class key drives three things through one field: the art,
   * the one-word label on the sheet, and the default capacity. Setting only the
   * image would leave a thing that looks like a barrel and calls itself a chest,
   * which is the exact drift `containerClass` was added to stop.
   *
   * `cls` is absent when the art came from the FilePicker — a Warden's own image
   * is not any of our classes, so the stored class is cleared and the label falls
   * back to inferring from the name.
   *
   * Capacity is only filled in when it is still 0 (i.e. "use the world setting",
   * never touched). A Warden who typed 12 into a crate meant 12, and choosing a
   * different picture is not a request to lose it.
   * @param {String} img
   * @param {String} [cls] a key of CONTAINER_CLASSES
   */
  async _setContainerArt(img, cls) {
    const patch = { img, "prototypeToken.texture.src": img };
    if (cls !== undefined) patch["system.containerClass"] = cls;
    if (cls && !Number(this.actor.system.slots)) {
      const dflt = containerClassSlots(cls);
      if (dflt) patch["system.slots"] = dflt;
    }
    await this.actor.update(patch);
    for (const token of this.actor.getActiveTokens()) {
      await token.document.update({ "texture.src": img });
    }
  }

  /* -------------------------------------------- */
  /*  Actions — header                            */
  /* -------------------------------------------- */

  /**
   * Roll the whole actor again. BOTH branches ask first.
   *
   * The NPC branch used to re-roll on a single click, on the reasoning that "a
   * hireling's statblock is disposable by design". That was written when only
   * `hireling` reached it. Folding hireling into npc silently widened it to the
   * whole bestiary: all 205 shipped monsters are `type: npc`, none of them declares
   * `generationEnabled` (so it defaults true, data-models.js:208) and
   * `show-generate-header` defaults true — so the button renders on every monster
   * for anyone who owns it, and `regenerateHireling` deletes every embedded Item
   * and overwrites the statblock. One click turned a shipped Gorilla into an
   * Alchemist (observed 2026-07-30: `Fists*` → six pieces of gear, STR 14→8, HP
   * 4→2), with no dialog and no undo.
   *
   * The confirmation is NOT worded via `_wording()`: that helper picks a `…Npc`
   * variant whenever `game.i18n.has()` is true, and `has()` consults the English
   * fallback, so a variant key silently un-translates a string every language
   * already has. These are new keys with no base-key twin, so they carry no such
   * risk.
   * @this {CairnActorSheet}
   */
  static async #onRollActor(event) {
    event.preventDefault();
    const isNpc = ["hireling", "npc"].includes(this.actor.type);
    // DialogV2.confirm already makes "No" the default button, so V1's
    // defaultYes: false has no equivalent to carry over.
    const confirm = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: game.i18n.localize(isNpc ? "CAIRN.NpcRegeneratorTitle" : "CAIRN.CharacterRegeneratorTitle"),
      },
      content: `<p>${game.i18n.localize(isNpc ? "CAIRN.NpcRegeneratorConfirm" : "CAIRN.CharacterRegeneratorConfirm")}</p>`,
      rejectClose: false,
    });
    if (!confirm) return;
    if (isNpc) await regenerateHireling(this.actor);
    else await regenerateActor(this.actor);
  }

  /**
   * Flip random-generation mode for this actor. Under AppV1 this had to rewrite
   * the header's innerHTML by hand; ApplicationV2 rebuilds the control menu from
   * _getHeaderControls every time it opens, so a re-render is all it takes.
   * @this {CairnActorSheet}
   */
  static async #onToggleGeneration(event) {
    event.preventDefault();
    await this.actor.update({ "system.generationEnabled": this.actor.system.generationEnabled === false });
  }

  /* -------------------------------------------- */
  /*  Actions — portrait and name                 */
  /* -------------------------------------------- */

  /**
   * Click the portrait to pick a new one. A container gets the transport/container
   * art gallery instead of the character portrait gallery -- different art, and no
   * paired token file. Every other type, NPCs included, gets the character portrait
   * gallery: an NPC is as much a face at the table as a PC is.
   * @this {CairnActorSheet}
   */
  static async #onEditPortrait(event) {
    // An INANIMATE npc is a container in every sense that matters here, so it
    // gets the container gallery rather than 80 human portraits. Routing on the
    // type alone stopped being right the moment a crate became an npc document.
    const isContainerish = this.actor.type === "container" || this.actor.system.inanimate === true;
    return isContainerish
      ? this._pickContainerArt(event)
      : this._pickPortrait(event);
  }

  /**
   * Dice on the portrait: roll a random one from the effective pool, avoiding the
   * current so it always changes. The pool matches auto-assignment — the GM's
   * custom portraits when they have any, else the shipped Aspeheim art. Reuses
   * _setPortrait so the paired token swaps too (custom portraits are their own).
   * @this {CairnActorSheet}
   */
  static async #onRollPortrait(event) {
    event.preventDefault();
    event.stopPropagation();
    const custom = getCustomPortraitPaths();
    let all;
    if (custom.length) {
      all = custom;
    } else {
      const manifest = await getPortraitManifest();
      const names = manifest?.names ?? [];
      if (!names.length) return;
      const dir = manifest.portraitDir ?? "systems/air-bladder/character_portraits";
      all = names.map((n) => `${dir}/${n}`);
    }
    const pool = all.filter((src) => src !== this.actor.img);
    const choices = pool.length ? pool : all;
    await this._setPortrait(choices[Math.floor(Math.random() * choices.length)]);
  }

  /**
   * Dice beside the name. Both sheets carry one, but they draw from different
   * sources -- a hireling's name comes from its own spark table, a character's
   * from the background's example names.
   *
   * 2e names come from the CURRENT background's example-name list (so the name
   * still suits the background after it has been changed); Barebones falls back
   * to its spark table. Active tokens are renamed too, as regeneration does,
   * so a token on the canvas never keeps the discarded name.
   * @this {CairnActorSheet}
   */
  static async #onRollName(event) {
    event.preventDefault();
    if (["hireling", "npc"].includes(this.actor.type)) {
      await rerollHirelingName(this.actor);
      return;
    }
    let name = null;
    if (this.actor.system.contentSource === "2e" && this.actor.system.backgroundUuid) {
      const bg = await fromUuid(this.actor.system.backgroundUuid);
      const names = bg?.system?.names ?? [];
      if (names.length) name = names[Math.floor(Math.random() * names.length)];
    }
    if (!name) {
      name = await rollNameFromTable(CONFIG.Cairn?.barebonesGenerator?.name, this.actor.name);
    }
    if (!name || name === this.actor.name) return;
    await this.actor.update({ name });
    for (const token of this.actor.getActiveTokens()) {
      await token.document.update({ name });
    }
  }

  /**
   * Profession-only die: swap to a different example hireling and adopt its whole
   * canonical statblock (a 2e hireling's stats ARE its profession). Keeps the
   * name, portrait, notes and any GM-added gear.
   * @this {CairnActorSheet}
   */
  static async #onRollProfession(event) {
    event.preventDefault();
    await rerollHirelingProfession(this.actor);
  }

  /* -------------------------------------------- */
  /*  Actions — inventory                         */
  /* -------------------------------------------- */

  /**
   * Handle creating a new Owned Item for the actor.
   * @this {CairnActorSheet}
   */
  static async #onItemCreate(event) {
    event.preventDefault();
    const template = "systems/air-bladder/templates/dialog/add-item-dialog.html";
    const content = await foundry.applications.handlebars.renderTemplate(template);

    await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("CAIRN.CreateItem") },
      content,
      ok: {
        icon: "fas fa-check",
        label: game.i18n.localize("CAIRN.CreateItem"),
        // DialogV2 hands the callback the clicked BUTTON; button.form is the
        // dialog's own form, which is why the content template must not carry
        // one of its own.
        callback: async (dialogEvent, button) => {
          const form = button.form;
          if (form.itemname.value.trim() !== "") {
            await this.actor.createOwnedItem({
              name: form.itemname.value,
              type: form.itemtype.value,
              weightless: form.itempetty.checked,
            });
          }
        },
      },
      rejectClose: false,
    });
  }

  /**
   * Open the marketplace (buy/take gear). On a container it is scoped to gear
   * only -- no buying a transport into a transport -- and acquisition is strict
   * there: a container refuses anything that will not fit.
   * @this {CairnActorSheet}
   */
  static #onItemShop(event) {
    event.preventDefault();
    if (this.actor.type === "container") openMarketplace(this.actor, { exclude: TRANSPORTS_CATEGORY });
    else openMarketplace(this.actor);
  }

  /** @this {CairnActorSheet} */
  static #onItemEdit(event, target) {
    event.preventDefault();
    this._openItemSheet(target);
  }

  /** @this {CairnActorSheet} */
  static #onItemDelete(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    if (!row) return;
    if (row.dataset.isContainer) {
      // No optimistic slide for a connected ACTOR: the confirm can be declined
      // and the server can refuse (Actor delete is Assistant+, ungrantable), and
      // sliding first showed the player a delete that never happened before the
      // re-render put the row back (review #5). On success, the delete's own
      // _onDeleteOperation re-renders this sheet and the row goes with it.
      this.actor.deleteOwnedContainer(row.dataset.itemId);
    } else {
      this.actor.deleteOwnedItem(row.dataset.itemId);
      slideUp(row, () => this.render(false));
    }
  }

  /**
   * Unlink a connected actor: it survives, connected to nobody, which under the
   * container rule IS a loot pile. Sits beside the trash rather than replacing
   * it, because "destroy this cart" and "drop this cart here" are different
   * intentions and the tab used to offer only one icon for both — one that
   * asked "Delete X?" and then unlinked.
   * @this {CairnActorSheet}
   */
  static #onContainerUnlink(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    if (!row?.dataset.isContainer) return;
    // Not slid up: unlinking leaves the actor in the world, and the row simply
    // stops matching on the next render. Animating it away would suggest the
    // thing itself had gone.
    this.actor.unlinkOwnedContainer(row.dataset.itemId).then(() => this.render(false));
  }

  /** @this {CairnActorSheet} */
  static async #onItemToggleEquipped(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    const item = this.actor.getOwnedItem(row?.dataset.itemId);
    if (item) await item.update({ "system.equipped": !item.system.equipped });
  }

  /** Not exactly quantity, this is about uses. @this {CairnActorSheet} */
  static async #onItemAddUse(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    const item = this.actor.getOwnedItem(row?.dataset.itemId);
    if (!item) return;
    await item.update({
      "system.uses.value": Math.min(item.system.uses.value + 1, item.system.uses.max),
    });
  }

  /** @this {CairnActorSheet} */
  static async #onItemRemoveUse(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    const item = this.actor.getOwnedItem(row?.dataset.itemId);
    if (!item) return;
    let val = Math.max(item.system.uses.value - 1, 0);
    if (val === 0 && item.system.quantity > 1) {
      await item.update({ "system.quantity": item.system.quantity - 1 });
      val = item.system.uses.max;
    }
    await item.update({ "system.uses.value": val });
  }

  /**
   * Expand a row to show what it holds: a container's contents, or an item's
   * description plus its critical-damage line.
   * @this {CairnActorSheet}
   */
  static #onItemDescription(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    if (!row) return;
    if (row.dataset.isContainer) {
      this._toggleRowDescription(row, () => {
        const container = game.actors.find((a) => a.uuid === row.dataset.itemId);
        if (!container) return null;
        // Built with textContent so a container's item names can't inject
        // HTML/script into the keeper's (or GM's) sheet when the row is expanded.
        const div = document.createElement("div");
        div.className = "item-description";
        div.textContent = container.items.map((it) => it.name).join(", ");
        return div;
      });
      return;
    }
    this._toggleRowDescription(row, () => {
      const item = this.actor.items.get(row.dataset.itemId);
      if (!item) return null;
      const crit = cleanDescription(item.system.criticalDamage) !== ""
        ? `<div><i class="fa-regular fa-skull"></i> <i>${cleanDescription(item.system.criticalDamage)}</i></div>`
        : "";
      const div = document.createElement("div");
      div.className = "item-description";
      div.innerHTML = `${cleanDescription(item.system.description)}${crit}`;
      return div;
    });
  }

  /** @this {CairnActorSheet} */
  static async #onAddFatigue(event) {
    event.preventDefault();
    if (this.actor.isEncumbered()) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MaxSlotsOccupied"));
      return;
    }
    await this.actor.createOwnedItem({ name: FATIGUE_NAME, type: "item" });
  }

  /** @this {CairnActorSheet} */
  static #onRemoveFatigue(event) {
    event.preventDefault();
    const fatigue = this.actor.items.find((i) => i.name === FATIGUE_NAME);
    if (fatigue) this.actor.deleteOwnedItem(fatigue.id);
  }

  /**
   * Roll a weapon's damage, honouring panic (a panicked character rolls d4
   * regardless of the weapon) and any targeted tokens.
   * @this {CairnActorSheet}
   */
  static async #onRollDamage(event, target) {
    event.preventDefault();
    const dataset = target.dataset;
    if (!dataset.roll) return;

    const usePanic = game.settings.get(SETTINGS_NS, "use-panic");
    let formula = dataset.roll;
    let panicLabel = "";
    if (usePanic && this.actor.system.panicked) {
      formula = "1d4"; // panicked character
      panicLabel = "(" + game.i18n.localize("CAIRN.RollingWithPanic") + ")";
    }

    const roll = await evaluateFormula(formula, this.actor.getRollData());
    const label = dataset.label
      ? game.i18n.localize("CAIRN.RollingDmgWith") + ` ${dataset.label} ` + panicLabel
      : "";

    const targetedTokens = Array.from(game.user.targets).map((tk) => tk.id);
    const targetIds = targetedTokens.length ? targetedTokens.join(";") : null;

    const flavor = await foundry.applications.handlebars.renderTemplate(
      "systems/air-bladder/templates/chat/dmg-roll-card.html",
      { label, targets: targetIds }
    );
    roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor });
  }

  /* -------------------------------------------- */
  /*  Actions — containers                        */
  /* -------------------------------------------- */

  /**
   * Add a container from the catalog (a pack, mount, or vehicle). Same shop, same
   * buy/take path as the Items-tab market, scoped to Transports & Containers --
   * so a bought/taken transport lands right back in this tab.
   * @this {CairnActorSheet}
   */
  static #onContainerShop(event) {
    event.preventDefault();
    openMarketplace(this.actor, { only: TRANSPORTS_CATEGORY, titleKey: "CAIRN.TransportMarketTitle" });
  }

  /**
   * Homebrew escape hatch: create a bespoke container by hand (name + slots).
   * Demoted below the catalog path -- most containers should come from the shop.
   * @this {CairnActorSheet}
   */
  static async #onContainerCreate(event) {
    event.preventDefault();
    if (!game.user.hasPermission("ACTOR_CREATE")) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoActorCreate"));
      return;
    }
    // No nesting: the Connected tab (and this button) renders on an npc
    // container's own sheet too — refuse BEFORE the dialog, not after the
    // Warden has filled it in.
    if (!this.actor.canKeepConnected) {
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.NoNesting", { name: this.actor.name }));
      return;
    }
    const template = "systems/air-bladder/templates/dialog/add-container-dialog.html";
    // The class list comes from CONTAINER_CLASSES itself, so a class added there
    // appears here without a second list to keep in step. `mule` and `donkey`
    // share art but are different words, and both are offered — the label is what
    // the sheet will show.
    const classes = Object.entries(CONTAINER_CLASSES).map(([key, v]) => ({ key, label: v.label }));
    const content = await foundry.applications.handlebars.renderTemplate(template, { classes });

    await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("CAIRN.CreateContainer") },
      content,
      ok: {
        icon: "fas fa-check",
        label: game.i18n.localize("CAIRN.CreateContainer"),
        callback: async (dialogEvent, button) => {
          const form = button.form;
          if (form.itemname.value.trim() !== "") {
            // An NPC, not a legacy `container` — this button was the last
            // module-side path still minting the dissolved type (review #5).
            // The class the Warden picked (or, blank, the one the name infers)
            // decides animacy off CONTAINER_CLASSES itself: a hand-made Mule is
            // a creature with the schema's default stat block, a hand-made
            // Barrel is a thing and gets 0/0 explicitly — the same phantom-6
            // rule mounts.mjs and acquireTransport follow.
            //
            // No `img` here on purpose: CairnActor._preCreate names the art from
            // the container's own name (a "Barrel" gets barrel art), so hardcoding
            // the chest icon would defeat it. getDocumentClass, not the global
            // `Actor` — the global is not CONFIG.Actor.documentClass.
            //
            // The result is deliberately not checked: a third-party
            // `preCreateActor` veto resolves undefined and says nothing — and
            // explaining its own veto is the vetoing module's job, not ours.
            // (The realistic refusal, a player without ACTOR_CREATE, is caught
            // above with a message.)
            const cls = form.itemclass?.value ?? "";
            const animate = containerClassAnimate(cls || containerClass(form.itemname.value));
            await getDocumentClass("Actor").create({
              type: "npc",
              name: form.itemname.value,
              system: {
                slots: Number(form.itemslots.value) || 0,
                // Blank means "read the name", which is what this dialog always did.
                containerClass: cls,
                inanimate: !animate,
                // Connected at CREATION — no window in which it exists as a
                // free-standing loot pile between two awaits, and no second
                // write for a permission wall to break in half.
                connectedTo: this.actor.uuid,
                generationEnabled: false,
                ...(animate ? {} : { hp: { value: 0, max: 0 } }),
              },
            });
          }
        },
      },
      rejectClose: false,
    });
  }

  /* -------------------------------------------- */
  /*  Actions — features                          */
  /* -------------------------------------------- */

  /** @this {CairnActorSheet} */
  static async #onFeatureCreate(event) {
    event.preventDefault();
    const template = "systems/air-bladder/templates/dialog/add-feature-dialog.html";
    const content = await foundry.applications.handlebars.renderTemplate(template);

    await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("CAIRN.CreateFeature") },
      position: { width: 500 },
      content,
      ok: {
        icon: "fas fa-check",
        label: game.i18n.localize("CAIRN.CreateFeature"),
        callback: async (dialogEvent, button) => {
          const form = button.form;
          if (form.itemname.value.trim() !== "") {
            const data = { name: form.itemname.value, description: form.itemdesc.value };
            FEATURE_FLAGS.forEach((c) => { data[c] = form[c].checked; });
            await this.actor.createOwnedFeature(data);
          }
        },
      },
      rejectClose: false,
    });
  }

  /** @this {CairnActorSheet} */
  static async #onFeatureEdit(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    const item = this.actor.getOwnedFeature(row?.dataset.itemId);
    if (!item) return;

    const template = "systems/air-bladder/templates/dialog/add-feature-dialog.html";
    const content = await foundry.applications.handlebars.renderTemplate(template, item);

    await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("CAIRN.EditFeature") },
      position: { width: 500 },
      content,
      ok: {
        icon: "fas fa-check",
        label: game.i18n.localize("CAIRN.UpdateFeature"),
        callback: async (dialogEvent, button) => {
          const form = button.form;
          if (form.itemname.value.trim() !== "") {
            // Copy, never mutate `item`. `system.features` is an ArrayField of
            // ObjectField, and an ObjectField hands back the SOURCE object by
            // reference — so assigning to `item` edited the actor's stored data
            // in place, before (and regardless of) the update. A rejected or
            // refused update then left the sheet showing values the document did
            // not have, until something re-read it from source.
            const newItem = { ...item, name: form.itemname.value, description: form.itemdesc.value };
            FEATURE_FLAGS.forEach((c) => { newItem[c] = form[c].checked; });
            // Replace in place rather than filter+push, so editing a feature does
            // not silently move it to the bottom of the list.
            const features = this.actor.system.features.map((f) => (f.id === newItem.id ? newItem : f));
            await this.actor.update({ "system.features": features });
          }
        },
      },
      rejectClose: false,
    });
  }

  /** @this {CairnActorSheet} */
  static #onFeatureDelete(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    if (!row) return;
    this.actor.deleteOwnedFeature(row.dataset.itemId);
    slideUp(row, () => this.render(false));
  }

  /** @this {CairnActorSheet} */
  static #onFeatureDescription(event, target) {
    event.preventDefault();
    const row = CairnActorSheet.#row(target);
    if (!row) return;
    this._toggleRowDescription(row, () => {
      const feature = this.actor.getOwnedFeature(row.dataset.itemId);
      if (!feature) return null;
      const div = document.createElement("div");
      div.className = "item-description";
      // cleanDescription, not stripPar: `system.features` is an ObjectField interior,
      // so the server never sanitizes it and this was a player→GM XSS. See utils.js.
      div.innerHTML = cleanDescription(feature.description);
      return div;
    });
  }

  /* -------------------------------------------- */
  /*  Actions — counters and buttons              */
  /* -------------------------------------------- */

  /**
   * A d20 save against an ability. On a failed STR save, offer to mark Critical
   * Damage — but only when STR is damaged and still above 0 (the crawling state;
   * STR 0 is Dead). A generic STR save at full health isn't Critical Damage.
   * Matches the sheet skull's gate.
   * @this {CairnActorSheet}
   */
  static async #onRollAbility(event, target) {
    event.preventDefault();
    const dataset = target.dataset;
    if (!dataset.roll) return;
    const roll = await evaluateFormula(dataset.roll, this.actor.getRollData());
    const label = dataset.label ? game.i18n.localize("CAIRN.Rolling") + ` ${dataset.label}` : "";
    const rolled = roll.terms[0].results[0].result;
    const failed = roll.total === 0;
    const result = failed ? game.i18n.localize("CAIRN.Fail") : game.i18n.localize("CAIRN.Success");
    const resultCls = failed ? "failure" : "success";
    const str = this.actor.system.abilities?.STR;
    const offerCrit =
      dataset.ability === "STR" && failed &&
      Number(str?.value) > 0 && Number(str?.value) < Number(str?.max);
    const critButton = offerCrit
      ? `<button type="button" class="mark-critical-damage">${game.i18n.localize("CAIRN.MarkCriticalDamage")}</button>`
      : "";
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: label,
      content: `<div class="dice-roll"><div class="dice-result"><div class="dice-formula">${roll.formula}</div><div class="dice-tooltip" style="display: none;"><section class="tooltip-part"><div class="dice"><header class="part-header flexrow"><span class="part-formula">${roll.formula}</span></header><ol class="dice-rolls"><li class="roll die d20">${rolled}</li></ol></div></section></div><h4 class="dice-total ${resultCls}">${result} (${rolled})</h4></div></div>${critButton}`,
    });
  }

  /**
   * Toggle STR Critical Damage (2e). Manual, per house style: the player marks
   * the failed-save crawling state; STR goes red and the banner appears.
   * Dead/Paralyzed/Delirious are automatic (ability at 0), not toggled here.
   * @this {CairnActorSheet}
   */
  static async #onToggleCritical(event) {
    event.preventDefault();
    await this.actor.update({ "system.critical": this.actor.system.critical !== true });
  }

  /** @this {CairnActorSheet} */
  static async #onArmorReset(event) {
    event.preventDefault();
    await this.actor.update({ "system.armorOverride": null });
  }

  /**
   * Rest restores HP (a DEPRIVED character cannot benefit from a rest). The
   * confirm reiterates the rule before committing.
   * @this {CairnActorSheet}
   */
  static async #onRest() {
    if (this.actor.system.deprived) return;
    if (!(await this._confirmAction("CAIRN.Rest", "CAIRN.RestTip", "CAIRN.RestConfirm"))) return;
    await this.actor.update({ "system.hp.value": this.actor.system.hp.max });
  }

  /** @this {CairnActorSheet} */
  static async #onRestoreAbilities() {
    if (this.actor.system.deprived) return;
    if (!(await this._confirmAction("CAIRN.RestoreAbilities", "CAIRN.RestoreTip", "CAIRN.RestoreConfirm"))) return;
    // Restoring abilities to full also clears any Critical Damage: the wound
    // that status represents is healed once the attribute is back.
    await this.actor.update({
      "system.abilities.STR.value": this.actor.system.abilities.STR.max,
      "system.abilities.DEX.value": this.actor.system.abilities.DEX.max,
      "system.abilities.WIL.value": this.actor.system.abilities.WIL.max,
      "system.critical": false,
    });
  }

  /** @this {CairnActorSheet} */
  static async #onDieOfFate() {
    const roll = await evaluateFormula("1d6");
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: game.i18n.localize("CAIRN.DieOfFate"),
    });
  }

  /**
   * Double-click the Items tab to set this character's own equipment limit.
   * Bound in _onRender rather than declared as an action: the action system
   * covers clicks only, and a single click here belongs to the tab.
   * @private
   */
  async _onSetEquipmentLimit(event) {
    if (!game.settings.get(SETTINGS_NS, "character-inventory-limit")) return;
    event.preventDefault();
    await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("CAIRN.Settings.MaxEquipSlots.label") },
      position: { width: 150 },
      content: `<input name="slots" type="number" autofocus value="${this.actor.calcCurrentMaxSlots()}">`,
      ok: {
        label: game.i18n.localize("CAIRN.SetLimit"),
        // DialogV2 awaits a callback's return value, so awaiting here holds the
        // dialog's promise open until the write lands.
        callback: async (dialogEvent, button) => {
          await this.actor.update({ "system.slots": button.form.elements.slots.valueAsNumber });
        },
      },
      rejectClose: false,
    });
  }

  /* -------------------------------------------- */
  /*  Actions — description tab                   */
  /* -------------------------------------------- */

  /**
   * Re-roll the character's age (2d20 + 10 by default) into the age field. The
   * formula lives in config so it matches what generation uses.
   * @this {CairnActorSheet}
   */
  static async #onRollAge(event) {
    event.preventDefault();
    const formula = CONFIG.Cairn?.characterGenerator2e?.biography?.age ?? "2d20 + 10";
    // rollAge (not evaluateFormula) so the sheet re-roll obeys the Warden's
    // minimum-age override, exactly as generation does.
    const total = await rollAge(formula);
    await this.actor.update({ "system.age": String(total) });
  }

  /**
   * Roll the Omens table and drop the result into the omen field (enabled by its
   * checkbox). roll(), not draw(): the Omens table is read-only from here — the
   * drawn text is stored on the actor, nothing is automated.
   * @this {CairnActorSheet}
   */
  static async #onRollOmen(event) {
    event.preventDefault();
    if (!this.actor.system.omenEnabled) return;
    const tables = await cachedPackDocuments("air-bladder.tables-2e");
    const omenTable = tables.find((tbl) => tbl.name === "Omens");
    if (!omenTable) {
      ui.notifications.warn(game.i18n.localize("CAIRN.OmenTableMissing"));
      return;
    }
    const { results } = await omenTable.roll();
    await this.actor.update({ "system.omen": resultText(results?.[0]) });
  }

  /**
   * Expand/collapse the trait pick-lists (+/-). Transient sheet state, so it
   * survives re-renders but is not stored on the actor. Defaults collapsed
   * (_prepareContext uses `?? true`), so read the effective value rather than
   * negating a maybe-undefined flag.
   * @this {CairnActorSheet}
   */
  static #onToggleTraits(event) {
    event.preventDefault();
    this._traitsCollapsed = !(this._traitsCollapsed ?? true);
    this.render(false);
  }

  /** @this {CairnActorSheet} */
  static #onToggleScars(event) {
    event.preventDefault();
    this._scarsCollapsed = !this._scarsCollapsed;
    this.render(false);
  }

  /* -------------------------------------------- */
  /*  Actions — background and failed career      */
  /* -------------------------------------------- */

  /**
   * Dice on the background line: swap to a random background. A PER-FIELD swap —
   * the character keeps its stats, name, traits, bonds and belongings; only the
   * background and what it granted change. Regenerating everything is the Roll
   * Character control's job.
   * @this {CairnActorSheet}
   */
  static async #onRollBackground(event) {
    event.preventDefault();
    await changeBackground(this.actor, null);
  }

  /**
   * Magnifier on the background line: open the picker for this character's own
   * content source, then swap to what was chosen. The picker never offers the
   * other edition's backgrounds — a character does not change edition.
   * @this {CairnActorSheet}
   */
  static async #onPickBackground(event) {
    event.preventDefault();
    if (!this._mayChangeBackground()) return;   // don't offer a list we can't act on
    const result = await promptBackground(
      this.actor.system.contentSource || "2e",
      this.actor.system.backgroundUuid
    );
    if (!result) return;                    // cancelled
    await changeBackground(this.actor, result.bg);
  }

  /** Dice on the "Failed career" line: roll a random one, avoiding the
   *  character's real background exactly as generation does. A new career brings
   *  a fresh keepsake item. @this {CairnActorSheet} */
  static async #onRollFailedCareer(event) {
    event.preventDefault();
    const name = await rollFailedCareerName(this.actor.system.background);
    if (!name) return;
    await this.actor.update({ "system.failedCareer": name });
    await this._grantFailedCareerItem(name);
  }

  /** Magnifier on the Barebones "Failed career" line: choose a different one.
   *  Flavour only — stores a name and grants nothing, so unlike the background
   *  swap there is no gear to reconcile. @this {CairnActorSheet} */
  static async #onPickFailedCareer(event) {
    event.preventDefault();
    const result = await promptFailedCareer(this.actor.system.failedCareer);
    if (!result) return;                    // cancelled
    await this.actor.update({ "system.failedCareer": result.name });
    await this._grantFailedCareerItem(result.name);
  }

  /** Dice on the "Failed career item" line: re-roll WHICH of the current failed
   *  career's gear items the character kept, without changing the career.
   *  @this {CairnActorSheet} */
  static async #onRollFailedCareerItem(event) {
    event.preventDefault();
    await this._grantFailedCareerItem(this.actor.system.failedCareer);
  }

  /* -------------------------------------------- */
  /*  Actions — notes tab (bonds and questions)   */
  /* -------------------------------------------- */

  /**
   * Re-roll one bond (by its stable id) from the Bonds table, syncing its granted
   * items and gold on the inventory, like a question re-roll.
   * @this {CairnActorSheet}
   */
  static async #onRerollBond(event, target) {
    event.preventDefault();
    if (this._rerolling) return;   // guard the double-click delete/create race
    this._rerolling = true;
    try {
      const id = target.dataset.bondId;
      const bonds = this._effectiveBonds();
      const idx = bonds.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const drawn = await drawBond(await this._bondsTableName());
      if (!drawn) return;
      const newItems = (drawn.items ?? []).map((it) => withGrantSource(it, `bond:${id}`));
      await this._replaceGrantedItems(`bond:${id}`, newItems);
      const gold = Math.max(0, (this.actor.system.gold ?? 0) - (bonds[idx].gold ?? 0) + drawn.gold);
      bonds[idx] = { id, description: drawn.description, gold: drawn.gold };
      await this.actor.update({ "system.bonds": bonds, "system.gold": gold });
    } finally {
      this._rerolling = false;
    }
  }

  /**
   * Add a bond: draw a new one and append it, granting its items and gold. Only
   * reachable below the bond entitlement (re-checked here so a stale link can't
   * push over the cap).
   * @this {CairnActorSheet}
   */
  static async #onAddBond(event) {
    event.preventDefault();
    const bonds = this._effectiveBonds();
    if (bonds.length >= (await this._bondEntitlement())) return;
    const rec = bondRecordFrom(await drawBond(await this._bondsTableName()));
    if (!rec) return;
    bonds.push(rec.bond);
    if (rec.items.length) {
      await this.actor.createEmbeddedDocuments("Item", rec.items, { render: false });
    }
    const gold = (this.actor.system.gold ?? 0) + rec.bond.gold;
    await this.actor.update({ "system.bonds": bonds, "system.gold": gold });
  }

  /**
   * Remove a bond (by id): drop it and delete its granted items, refunding its
   * gold grant back out (never below zero).
   * @this {CairnActorSheet}
   */
  static async #onRemoveBond(event, target) {
    event.preventDefault();
    const id = target.dataset.bondId;
    const bonds = this._effectiveBonds();
    const idx = bonds.findIndex((b) => b.id === id);
    if (idx < 0) return;
    await this._replaceGrantedItems(`bond:${id}`, []);
    const gold = Math.max(0, (this.actor.system.gold ?? 0) - (bonds[idx].gold ?? 0));
    bonds.splice(idx, 1);
    await this.actor.update({ "system.bonds": bonds, "system.gold": gold });
  }

  /**
   * Re-roll a single background question in isolation: re-roll that table's d6
   * (from the source background via `backgroundUuid`), replace only that
   * question's answer, and sync the items/gold it grants (options carry gear as
   * references, resolved through resolveRefs like generation does).
   * @this {CairnActorSheet}
   */
  static async #onRerollQuestion(event, target) {
    event.preventDefault();
    if (this._rerolling) return;   // guard the double-click delete/create race
    this._rerolling = true;
    try {
      const idx = Number(target.dataset.index);
      // A question's option can grant a container (an Actor); bail before replacing
      // anything if this user can't manage those (see canRegenerateContainers).
      if (!canRegenerateContainers(this.actor, `question:${idx}`)) return;
      const bg = this.actor.system.backgroundUuid
        ? await fromUuid(this.actor.system.backgroundUuid)
        : null;
      const table = bg?.system?.tables?.[idx];
      const options = table?.options ?? [];
      if (!options.length) {
        ui.notifications.warn(game.i18n.localize("CAIRN.RerollQuestionUnavailable"));
        return;
      }
      const roll = await evaluateFormula(`1d${options.length}`);
      const opt = options[roll.total - 1] ?? options[0];

      const newItems = (await resolveRefs(opt.items)).map((it) => withGrantSource(it, `question:${idx}`));
      await this._replaceGrantedItems(`question:${idx}`, newItems);
      // An option may also grant a container (Outrider's horse breeds are one whole
      // question of them), which is an Actor — swap those the same way.
      await replaceGrantedContainers(this.actor, `question:${idx}`, opt.containers);
      const questions = foundry.utils.duplicate(this.actor.system.questions ?? []);
      const oldGold = questions[idx]?.gold ?? 0;
      const newGold = opt.bonusGold ?? 0;
      const gold = Math.max(0, (this.actor.system.gold ?? 0) - oldGold + newGold);
      questions[idx] = { question: table.question ?? "", answer: opt.description ?? "", gold: newGold };
      await this.actor.update({ "system.questions": questions, "system.gold": gold });
    } finally {
      this._rerolling = false;
    }
  }

  /* -------------------------------------------- */
  /*  Portrait pickers                            */
  /* -------------------------------------------- */

  /**
   * Container art picker: a grayscale gallery of transport/container art
   * (CONTAINER_ART, all Foundry core icons), plus a Browse escape for anyone
   * with FILES_BROWSE. This is the container counterpart to _pickPortrait --
   * clicking a container's portrait opens THIS, not the character gallery.
   * @private
   */
  async _pickContainerArt(event) {
    event.preventDefault();
    const current = this.actor.img;

    // Labelled by CLASS, not by filename. The old version derived a caption from
    // the image path ("donkey" for both the mule and the donkey, "stack" for the
    // item pile), which is the file's name rather than the thing's.
    const stored = this.actor.system.containerClass;
    const cells = CONTAINER_ART_CHOICES.map(({ key, src, label }) => {
      const sel = key === stored || (!stored && src === current) ? " selected" : "";
      const title = game.i18n.localize(label);
      return `<img class="cairn-portrait-choice${sel}" src="${src}" data-src="${src}" `
        + `data-class="${key}" title="${title}" alt="${title}" />`;
    }).join("");

    const canBrowse = game.user.can("FILES_BROWSE");
    const browseBtn = canBrowse
      ? `<button type="button" class="cairn-portrait-browse"><i class="fas fa-folder-open"></i> ${game.i18n.localize("CAIRN.BrowsePortrait")}</button>`
      : "";

    const content = `<div class="cairn-portrait-gallery cairn-container-gallery">
        <div class="cairn-portrait-grid">${cells}</div>
        ${browseBtn}
      </div>`;

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("CAIRN.ChooseContainerArt"), icon: "fas fa-image" },
      position: { width: 520 },
      content,
      buttons: [{ action: "close", label: game.i18n.localize("CAIRN.Close"), default: true }],
    });
    await dialog.render(true);

    const root = dialog.element;
    root.querySelectorAll(".cairn-portrait-choice").forEach((img) => {
      img.addEventListener("click", async () => {
        await this._setContainerArt(img.dataset.src, img.dataset.class);
        dialog.close();
      });
    });
    const browse = root.querySelector(".cairn-portrait-browse");
    if (browse) {
      browse.addEventListener("click", () => {
        const FP = foundry.applications.apps?.FilePicker?.implementation
          ?? foundry.applications.apps?.FilePicker
          ?? FilePicker;
        new FP({
          type: "image",
          current: "icons/containers",
          callback: async (path) => {
            // A Warden's own image is none of our classes, so clear the stored
            // one and let the label fall back to inferring from the name --
            // rather than leaving a custom picture labelled "Chest".
            await this._setContainerArt(path, "");
            dialog.close();
          },
        }).render(true);
      });
    }
  }

  /**
   * Portrait picker. Two galleries behind a tab toggle — the shipped Jon Aspeheim
   * art and the GM's custom folder — plus a paste-a-URL row and (for FILES_BROWSE
   * users) a FilePicker escape. Picking any image swaps the portrait AND its token
   * via _setPortrait. The Aspeheim credit shows only under its own tab; the Custom
   * tab appears when there are custom portraits or the viewer is a GM (who can add
   * them). Shared by the PC and hireling sheets — they route here identically.
   * @private
   */
  async _pickPortrait(event) {
    event.preventDefault();
    const manifest = await getPortraitManifest();
    const names = manifest?.names ?? [];
    const portraitDir = manifest?.portraitDir ?? "systems/air-bladder/character_portraits";
    const current = this.actor.img;
    const custom = getCustomPortraitPaths();
    const isGM = game.user.isGM;
    const showCustom = custom.length > 0 || isGM;

    const cellFor = (src) => {
      const sel = src === current ? " selected" : "";
      const title = String(src).split("/").pop();
      return `<img class="cairn-portrait-choice${sel}" src="${src}" data-src="${src}" title="${title}" />`;
    };
    const shippedCells = names.map((n) => cellFor(`${portraitDir}/${n}`)).join("");
    const customCells = custom.map(cellFor).join("");

    // Start on the tab holding the current portrait, so re-opening lands where you
    // are; default to shipped otherwise.
    const startTab = custom.includes(current) && custom.length ? "custom" : "shipped";
    const tab = (id, label) =>
      `<button type="button" class="cairn-portrait-tab${id === startTab ? " active" : ""}" data-tab="${id}">${label}</button>`;
    const tabsBar = showCustom
      ? `<div class="cairn-portrait-tabs">
          ${tab("shipped", game.i18n.localize("CAIRN.PortraitTabShipped"))}
          ${tab("custom", game.i18n.localize("CAIRN.PortraitTabCustom"))}
        </div>`
      : "";

    const refreshBtn = isGM
      ? `<button type="button" class="cairn-portrait-refresh"><i class="fas fa-rotate"></i> ${game.i18n.localize("CAIRN.RefreshCustomPortraits")}</button>`
      : "";
    const emptyHint = `<div class="cairn-portrait-empty"${custom.length ? " hidden" : ""}>${game.i18n.localize("CAIRN.CustomPortraitsEmpty")}</div>`;
    const customPane = showCustom
      ? `<div class="cairn-portrait-pane" data-pane="custom"${startTab === "custom" ? "" : " hidden"}>
          <div class="cairn-portrait-grid">${customCells}</div>
          ${emptyHint}
          ${refreshBtn}
        </div>`
      : "";

    const canBrowse = game.user.can("FILES_BROWSE");
    const browseBtn = canBrowse
      ? `<button type="button" class="cairn-portrait-browse"><i class="fas fa-folder-open"></i> ${game.i18n.localize("CAIRN.BrowsePortrait")}</button>`
      : "";

    // Paste-an-image-URL row: lets any owner set a custom portrait without the
    // FILES_BROWSE permission the Browse button needs (so it works for players).
    const urlRow = `<div class="cairn-portrait-url">
        <input type="text" class="cairn-portrait-url-input" placeholder="${game.i18n.localize("CAIRN.PortraitUrlPlaceholder")}" />
        <button type="button" class="cairn-portrait-url-set">${game.i18n.localize("CAIRN.PortraitUrlSet")}</button>
      </div>`;

    const content = `<div class="cairn-portrait-gallery">
        ${tabsBar}
        <div class="cairn-portrait-pane" data-pane="shipped"${startTab === "shipped" ? "" : " hidden"}>
          <div class="cairn-portrait-grid">${shippedCells}</div>
          <div class="cairn-portrait-credit">${game.i18n.localize("CAIRN.PortraitCredit")}</div>
        </div>
        ${customPane}
        ${urlRow}
        ${browseBtn}
      </div>`;

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("CAIRN.ChoosePortrait"), icon: "fas fa-image" },
      position: { width: 520 },
      content,
      buttons: [{ action: "close", label: game.i18n.localize("CAIRN.Close"), default: true }],
    });
    await dialog.render(true);

    const root = dialog.element;
    const wireChoice = (img) =>
      img.addEventListener("click", async () => {
        await this._setPortrait(img.dataset.src);
        dialog.close();
      });
    root.querySelectorAll(".cairn-portrait-choice").forEach(wireChoice);

    // Tab toggle: show the clicked pane, hide the other, move the active marker.
    root.querySelectorAll(".cairn-portrait-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.tab;
        root.querySelectorAll(".cairn-portrait-tab").forEach((b) => b.classList.toggle("active", b === btn));
        root.querySelectorAll(".cairn-portrait-pane").forEach((p) => { p.hidden = p.dataset.pane !== id; });
      });
    });

    // Refresh: re-scan the custom folder (GM), then rebuild the custom grid in place.
    const refresh = root.querySelector(".cairn-portrait-refresh");
    if (refresh) {
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        const list = await refreshCustomPortraits();
        const grid = root.querySelector('[data-pane="custom"] .cairn-portrait-grid');
        const hint = root.querySelector('[data-pane="custom"] .cairn-portrait-empty');
        if (grid) {
          grid.innerHTML = list.map(cellFor).join("");
          grid.querySelectorAll(".cairn-portrait-choice").forEach(wireChoice);
        }
        if (hint) hint.hidden = list.length > 0;
        refresh.disabled = false;
      });
    }

    const urlInput = root.querySelector(".cairn-portrait-url-input");
    const applyUrl = async () => {
      const value = urlInput?.value.trim();
      if (!value) return;
      await this._setPortrait(value);
      dialog.close();
    };
    root.querySelector(".cairn-portrait-url-set")?.addEventListener("click", applyUrl);
    urlInput?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); applyUrl(); }
    });
    const browse = root.querySelector(".cairn-portrait-browse");
    if (browse) {
      browse.addEventListener("click", () => {
        const FP = foundry.applications.apps?.FilePicker?.implementation
          ?? foundry.applications.apps?.FilePicker
          ?? FilePicker;
        new FP({
          type: "image",
          current: portraitDir,
          callback: async (path) => {
            await this._setPortrait(path);
            dialog.close();
          },
        }).render(true);
      });
    }
  }

  /* -------------------------------------------- */
  /*  Form submission                             */
  /* -------------------------------------------- */

  /**
   * Encumbrance and panic zero HP as DERIVED state (in _prepareCharacterData), but
   * a plain form submit would persist that 0 over the real stored value. Strip
   * system.hp.value from the submit while either condition holds, so the real
   * value reappears the moment the character is back under capacity / not panicked.
   * Real damage still persists — it goes through actor.update in damage.js.
   *
   * AppV1's hook was `_getSubmitData`; ApplicationV2's is `_processFormData`,
   * which returns the already-expanded object.
   * @override
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // Strip system.hp.value from the submit EXACTLY when prepareData derives it
    // to 0, so a derived 0 never persists over the real stored value — and ONLY
    // then, or the strip becomes its own bug: an npc at capacity (a full crate,
    // which no longer zeroes — that is a container's normal state, review #5)
    // would otherwise have every HP edit silently dropped, un-editable for as
    // long as it stayed full. character and hireling zero on encumbrance or
    // panic; npc only on panic. Keep this condition in step with
    // _prepareCharacterData — the two are one rule stated twice.
    const derivedZero =
      (["character", "hireling"].includes(this.actor.type)
        && (this.actor.system.encumbered || this.actor.system.panicked))
      || (this.actor.type === "npc" && this.actor.system.panicked);
    if (derivedZero) {
      foundry.utils.deleteProperty(data, "system.hp.value");
    }
    return data;
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /**
   * @override
   * @param {DragEvent} event
   * @param {CairnItem} originalItem  the dropped Item, already resolved by ActorSheetV2
   */
  async _onDropItem(event, originalItem) {
    if (!originalItem) return null;

    // The Actor the item currently belongs to; null for a world or compendium item.
    const originalActor = originalItem.actor;

    // A background ARRIVING here is not inventory. Dropping one CHANGES the
    // character's background — the same operation as the magnifier's picker — so it
    // is intercepted before any capacity check and before any create. Without this
    // it fell through to the transfer path below and became an owned item:
    // `BackgroundData` declares neither `weightless` nor `bulky`, so it cost a slot,
    // and on an encumbered character the refusal below rejected the drop outright,
    // so nothing happened at all.
    //
    // ARRIVING is the load-bearing word, and the `!== this.actor` term is what says
    // it. A background already in this inventory — the 0.1.7 artefact upgraded
    // worlds still carry — is a draggable row like any other, and dragging it to
    // REORDER it is a sort, not a swap. Without the term the sort never happened:
    // the drag raised the destructive prompt and, answered yes, renamed the
    // character's background to the item being dragged and deleted the gear the
    // real one granted. Note it cannot instead move below the same-actor branch and
    // rely on position — a background dragged off ANOTHER character's sheet is a
    // legitimate arrival route that must still be intercepted, and dev:bg-drop-guard
    // covers it.
    if (originalItem.type === "background" && originalActor !== this.actor) {
      return this._onDropBackground(originalItem);
    }

    // Same-actor drop: this is a reorder within our own inventory, not a
    // transfer. Honour it only when the GM has enabled drag-to-reorder.
    if (this.actor === originalActor) {
      if (game.settings.get(SETTINGS_NS, "enable-inventory-reorder")) {
        await this._onSortItem(event, originalItem);
        return originalItem;
      }
      return null;
    }

    // A transfer takes the item off ANOTHER actor's sheet, so it needs write
    // access to that source. Without it the old code added to the target and then
    // failed (or silently duplicated) on the source — refuse it up front. A drop
    // from a compendium has no owning actor and is a copy, so it skips this.
    if (originalActor && !originalItem.isOwner) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DropNoSource"));
      return null;
    }

    // Capacity rules differ by target. A CHARACTER may accept an item that puts
    // them over capacity (they just drop to HP 0 until a slot frees). A CONTAINER
    // is strict — it refuses anything that won't fit.
    const s = originalItem.system ?? {};
    const need = s.bulky ? 2 : s.weightless ? 0 : 1;
    if (this.actor.type === "container") {
      if ((this.actor.system.slotsUsed ?? 0) + need > (this.actor.system.slotsMax ?? 0)) {
        ui.notifications.warn(
          game.i18n.format("CAIRN.Notify.ContainerFull", { name: originalItem.name })
        );
        return null;
      }
    } else if (this.actor.isEncumbered()) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MaxSlotsOccupied"));
      return null;
    }

    // Put the item on the target FIRST, and only move quantity off the source
    // once that has actually succeeded. The old order created-then-decremented
    // unconditionally: a refused create (typically a permissions wall) threw AND
    // still decremented the source, so the item vanished.
    const foundItem = this.actor.items.find(
      (it) => it.name === originalItem.name && it.type === originalItem.type
    );
    let created = foundItem ?? null;
    if (foundItem) {
      await foundItem.update({ "system.quantity": (foundItem.system.quantity ?? 1) + 1 });
    } else {
      created = await super._onDropItem(event, originalItem);
      if (!created) {
        ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DropFailed"));
        return null;
      }
      // Items inside a container are stowed, never equipped.
      const patch = { "system.quantity": 1 };
      if (this.actor.type === "container") patch["system.equipped"] = false;
      await created.update(patch);
    }

    // Target received it. Only a real transfer FROM another actor removes a unit
    // from the source. A drop from a compendium (no owning actor) is a COPY —
    // never write to the pack document, or the pool's master item gets its
    // quantity decremented and every future grant resolves from corrupted data.
    if (originalActor) {
      const osq = (originalItem.system.quantity ?? 1) - 1;
      if (osq > 0) {
        await originalItem.update({ "system.quantity": osq });
      } else {
        await originalActor.deleteEmbeddedDocuments("Item", [originalItem.id]);
      }
    }
    return created;
  }

  /**
   * Reorder an item within this actor's own inventory by drag-and-drop, gated on
   * the "enable-inventory-reorder" setting. Only real embedded items take part:
   * dropping onto a gold-slot / worn-container row (no embedded item) is a no-op.
   * ActorSheetV2 ships its own version, but it assumes every sibling row carries a
   * real embedded item and throws on ours, which include gold-slot rows.
   * @param {DragEvent} event
   * @param {CairnItem} source  the dragged item
   * @override
   */
  async _onSortItem(event, source) {
    const dropTarget = event.target.closest("[data-item-id]");
    if (!dropTarget) return;
    const target = this.actor.items.get(dropTarget.dataset.itemId);
    if (!target || target.id === source.id) return;

    const siblings = [];
    for (const el of dropTarget.parentElement.children) {
      const sid = el.dataset?.itemId;
      if (!sid || sid === source.id) continue;
      const sib = this.actor.items.get(sid);
      if (sib) siblings.push(sib);
    }

    const updates = foundry.utils
      .performIntegerSort(source, { target, siblings })
      .map((u) => ({ _id: u.target.id, ...u.update }));
    if (updates.length) {
      await this.actor.updateEmbeddedDocuments("Item", updates);
    }
  }

  /**
   * @override
   * @param {DragEvent} event
   * @param {CairnActor} actor  the dropped Actor, already resolved by ActorSheetV2
   */
  async _onDropActor(event, actor) {
    // Only WORLD container actors can be attached. AppV1 expressed this by looking
    // the uuid up in `game.actors`, which a compendium or unlinked-token actor is
    // never in; ApplicationV2 hands us the resolved document, so say it directly.
    if (!actor || actor.type !== "container" || actor.pack || actor.isToken) return null;
    if (actor.system.keeper !== "") {
      ui.notifications.warn(game.i18n.localize("CAIRN.ContainerAlreadyOwned"));
      return null;
    }
    if (this.actor.uuid === actor.uuid) return null;
    await this.actor.createOwnedContainer(actor);
    return actor;
  }

  /**
   * @override
   *
   * ActorSheetV2's version resolves a row to `actor.items.get(itemId)`, which is
   * wrong for our container rows: those carry an Actor UUID in `data-item-id`, so
   * the lookup misses and the drag silently carries nothing.
   */
  _onDragStart(event) {
    const li = event.currentTarget;
    if ("link" in event.target.dataset) return;

    let dragData;
    if (li.dataset.itemId) {
      const item = li.dataset.isContainer
        ? this.actor.getOwnedContainer(li.dataset.itemId)
        : this.actor.items.get(li.dataset.itemId);
      dragData = item?.toDragData();
    }
    if (li.dataset.effectId) {
      dragData = this.actor.effects.get(li.dataset.effectId)?.toDragData();
    }
    if (!dragData) return;
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }
}
