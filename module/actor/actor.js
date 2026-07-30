import { SETTINGS_NS } from "../settings.js";
import { iconForItem, iconForTransport, containerClassLabel, CONTAINER_CLASSES, ICON_DIR } from "../icons.js";

/** Document names go into dialog HTML; a name is user-authored text. */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * "Delete <name>?" as ONE format key, never `localize("…Delete") + " " + name + "?"`.
 * Spanish opens the question with "¿", which concatenating a trailing "?" cannot
 * produce — the sentence has to be the translator's to write, whole.
 */
const confirmDelete = (name) =>
  foundry.applications.api.DialogV2.confirm({
    content: game.i18n.format("CAIRN.Notify.ConfirmDeleteNamed", { name: esc(name) }),
    rejectClose: false,
    modal: true,
  });

/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class CairnActor extends Actor {
  equipContainers = [];

  /**
   * Create-time defaults. They live in `_preCreate`, NOT in a `static create`
   * override, because a static only runs for callers that name this class:
   * compendium importAll, an Adventure import, and anything reaching for the
   * global `Actor` all route through `createDocuments` → `_preCreate` and never
   * touch a static — so defaults kept there were silently skipped on exactly
   * the bulk paths that create the most documents at once.
   *
   * An explicit value in the creation data always wins: the `=== undefined`
   * tests below are the `_preCreate` spelling of a `mergeObject(...,
   * {overwrite: false})`, and core uses the same idiom for its own create-time
   * default (canvas-document.mjs:125, `("sort" in data)`).
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    // Hirelings are player-facing helpers, so they get the same friendly, linked
    // token defaults a character does. Monsters must NOT — they are `npc` too.
    //
    // **`system.forHire` is the discriminator, not the type.** The Hireling->NPC
    // fold made the two one type, so a `type === "hireling"` test stopped matching
    // anything the generator produces: `hirelingToActorData` emits `type: "npc"`.
    // Every generated hireling therefore fell through to Foundry's own schema
    // defaults — `actorLink` is a BooleanField with no initial (false) and
    // `disposition` initials to HOSTILE (common/documents/token.mjs:62,73-74) — and
    // arrived red-ringed and unlinked, so HP edited on the token never reached the
    // sheet. Widening the test to plain `npc` would be the wrong fix: all 205
    // shipped monsters are npc documents and must stay hostile and unlinked.
    // `forHire` says exactly the thing that matters — this NPC is in the party's
    // employ. `hireling` stays in the test for documents created before the fold,
    // and for a Warden picking the still-registered alias in Create Actor.
    const isHireling =
      data.type === "hireling" || (data.type === "npc" && data.system?.forHire === true);
    if (data.type === "character" || isHireling) {
      // No `vision: true` here. It is not a field of PrototypeToken in v14 —
      // `defineSchema` keeps an explicit `included` set (common/data/data.mjs:614-616)
      // with no `vision` key — so `cleanData` pruned it silently and it has never done
      // anything. The v14 path is `sight.enabled`, and turning sight ON for these
      // tokens is a behaviour change, not this fix; left for a deliberate decision.
      const changes = {};
      if (data.prototypeToken?.disposition === undefined) {
        changes["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      }
      if (data.prototypeToken?.actorLink === undefined) {
        changes["prototypeToken.actorLink"] = true;
      }
      if (Object.keys(changes).length) this.updateSource(changes);
    }

    // Picking "Hireling" in the Create Actor dialog rolls a portrait, so a
    // hand-made one arrives looking like somebody instead of Foundry's
    // mystery-man. Deliberately NOT extended to `npc`: the 205 shipped monsters
    // are npc documents and each carries its own art, and a hand-made npc is as
    // often a monster as a person.
    //
    // `!data.img` guards it — an explicit image always wins, which is what keeps
    // pack imports and the generator's own paired art untouched. The import is
    // dynamic to avoid a cycle: character-generator.js imports this module.
    if (data.type === "hireling" && !data.img) {
      try {
        const { randomPortraitPair } = await import("../character-generator.js");
        const pair = await randomPortraitPair();
        if (pair) {
          const changes = { img: pair.img };
          if (data.prototypeToken?.texture?.src === undefined) {
            changes["prototypeToken.texture.src"] = pair.token;
          }
          this.updateSource(changes);
        }
      } catch (err) {
        // A missing manifest must not block creating an actor.
        console.warn("Air Bladder | could not assign a random hireling portrait:", err);
      }
    }

    // A container made by hand — the Warden's route to an Item Pile — arrived
    // wearing Foundry's mystery-man, because nothing stamped its class icon.
    // (`iconForActor` existed for this and was called from nowhere in `module/`;
    // only the pack importer used it.) An explicit `img` always wins: the
    // marketplace passes the transport's own art.
    if (data.type === "container" && !data.img) {
      const art = iconForTransport(
        data.name ?? "",
        data.system?.transportKind ?? "",
        data.system?.containerClass ?? "",
      );
      const changes = { img: art };
      if (data.prototypeToken?.texture?.src === undefined) {
        changes["prototypeToken.texture.src"] = art;
      }
      this.updateSource(changes);
    }
  }

  /**
   * Augment the basic actor data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    this.system.useItemIcons = game.settings.get(SETTINGS_NS, "use-item-icons");
    this.system.showFeatures = game.settings.get(SETTINGS_NS, "show-features-section");
    this.system.showContainersTab = game.settings.get(SETTINGS_NS, "show-containers-tab");
    // Both of these are now PERMANENTLY TRUE and no template reads either. They
    // date from template.json, where `biography`/`description` could be absent or
    // null; a TypeDataModel HTMLField initialises to "", which is neither. That is
    // how the NPC sheet ended up rendering two editors on its Description tab (an
    // always-true `{{#if system.showBio}}` above an always-true
    // `{{#if system.showDesc}}`) — fixed 2026-07-29 by rendering one, ungated.
    // Do not build a new conditional on these; they cannot be false.
    this.system.showBio = (this.system.biography !== undefined && this.system.biography !== null);
    this.system.showDesc = (this.system.description !== undefined && this.system.description !== null);


    // A hireling shares the character's inventory/armor/HP model wholesale --
    // slots, coins-as-slots, encumbrance, derived armor. Only the sheet differs.
    // npc joins this branch: it shares the hireling's sheet now, which reads
    // `armorOverridden`, `coinTip` and `maybeTooMuchGold` — none of which
    // `_prepareNpcData` ever set. That function was a near-duplicate of this one
    // minus the armor override and the coin accounting, so npc gains both rather
    // than the sheet gaining a second set of conditionals.
    if (["character", "hireling", "npc"].includes(this.type)) this._prepareCharacterData();
    if (this.type === "container") this._prepareContainerData();
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData() {
    // Armor is derived from equipped gear (calcArmor, capped at 3). A player can
    // override it — spells/effects set Armor directly — by storing a value in
    // system.armorOverride; null means "auto" (use the derived value). The
    // override still obeys the 0..3 cap. Both feed system.armor, which damage.js
    // reads.
    const derivedArmor = this.calcArmor();
    const override = this.system.armorOverride;
    const hasOverride = override !== null && override !== undefined && override !== "";
    this.system.armorOverridden = hasOverride;
    this.system.armor = hasOverride
      ? Math.min(3, Math.max(0, Math.trunc(Number(override)) || 0))
      : derivedArmor;
    this.system.slotsUsed = this.calcSlotsUsed();
    this.system.slotsMax = this.calcCurrentMaxSlots();
    this.system.encumbered =
      this.system.slotsUsed >= this.calcCurrentMaxSlots();
    this.system.maybeTooMuchGold = false;

    if (!this.system.containers) {
      this.system.containers = [];
    }
    this.system.containerObjects = this.system.containers.map((it) =>
      game.actors.find((a) => a.uuid == it)
    );

    // Coins are heavy (Cairn 2e, p.9). The first N coins stay petty (weightless);
    // every further N fills a slot -- N is the GM's "coins per slot" setting
    // (default 100). The filled slots render as "N Gold" rows in the inventory
    // (items-list.html) and count toward encumbrance like any other slot.
    this.system.coinsPerSlot = this._coinsPerSlot();
    this.system.coinRowLabel = game.i18n.format("CAIRN.NGold", { n: this.system.coinsPerSlot });
    this.system.coinTip = this.system.coinsPerSlot > 0
      ? game.i18n.format("CAIRN.GoldTip", { n: this.system.coinsPerSlot })
      : game.i18n.localize("CAIRN.GoldTipWeightless");
    this.system.goldSlots = this._calcGoldSlots();
    this.system.hasGoldThreshold = this.system.coinsPerSlot > 0;

    if (this.system.encumbered) {
      this.system.hp.value = 0;
      if (this.system.goldSlots > 0) {
        this.system.maybeTooMuchGold = true;
      }
    }

    this.system.usePanic = game.settings.get(SETTINGS_NS, "use-panic") > 0;
    if (this.system.usePanic && this.system.panicked) {
      this.system.hp.value = 0;
    }

    this.system.characterEquipmentLimit = game.settings.get(SETTINGS_NS, "character-inventory-limit");
  }

  /**
   * The GM's "coins per slot" value (setting `use-gold-threshold`, default 100).
   * <= 0 (or a non-number) means coins never weigh anything.
   * @returns {number}
   */
  _coinsPerSlot() {
    const n = game.settings.get(SETTINGS_NS, "use-gold-threshold");
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Slots the actor's coins occupy (Cairn 2e, p.9): the first N coins are petty
   * (0 slots), then one slot per further N -- ceil(gold/N) - 1. So with N=100,
   * <=100 is free, 150 is one slot (50 petty), 225 is two (25 petty). N is the
   * GM's coins-per-slot setting (_coinsPerSlot); N=0 disables coin weight. This
   * ONE rule governs every actor type -- coins weigh the same in a pocket, a
   * sack, or an NPC's hoard.
   * @returns {number}
   */
  _calcGoldSlots() {
    const n = this._coinsPerSlot();
    const gold = this.system.gold ?? 0;
    if (n <= 0 || gold <= 0) return 0;
    return Math.max(0, Math.ceil(gold / n) - 1);
  }

  _prepareNpcData() {
    this.system.armor = this.calcArmor();
    this.system.slotsUsed = this.calcSlotsUsed();
    this.system.slotsMax = this.calcCurrentMaxSlots();
    this.system.encumbered =
      this.system.slotsUsed >= this.calcCurrentMaxSlots();
    // NPCs can keep containers too (the Containers tab, gated by the setting).
    if (!this.system.containers) this.system.containers = [];
    this.system.containerObjects = this.system.containers.map((it) =>
      game.actors.find((a) => a.uuid == it)
    );
  }

  _prepareContainerData() {
    // What this container IS, in one word, on every container sheet. Still derived
    // by default — it follows the name and the type with nothing to keep in step,
    // and it is the only thing that tells a player a "Heavy Destrier" is a horse,
    // since the name does not say so and neither does anything else. `containerClass`
    // overrides it when someone has said outright what the thing is, which is the
    // only route available to a Warden whose language the keyword table does not
    // speak. Art and this label go through the same call, so they cannot disagree.
    this.system.classLabel = game.i18n.localize(
      containerClassLabel(this.name, this.system.transportKind, this.system.containerClass)
    );

    this.system.slotsUsed = this.calcSlotsUsed();
    this.system.slotsMax = this.calcCurrentMaxSlots();
    this.system.encumbered =
      this.system.slotsUsed >= this.calcCurrentMaxSlots();
    this.system.maybeTooMuchGold = false;
    if (this.system.keeper && this.system.keeper != "") {
      const actor = game.actors.find((a) => a.uuid == this.system.keeper);
      if (actor) {
        this.system.ownedBy =
          game.i18n.localize("CAIRN.Owner") + ": " + actor.name;
      }
    }

    this.system.coinsPerSlot = this._coinsPerSlot();
    this.system.coinRowLabel = game.i18n.format("CAIRN.NGold", { n: this.system.coinsPerSlot });
    this.system.hasGoldThreshold = this.system.coinsPerSlot > 0;
    this.system.goldSlots = this._calcGoldSlots();
    if (this.system.encumbered) {
      if (this.system.goldSlots > 0) {
        this.system.maybeTooMuchGold = true;
      }
    }
    this.system.showGoldNotCost = game.settings.get(SETTINGS_NS, "show-gold-not-cost");
  }

  /** @override */
  getRollData() {
    const data = super.getRollData();
    if (!data.abilities) return data;
    // Let us do @STR etc, instead of @abilities.str.value
    for (const [k, v] of Object.entries(data.abilities)) {
      if (!(k in data)) data[k] = v.value;
    }
    return data;
  }

  getOwnedItem(itemId) {
    return this.getEmbeddedDocument("Item", itemId);
  }

  getOwnedContainer(itemId) {
    return game.actors.find((a) => a.uuid == itemId);
  }

  getOwnedFeature(itemId) {
    if (!this.system.features) return undefined;
    return this.system.features.find(a => a.id == itemId);
  }

  async createOwnedItem(itemData) {
    if (this.isEncumbered() && !itemData.weightless) {
      await ui.notifications.warn(
        game.i18n.localize("CAIRN.Notify.MaxSlotsOccupied")
      );
      return;
    }
    await this.createEmbeddedDocuments("Item", [{
      ...itemData,
      img: itemData.img ?? iconForItem(itemData.type, itemData.name),
      // Merge, don't replace: a future caller passing a full system payload
      // (a weapon's damage, an armor value) would otherwise lose it.
      system: { ...(itemData.system ?? {}), weightless: itemData.weightless },
    }]);
    if (this.type == "container") {
      this._synchronizeKeeperSheet();
    }
  }

  /**
   * Attach a container Actor to this actor. The link is TWO writes — this actor
   * lists the container's uuid, the container's `keeper` points back — and both
   * must land or neither, because either half alone is a broken state.
   *
   * The old code wrote this actor first and the container second, with no
   * permission check and no catch. Containers are visible to players by default
   * (`show-container-actors`, and mounts/vehicles show in the directory), so a
   * player could drag a Warden's pack mule onto their own sheet: the first update
   * succeeded (they own their character), the second was refused. That left the
   * character listing a container whose `keeper` was still empty — unopenable, and
   * still claimable by anyone else. `_onDropItem` already refuses a transfer up
   * front for the same reason; this now matches.
   *
   * @param {CairnActor} data  the container Actor to attach
   */
  async createOwnedContainer(data) {
    if (!data || data.type != "container") return;
    const containers = this.system.containers ?? [];
    if (containers.includes(data.uuid)) return;

    // Refuse before writing anything. Both documents are written below, so both
    // need write access — asking canUserModify directly says exactly that, and
    // answers true for a GM.
    if (!this.canUserModify(game.user, "update") || !data.canUserModify(game.user, "update")) {
      ui.notifications.warn(
        game.i18n.format("CAIRN.Notify.ContainerNoPermission", { name: data.name })
      );
      return;
    }

    // A NEW array, not the live one. Pushing onto this.system.containers mutates
    // the prepared model in place, so a failed or rolled-back update would leave
    // the in-memory copy holding a link that was never persisted.
    await this.update({ "system.containers": [...containers, data.uuid] });
    try {
      // update container owner - named 'keeper' to avoid conflict.
      await data.update({ "system.keeper": this.uuid });
    } catch (err) {
      // Undo our half rather than leave the pair inconsistent.
      await this.update({ "system.containers": containers });
      ui.notifications.error(
        game.i18n.format("CAIRN.Notify.ContainerLinkFailed", { name: data.name })
      );
      console.error("Air Bladder | container link failed, rolled back", err);
    }
  }

  async createOwnedFeature(data) {
    if (!this.system.features) this.system.features = [];
    const newValue = this.system.features;
    data.id = foundry.utils.randomID();
    newValue.push(data);
    await this.update({ "system.features": newValue });
  }

  /** No longer an override as deleteOwnedItem is deprecated on type Actor */
  async deleteOwnedItem(itemId) {
    const item = this.items.get(itemId);
    if (item) {
      const proceed = await confirmDelete(item.name);
      if (!proceed) return;
      await item.delete();
      if (this.type == "container") {
        this._synchronizeKeeperSheet();
      }
    } else {
      await ui.notifications.error(game.i18n.localize("CAIRN.NoItemToDelete"));
    }
  }

  async deleteOwnedContainer(itemId) {
    const container = this.getOwnedContainer(itemId);
    if (!container) return;
    const proceed = await confirmDelete(container.name);
    if (!proceed) return;
    const containers = this.system.containers.filter((c) => c !== itemId);
    const actor = game.actors.find((a) => a.uuid == itemId);
    await this.update({ "system.containers": containers });
    // update container owner - named 'keeper' to avoid conflict.
    await actor.update({ "system.keeper": "" });
  }

  async deleteOwnedFeature(itemId) {
    const ft = this.getOwnedFeature(itemId);
    if (!ft) return;
    const proceed = await confirmDelete(ft.name);
    if (!proceed) return;
    const features = this.system.features.filter((c) => c.id !== itemId);
    await this.update({ "system.features": features });
  }

  calcSlotsUsed() {
    let totalSlots = this.items.reduce(
      (memo, item) =>
        memo +
        (item.system.bulky ?? false
          ? item.system.quantity != undefined
            ? 2 * item.system.quantity
            : 2
          : item.system.weightless ?? false
          ? 0
          : item.system.quantity != undefined
          ? item.system.quantity
          : 1),
      0
    );
    // One coin-weight rule for every actor type (Cairn 2e, p.9): first N petty,
    // then 1 slot per further N. N is the GM's coins-per-slot setting.
    totalSlots += this._calcGoldSlots();
    return totalSlots;
  }

  calcArmor() {
    const armor = this.items
      .filter((item) => ["armor", "item"].includes(item.type))
      .filter((item) => item.system.equipped ?? false)
      .map((item) => parseInt(item.system.armor ?? 0, 10))
      .reduce((a, b) => a + b, 0);

    return Math.min(armor, 3);
  }

  /**
   * The actor's slot capacity. `system.slots` is a plain number on EVERY actor
   * type: 0 means "no override, use the Warden's max-equip-slots setting". An
   * npc or container states its own capacity there; a character or hireling only
   * has one if the Warden set a per-character limit (the equipment-limit dialog,
   * gated by the character-inventory-limit setting).
   *
   * It used to be `{value: N}` for npc/container and a bare number for
   * character/hireling — the reason npcs could hold nothing at all, since
   * template.json declared a bare number and this read `.value` off it.
   * @returns {number}
   */
  calcCurrentMaxSlots() {
    const override = this.system.slots ?? 0;
    if (["npc", "container"].includes(this.type) && override > 0) return override;
    if (game.settings.get(SETTINGS_NS, "character-inventory-limit") && override > 0) return override;
    return game.settings.get(SETTINGS_NS, "max-equip-slots");
  }

  isEncumbered() {
    return this.system.slotsUsed >= this.calcCurrentMaxSlots();
  }

  _synchronizeKeeperSheet() {
    // Synchronize container owner sheet
    if (this.type !== "container" || this.system.keeper == "") return;
    const keeper = game.actors.find((a) => a.uuid == this.system.keeper);
    if (!keeper) return;
    // ClientDocument#render re-renders only the applications actually open for
    // this document -- the same swap already made in _onDeleteOperation below. The old
    // `keeper.sheet._state > 0` probe read a private member AND constructed a
    // sheet as a side effect, because `.sheet` is a lazily-constructing getter:
    // asking "is the sheet open?" built one for every keeper that had none.
    keeper.render(false);
  }

  /**
   * Re-art a container when its type changes — but ONLY if it is still wearing
   * one of our class icons. Turning a chest into an Item Pile should look like
   * one, and `img` is a stored copy that no amount of derived data will move.
   *
   * The same rule the icon migration uses: touch our own `icons/*.svg` and
   * nothing else, so a Warden who picked their own art (or browsed to a file)
   * keeps it. Idempotent — re-running on an already-correct path is a no-op.
   * @override
   */
  async _preUpdate(changed, options, user) {
    const result = await super._preUpdate(changed, options, user);
    if (result === false) return false;
    if (this.type !== "container") return result;
    const kind = changed.system?.transportKind;
    if (kind === undefined || kind === this.system.transportKind) return result;

    // Our own class art, plus Foundry's default — a container in an existing
    // world predates the create-time stamping above and is still on mystery-man,
    // which nobody chose either.
    const ours = new Set(Object.values(CONTAINER_CLASSES).map((c) => `${ICON_DIR}/${c.icon}.svg`));
    ours.add(CONST.DEFAULT_TOKEN);
    if (!ours.has(this.img)) return result;
    const art = iconForTransport(changed.name ?? this.name, kind);
    if (art === this.img) return result;
    changed.img = art;
    foundry.utils.setProperty(changed, "prototypeToken.texture.src", art);
    return result;
  }

  /** @override */
  _onUpdate(changed, options, userId) {
    this.system.slotsMax = this.calcCurrentMaxSlots();
    super._onUpdate(changed, options, userId);
    this._synchronizeKeeperSheet();
  }

  /**
   * Prune deleted containers from every keeper's uuid list — ONCE per delete
   * operation, over the whole batch. This was a per-document `_onDelete` walk,
   * and that shape loses a race with itself on a bulk delete: Foundry fires the
   * per-document callbacks without awaiting them (client-backend.mjs:472), so
   * deleting two containers kept by the same actor interleaved two
   * read-modify-writes of the same array — each read the pre-delete list, each
   * filtered out only its own uuid, and whichever update landed last put the
   * other container's uuid back, dangling. Batch-wise, the list is read once
   * and every deleted uuid leaves in one write. `_onDeleteOperation` is also
   * awaited by the workflow (client-backend.mjs:478), so a caller that awaits
   * a delete sees the prune already done.
   * @override
   */
  static async _onDeleteOperation(documents, operation, user) {
    await super._onDeleteOperation(documents, operation, user);
    // Post-operation events fire on EVERY connected client — that is what the
    // `user` argument is for. Without this guard one container delete fired the
    // same prune from every browser: clients that do not own the keeper got a
    // permission-error toast for an action they did not take. Let the acting
    // client do it once (`isSelf` is core's own idiom — token.mjs:3150).
    if (!user.isSelf) return;
    const gone = new Set(documents.filter((d) => d.type === "container").map((d) => d.uuid));
    if (!gone.size) return;
    for (const ac of game.actors) {
      // Hirelings and NPCs share the character data model (and so can keep
      // containers); without them here a deleted container leaves a dangling uuid.
      if (!["character", "hireling", "npc"].includes(ac.type)) continue;
      const list = ac.system.containers ?? [];
      const pruned = list.filter((u) => !gone.has(u));
      if (pruned.length === list.length) continue;
      await ac.update({ "system.containers": pruned });
      // ClientDocument#render re-renders only the applications actually open for
      // this document. The old `ac.sheet._state > 0` probe read a private member
      // AND instantiated a sheet on every actor it touched, because `.sheet` is a
      // lazily-constructing getter.
      ac.render(false);
    }
  }


}
