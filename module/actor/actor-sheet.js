import { regenerateActor, drawBond, bondRecordFrom, withGrantSource, mentionsSecondBond, resolveRefs, replaceGrantedContainers, promptBackground, changeBackground, promptFailedCareer, rollFailedCareerName, buildFailedCareerItem, getPortraitManifest, pairedTokenFor, regenerateHireling, rerollHirelingProfession, rerollHirelingName, rollNameFromTable, rollAge } from "../character-generator.js";
import { openMarketplace, TRANSPORTS_CATEGORY } from "../marketplace.js";
import { evaluateFormula, getInfoFromDropData, stripPar } from "../utils.js";
import { SETTINGS_NS } from "../settings.js";
import { CONTAINER_ART, CONTAINER_ICON, iconForItem } from "../icons.js";
import { localizeNameDesc, t } from "../i18n-content.js";

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class CairnActorSheet extends ActorSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["cairn", "sheet", "actor"],
      template: "systems/air-bladder/templates/actor/actor-sheet.html",
      width: 600,
      height: 750,
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".content",
          initial: "items",
        },
      ],
      dragDrop: [{ dragSelector: ".cairn-items-list-row", dropSelector: null }],
    });
  }

  get template() {
    const path = "systems/air-bladder/templates/actor";
    return `${path}/${this.actor.type}-sheet.html`;
  }

  /** @override */
  async getData() {
    const data = await super.getData();
    if (game.settings.get(SETTINGS_NS, "enable-inventory-reorder")) {
      // Manual order: honour each item's stored `sort` (Foundry's native field,
      // written by the drag-to-reorder handler), falling back to name. Fatigue is
      // NOT forced last here — with reorder on, the player controls placement.
      data.items.sort((a, b) =>
        (a.sort ?? 0) - (b.sort ?? 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      );
    } else {
      data.items = data.items.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0
      );
      data.items = data.items.sort((a, b) =>
        a.system.equipped && !b.system.equipped
          ? -1
          : a.system.equipped === b.system.equipped
          ? 0
          : 1
      );
      data.items.sort((a,b) => a.name == game.i18n.localize("CAIRN.Fatigue") ? 1 : b.name == game.i18n.localize("CAIRN.Fatigue") ? -1 : 0 )
    }
    // Display-only content localization: translate inventory item names/descriptions
    // into the active language for rendering only. These are plain data copies (not
    // the stored documents, which stay English), so name-matching elsewhere is
    // unaffected. A no-op in an English world (overlay null); a miss shows English.
    data.items = data.items.map((i) => localizeNameDesc(i));
    // Compendium monsters have "description" instead of "biography"
    if (this.actor.system.showBio) {
      data.enrichedBiography = await foundry.applications.ux.TextEditor.enrichHTML(this.actor.system.biography, { async: true });
    } else {
      data.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(this.actor.system.description, { async: true });
    }
    data.enrichedNotes = await foundry.applications.ux.TextEditor.enrichHTML(this.actor.system.notes, { async: true });

    // Description tab: traits (pick-lists + sentence), Omen, Scars, plus the 2e
    // background header/description. Character-only — NPCs/containers have none
    // of this. Bonds/questions (Notes tab) and the stat context (banners/critical)
    // are added by _computeStatContext and the Notes-tab block.
    if (this.actor.type === "character") {
      // Trait pick-lists: each trait's source table (from the 2e biography config,
      // which already points at air-bladder.tables-2e) supplies a <select> of
      // options so a player can pick a value (or keep an off-table one).
      const mapping = CONFIG.Cairn?.characterGenerator2e?.biography?.items ?? {};
      const byPack = {};
      for (const ref of Object.values(mapping)) {
        const [packName] = ref.split(";");
        if (!(packName in byPack)) byPack[packName] = game.packs.get(packName) ? await game.packs.get(packName).getDocuments() : [];
      }
      data.traitRows = Object.entries(mapping).map(([key, ref]) => {
        const [packName, tableName] = ref.split(";");
        const table = (byPack[packName] ?? []).find((t) => t.name === tableName);
        const value = this.actor.system.traits?.[key] ?? "";
        const texts = table ? table.results.map((r) => r.text).sort() : [];
        return {
          key,
          label: tableName,
          value,
          options: texts.map((text) => ({ text, selected: text === value })),
          // An off-table value (legacy free-typed) is preserved as its own option
          // so switching to a dropdown never silently drops it.
          customValue: value && !texts.includes(value) ? value : "",
        };
      });

      // Live constructed trait sentence + collapsible pick-lists (transient
      // sheet state; defaults collapsed so the sentence is the clean default view).
      data.traitSentence = this._buildTraitSentence(this.actor.system.traits, this.actor.system.age);
      data.traitsCollapsed = this._traitsCollapsed ?? true;

      // Scars pick-list from the same tables-2e pack. Neither Omen nor Scar is
      // generated: a player ticks the field's checkbox to enable it, then rolls
      // (Omen) or checks scars. Both are descriptive only.
      const tables2e =
        byPack["air-bladder.tables-2e"] ??
        (game.packs.get("air-bladder.tables-2e")
          ? await game.packs.get("air-bladder.tables-2e").getDocuments()
          : []);
      const scarTable = tables2e.find((t) => t.name === "Scars");
      const selectedScars = this.actor.system.scars ?? [];
      data.scarOptions = scarTable
        ? scarTable.results.map((r) => ({
            name: r.text,
            description: r.flags?.["air-bladder"]?.description ?? "",
            selected: selectedScars.includes(r.text),
          }))
        : [];
      data.scarDisplay = selectedScars.length ? selectedScars.join(", ") : null;
      data.scarsCollapsed = this._scarsCollapsed ?? false;

      // Background description (from the linked Item) + a friendly source label,
      // shown in the sheet header. "2e" -> "Cairn 2e".
      const bgUuid = this.actor.system.backgroundUuid;
      const bg = bgUuid ? await fromUuid(bgUuid) : null;
      data.backgroundDescription = bg?.system?.description
        ? await foundry.applications.ux.TextEditor.enrichHTML(t("bg.desc", bg.system.description), { async: true })
        : "";
      // Translated background name for the header (generated case). The editable
      // input for a hand-made character keeps the raw system.background so a Warden
      // never edits a translated string.
      data.backgroundName = t("bg.name", this.actor.system.background ?? "");
      const SOURCE_LABELS = { "2e": "Cairn 2e", "barebones": "Cairn Barebones" };
      data.contentSourceLabel =
        SOURCE_LABELS[this.actor.system.contentSource] ?? this.actor.system.contentSource;

      // A generated background (either edition) is a linked document, so its name
      // is a header rather than a free-text field; a hand-made character keeps the
      // editable input.
      data.is2eBackground = this.actor.system.contentSource === "2e";
      data.isBarebonesBackground = this.actor.system.contentSource === "barebones";
      data.hasGeneratedBackground = !!this.actor.system.backgroundUuid;
      // A generated character's Notes tab also carries its bonds and background
      // questions, so the tab is titled for both; a hand-made one is just notes.
      data.showBackgroundNotesLabel = data.is2eBackground || data.isBarebonesBackground;
      // Scars and Age are never generated — a player fills each in by hand after
      // the fact — so they are NOT edition-specific and show on both. Only
      // character CREATION differs between 2e and Barebones (see CLAUDE.md).
      data.showScars = true;
      data.showAge = true;
      // Omen is the one exception, and it is a CONTENT question rather than a rule:
      // Barebones ships no omens table, so a Warden opts in to lending it 2e's, the
      // same way they can lend it 2e's bonds. Nothing about generation changes —
      // an omen is never rolled at creation in either edition.
      data.showOmen =
        this.actor.system.contentSource !== "barebones" ||
        game.settings.get(SETTINGS_NS, "show-omens-barebones");
      // Barebones-only flavour: the career that didn't work out. Grants nothing.
      // Read the setting live, so a Warden switching it off hides the line on an
      // already-generated character rather than only affecting the next one.
      data.failedCareer = this.actor.system.failedCareer ?? "";
      data.showFailedCareer =
        this.actor.system.contentSource === "barebones" &&
        game.settings.get(SETTINGS_NS, "barebones-failed-career");
      // The single keepsake item the failed career left (grantSource
      // "failed-career") — shown on its own line under the career, with a re-roll
      // dice. It also appears in the inventory tagged "Failed Career" + "Petty".
      data.failedCareerItem =
        this.actor.items.find((i) => i.getFlag("air-bladder", "grantSource") === "failed-career")?.name ?? "";

      // Random-generation mode (default on): gates the per-field dice rollers
      // (age, omen). Legacy characters lack the field -> default to enabled.
      data.generationEnabled = this.actor.system.generationEnabled !== false;

      // Notes tab: bonds (a character can hold several) + the background's
      // re-rollable questions. Questions are 2e; bonds are 2e by default but a
      // Warden can lend them to Barebones (show-bonds-barebones), so show the
      // section whenever the character actually has one.
      // Translate bond prose for display (bonds are drawn from the Bonds table →
      // table.result). A composed bond string that doesn't match a source key
      // falls back to English; the count/entitlement below is unaffected.
      data.bonds = this._effectiveBonds()
        .map((b) => ({ ...b, description: t("table.result", b.description) }));
      data.showBonds = data.is2eBackground || data.bonds.length > 0;
      // "Add a bond" shows only while below the background's entitlement (base 1,
      // plus a second for Fieldwarden / Outrider's debt option). A fresh character
      // starts AT its entitlement, so the link is normally hidden.
      data.canAddBond = data.bonds.length < (await this._bondEntitlement(bg));
      // Divider between the bonds/questions area and the free-form notes editor.
      data.showNotesDivider = data.showBonds;
      // Questions render from a translated copy (template iterates `questions`, not
      // system.questions): each prompt is a bg.question, each answer a background
      // option description (bg.optionDesc). Misses fall back to English.
      data.questions = (this.actor.system.questions ?? []).map((q) => ({
        ...q,
        question: t("bg.question", q.question ?? ""),
        answer: t("bg.optionDesc", q.answer ?? ""),
      }));

      // Attribute-loss statuses, ability tooltips, peril/low cues, critical skull.
      this._computeStatContext(data);
    }

    // Hirelings reuse the character's STR/DEX/WIL/HP behaviour and tooltips, but
    // none of the background/traits/bonds machinery above.
    if (this.actor.type === "hireling") {
      this._computeStatContext(data);
      // Same random-generation switch as a character: gates the per-field dice
      // (name, profession, portrait) and the on-sheet Re-roll button.
      data.generationEnabled = this.actor.system.generationEnabled !== false;
    }

    return data;
  }

  /**
   * Ability/HP peril + "low" cues, the STR-critical skull toggle, per-ability save
   * tooltips, and the attribute-loss status banners (Dead / STR Critical /
   * Paralyzed / Delirious / Overburdened). STR 0 = Dead, DEX 0 = Paralyzed,
   * WIL 0 = Delirious are automatic (derived); Critical Damage is a manual skull.
   * @private
   */
  _computeStatContext(data) {
    const ab = this.actor.system.abilities ?? {};
    const val = (k) => Number(ab[k]?.value);
    const max = (k) => Number(ab[k]?.max);
    const dead = val("STR") <= 0;
    const paralyzed = val("DEX") <= 0;
    const delirious = val("WIL") <= 0;
    // Legacy-safe: only a strict boolean true counts as the STR Critical Damage
    // flag. Death overrides it.
    const strCritical = this.actor.system.critical === true && !dead;

    data.abilityPeril = { STR: dead || strCritical, DEX: paralyzed, WIL: delirious };
    // "Low" = current below max but not in peril: amber "reduced" cue (peril's red
    // takes precedence). HP uses it too.
    data.abilityLow = {};
    for (const k of ["STR", "DEX", "WIL"]) data.abilityLow[k] = val(k) < max(k) && !data.abilityPeril[k];
    data.hpLow = Number(this.actor.system.hp?.value) < Number(this.actor.system.hp?.max);
    // Skull offered when STR is damaged and still alive, or already marked.
    data.criticalToggle = { STR: (val("STR") < max("STR") && val("STR") > 0) || strCritical };
    data.criticalActive = { STR: strCritical };

    const L = (k) => game.i18n.localize(k);
    data.abilityTips = { STR: L("CAIRN.StrTip"), DEX: L("CAIRN.DexTip"), WIL: L("CAIRN.WilTip") };

    const banners = [];
    if (dead) {
      banners.push({ key: "dead", icon: "fa-skull", label: L("CAIRN.Dead"), text: L("CAIRN.DeadBanner") });
    } else {
      if (strCritical)
        banners.push({ key: "critical", icon: "fa-heart-crack", label: `${L("CAIRN.CriticalDamageStatus")} — STR`, text: L("CAIRN.CriticalDamageBanner") });
      if (paralyzed)
        banners.push({ key: "paralyzed", icon: "fa-lock", label: L("CAIRN.Paralyzed"), text: L("CAIRN.ParalyzedBanner") });
      if (delirious)
        banners.push({ key: "delirious", icon: "fa-brain", label: L("CAIRN.Delirious"), text: L("CAIRN.DeliriousBanner") });
    }
    // Encumbrance is a carry state, not an ability loss, but likewise forces HP
    // to 0, so surface it as a persistent banner too. Suppressed when dead.
    if (!dead && this.actor.system.encumbered)
      banners.push({ key: "encumbered", icon: "fa-weight-hanging", label: L("CAIRN.Overburdened"), text: L("CAIRN.OverburdenedBanner") });
    data.statusBanners = banners;
  }

  /**
   * The actor's bonds as an array, migrating a legacy single system.bond into a
   * one-element list (id "legacy") so old characters still display and operate.
   * @returns {{id: String, description: String, gold: Number}[]}
   * @private
   */
  _effectiveBonds() {
    const bonds = foundry.utils.duplicate(this.actor.system.bonds ?? []);
    if (!bonds.length && this.actor.system.bond) {
      bonds.push({ id: "legacy", description: this.actor.system.bond, gold: this.actor.system.bondGold ?? 0 });
    }
    return bonds;
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
    const bgSecond = bg?.system?.description && mentionsSecondBond(bg.system.description) ? 1 : 0;
    const qSecond = (this.actor.system.questions ?? []).filter((q) => mentionsSecondBond(q.answer ?? "")).length;
    return 1 + bgSecond + qSecond;
  }

  /**
   * Re-roll one bond (by its stable id) from the Bonds table, syncing its granted
   * items and gold on the inventory, like a question re-roll.
   * @param {Event} event
   * @private
   */
  async _onRerollBond(event) {
    event.preventDefault();
    if (this._rerolling) return;   // guard the double-click delete/create race
    this._rerolling = true;
    try {
      const id = event.currentTarget.dataset.bondId;
      const bonds = this._effectiveBonds();
      const idx = bonds.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const drawn = await drawBond();
      if (!drawn) return;
      const newItems = (drawn.items ?? []).map((it) => withGrantSource(it, `bond:${id}`));
      await this._replaceGrantedItems(`bond:${id}`, newItems, id === "legacy" ? "bond" : null);
      const gold = Math.max(0, (this.actor.system.gold ?? 0) - (bonds[idx].gold ?? 0) + drawn.gold);
      bonds[idx] = { id, description: drawn.description, gold: drawn.gold };
      await this.actor.update({ "system.bonds": bonds, "system.gold": gold, "system.bond": "" });
    } finally {
      this._rerolling = false;
    }
  }

  /**
   * Add a bond: draw a new one and append it, granting its items and gold. Only
   * reachable below the bond entitlement (re-checked here so a stale link can't
   * push over the cap).
   * @param {Event} event
   * @private
   */
  async _onAddBond(event) {
    event.preventDefault();
    const bonds = this._effectiveBonds();
    if (bonds.length >= (await this._bondEntitlement())) return;
    const rec = bondRecordFrom(await drawBond());
    if (!rec) return;
    bonds.push(rec.bond);
    if (rec.items.length) {
      await this.actor.createEmbeddedDocuments("Item", rec.items, { render: false });
    }
    const gold = (this.actor.system.gold ?? 0) + rec.bond.gold;
    await this.actor.update({ "system.bonds": bonds, "system.gold": gold, "system.bond": "" });
  }

  /**
   * Remove a bond (by id): drop it and delete its granted items, refunding its
   * gold grant back out (never below zero).
   * @param {Event} event
   * @private
   */
  async _onRemoveBond(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.bondId;
    const bonds = this._effectiveBonds();
    const idx = bonds.findIndex((b) => b.id === id);
    if (idx < 0) return;
    await this._replaceGrantedItems(`bond:${id}`, [], id === "legacy" ? "bond" : null);
    const gold = Math.max(0, (this.actor.system.gold ?? 0) - (bonds[idx].gold ?? 0));
    bonds.splice(idx, 1);
    await this.actor.update({ "system.bonds": bonds, "system.gold": gold, "system.bond": "" });
  }

  /**
   * Delete the actor's items previously granted by `source` and create the new
   * ones in their place, so re-rolling a bond/question keeps the inventory tab in
   * sync. `legacyFallback` also matches an older flat source tag. render:false --
   * the pending actor.update re-renders once.
   * @param {String} source  e.g. "bond:ab12" or "question:1"
   * @param {Object[]} newItems  resolved + withGrantSource() item data
   * @param {String|null} [legacyFallback]
   * @private
   */
  async _replaceGrantedItems(source, newItems, legacyFallback = null) {
    const oldIds = this.actor.items
      .filter((i) => {
        const gs = i.getFlag("air-bladder", "grantSource");
        return gs === source || (legacyFallback && gs === legacyFallback);
      })
      .map((i) => i.id);
    if (oldIds.length) {
      await this.actor.deleteEmbeddedDocuments("Item", oldIds, { render: false });
    }
    if (newItems.length) {
      await this.actor.createEmbeddedDocuments("Item", newItems, { render: false });
    }
  }

  /**
   * Re-roll a single background question in isolation: re-roll that table's d6
   * (from the source background via `backgroundUuid`), replace only that
   * question's answer, and sync the items/gold it grants (options carry gear as
   * references, resolved through resolveRefs like generation does).
   * @param {Event} event
   * @private
   */
  async _onRerollQuestion(event) {
    event.preventDefault();
    if (this._rerolling) return;   // guard the double-click delete/create race
    this._rerolling = true;
    try {
      const idx = Number(event.currentTarget.dataset.index);
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

  /**
   * Magnifier on the background line: open the picker for this character's own
   * content source, then swap to what was chosen. The picker never offers the
   * other edition's backgrounds — a character does not change edition.
   * @param {Event} event
   * @private
   */
  async _onPickBackground(event) {
    event.preventDefault();
    const result = await promptBackground(
      this.actor.system.contentSource || "2e",
      this.actor.system.backgroundUuid
    );
    if (!result) return;                    // cancelled
    await changeBackground(this.actor, result.bg);
  }

  /** Magnifier on the Barebones "Failed career" line: choose a different one.
   *  Flavour only — stores a name and grants nothing, so unlike the background
   *  swap above there is no gear to reconcile. */
  async _onPickFailedCareer(event) {
    event.preventDefault();
    const result = await promptFailedCareer(this.actor.system.failedCareer);
    if (!result) return;                    // cancelled
    await this.actor.update({ "system.failedCareer": result.name });
    await this._grantFailedCareerItem(result.name);
  }

  /** Dice on the "Failed career" line: roll a random one, avoiding the
   *  character's real background exactly as generation does. A new career brings
   *  a fresh keepsake item. */
  async _onRollFailedCareer(event) {
    event.preventDefault();
    const name = await rollFailedCareerName(this.actor.system.background);
    if (name) {
      await this.actor.update({ "system.failedCareer": name });
      await this._grantFailedCareerItem(name);
    }
  }

  /** Dice on the "Failed career item" line: re-roll WHICH of the current failed
   *  career's gear items the character kept, without changing the career. */
  async _onRollFailedCareerItem(event) {
    event.preventDefault();
    await this._grantFailedCareerItem(this.actor.system.failedCareer);
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
    const t = (k) => String(traits?.[k] ?? "").trim();
    const andList = (arr) =>
      arr.length <= 1 ? (arr[0] ?? "")
      : arr.length === 2 ? `${arr[0]} and ${arr[1]}`
      : `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;

    const parts = [];
    const physical = [
      t("physique") && `a ${t("physique")} Physique`,
      t("skin") && `${t("skin")} Skin`,
      t("hair") && `${t("hair")} Hair`,
    ].filter(Boolean);
    if (physical.length) parts.push(`You have ${andList(physical)}.`);

    const faceSpeech = [
      t("face") && `your Face is ${t("face")}`,
      t("speech") && `your Speech ${t("speech")}`,
    ].filter(Boolean);
    if (faceSpeech.length) {
      const clause = faceSpeech.join(", ");
      parts.push(clause.charAt(0).toUpperCase() + clause.slice(1) + ".");
    }

    if (t("clothing")) parts.push(`You have ${t("clothing")} Clothing.`);

    const viceVirtue = [t("vice"), t("virtue")].filter(Boolean);
    if (viceVirtue.length) parts.push(`You are ${andList(viceVirtue)}.`);

    const ageStr = String(age ?? "").trim();
    if (ageStr) parts.push(`You are ${ageStr} years old.`);

    return parts.join(" ");
  }

  /**
   * Re-roll the character's age (2d20 + 10 by default) into the age field. The
   * formula lives in config so it matches what generation uses.
   * @param {Event} event
   * @private
   */
  async _onRollAge(event) {
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
   * @param {Event} event
   * @private
   */
  async _onRollOmen(event) {
    event.preventDefault();
    if (!this.actor.system.omenEnabled) return;
    const pack = game.packs.get("air-bladder.tables-2e");
    const tables = pack ? await pack.getDocuments() : [];
    const omenTable = tables.find((t) => t.name === "Omens");
    if (!omenTable) {
      ui.notifications.warn(game.i18n.localize("CAIRN.OmenTableMissing"));
      return;
    }
    const { results } = await omenTable.roll();
    const text = results?.[0]?.text ?? "";
    await this.actor.update({ "system.omen": text });
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
    return foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(titleKey) },
      content: `<div class="cairn-confirm">${game.i18n.localize(tipKey)}<p class="cairn-confirm-q">${game.i18n.localize(questionKey)}</p></div>`,
      rejectClose: false,
      modal: true,
    });
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) {
      return;
    }

    // Header buttons (Roll Character + the Randomization toggle) are bound here.
    // Their onclick is a no-op (see _getHeaderButtons), so binding here is the
    // single source of truth. Namespaced + .off first so re-renders don't stack
    // handlers; this.element is the whole window, which includes the header.
    if (this.actor.type === "character" || this.actor.type === "hireling") {
      const el = this.element;
      // The Randomization On/Off toggle is shared by both sheet types.
      el.find(`.toggle-generation-button-${this.actor.id}`)
        .off("click.cairnHeader")
        .on("click.cairnHeader", (ev) => this._onToggleGeneration(ev));
      // Both sheet types carry a header Roll button; only the class + handler
      // differ. Its initial visibility follows the Randomization toggle.
      const genEnabled = this.actor.system.generationEnabled !== false;
      const hireling = this.actor.type === "hireling";
      el.find(`.regenerate-${hireling ? "hireling" : "character"}-button-${this.actor.id}`)
        .toggleClass("cairn-header-hidden", !genEnabled)
        .off("click.cairnHeader")
        .on("click.cairnHeader", (ev) =>
          hireling ? this._onRegenerateHireling(ev) : this._onRegenerateCharacter(ev));
    }

    // When drag-to-reorder is enabled, mark the sheet so item rows show a grab
    // cursor and the reorder hint appears.
    if (game.settings.get(SETTINGS_NS, "enable-inventory-reorder")) {
      html.addClass("cairn-reorder-enabled");
    }

    // When grant-source tags are on, mark the sheet so the footer hint under the
    // inventory explains the Background / Bond / Question chips. Character-only:
    // those chips are set at character generation, so no other actor type has them.
    if (game.settings.get(SETTINGS_NS, "show-grant-tags") && this.actor.type === "character") {
      html.addClass("cairn-grant-tags-enabled");
    }

    // Click the portrait to pick a new one from the shipped gallery (or browse /
    // paste a URL); the d20 beside it rolls a random one. Both swap the paired
    // token too, so the token never goes stale. Only the actor types that carry
    // shipped character art use the gallery -- containers/NPCs keep Foundry's
    // default image editing (the `data-edit="img"` in their templates).
    // A container gets the transport/container art gallery instead of the
    // character portrait gallery -- different art, and no paired token file.
    html.find(".portrait").click((ev) =>
      this.actor.type === "container"
        ? this._onPickContainerArt(ev)
        : this._onEditPortrait(ev)
    );
    if (this.actor.type === "character" || this.actor.type === "hireling") {
      html.find(".portrait-roll").click((ev) => this._onRollPortrait(ev));
    }

    // Hireling dice. The whole-statblock re-roll now lives in the title bar
    // ("Roll NPC"), bound in the header block above like the character's Roll
    // Character; only the profession- and name-only dice remain on the sheet.
    html.find(".profession-roll").click((ev) => this._onRerollProfession(ev));

    // Both sheets carry a die beside the name, but they draw from different
    // sources -- a hireling's name comes from its own spark table, a character's
    // from the background's example names -- so route by type rather than
    // letting one selector bind both.
    html.find(".name-roll").click((ev) =>
      this.actor.type === "hireling" ? this._onRerollHirelingName(ev) : this._onRollName(ev)
    );

    // Add inventory item
    html.find(".item-create").click(this._onItemCreate.bind(this));

    // Open the marketplace (buy/take gear from the reference catalog).
    // Open the marketplace (buy/take gear). On a container it is scoped to gear
    // only -- no buying a transport into a transport -- and acquisition is
    // strict there: a container refuses anything that will not fit.
    html.find(".item-shop").click((ev) => {
      ev.preventDefault();
      if (this.actor.type === "container") {
        openMarketplace(this.actor, { exclude: TRANSPORTS_CATEGORY });
      } else {
        openMarketplace(this.actor);
      }
    });

    // Add a container from the catalog (a pack, mount, or vehicle). Same shop,
    // same buy/take path as the Items-tab market, scoped to Transports &
    // Containers -- so a bought/taken transport lands right back in this tab.
    html.find(".container-shop").click((ev) => {
      ev.preventDefault();
      openMarketplace(this.actor, { only: TRANSPORTS_CATEGORY, titleKey: "CAIRN.TransportMarketTitle" });
    });

    // Homebrew escape hatch: create a bespoke container by hand (name + slots).
    // Demoted below the catalog path -- most containers should come from the shop.
    html.find(".container-create").click(this._onContainerCreate.bind(this));

    // Add feature
    html.find(".feature-create").click(this._onFeatureCreate.bind(this));

    // Add fatigue
    html.find(".add-fatigue").click(this._onAddFatigue.bind(this));

    // Remove fatigue
    html.find(".remove-fatigue").click(this._onRemoveFatigue.bind(this));

    // Update inventory item
    html.find(".item-edit").click((ev) => this._onItemEditToggle(ev));

    // Delete inventory item
    html.find(".item-delete").click((ev) => {
      const li = $(ev.currentTarget).parents(".cairn-items-list-row");
      if (li.data("isContainer")) {
        this.actor.deleteOwnedContainer(li.data("itemId"));
      } else {
        this.actor.deleteOwnedItem(li.data("itemId"));
      }
      li.slideUp(200, () => this.render(false));
    });

    // Edit feature
    html.find(".feature-edit").click((ev) => {
      const li = $(ev.currentTarget).parents(".cairn-items-list-row");
      const item = this.actor.getOwnedFeature(li.data("itemId"));
      if (!item) return;
      this._onFeatureEdit(item);
    });

     // Delete feature
     html.find(".feature-delete").click((ev) => {
      const li = $(ev.currentTarget).parents(".cairn-items-list-row");
      this.actor.deleteOwnedFeature(li.data("itemId"));
      li.slideUp(200, () => this.render(false));
    });

    html.find(".item-toggle-equipped").click((ev) => {
      const li = $(ev.currentTarget).parents(".cairn-items-list-row");
      const item = this.actor.getOwnedItem(li.data("itemId"));
      item.update({ "system.equipped": !item.system.equipped });
    });

    // Not exactly quantity, this is about uses
    html.find(".item-add-quantity").click(async (ev) => {
      const li = $(ev.currentTarget).parents(".cairn-items-list-row");
      const item = await this.actor.getOwnedItem(li.data("itemId"));
      await item.update({
          "system.uses.value": Math.min(
            item.system.uses.value + 1,
            item.system.uses.max
          ),
      });      
    });

    html.find(".item-remove-quantity").click(async (ev) => {
      const li = $(ev.currentTarget).parents(".cairn-items-list-row");
      const item = this.actor.getOwnedItem(li.data("itemId"));      
      let val = Math.max(item.system.uses.value - 1, 0)
      if (val == 0 && item.system.quantity > 1) {
        await item.update({
            "system.quantity": item.system.quantity - 1
        });  
        val = item.system.uses.max;
      }
      await item.update({
          "system.uses.value": val,
      });      
    });

    html.find(".roll-control").click(this._onRoll.bind(this));

    // Rollable abilities
    html.find(".resource-roll").click(this._onRollAbility.bind(this));

    // --- Description tab: traits / age / omen / scars ---
    // Re-roll age (2d20 + 10) into the age field.
    html.find(".age-roll").click((ev) => this._onRollAge(ev));

    // Roll an omen from the Omens table into the (enabled) omen field.
    html.find(".omen-roll").click((ev) => this._onRollOmen(ev));

    // Enabling Omen reveals the field; disabling it clears the stored omen so the
    // field resets to the placeholder hint (not a hidden value).
    html.find(".omen-enable").change((ev) => {
      const enabled = ev.currentTarget.checked;
      const data = { "system.omenEnabled": enabled };
      if (!enabled) data["system.omen"] = "";
      this.actor.update(data);
    });

    // Enabling Scars reveals the checklist; disabling it clears every picked scar.
    html.find(".scar-enable").change((ev) => {
      const enabled = ev.currentTarget.checked;
      const data = { "system.scarEnabled": enabled };
      if (!enabled) data["system.scars"] = [];
      this.actor.update(data);
    });

    // Expand/collapse the scar checklist (+/-). Transient sheet state, so it
    // survives re-renders (e.g. checking a scar) but is not stored on the actor.
    html.find(".scar-toggle").click((ev) => {
      ev.preventDefault();
      this._scarsCollapsed = !this._scarsCollapsed;
      this.render(false);
    });

    // Expand/collapse the trait pick-lists (+/-). Defaults collapsed (getData uses
    // `?? true`), so read the effective value rather than negating a maybe-undefined flag.
    html.find(".trait-toggle").click((ev) => {
      ev.preventDefault();
      const collapsed = this._traitsCollapsed ?? true;
      this._traitsCollapsed = !collapsed;
      this.render(false);
    });

    // Scars are a checkbox list: persist the set of checked names (including
    // empty). Managed here rather than via form serialization so unchecking the
    // last one reliably stores an empty array. render:false keeps scroll/state.
    html.find(".scar-check").change(() => {
      const scars = html.find(".scar-check:checked").toArray().map((o) => o.value);
      this.actor.update({ "system.scars": scars }, { render: false });
    });

    // --- Notes tab: bonds + questions ---
    html.find(".bond-reroll").click((ev) => this._onRerollBond(ev));
    html.find(".bond-add").click((ev) => this._onAddBond(ev));
    html.find(".bond-remove").click((ev) => this._onRemoveBond(ev));
    html.find(".question-reroll").click((ev) => this._onRerollQuestion(ev));

    // Background line: the dice swaps to a random background, the magnifier opens
    // the picker. Both are a PER-FIELD swap — the character keeps its stats, name,
    // traits, bonds and belongings; only the background and what it granted
    // change. Regenerating everything is the Regenerate button's job.
    html.find(".background-roll").click(async (ev) => {
      ev.preventDefault();
      await changeBackground(this.actor, null);
    });
    html.find(".background-pick").click((ev) => this._onPickBackground(ev));

    // Failed career (Barebones): flavour only, so these touch nothing but the
    // one string — no gear is granted or removed either way.
    html.find(".failed-career-roll").click((ev) => this._onRollFailedCareer(ev));
    html.find(".failed-career-pick").click((ev) => this._onPickFailedCareer(ev));
    html.find(".failed-career-item-roll").click((ev) => this._onRollFailedCareerItem(ev));

    // ProseMirror only commits via its (easily missed) save button, so a player
    // can't just switch tabs to escape edit mode. Save any active editor when the
    // player mouses down outside of it.
    html.on("mousedown", (ev) => {
      if (ev.target.closest(".editor")) return;
      for (const [name, editor] of Object.entries(this.editors ?? {})) {
        if (editor?.active) this.saveEditor(name);
      }
    });

    // Rest restores HP (a DEPRIVED character cannot benefit from a rest). The
    // confirm reiterates the rule before committing.
    html.find("#rest-button").click(async () => {
      if (!this.actor.system.deprived) {
        if (!(await this._confirmAction("CAIRN.Rest", "CAIRN.RestTip", "CAIRN.RestConfirm"))) return;
        await this.actor.update({ "system.hp.value": this.actor.system.hp.max });
      }
    });

    html.find("#restore-abilities-button").click(async () => {
      if (!this.actor.system.deprived) {
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
    });

    // Toggle STR Critical Damage (2e). Manual, per house style: the player marks
    // the failed-save crawling state; STR goes red and the banner appears.
    // Dead/Paralyzed/Delirious are automatic (ability at 0), not toggled here.
    html.find(".critical-toggle").click((ev) => {
      ev.preventDefault();
      this.actor.update({ "system.critical": this.actor.system.critical !== true });
    });

    // Stat inputs (HP + abilities, current & max) are numeric and capped 0-18.
    html.find(".stat-input").change((ev) => {
      const el = ev.currentTarget;
      let n = Math.round(Number(el.value));
      if (!Number.isFinite(n)) n = 0;
      n = Math.min(18, Math.max(0, n));
      if (String(n) !== el.value) el.value = n;
    });

    // Armor is class-managed (no form name): the field shows the effective Armor
    // (derived from gear, or an override). Typing a 0-3 value stores an override
    // that supersedes the gear value; clearing it — or the reset icon — returns
    // to auto (system.armorOverride = null).
    html.find(".armor-input").change((ev) => {
      const raw = ev.currentTarget.value.trim();
      if (raw === "") {
        this.actor.update({ "system.armorOverride": null });
        return;
      }
      let n = Math.trunc(Number(raw));
      if (!Number.isFinite(n)) n = 0;
      n = Math.min(3, Math.max(0, n));
      this.actor.update({ "system.armorOverride": n });
    });
    html.find(".armor-reset").click((ev) => {
      ev.preventDefault();
      this.actor.update({ "system.armorOverride": null });
    });

    // Deprived / Panicked are class-managed (no form name): toggling ON asks for
    // confirmation that reiterates the condition's tooltip; declining reverts.
    // Toggling OFF (recovering) applies immediately.
    html.find(".deprived-check").change(async (ev) => {
      const desired = ev.currentTarget.checked;
      if (desired && !(await this._confirmAction("CAIRN.Deprived", "CAIRN.DeprivedTip", "CAIRN.DeprivedConfirm"))) {
        this.render(false);
        return;
      }
      await this.actor.update({ "system.deprived": desired });
    });

    html.find(".panicked-check").change(async (ev) => {
      const desired = ev.currentTarget.checked;
      if (desired && !(await this._confirmAction("CAIRN.Panicked", "CAIRN.PanickedTip", "CAIRN.PanickedConfirm"))) {
        this.render(false);
        return;
      }
      await this.actor.update({ "system.panicked": desired });
    });

    html
      .find(".cairn-item-title")
      .click((event) => this._onItemDescriptionToggle(event));

    html
      .find(".cairn-item-title")
      .dblclick((event) => this._onItemEditToggle(event));

    html
      .find(".cairn-feature-title")
      .click((event) => this._onFeatureDescriptionToggle(event));      

    html.find("#die-of-fate-button").click(async () => {
      const roll = await evaluateFormula("1d6");
      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: game.i18n.localize("CAIRN.DieOfFate"),
      });
    });

    html.find("#set-equipment-limit").dblclick(async (ev) => {
      if (!game.settings.get(SETTINGS_NS, "character-inventory-limit")) return;
      ev.preventDefault();
      let slots;
      try {
        slots = await foundry.applications.api.DialogV2.prompt({
          window: { title: game.i18n.localize("CAIRN.Settings.MaxEquipSlots.label") },
          position: { width: 150},
          content: '<input name="slots" type="number" autofocus value="'+this.actor.calcCurrentMaxSlots()+'">',
          ok: {
            label: game.i18n.localize("CAIRN.SetLimit"),
            callback: (event, button, dialog) => {               
                this.actor.update({"system.slots":button.form.elements.slots.valueAsNumber});
            }
          }
        });
      } catch {
        return;
      }
       
    });

  }

  async _onItemEditToggle(ev) {
    const li = $(ev.currentTarget).parents(".cairn-items-list-row");
      if (li.data("isContainer")) {
        const item = this.actor.getOwnedContainer(li.data("itemId"));
        item.sheet.render(true);
        return;
      }
      const item = this.actor.getOwnedItem(li.data("itemId"));
      if (item.name == game.i18n.localize("CAIRN.Fatigue")) return;
      item.sheet.render(true);
  }

  /* -------------------------------------------- */
  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const template = "systems/air-bladder/templates/dialog/add-item-dialog.html";
    const content = await renderTemplate(template);

    new Dialog({
      title: game.i18n.localize("CAIRN.CreateItem"),
      content,
      buttons: {
        create: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("CAIRN.CreateItem"),
          callback: (html) => {
            const form = html[0].querySelector("form");
            if (form.itemname.value.trim() !== "") {
              this.actor.createOwnedItem({
                name: form.itemname.value,
                type: form.itemtype.value,
                weightless: form.itempetty.checked,
              });
            }
          },
        },
      },
      default: "create",
    }).render(true);
  }

  /* -------------------------------------------- */
  /**
   * Handle creating a new Owned Container for the actor
   * @param {Event} event   The originating click event
   * @private
   */
  async _onContainerCreate(event) {
    event.preventDefault();
    if (!game.user.hasPermission("ACTOR_CREATE")) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoActorCreate"));
      return;
    }
    const template = "systems/air-bladder/templates/dialog/add-container-dialog.html";
    const content = await renderTemplate(template);

    new Dialog({
      title: game.i18n.localize("CAIRN.CreateContainer"),
      content,
      buttons: {
        create: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("CAIRN.CreateContainer"),
          callback: async (html) => {
            const form = html[0].querySelector("form");
            if (form.itemname.value.trim() !== "") {
              const result = await Actor.create({
                type: "container",
                name: form.itemname.value,
                img: CONTAINER_ICON,
                "prototypeToken.texture.src": CONTAINER_ICON,
                "system.slots.value": form.itemslots.value,
              });
              await this.actor.createOwnedContainer(result);
            }
          },
        },
      },
      default: "create",
    }).render(true);
  }

  /* -------------------------------------------- */
  /**
   * Handle creating a new feature for the actor
   * @param {Event} event   The originating click event
   * @private
   */
  async _onFeatureCreate(event) {
    event.preventDefault();
    const template = "systems/air-bladder/templates/dialog/add-feature-dialog.html";
    const content = await renderTemplate(template);

    new Dialog({
      title: game.i18n.localize("CAIRN.CreateFeature"),
      content,
      buttons: {
        create: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("CAIRN.CreateFeature"),
          callback: async (html) => {
            const form = html[0].querySelector("form");
            if (form.itemname.value.trim() !== "") {
              const data = {
                "name": form.itemname.value,
                "description": form.itemdesc.value,
              };
              const checks = ['str','dex','wil','hp','armor','dmg','crit','deprived','blast'];
              checks.forEach((c) => {
                data[c] = form[c].checked;
              });
              await this.actor.createOwnedFeature(data);
            }
          },
        },
      },
      default: "create",
    },{
      "width": 500,
    }).render(true);
  }

  async _onFeatureEdit(item) {
    const template = "systems/air-bladder/templates/dialog/add-feature-dialog.html";
    const content = await renderTemplate(template, item);
    
    new Dialog({
      title: game.i18n.localize("CAIRN.EditFeature"),
      content,
      buttons: {
        update: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("CAIRN.UpdateFeature"),
          callback: async (html) => {
            const form = html[0].querySelector("form");
            if (form.itemname.value.trim() !== "") {
              const newItem = item;
              newItem.name  = form.itemname.value;
              newItem.description = form.itemdesc.value;
              const checks = ['str','dex','wil','hp','armor','dmg','crit','deprived','blast'];
              checks.forEach((c) => {
                newItem[c] = form[c].checked;
              });
              const features = this.actor.system.features.filter((f) => f.id != newItem.id);
              features.push(newItem);
              await this.actor.update({"system.features":features});
            }
          },
        },
      },
      default: "update",
    },{
      "width": 500,
    }).render(true);
  }

  /**
   * Full hireling re-roll: a fresh 2e statblock -- new Profession, day-rate,
   * abilities, HP and gear. Keeps the name, portrait and free-form notes.
   * @param {Event} event
   * @private
   */
  async _onRegenerateHireling(event) {
    event.preventDefault();
    await regenerateHireling(this.actor);
  }

  /**
   * Profession-only die: swap to a different example hireling and adopt its whole
   * canonical statblock (a 2e hireling's stats ARE its profession). Keeps the
   * name, portrait, notes and any GM-added gear.
   * @param {Event} event
   * @private
   */
  async _onRerollProfession(event) {
    event.preventDefault();
    await rerollHirelingProfession(this.actor);
  }

  /**
   * Name-only die: a fresh name off the Warden's 2e NPC name table, statblock
   * untouched.
   * @param {Event} event
   * @private
   */
  async _onRerollHirelingName(event) {
    event.preventDefault();
    await rerollHirelingName(this.actor);
  }

  /**
   * Dice beside the character's name: roll a new one from the same source
   * generation used, so a re-roll is indistinguishable from what the generator
   * would have produced.
   *
   * 2e names come from the CURRENT background's example-name list (so the name
   * still suits the background after it has been changed); Barebones falls back
   * to its spark table. Active tokens are renamed too, as regeneration does,
   * so a token on the canvas never keeps the discarded name.
   * @param {Event} event
   * @private
   */
  async _onRollName(event) {
    event.preventDefault();
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
   * Set the actor portrait and its token together. The token is the shipped
   * prepped art paired with the portrait by filename; for a custom image with no
   * paired token, the portrait itself is used so the token is never left stale.
   * @param {String} img
   * @private
   */
  /**
   * Set a container's art and its token together. Unlike a character portrait
   * there is no paired token file -- the same image serves both.
   * @param {String} img
   * @private
   */
  async _setContainerArt(img) {
    await this.actor.update({ img, "prototypeToken.texture.src": img });
    for (const t of this.actor.getActiveTokens()) {
      await t.document.update({ "texture.src": img });
    }
  }

  /**
   * Container art picker: a grayscale gallery of transport/container art
   * (CONTAINER_ART, all Foundry core icons), plus a Browse escape for anyone
   * with FILES_BROWSE. This is the container counterpart to _onEditPortrait --
   * clicking a container's portrait opens THIS, not the character gallery.
   * @private
   */
  async _onPickContainerArt(event) {
    event.preventDefault();
    const current = this.actor.img;

    const cells = CONTAINER_ART.map((src) => {
      const sel = src === current ? " selected" : "";
      const label = src.split("/").pop().replace(/\.\w+$/, "").replace(/[-_]/g, " ");
      return `<img class="cairn-portrait-choice${sel}" src="${src}" data-src="${src}" title="${label}" />`;
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
        await this._setContainerArt(img.dataset.src);
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
            await this._setContainerArt(path);
            dialog.close();
          },
        }).render(true);
      });
    }
  }

  async _setPortrait(img) {
    const tokenSrc = (await pairedTokenFor(img)) ?? img;
    await this.actor.update({ img, "prototypeToken.texture.src": tokenSrc });
    for (const t of this.actor.getActiveTokens()) {
      await t.document.update({ "texture.src": tokenSrc });
    }
  }

  /**
   * Dice on the portrait: roll a random shipped portrait, avoiding the current one
   * so it always changes. Reuses _setPortrait so the paired token swaps too.
   * @param {Event} event
   * @private
   */
  async _onRollPortrait(event) {
    event.preventDefault();
    event.stopPropagation();
    const manifest = await getPortraitManifest();
    const names = manifest?.names ?? [];
    if (!names.length) return;
    const dir = manifest.portraitDir ?? "systems/air-bladder/character_portraits";
    const all = names.map((n) => `${dir}/${n}`);
    const pool = all.filter((src) => src !== this.actor.img);
    const choices = pool.length ? pool : all;
    await this._setPortrait(choices[Math.floor(Math.random() * choices.length)]);
  }

  /**
   * Portrait picker: a gallery of the shipped portraits, a paste-a-URL row, and
   * (for users who may browse files) an escape to Foundry's FilePicker. Picking
   * any of them swaps the portrait AND its paired token via _setPortrait.
   * @param {Event} event
   * @private
   */
  async _onEditPortrait(event) {
    event.preventDefault();
    const manifest = await getPortraitManifest();
    const names = manifest?.names ?? [];
    const portraitDir = manifest?.portraitDir ?? "systems/air-bladder/character_portraits";
    const current = this.actor.img;

    const cells = names.map((n) => {
      const src = `${portraitDir}/${n}`;
      const sel = src === current ? " selected" : "";
      return `<img class="cairn-portrait-choice${sel}" src="${src}" data-src="${src}" title="${n}" />`;
    }).join("");

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
        <div class="cairn-portrait-grid">${cells}</div>
        ${urlRow}
        ${browseBtn}
        <div class="cairn-portrait-credit">${game.i18n.localize("CAIRN.PortraitCredit")}</div>
      </div>`;

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("CAIRN.ChoosePortrait"), icon: "fas fa-image" },
      position: { width: 520 },
      content,
      buttons: [{ action: "close", label: game.i18n.localize("CAIRN.Close"), default: true }],
    });
    await dialog.render(true);

    const root = dialog.element;
    root.querySelectorAll(".cairn-portrait-choice").forEach((img) => {
      img.addEventListener("click", async () => {
        await this._setPortrait(img.dataset.src);
        dialog.close();
      });
    });
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

  /**
   * Handle creating a fatigue for the actor
   * @param {Event} event   The originating click event
   * @private
   */
  async _onAddFatigue(event) {
    event.preventDefault();
    if (this.actor.isEncumbered()) {
      ui.notifications.warn(
        game.i18n.localize("CAIRN.Notify.MaxSlotsOccupied")
      );
      return;
    }

    this.actor.createOwnedItem({
      name: game.i18n.localize("CAIRN.Fatigue"),
      type: "item",
    });
  }

  /**
   * Handle removing any fatigue for the actor
   * @param {Event} event   The originating click event
   * @private
   */
  async _onRemoveFatigue(event) {
    event.preventDefault();

    // Find a fatigue to delete
    const fatigues = this.actor.items.filter(
      (i) => i.name === game.i18n.localize("CAIRN.Fatigue")
    );

    if (fatigues.length > 0) {
      const fatigue = fatigues[0];
      this.actor.deleteOwnedItem(fatigue._id);
    }
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    if (dataset.roll) {
      const usePanic = game.settings.get(SETTINGS_NS, "use-panic");
      let panicLabel = "";
      if (usePanic && this.actor.system.panicked) {
        dataset.roll = "1d4"; // panicked character
        panicLabel = "(" + game.i18n.localize("CAIRN.RollingWithPanic") + ")";
      }

      const roll = await evaluateFormula(
        dataset.roll,
        this.actor.getRollData()
      );
      const label = dataset.label
        ? game.i18n.localize("CAIRN.RollingDmgWith") +
          ` ${dataset.label} ` +
          panicLabel
        : "";

      const targetedTokens = Array.from(game.user.targets).map((t) => t.id);

      let targetIds;
      if (targetedTokens.length == 0) targetIds = null;
      else if (targetedTokens.length == 1) targetIds = targetedTokens[0];
      else {
        targetIds = targetedTokens[0];
        for (let index = 1; index < targetedTokens.length; index++) {
          const element = targetedTokens[index];
          targetIds = targetIds.concat(";", element);
        }
      }

      this._buildDamageRollMessage(label, targetIds).then((msg) => {
        roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          flavor: msg,
        });
      });
    }
  }

  _buildDamageRollMessage(label, targetIds) {
    const rollMessageTpl = "systems/air-bladder/templates/chat/dmg-roll-card.html";
    const tplData = { label: label, targets: targetIds };
    return renderTemplate(rollMessageTpl, tplData);
  }

  _onItemDescriptionToggle(event) {
    event.preventDefault();
    const boxItem = $(event.currentTarget).parents(".cairn-items-list-row");
    const isContainer = boxItem.data("isContainer");
    if (isContainer) {
      this._prepareContainerDescription(boxItem);
      return;
    }
    this._prepareItemDescription(boxItem);
  }

  _prepareContainerDescription(boxItem) {
    if (boxItem.hasClass("expanded")) {
      const summary = boxItem.children(".item-description");
      summary.slideUp(200, () => summary.remove());
    } else {
      const id = boxItem.data("itemId");
      const item = game.actors.find((a) => a.uuid == id);
      if (!item) return;
      // Build with .text() so a container's item names can't inject HTML/script
      // into the keeper's (or GM's) sheet when the row is expanded.
      const names = item.items.map((it) => it.name).join(", ");
      const div = $('<div class="item-description"></div>').text(names);
      boxItem.append(div.hide());
      div.slideDown(200);
    }
    boxItem.toggleClass("expanded");
  }

  _prepareItemDescription(boxItem) {
    const item = this.actor.items.get(boxItem.data("itemId"));
    if (boxItem.hasClass("expanded")) {
      const summary = boxItem.children(".item-description");
      summary.slideUp(200, () => summary.remove());
    } else {
      const desc = stripPar(item.system.description);
      let crit = "";
      if (
        item.system.criticalDamage &&
        stripPar(item.system.criticalDamage) !== ""
      )
        crit =
          '<div><i class="fa-regular fa-skull"></i> <i>'+
          stripPar(item.system.criticalDamage) +
          "</i></div>";
      const div = $(`<div class="item-description">${desc}${crit}</div>`);
      boxItem.append(div.hide());
      div.slideDown(200);
    }
    boxItem.toggleClass("expanded");
  }

  _onFeatureDescriptionToggle(event) {
    event.preventDefault();
    const boxItem = $(event.currentTarget).parents(".cairn-items-list-row");
    const item = this.actor.getOwnedFeature(boxItem.data("itemId"));
    if (!item) return;
    if (boxItem.hasClass("expanded")) {
      const summary = boxItem.children(".item-description");
      summary.slideUp(200, () => summary.remove());
    } else {
      const desc = stripPar(item.description);
      const div = $(`<div class="item-description">${desc}</div>`);
      boxItem.append(div.hide());
      div.slideDown(200);
    }
    boxItem.toggleClass("expanded");
  }


  async _onRollAbility(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    if (dataset.roll) {
      const roll = await evaluateFormula(
        dataset.roll,
        this.actor.getRollData()
      );
      const label = dataset.label
        ? game.i18n.localize("CAIRN.Rolling") + ` ${dataset.label}`
        : "";
      const rolled = roll.terms[0].results[0].result;
      const failed = roll.total === 0;
      const result = failed
        ? game.i18n.localize("CAIRN.Fail")
        : game.i18n.localize("CAIRN.Success");
      const resultCls = failed ? "failure" : "success";
      // Offer to mark Critical Damage on a failed STR save, but only when STR is
      // damaged and still above 0 (the crawling state; STR 0 is Dead). A generic
      // STR save at full health isn't Critical Damage. Matches the sheet skull gate.
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
  }

  /**
   * @param {MouseEvent} event
   * @private
   */
  async _onRegenerateCharacter(event) {
    event.preventDefault();

    const confirm = await Dialog.confirm({
      title: game.i18n.localize("CAIRN.CharacterRegeneratorTitle"),
      content: `<p>${game.i18n.localize(
        "CAIRN.CharacterRegeneratorConfirm"
      )}</p>`,
      defaultYes: false,
    });

    if (confirm) {
      await regenerateActor(this.actor);
    }
  }

  /** @override */
  _getHeaderButtons() {
    const base = super._getHeaderButtons();
    const showGenHeader = game.settings.get(SETTINGS_NS, "show-generate-header");
    const isChar = this.actor.type === "character";
    const isHireling = this.actor.type === "hireling";
    if ((!isChar && !isHireling) || !showGenHeader) return base;

    // Random-generation mode. Roll Character is ALWAYS rendered (so the toggle
    // can show/hide it by hand without a header rebuild); its initial visibility
    // is reconciled in activateListeners, NOT via a second class token here --
    // Foundry matches header buttons with classList.contains(b.class), so `class`
    // must stay a single token. The toggle sits right next to it. Default ON for
    // legacy characters lacking the field.
    const genEnabled = this.actor.system.generationEnabled !== false;
    // NOTE: onclick is a no-op on purpose. Foundry wires header-button clicks in a
    // setTimeout(500ms) after the outer frame renders (appv1 _renderOuter), which
    // is missed for ~1-2s when the first sheet's render is slowed by cold pack
    // loading -- leaving these buttons dead. We instead bind them reliably in
    // activateListeners; the no-op keeps the framework handler from also firing
    // and double-invoking.
    const noop = () => {};
    const toggleButton = {
      class: `toggle-generation-button-${this.actor.id}`,
      label: game.i18n.localize(genEnabled ? "CAIRN.RandomizationOn" : "CAIRN.RandomizationOff"),
      icon: genEnabled ? "fas fa-toggle-on" : "fas fa-toggle-off",
      onclick: noop,
    };
    // Both sheet types carry the SAME title-bar Roll button + Randomization
    // toggle, so the two headers read identically. Only the label and the click
    // handler differ (character -> "Roll Character" / _onRegenerateCharacter;
    // hireling -> "Roll NPC" / _onRegenerateHireling); the distinct class token
    // routes the click in activateListeners.
    const regenButton = {
      class: `regenerate-${isHireling ? "hireling" : "character"}-button-${this.actor.id}`,
      label: game.i18n.localize(isHireling ? "CAIRN.RollNpc" : "CAIRN.RegenerateCharacter"),
      icon: "fas fa-dice-d6",
      onclick: noop,
    };
    return [regenButton, toggleButton, ...base];
  }

  /**
   * Flip random-generation mode for this actor.
   *
   * Updates the header in place rather than re-rendering it: Foundry builds the
   * header once when the outer frame renders, so a rebuild would mean tearing
   * the whole window down. Roll Character is always present in the DOM and is
   * shown/hidden with a class.
   *
   * @param {Event} event
   */
  async _onToggleGeneration(event) {
    event.preventDefault();
    const now = this.actor.system.generationEnabled === false; // the value we're switching TO
    await this.actor.update({ "system.generationEnabled": now });

    const el = this.element;
    if (!el) return;
    el.find(`.regenerate-character-button-${this.actor.id}, .regenerate-hireling-button-${this.actor.id}`).toggleClass("cairn-header-hidden", !now);
    el.find(`.toggle-generation-button-${this.actor.id}`).html(
      `<i class="fas ${now ? "fa-toggle-on" : "fa-toggle-off"}"></i>${game.i18n.localize(now ? "CAIRN.RandomizationOn" : "CAIRN.RandomizationOff")}`
    );
  }

  /**
   * @override
   *
   * @param {DragEvent} event
   * @param {Object} itemData
   */
  async _onDropItem(event, itemData) {
    const { item: originalItem, actor: originalActor } =
      await getInfoFromDropData(itemData);
    if (originalItem == undefined || originalItem == null) {
      return;
    }
    // Same-actor drop: this is a reorder within our own inventory, not a
    // transfer. Honour it only when the GM has enabled drag-to-reorder.
    if (this.actor == originalActor) {
      if (game.settings.get(SETTINGS_NS, "enable-inventory-reorder")) {
        return this._onSortItem(event, originalItem);
      }
      return;
    }

    // A transfer takes the item off ANOTHER actor's sheet, so it needs write
    // access to that source. Without it the old code added to the target and then
    // failed (or silently duplicated) on the source — refuse it up front. A drop
    // from a compendium has no owning actor and is a copy, so it skips this.
    if (originalActor && !originalItem.isOwner) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DropNoSource"));
      return;
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
        return;
      }
    } else if (this.actor.isEncumbered()) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MaxSlotsOccupied"));
      return;
    }

    // Put the item on the target FIRST, and only move quantity off the source
    // once that has actually succeeded. The old order created-then-decremented
    // unconditionally: a refused create (typically a permissions wall) threw on
    // `.pop()` AND still decremented the source, so the item vanished.
    const foundItem = this.actor.items.find(
      (it) => it.name == originalItem.name && it.type == originalItem.type
    );
    if (foundItem != undefined && foundItem != null) {
      await foundItem.update({
        "system.quantity": (foundItem.system.quantity ?? 1) + 1,
      });
    } else {
      const created = ((await super._onDropItem(event, itemData)) || []).pop();
      if (!created) {
        ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DropFailed"));
        return;
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
  }

  /**
   * Reorder an item within this actor's own inventory by drag-and-drop, gated on
   * the "enable-inventory-reorder" setting. Only real embedded items take part:
   * dropping onto a gold-slot / worn-container row (no embedded item) is a no-op.
   * @param {DragEvent} event
   * @param {CairnItem} source  the dragged item
   * @private
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
   * Encumbrance and panic zero HP as DERIVED state (in _prepareCharacterData), but
   * a plain form submit would persist that 0 over the real stored value. Strip
   * system.hp.value from the submit while either condition holds, so the real
   * value reappears the moment the character is back under capacity / not panicked.
   * Real damage still persists — it goes through actor.update in damage.js.
   * @override
   */
  _getSubmitData(updateData) {
    const data = super._getSubmitData(updateData);
    if (
      this.actor.type === "character" &&
      (this.actor.system.encumbered || this.actor.system.panicked)
    ) {
      // The submit object may be flattened ("system.hp.value") or expanded.
      delete data["system.hp.value"];
      foundry.utils.deleteProperty(data, "system.hp.value");
    }
    return data;
  }

  /**
   * @override
   *
   * @param {DragEvent} event
   * @param {Object} itemData
   */
  async _onDropActor(event, data) {
    let actor = game.actors.find((a) => a.uuid == data.uuid);
    // undefined for a compendium actor or an unlinked token — only world
    // container actors can be attached as owned containers.
    if (!actor || actor.type !== "container") return;
    if (actor.system.keeper != "") {
      ui.notifications.warn(game.i18n.localize("CAIRN.ContainerAlreadyOwned"));
      return;
    }
    if (this.actor.uuid == data.uuid) return;
    await this.actor.createOwnedContainer(actor);
  }


  /** override */
  /** @inheritdoc */
  _onDragStart(event) {
    const li = event.currentTarget;
    if ( "link" in event.target.dataset ) return;

    // Create drag data
    let dragData;

    // Owned Items
    if ( li.dataset.itemId ) {
      if ( li.dataset.isContainer ) {
         const item = this.actor.getOwnedContainer(li.dataset.itemId);
         dragData = item.toDragData();
      } else {
        const item = this.actor.items.get(li.dataset.itemId);
        dragData = item.toDragData();
      }
    }

    // Active Effect
    if ( li.dataset.effectId ) {
      const effect = this.actor.effects.get(li.dataset.effectId);
      dragData = effect.toDragData();
    }

    if ( !dragData ) return;

    // Set data transfer
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }
}
