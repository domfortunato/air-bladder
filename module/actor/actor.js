import { SETTINGS_NS } from "../settings.js";
import { iconForItem, iconForTransport, containerClassSlots, CONTAINER_CLASSES, ICON_DIR } from "../icons.js";
import { THING_ROLES } from "../data-models.js";
import {
  atConnectionLimit, maxConnections,
  connectedOwnershipShape, brokenOwnershipShape, OWNERSHIP_SYNC_FLAG,
} from "../connections.js";

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

    // A document created as the still-registered `hireling` alias should READ as
    // one everywhere role is consulted, so stamp the role it obviously means —
    // `npc` since the collapse, with `forHire` taking the initial `true`.
    // Explicit creation data wins, as everywhere in this method.
    if (data.type === "hireling" && data.system?.role === undefined) {
      this.updateSource({ "system.role": "npc" });
    }

    // An NPC PERSON is a player-facing figure, so it gets the linked token a
    // character does. Monsters must NOT — they are `npc` too.
    //
    // **`system.role` is the discriminator, not the type.** The Hireling->NPC
    // fold made the two one type, so a `type === "hireling"` test stopped matching
    // anything the generator produces: `npcToActorData` emits `type: "npc"`.
    // Every generated hireling therefore fell through to Foundry's own schema
    // defaults — `actorLink` is a BooleanField with no initial (false) and
    // `disposition` initials to HOSTILE (common/documents/token.mjs:62,73-74) — and
    // arrived red-ringed and unlinked, so HP edited on the token never reached the
    // sheet.
    //
    // The test was `role === "hireling"` and is now role `npc` OR ABSENT, which
    // is the collapse working: being for hire stopped being a role, so the thing
    // that matters is "this npc is a person". Absent counts because a hand-made
    // one from Create Actor states nothing and takes the schema initial `npc`.
    // The old warning against widening to plain `npc` does not apply to it —
    // that was about the 205 shipped monsters, and every one of them (all 220
    // npc-typed pack documents, checked) states `role: monster` outright, as does
    // every programmatic creation in `module/`.
    const isNpcPerson = data.type === "hireling"
      || (data.type === "npc" && (data.system?.role === undefined || data.system?.role === "npc"));
    if (data.type === "character" || isNpcPerson) {
      // No `vision: true` here. It is not a field of PrototypeToken in v14 —
      // `defineSchema` keeps an explicit `included` set (common/data/data.mjs:614-616)
      // with no `vision` key — so `cleanData` pruned it silently and it has never done
      // anything. The v14 path is `sight.enabled`, and turning sight ON for these
      // tokens is a behaviour change, not this fix; left for a deliberate decision.
      const changes = {};
      if (data.prototypeToken?.disposition === undefined) {
        // NEUTRAL for an NPC, FRIENDLY only for a PC (2026-08-01, asked for).
        // Both used to be FRIENDLY, from when the branch only ever caught a
        // hireling — someone the party had already hired, so a green ring was a
        // fair guess. Role npc is now every person in the world who is not a
        // monster: an innkeeper, a captain, a rival. Neutral is the honest
        // default, and a Warden who means friendly says so on the token.
        changes["prototypeToken.disposition"] = data.type === "character"
          ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
          : CONST.TOKEN_DISPOSITIONS.NEUTRAL;
      }
      if (data.prototypeToken?.actorLink === undefined) {
        changes["prototypeToken.actorLink"] = true;
      }
      if (Object.keys(changes).length) this.updateSource(changes);
    }

    // An NPC PERSON made by hand rolls a portrait, so it arrives looking like
    // somebody instead of Foundry's mystery-man.
    //
    // This used to be the `hireling` type alone, deliberately, on the grounds
    // that "a hand-made npc is as often a monster as a person". The collapse
    // takes that argument away from it: the hireling type is hidden from Create
    // Actor now, so the ONLY hand-made person is an npc, and leaving the test
    // where it was would have quietly deleted the feature in the same commit
    // that hid its one entry point. A monster is made by the Generate Monster
    // button or dragged from the pack, and both carry their own art.
    //
    // `!data.img` guards it — an explicit image always wins, which is what keeps
    // pack imports and the generator's own paired art untouched. The import is
    // dynamic to avoid a cycle: character-generator.js imports this module.
    if (isNpcPerson && !data.img) {
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
        console.warn("Air Bladder | could not assign a random npc portrait:", err);
      }
    }

    // An unconnected non-monster npc defaults to LIMITED (2026-08-01): a
    // stranger's silhouette until it is connected or the Warden says
    // otherwise. `ownership === undefined` is the whole guard — an explicit
    // ownership in the creation data always wins, which is what keeps pack
    // imports (every pack doc states {default: 0}) and the probes' seeded
    // shapes untouched. Monsters keep Foundry's NONE: their ownership is
    // never this automation's to touch, in either direction. The server
    // permits creation-time `default` changes from any creator (it is UPDATES
    // it walls off), so this works for a player with ACTOR_CREATE too.
    //
    // WRITTEN BY REPLACING `_source.ownership`, not through `updateSource`, and
    // that is load-bearing rather than sloppy. `DocumentOwnershipField` declares
    // `initial: {default: NONE}` as ONE object held on the field instance
    // (common/data/fields.mjs:3791) and `getInitialValue` hands it back BY
    // REFERENCE with no clone (fields.mjs:265). So for every document created
    // without explicit ownership, `_source.ownership` IS that shared object —
    // and any write THROUGH it mutates the schema's own initial. Measured, all
    // three of the obvious spellings poison it: the dotted path
    // `"ownership.default"`, a whole `{ownership: {...}}` object, and even
    // `ForcedReplacement`. The symptom is brutal and silent — after the first
    // npc took LIMITED, every actor created for the rest of the session started
    // from `{default: 1}`, monsters included, whether or not this method ran at
    // all. Spreading into a new object replaces the REFERENCE instead, which is
    // the only one of the four that leaves the initial at `{default: 0}`.
    // The server still adds the creating user's OWNER entry after this.
    if (["npc", "hireling"].includes(data.type)
      && data.system?.role !== "monster"
      && data.ownership === undefined) {
      this._source.ownership = {
        ...this._source.ownership,
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
      };
    }

    // A container made by hand — the Warden's route to an Item Pile — arrived
    // wearing Foundry's mystery-man, because nothing stamped its class icon.
    // (`iconForActor` existed for this and was called from nowhere in `module/`;
    // only the pack importer used it.) An explicit `img` always wins: the
    // marketplace passes the transport's own art. An npc qualifies only when
    // its creation data SAYS it is a container-line thing (a Kind, or a
    // mount/transport/container role) — a hand-made npc is as often a monster,
    // and monsters keep mystery-man.
    const artRole = data.system?.role;
    const isContainerish = ["npc", "hireling"].includes(data.type) && (data.system?.containerClass
      || THING_ROLES.includes(artRole) || artRole === "mount");
    if (isContainerish && !data.img) {
      const art = iconForTransport(
        data.name ?? "",
        "",
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
   * Turning an EXISTING actor into an npc PERSON gets the same token defaults
   * `_preCreate` gives one created as one.
   *
   * Role is not only a create-time property: picking NPC on the sheet of a
   * monster-shaped npc is the natural way to promote something already in the
   * world into somebody the party can deal with. `_preCreate` is never revisited,
   * so nothing re-applied the defaults — the actor kept Foundry's own
   * (`disposition` HOSTILE, `actorLink` false, common/documents/token.mjs:62,73-74)
   * and its token arrived red-ringed and unlinked, so HP edited on the token never
   * reached the sheet. That is exactly the bug `b3eefa6` fixed for GENERATED
   * hirelings, reachable by the other route; observed 2026-07-30 (keyed on
   * `forHire`, then on the hireling role, now on the npc-person edge — three
   * spellings of one fact, which is the argument the collapse was made on).
   *
   * Only from the Foundry defaults, and only on the becoming-a-person edge. A
   * Warden who has deliberately made an NPC hostile-ringed, or unlinked it on
   * purpose, keeps that — the same "an explicit value wins" rule `_preCreate`
   * follows, applied to a value chosen earlier rather than passed in the same
   * breath. Leaving the role is not the mirror image and does nothing: ceasing
   * to be a person is not a reason to turn something hostile.
   *
   * Only the prototype, which is all this can honestly promise. Tokens already on
   * a scene are their own documents and are left alone.
   */
  #applyNpcTokenDefaults(changed) {
    // flattenObject, so this reads the same whether the caller passed
    // `{system: {role: "npc"}}` (the sheet, via expandObject) or the flat
    // `{"system.role": "npc"}` (any API caller). getProperty would miss the
    // second: it walks dot paths and cannot see a key that CONTAINS the dots.
    const flat = foundry.utils.flattenObject(changed);
    if (flat["system.role"] !== "npc") return;
    if (this.npcRole === "npc") return;                       // already a person

    const D = CONST.TOKEN_DISPOSITIONS;
    if (this.prototypeToken.disposition === D.HOSTILE
      && flat["prototypeToken.disposition"] === undefined) {
      // NEUTRAL, matching _preCreate: an npc person is not automatically an ally.
      foundry.utils.setProperty(changed, "prototypeToken.disposition", D.NEUTRAL);
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
    // Who shows the Connections tab. CHARACTERS ONLY consume this now
    // (2026-08-02): the child end's single upward edge became a header line on
    // the npc sheet, and a tab whose count could only ever read (0) or (1) went
    // with it — so the character template and TAB_IDS' filter are the readers
    // left. The npcRole clause is vestigial for them (a character's npcRole is
    // null); the isToken clause is the live one — an unlinked token's synthetic
    // actor cannot appear in anyone's list nor keep its own (canBeConnected).
    this.system.showContainersTab = this.npcRole !== "monster" && !this.isToken;
    // Role-derived sheet facts, computed once here rather than re-tested in
    // template conditionals: what `inanimate` and `forHire` used to answer.
    this.system.isThing = this.isThing;
    // The day-rate row, and the For Hire box that gates it. Two facts, because
    // the box must stay visible while unticked or there is no way to tick it
    // again — the deadlock the retired `inanimate`/`forHire` checkboxes taught,
    // now that one of them is back as a checkbox.
    this.system.isNpcPerson = this.npcRole === "npc";
    this.system.showDayRate = this.npcRole === "npc" && this.system.forHire === true;
    this.system.canKeep = this.canKeepConnected;
    // Round 2: Gold follows the role too. Mounts and things hide the COUNTER;
    // the stored value and the coins-take-slots rule are untouched, so a chest
    // that held 25gp still holds it (and it still weighs) — the sheet just
    // stops offering a purse on something that has no pockets to manage.
    this.system.showGold = !this.isThing && this.npcRole !== "mount";
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

    this.system.containerObjects = this.connectedActors();
    // The connection-line label ("Hired by…" / "Connected to…" / "Formerly
    // connected to…") is NOT derived here any more (2026-08-02): it names the
    // KEEPER, and nothing re-prepares this document when the keeper is renamed,
    // so the derived copy went stale until something else touched this actor.
    // The sheet builds it per render (actor-sheet.js `connectionLine`).
    // The one-word Kind label ("Horse", "Crate") is NOT derived here any more
    // (review #6): the sheet computes kindDisplay from CONTAINER_CLASSES
    // directly (actor-sheet.js _prepareContext), and the old system.classLabel
    // had no reader left outside dev probes.

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
      // Being encumbered zeroes HP (Cairn 2e) — for whoever lives by the
      // PLAYER rules. Keyed on ROLE, not type, since 2026-08-01: the old
      // `type !== "npc"` exemption was added for a container at exactly its
      // capacity — its NORMAL state, not an injury (review #5) — and that
      // reasoning is right for a crate and wrong for a person. An innkeeper
      // hauling ten slots is overburdened exactly like a PC; monster, mount,
      // transport and container keep the exemption. `livesByPlayerRules` is
      // the ONE statement of the rule — the sheet's _processFormData strip
      // (which drops the HP input from a submit while the 0 is derived, so it
      // never persists) reads the same getter, because the two sites
      // disagreeing IS review #5's bug: an HP edit silently dropped and the
      // field un-editable.
      if (this.livesByPlayerRules) this.system.hp.value = 0;
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

  /* `_prepareNpcData` and `_prepareContainerData` lived here and are gone
     (2026-07-31). The first had been dead since npc joined the character path
     and the file said so; the second was the `container` type's prepare, and
     the type is retired — everything it derived (the class label, the coin
     accounting, the connection line) `_prepareCharacterData` already does for
     the npc that replaced it. */

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

  /* `createOwnedContainer` lived here and is gone with the `container` type
     (2026-07-31): it accepted nothing else, so retiring the type made it
     unreachable. It was the two-write half of the old link — this actor's uuid
     array plus the child's `keeper` — with a rollback because either half alone
     was a broken state. `connectActor` replaced it with ONE write and no
     rollback to get wrong. */

  async createOwnedFeature(data) {
    // Build the new array without touching prepared state or the caller's
    // object (review #6): pushing into this.system.features put the feature
    // on the PREPARED data before the write, so a rejected update still
    // showed a phantom feature until the next prepare. deleteOwnedFeature's
    // shape — derive, then update.
    const feature = { ...data, id: foundry.utils.randomID() };
    await this.update({ "system.features": [...(this.system.features ?? []), feature] });
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
    const actor = game.actors.find((a) => a.uuid == itemId);
    if (!actor) return;
    // The SAME wall as connectActor, breaking instead of making: the Warden
    // always may, a player may when they own both ends. Round 2's Warden-only
    // reading retired with it (2026-08-01) — connection drives ownership now,
    // and a player dropping her own sack risks nobody else's documents. What
    // she risks is HER OWN standing: the broken shape strips the
    // connection-granted OWNER, so she cannot reconnect it alone. By design.
    if (!game.user.isGM && !(this.isOwner && actor.isOwner)) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.ConnectionOwnBothEnds"));
      return;
    }
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
    // The BROKEN shape rides the same update as the break (GM-side), or the
    // sync flag does (player-side) — mirror of connectActor's tail. Monsters
    // are excluded from the automation everywhere; one can only be here via
    // pre-automation data, and its ownership is not ours to touch.
    const changes = {
      "system.connectedTo": "",
      "system.formerlyBelongedTo": this.name,
    };
    if (actor.npcRole !== "monster") {
      if (game.user.isGM) {
        changes.ownership = foundry.data.operators.ForcedReplacement.create(brokenOwnershipShape(actor));
      } else {
        changes[`flags.air-bladder.${OWNERSHIP_SYNC_FLAG}`] = true;
      }
    }
    await actor.update(changes);
    if (!game.user.isGM && actor.npcRole !== "monster") {
      game.socket.emit(`system.${game.system.id}`, { action: "ownershipSync", childUuid: actor.uuid });
    }
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
   * The legacy `system.containers` array used to be unioned in for worlds built
   * before this. It went with `keeper` when the `container` type was retired
   * (2026-07-31), exactly as this note used to promise it would.
   * @returns {CairnActor[]}
   */
  /**
   * The actor's effective role. A character has no role and reads null.
   * Everything role-gated consults THIS, never `system.role` directly.
   *
   * The `hireling` TYPE used to be hard-mapped to role "hireling" here, ahead of
   * whatever the document stored — which meant a hireling-typed document whose
   * Warden had re-roled it to Mount on the sheet went on behaving as a hireling
   * everywhere, with the sheet showing the value it stored and the code reading
   * a different one. That is fixed by the collapse rather than in spite of it:
   * both types now answer with the STORED role, and the alias falls back to the
   * same `npc` initial an npc-typed document takes.
   * @returns {string|null}
   */
  get npcRole() {
    if (["npc", "hireling"].includes(this.type)) return this.system?.role || "npc";
    return null;
  }

  /** A thing rather than a creature — no stat block. What `inanimate` meant.
   *  This is also the "its Items tab is CARGO" test: a thing takes items
   *  stowed, never equipped, and refuses what will not fit. A mount is NOT a
   *  thing — it is a creature with a stat block that can wear barding. */
  get isThing() {
    return THING_ROLES.includes(this.npcRole);
  }

  /**
   * Does this actor live by the PLAYER rules — specifically, does being over
   * capacity read as an injury (HP 0) rather than as a full hold? A character
   * does by type; an npc-typed document does when it is a PERSON — role npc,
   * which covers a hireling-typed alias too, since `npcRole` answers with the
   * stored role or "npc". Monster, mount, transport and container are exempt:
   * a crate at exactly its capacity is in its normal state.
   *
   * A GETTER, deliberately, because the rule is stated in two places — the
   * derived zero in `_prepareCharacterData` and the submit strip in the
   * sheet's `_processFormData` — and review #5 is what their drifting costs:
   * when the strip fires without the zero (or the reverse), an HP edit is
   * silently dropped and the field becomes un-editable. Both sites read THIS,
   * so they cannot drift.
   * @returns {boolean}
   */
  get livesByPlayerRules() {
    return this.type === "character" || this.npcRole === "npc";
  }

  /**
   * May this actor KEEP connections? ONLY A CHARACTER (2026-08-01). The graph is
   * FLAT: every edge runs from a PC to something the PC has, and nothing else
   * keeps anything.
   *
   * Round 2 had allowed npc → npc, so a hireling could carry her own backpack.
   * The user retired it on the ownership question — "isn't nesting an invitation
   * to disaster?" — and the answer is yes, for a reason that is about
   * permissions rather than tidiness: connection now drives ownership, so under
   * nesting every connect and every break becomes a transitive walk over a
   * subtree, re-deriving the rights of documents nobody touched. Flat makes each
   * edge a two-document operation with nothing below it to recurse into.
   *
   * The old role table (KEEPER_ROLES) is gone with it: with keeping decided by
   * TYPE there is no role that can keep, so a list of them had one entry and no
   * future. `wouldCreateConnectionCycle` survives as belt-and-braces — under a
   * flat graph a cycle is unreachable (a character is never a target), so it now
   * guards against a re-introduced edge kind rather than against ordinary use.
   * @returns {boolean}
   */
  get canKeepConnected() {
    if (this.isToken) return false;   // see canBeConnected
    return this.type === "character";
  }

  /**
   * May this actor BE connected to a keeper? Monsters never join the graph, and
   * a character is only ever its root.
   * @returns {boolean}
   */
  get canBeConnected() {
    // An UNLINKED token's actor is a synthetic per-token copy, and the graph is
    // world-level: `connectedActors` filters `game.actors`, which no synthetic
    // actor is in, and every picker lists world actors only. So a link at
    // either end of one is invisible from the other — connecting TO it writes a
    // `connectedTo` that resolves to nothing ("Connected to an actor that no
    // longer exists"), and connecting it to a keeper writes into the token's
    // delta, where the keeper's list will never look. It cost a real
    // afternoon: a Backpack was connected to the world "Bat, Vampire" while the
    // sheet on screen was the unlinked TOKEN's — same name, same art, different
    // document, permanently empty tab. Link the token if you want it in the
    // graph; that makes `token.actor` the world Actor and `isToken` false.
    if (this.isToken) return false;
    // A PC is never kept (2026-07-31). Round 2 had allowed PC→PC as a party
    // roster; the user retired it — a character keeps npcs, hirelings, mounts,
    // transports and containers, and is the top of every chain. No branch is
    // needed to say so: `npcRole` is null for a character, so the line below
    // already refuses it, and the pair rule connectActor used to carry ("an
    // NPC never keeps a PC") is now a special case of "no character is a legal
    // target at all". CharacterData no longer declares `connectedTo`, so this
    // is belt and braces over a write the schema would drop anyway.
    return this.npcRole !== null && this.npcRole !== "monster";
  }

  /**
   * Would connecting `candidate` to THIS actor close a loop? Belt-and-braces
   * since the flat graph (2026-08-01): a keeper is a character and a character
   * never stores a `connectedTo`, so the walk below terminates at the first
   * step and no loop is reachable through `connectActor`. It stays because a
   * pre-flat world can still hold npc → npc chains until the migration
   * flattens them, and because the guard is what refuses a re-introduced edge
   * kind rather than trusting every future caller. The visited set caps a
   * chain that is already broken (two old documents pointing at each other) —
   * without it, that pre-existing corruption would hang the check instead of
   * failing it.
   * @param {CairnActor} candidate  the actor about to be connected to this one
   * @returns {boolean}
   */
  wouldCreateConnectionCycle(candidate) {
    if (!candidate) return false;
    const seen = new Set();
    let cur = this;
    while (cur) {
      if (cur.uuid === candidate.uuid) return true;
      if (seen.has(cur.uuid)) return false;
      seen.add(cur.uuid);
      const up = cur.system?.connectedTo || "";
      cur = up ? game.actors.find((a) => a.uuid === up) : null;
    }
    return false;
  }

  /**
   * Connect an existing actor to this one — the Add Connection gesture, and the
   * ONE write the graph needs (`connectedTo` on the child; the list on this side
   * is derived). Guards in refusal order: the caller is the Warden, this actor
   * may keep, the target may be connected, the pair is legal, the target is
   * free, no loop, and the caller can write the target. Returns true on
   * success so dialogs can close quietly on refusal.
   *
   * The Warden gate lives HERE, not in the sheet handlers, for the same reason
   * the no-nesting wall does: every spelling of the gesture (picker dialog,
   * drag-drop, the child end's Connect to…) funnels through this method, and
   * every caller IS a manual gesture — the automatic flows players keep
   * (marketplace buys, the socket mint, the custom-container dialog) write
   * `connectedTo` in their create data and never come through here.
   * @param {CairnActor} target
   * @returns {Promise<boolean>}
   */
  async connectActor(target) {
    if (!target || target === this) return false;
    // ONE wall, every spelling (2026-08-01): the Warden always may; a player
    // may when they own BOTH ends. This replaced the Warden-only gate the day
    // connection started driving ownership — with the graph flat and the
    // shapes automated, a player wiring her own mule to her own PC risks
    // nobody else's documents.
    if (!game.user.isGM && !(this.isOwner && target.isOwner)) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.ConnectionOwnBothEnds"));
      return false;
    }
    if (!this.canKeepConnected) {
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.NoNesting", { name: this.name }));
      return false;
    }
    if (!target.canBeConnected) {
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.CannotConnect", { name: target.name }));
      return false;
    }
    // The pair rule that used to sit here — "an NPC never keeps a PC" — is
    // gone because the general case swallowed it: a PC is never kept BY
    // ANYONE, so `canBeConnected` above refuses every character and no
    // combination needs testing. Its NpcCannotKeepPc notice retired with it —
    // deliberately NOT written here in full, because `check:i18n`'s source gate
    // counts a key quoted in a comment as a reference and would then report the
    // en.json entry I just deleted as missing. The refusal a Warden now sees is
    // the plain CannotConnect.
    //
    // ONE upward link at a time (Round 2, settled over "both at once"). The
    // picker already filtered connected actors out, but a drop never went
    // through the picker — without this wall it could steal a connected actor
    // from its keeper in one gesture.
    if (target.system?.connectedTo) {
      ui.notifications.warn(game.i18n.localize("CAIRN.AlreadyConnected"));
      return false;
    }
    // The ceiling. Stated here as well as in the pickers because this is the
    // method a DROP goes through, and a drop never saw a filtered list.
    if (atConnectionLimit(this)) {
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.ConnectionLimit", {
        name: this.name,
        max: maxConnections(),
      }));
      return false;
    }
    if (this.wouldCreateConnectionCycle(target)) {
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.ConnectionCycle", { name: target.name }));
      return false;
    }
    if (!target.canUserModify(game.user, "update")) {
      ui.notifications.warn(
        game.i18n.format("CAIRN.Notify.ContainerNoPermission", { name: target.name })
      );
      return false;
    }
    // Ownership follows connection — the CONNECTED shape ({default: OBSERVER,
    // keeper's players: OWNER}), not the old wholesale copy of the keeper's
    // ownership, and folded into the SAME update as the link so no window
    // exists in which the edge is made and the rights are not. Only a GM
    // client may write it (the server refuses ownership changes from anyone
    // below Assistant); a player — who passed the both-ends wall above — sets
    // the sync flag in the same write instead and asks the active GM's client
    // to apply the shape, recomputed from document state (connections.js).
    const changes = {
      "system.connectedTo": this.uuid,
      "system.formerlyBelongedTo": "",
    };
    if (game.user.isGM) {
      changes.ownership = foundry.data.operators.ForcedReplacement.create(connectedOwnershipShape(this));
    } else {
      changes[`flags.air-bladder.${OWNERSHIP_SYNC_FLAG}`] = true;
    }
    await target.update(changes);
    if (!game.user.isGM) {
      game.socket.emit(`system.${game.system.id}`, { action: "ownershipSync", childUuid: target.uuid });
    }
    return true;
  }

  connectedActors() {
    return game.actors.filter((a) => a.system?.connectedTo === this.uuid);
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
   * npc — including the frozen hireling alias, same model — states its own
   * capacity there; a character only has one if the Warden set a per-character
   * limit (the equipment-limit dialog, gated by the character-inventory-limit
   * setting).
   *
   * It used to be `{value: N}` for npc/container and a bare number for
   * character/hireling — the reason npcs could hold nothing at all, since
   * template.json declared a bare number and this read `.value` off it.
   * @returns {number}
   */
  calcCurrentMaxSlots() {
    const override = this.system.slots ?? 0;
    if (["npc", "hireling"].includes(this.type) && override > 0) return override;
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
    const refs = new Set([this.system.connectedTo, ...also].filter(Boolean));
    for (const uuid of refs) game.actors.find((a) => a.uuid === uuid)?.render(false);
  }

  /**
   * Two jobs, in the one `_preUpdate` this class is allowed to have.
   *
   * **npc / hireling** — `#applyNpcTokenDefaults`, above (picking the NPC role
   * gets the token defaults `_preCreate` gives one created that way),
   * and the Kind defaults: typing a KNOWN `containerClass` brings its art and
   * capacity, because `img` is a stored copy that no amount of derived data will
   * move. Touch our own `icons/*.svg` and nothing else, so a Warden who picked
   * their own art keeps it; idempotent, since a correct path is left alone.
   * The Career defaults ride the same dispatch: a profession the 2e catalogue
   * knows fills a still-zero day rate.
   *
   * **any type** — stash the former owner so `_onUpdate` can re-render the sheet
   * a broken link just vanished from.
   *
   * The `container` type had a third job here (re-art on a `transportKind`
   * change); it went with the type.
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
    if (["npc", "hireling"].includes(this.type)) {
      this.#applyNpcTokenDefaults(changed);

      // Typing a KNOWN Kind brings its defaults, exactly as picking its
      // glyph from the gallery would: art (only while the current image is
      // ours or Foundry's default — a Warden's own picture is never
      // overwritten) and capacity (only while still 0, the same "a typed
      // value wins" rule _setContainerArt follows). An unknown word — a
      // Warden's own Kind — changes nothing but the label.
      const flat = foundry.utils.flattenObject(changed);
      const cls = flat["system.containerClass"];
      if (cls && cls !== this.system.containerClass && CONTAINER_CLASSES[cls]) {
        if (flat["img"] === undefined) {
          const ours = new Set(Object.values(CONTAINER_CLASSES).map((c) => `${ICON_DIR}/${c.icon}.svg`));
          ours.add(CONST.DEFAULT_TOKEN);
          if (ours.has(this.img)) {
            const art = iconForTransport(changed.name ?? this.name, "", cls);
            changed.img = art;
            foundry.utils.setProperty(changed, "prototypeToken.texture.src", art);
          }
        }
        if (flat["system.slots"] === undefined && !Number(this.system.slots)) {
          const dflt = containerClassSlots(cls);
          if (dflt) foundry.utils.setProperty(changed, "system.slots", dflt);
        }
      }

      // Typing a Career the 2e catalogue KNOWS brings its day rate, exactly as
      // a known Kind brings its capacity above, under the same "a typed value
      // wins" rule: only while the stored rate is still 0, and never over a
      // rate the same update names — which is also what keeps regenerateNpc
      // and rerollNpcProfession out of here, since both set profession and
      // dayRate in one write. Role npc only (nothing else has a career), and
      // matched case-insensitively so a Warden typing "bandit" gets the
      // Bandit's rate. The import is dynamic for the same reason _preCreate's
      // is: character-generator.js imports this module, so a static import
      // would be a cycle.
      const prof = flat["system.profession"];
      if (prof && prof !== this.system.profession
        && (flat["system.role"] ?? this.npcRole) === "npc"
        && !Number(this.system.dayRate)
        && flat["system.dayRate"] === undefined) {
        try {
          const { getNpcCareers2e } = await import("../character-generator.js");
          const wanted = String(prof).trim().toLowerCase();
          const entry = (await getNpcCareers2e()).find((h) => h.name.toLowerCase() === wanted);
          if (entry?.rate) foundry.utils.setProperty(changed, "system.dayRate", entry.rate);
        } catch (err) {
          // A missing catalogue must not block the rename that triggered this.
          console.warn("Air Bladder | could not autofill a day rate:", err);
        }
      }
    }

    // A changed link must re-render the FORMER owner's sheet too (an unlinked
    // mule has to vanish from the tab it was on), and by _onUpdate the old
    // value is gone — stash it on `options`, which travel with the operation
    // to _onUpdate on every client.
    if (changed.system && "connectedTo" in changed.system) {
      options.airBladderFormerOwners = [this.system.connectedTo].filter(Boolean);
    }

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
   * Two delete-time jobs, batch-wise. (1) Every client re-renders the open
   * sheets of the deleted actors' OWNERS — the derived Connected list changed
   * with no owner write to say so. (2) On the acting client, a deleted OWNER's
   * still-connected children are unlinked and stamped `formerlyBelongedTo` with
   * its name — a dead character's mule becomes a labelled loot pile.
   *
   * There was a third: pruning deleted legacy containers out of every keeper's
   * uuid array. It is gone with the array (and with the `container` type), but
   * the reason this method is BATCH-wise is entirely that job's, and it still
   * governs anything added here. It began as a per-document `_onDelete` walk,
   * and that shape loses a race with itself on a bulk delete: Foundry fires the
   * per-document callbacks without awaiting them (client-backend.mjs:472), so
   * deleting two containers kept by the same actor interleaved two
   * read-modify-writes of the same array — each read the pre-delete list, each
   * filtered out only its own uuid, and whichever update landed last put the
   * other container's uuid back, dangling. `_onDeleteOperation` is also awaited
   * by the workflow (client-backend.mjs:478), so a caller that awaits a delete
   * sees this finished.
   * @override
   */
  static async _onDeleteOperation(documents, operation, user) {
    await super._onDeleteOperation(documents, operation, user);
    // EVERY client re-renders the deleted actors' owners first — a deleted mule
    // must leave the Connected tab on all of them, and the derived list changes
    // with no owner update to trigger a render. (The WRITES below stay
    // acting-client-only.)
    const ownerRefs = new Set(documents.map((d) => d.system?.connectedTo).filter(Boolean));
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
    const updates = [];
    for (const d of documents) {
      for (const child of game.actors) {
        if (deletedIds.has(child.id)) continue;
        if (child.system?.connectedTo !== d.uuid) continue;
        // A broken edge takes the BROKEN ownership shape with it (2026-08-01),
        // in the same update as the break. Actor deletion is Assistant+, so
        // the acting client here always holds isGM and may write ownership
        // directly — no relay needed. Monsters excluded, as everywhere.
        const changes = {
          _id: child.id,
          "system.formerlyBelongedTo": d.name,
          "system.connectedTo": "",
        };
        if (child.npcRole !== "monster") {
          changes.ownership = foundry.data.operators.ForcedReplacement.create(brokenOwnershipShape(child));
        }
        updates.push(changes);
      }
    }
    // ONE batched write, not one awaited update() per orphan (review #6): a
    // keeper with several children cost a server round-trip each, serially,
    // all inside a hook the workflow awaits — the delete stalled behind them.
    // `this` is CairnActor here (static method), which matters: the global
    // `Actor` is not CONFIG.Actor.documentClass.
    if (updates.length) await this.updateDocuments(updates);
  }


}
