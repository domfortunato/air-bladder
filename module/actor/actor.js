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
   * Taking an EXISTING npc into the party's employ gets the same token defaults
   * `_preCreate` gives one generated as a hireling.
   *
   * `forHire` is not a create-time property: it is a checkbox on the NPC sheet, and
   * ticking it on a monster-shaped npc is the natural way to hire someone who is
   * already in the world. `_preCreate` is never revisited, so nothing re-applied
   * the defaults — the actor kept Foundry's own (`disposition` HOSTILE,
   * `actorLink` false, common/documents/token.mjs:62,73-74) and its token arrived
   * red-ringed and unlinked, so HP edited on the token never reached the sheet.
   * That is exactly the bug `b3eefa6` fixed for GENERATED hirelings, reachable by
   * the other route; observed 2026-07-30.
   *
   * Only from the Foundry defaults, and only on the false->true edge. A Warden who
   * has deliberately made a hireling NEUTRAL, or unlinked it on purpose, keeps that
   * — the same "an explicit value wins" rule `_preCreate` follows, applied to a
   * value chosen earlier rather than passed in the same breath. Un-ticking is not
   * the mirror image and does nothing: ceasing to be for hire is not a reason to
   * turn someone hostile.
   *
   * Only the prototype, which is all this can honestly promise. Tokens already on
   * a scene are their own documents and are left alone.
   */
  #applyForHireTokenDefaults(changed) {
    // flattenObject, so this reads the same whether the caller passed
    // `{system: {forHire: true}}` (the sheet, via expandObject) or the flat
    // `{"system.forHire": true}` (any API caller). getProperty would miss the
    // second: it walks dot paths and cannot see a key that CONTAINS the dots.
    const flat = foundry.utils.flattenObject(changed);
    if (flat["system.forHire"] !== true) return;
    if (this.system.forHire === true) return;                 // already hired

    const D = CONST.TOKEN_DISPOSITIONS;
    if (this.prototypeToken.disposition === D.HOSTILE
      && flat["prototypeToken.disposition"] === undefined) {
      foundry.utils.setProperty(changed, "prototypeToken.disposition", D.FRIENDLY);
    }
    if (this.prototypeToken.actorLink === false
      && flat["prototypeToken.actorLink"] === undefined) {
      foundry.utils.setProperty(changed, "prototypeToken.actorLink", true);
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
    this.system.containerObjects = this.connectedActors();
    // NOTE this is the live path for character, hireling AND npc (see the type
    // dispatch above) -- `_prepareNpcData` below is dead code and has been since
    // the two were merged. An NPC can now BE a container, so it needs the owner /
    // formerly-owner line the container sheet has always had.
    this._prepareConnectionLabel();

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
      // Being encumbered zeroes HP (Cairn 2e) — for the creatures that live by
      // the player rules: characters and hirelings. NOT for an npc. An NPC can
      // BE a container now, and a container holding exactly its capacity is its
      // NORMAL state, not an injury — folding containers into npc had put a
      // full crate on this line, where it read 0 HP on its own sheet and its
      // token bar, and _processFormData (which strips the HP input while
      // encumbered, so the derived 0 never persists) made the phantom
      // uncorrectable (review #5). The pre-merge _prepareNpcData never zeroed
      // HP either — the merge added it to NPCs by accident, not decision.
      if (this.type !== "npc") this.system.hp.value = 0;
      if (this.system.goldSlots > 0) {
        this.system.maybeTooMuchGold = true;
      }
    }

    // Panic stays for all three types: unlike encumbrance it is a checkbox the
    // Warden ticks deliberately, never a state a full inventory derives, and a
    // panicked horse at 0 HP is the rule working as intended.
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
    // NPCs can keep containers too (the Connected tab, gated by the setting).
    if (!this.system.containers) this.system.containers = [];
    this.system.containerObjects = this.connectedActors();
    // An NPC can now BE a container, so it needs the same owner / formerly-owner
    // line the container sheet has always had.
    this._prepareConnectionLabel();
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
    this._prepareConnectionLabel();

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
    // The owner's Connected row shows this actor's slotsUsed, so a content
    // change refreshes the owner's open sheet. Ungated: an npc can be a
    // container now, and the call is a no-op for anything unconnected.
    this._synchronizeOwnerSheets();
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
      // Same as createOwnedItem: the owner's row shows slotsUsed — ungated,
      // no-op for anything unconnected.
      this._synchronizeOwnerSheets();
    } else {
      await ui.notifications.error(game.i18n.localize("CAIRN.NoItemToDelete"));
    }
  }

  /**
   * DELETE a connected actor, for real.
   *
   * This used to be the only control on the tab, and it did not delete: it
   * filtered the owner's array and cleared `keeper` while the dialog asked
   * "Delete X?" — so a Warden aiming to destroy a crate got a crate that still
   * existed, now belonging to nobody. Harmless-looking then; under the new rule
   * ("a container connected to nobody IS a loot pile") it silently creates one
   * in the middle of the world every time.
   *
   * The two operations are now separate and both are honest about what they do.
   * @param {String} itemId uuid of the connected actor
   */
  async deleteOwnedContainer(itemId) {
    const container = this.getOwnedContainer(itemId);
    if (!container) return;
    const proceed = await confirmDelete(container.name);
    if (!proceed) return;
    const actor = game.actors.find((a) => a.uuid == itemId);
    // Prune the legacy array first. `connectedActors` no longer needs it, but a
    // world written before this still has entries, and leaving one behind would
    // re-dangle exactly the way the old two-way link did.
    if (this.system.containers?.includes(itemId)) {
      await this.update({ "system.containers": this.system.containers.filter((c) => c !== itemId) });
    }
    await actor?.delete();
  }

  /**
   * UNLINK a connected actor: it survives, connected to nobody.
   *
   * Which, under the rule, is precisely a loot pile — so this is the useful
   * gesture, not a lesser delete. Drop the sack on the floor and walk away.
   *
   * The previous owner's name is snapshotted as a STRING rather than left as a
   * uuid to resolve later. The commonest reason a pile exists is that its owner
   * died and was deleted, which is exactly when a uuid resolves to nothing: the
   * one fact worth keeping would be destroyed by the event that made it
   * interesting.
   * @param {String} itemId uuid of the connected actor
   */
  async unlinkOwnedContainer(itemId) {
    const container = this.getOwnedContainer(itemId);
    if (!container) return;
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CAIRN.UnlinkContainerTitle") },
      content: `<div class="cairn-confirm"><p class="cairn-confirm-q">${
        game.i18n.format("CAIRN.UnlinkContainerQ", {
          name: foundry.utils.escapeHTML(container.name),
        })}</p></div>`,
      rejectClose: false,
      modal: true,
    });
    if (!proceed) return;
    const actor = game.actors.find((a) => a.uuid == itemId);
    if (this.system.containers?.includes(itemId)) {
      await this.update({ "system.containers": this.system.containers.filter((c) => c !== itemId) });
    }
    await actor?.update({
      "system.connectedTo": "",
      "system.keeper": "",
      "system.formerlyBelongedTo": this.name,
    });
  }

  async deleteOwnedFeature(itemId) {
    const ft = this.getOwnedFeature(itemId);
    if (!ft) return;
    const proceed = await confirmDelete(ft.name);
    if (!proceed) return;
    const features = this.system.features.filter((c) => c.id !== itemId);
    await this.update({ "system.features": features });
  }

  /**
   * The one line under the name saying who this belongs to — or who it USED to.
   *
   * Three states, and the third is the one worth having: connected (name the
   * owner), never connected (say nothing), or unlinked (name whoever had it
   * last). That last line is why `formerlyBelongedTo` is a stored string rather
   * than a uuid — see the field's own note.
   *
   * Built with `format`, not concatenation. The previous version was
   * `localize("CAIRN.Owner") + ": " + actor.name`, which hands a translator a
   * fixed word order and a hardcoded colon; a language wanting "de X" or the name
   * first cannot express it, and no gate can see the problem because every piece
   * is individually localized.
   */
  _prepareConnectionLabel() {
    const link = this.system.connectedTo || this.system.keeper || "";
    this.system.ownedBy = "";
    if (link) {
      const owner = game.actors.find((a) => a.uuid === link);
      if (owner) this.system.ownedBy = game.i18n.format("CAIRN.OwnerNamed", { name: owner.name });
    } else if (this.system.formerlyBelongedTo) {
      this.system.ownedBy = game.i18n.format("CAIRN.FormerlyBelongedTo", {
        name: this.system.formerlyBelongedTo,
      });
    }
  }

  /**
   * Every Actor connected to this one — what the Connected tab lists.
   *
   * DERIVED, deliberately, and this is the point of `connectedTo`. The old model
   * was a two-way link: the owner kept a `system.containers` uuid array and the
   * container kept a `keeper` uuid pointing back, which meant two writes per
   * change and a whole family of bugs when only one of them landed — a uuid left
   * pointing at a deleted actor, a container whose keeper was set while the
   * parent's half was silently dropped by schema cleaning, and a delete race
   * where two prunes interleaved read-modify-writes on the same array and
   * whichever finished last re-dangled the other's entry.
   *
   * Computing the list from the child's own `connectedTo` deletes that entire
   * class: there is one place the fact is stored, so it cannot disagree with
   * itself, and a deleted actor simply stops appearing. It costs one pass over
   * `game.actors` per prepare, which is nothing next to the bookkeeping it removes.
   *
   * The legacy `system.containers` array is still unioned in so worlds built
   * before this keep showing their containers. That half goes away with `keeper`
   * itself; until then, note the `.filter(Boolean)` — the old `.map()` returned
   * `undefined` for a dangling uuid and the template rendered it as a blank row.
   * @returns {CairnActor[]}
   */
  connectedActors() {
    const mine = game.actors.filter((a) => a.system?.connectedTo === this.uuid);
    const legacy = (this.system.containers ?? [])
      .map((uuid) => game.actors.find((a) => a.uuid === uuid))
      .filter(Boolean);
    const seen = new Set(mine.map((a) => a.id));
    for (const a of legacy) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      mine.push(a);
    }
    return mine;
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

  /**
   * Re-render the OWNER's open sheet when this actor's link state — or anything
   * a Connected row shows (name, slots, class) — changes. The owner's list is
   * DERIVED from each child's `connectedTo` at render, so a link change writes
   * nothing to the owner document: no update, no render, a stale tab. That was
   * exactly review #5's finding — this method used to gate on
   * `type === "container"` + `keeper`, so a bought mount never appeared on the
   * Connected tab and a deleted one left a phantom row.
   *
   * ClientDocument#render re-renders only the applications actually open for
   * the document (the old `keeper.sheet._state > 0` probe read a private member
   * AND constructed a sheet as a side effect, because `.sheet` is a lazily-
   * constructing getter), so this is cheap in the common no-sheet case.
   * @param {string[]} [also]  FORMER owner uuids, stashed by _preUpdate — the
   *   sheet a cleared link just vanished from is precisely the one no current
   *   field still points at
   */
  _synchronizeOwnerSheets(also = []) {
    const refs = new Set([this.system.connectedTo, this.system.keeper, ...also].filter(Boolean));
    for (const uuid of refs) game.actors.find((a) => a.uuid === uuid)?.render(false);
  }

  /**
   * Two type-exclusive jobs, in the one `_preUpdate` this class is allowed to have.
   *
   * **npc / hireling** — `#applyForHireTokenDefaults`, above: ticking "For hire"
   * gets the token defaults `_preCreate` gives a generated hireling.
   *
   * **container** — re-art it when its type changes, but ONLY if it is still
   * wearing one of our class icons. Turning a chest into an Item Pile should look
   * like one, and `img` is a stored copy that no amount of derived data will move.
   * The same rule the icon migration uses: touch our own `icons/*.svg` and nothing
   * else, so a Warden who picked their own art (or browsed to a file) keeps it.
   * Idempotent — re-running on an already-correct path is a no-op.
   * @override
   */
  async _preUpdate(changed, options, user) {
    const result = await super._preUpdate(changed, options, user);
    if (result === false) return false;

    // ONE _preUpdate for the whole class. There were briefly two, and the second
    // silently won — a duplicate method in a class body is not an error, the later
    // definition simply replaces the earlier, so the first became dead code that
    // still read like working code. Caught only by instrumenting the loaded
    // prototype and seeing the wrong function body come back. The two concerns are
    // type-exclusive, so they dispatch here rather than each owning a hook.
    if (["npc", "hireling"].includes(this.type)) this.#applyForHireTokenDefaults(changed);

    // A changed link must re-render the FORMER owner's sheet too (an unlinked
    // mule has to vanish from the tab it was on), and by _onUpdate the old
    // value is gone — stash it on `options`, which travel with the operation
    // to _onUpdate on every client.
    if (changed.system && ("connectedTo" in changed.system || "keeper" in changed.system)) {
      options.airBladderFormerOwners = [this.system.connectedTo, this.system.keeper].filter(Boolean);
    }

    if (this.type !== "container") return result;
    const kind = changed.system?.transportKind;
    if (kind === undefined || kind === this.system.transportKind) return result;

    // Our own class art, plus Foundry's default — a container in an existing
    // world predates the create-time stamping above and is still on mystery-man,
    // which nobody chose either.
    const ours = new Set(Object.values(CONTAINER_CLASSES).map((c) => `${ICON_DIR}/${c.icon}.svg`));
    ours.add(CONST.DEFAULT_TOKEN);
    if (!ours.has(this.img)) return result;
    // The stored class still wins here, exactly as it does at creation. Without
    // it, changing a transportKind would re-art a container away from the class
    // its owner picked by hand — the one thing that override exists to prevent.
    const art = iconForTransport(
      changed.name ?? this.name,
      kind,
      changed.system?.containerClass ?? this.system.containerClass ?? "",
    );
    if (art === this.img) return result;
    changed.img = art;
    foundry.utils.setProperty(changed, "prototypeToken.texture.src", art);
    return result;
  }

  /** @override */
  _onUpdate(changed, options, userId) {
    this.system.slotsMax = this.calcCurrentMaxSlots();
    super._onUpdate(changed, options, userId);
    this._synchronizeOwnerSheets(options.airBladderFormerOwners ?? []);
  }

  /** @override */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    // A mount bought or granted arrives with `connectedTo` already set, and its
    // creation writes nothing to the owner (the list is derived) — so the
    // owner's open sheet learns about it here, on every client, or not at all.
    this._synchronizeOwnerSheets();
  }

  /**
   * Three delete-time jobs, batch-wise. (1) Every client re-renders the open
   * sheets of the deleted actors' OWNERS — the derived Connected list changed
   * with no owner write to say so. (2) On the acting client, a deleted OWNER's
   * still-connected children are unlinked and stamped `formerlyBelongedTo` with
   * its name — a dead character's mule becomes a labelled loot pile. (3) The
   * original job: prune deleted legacy containers from every keeper's uuid
   * list — ONCE per delete operation, over the whole batch. That last one was
   * a per-document `_onDelete` walk,
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
    // EVERY client re-renders the deleted actors' owners first — a deleted mule
    // must leave the Connected tab on all of them, and the derived list changes
    // with no owner update to trigger a render. (The WRITES below stay
    // acting-client-only.)
    const ownerRefs = new Set(documents.flatMap((d) => [d.system?.connectedTo, d.system?.keeper]).filter(Boolean));
    for (const uuid of ownerRefs) game.actors.find((a) => a.uuid === uuid)?.render(false);

    // Post-operation events fire on EVERY connected client — that is what the
    // `user` argument is for. Without this guard one container delete fired the
    // same prune from every browser: clients that do not own the keeper got a
    // permission-error toast for an action they did not take. Let the acting
    // client do it once (`isSelf` is core's own idiom — token.mjs:3150).
    if (!user.isSelf) return;

    // THE OTHER DIRECTION: the deleted actor was an OWNER. Anything still
    // connected to it becomes an unlinked pile carrying the former owner's
    // NAME — the exact scenario `formerlyBelongedTo` exists for: the commonest
    // way a loot pile comes into existence is the character dying and being
    // deleted, which is precisely when a uuid resolves to nothing. Review #5
    // found the field was only ever written on a deliberate unlink, never
    // here. A child that is itself in the delete batch is skipped — it is on
    // its way out, and updating it mid-delete is a write to a corpse.
    const deletedIds = new Set(documents.map((d) => d.id));
    for (const d of documents) {
      for (const child of game.actors) {
        if (deletedIds.has(child.id)) continue;
        if (child.system?.connectedTo !== d.uuid && child.system?.keeper !== d.uuid) continue;
        const patch = { "system.formerlyBelongedTo": d.name };
        // Clear whichever link field this type's schema actually has —
        // `connectedTo` on npc, `keeper` on legacy containers.
        if (child.system.connectedTo !== undefined) patch["system.connectedTo"] = "";
        if (child.system.keeper !== undefined) patch["system.keeper"] = "";
        await child.update(patch);
      }
    }

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
