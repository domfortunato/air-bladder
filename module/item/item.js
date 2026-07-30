import { SETTINGS_NS } from "../settings.js";
import { iconForItem, SPELLBOOK_ICON, SPELLSCROLL_ICON } from "../icons.js";

/**
 * The stored name of a Fatigue item. ENGLISH, always — Foundry's language setting
 * is per-client, so an item created under the translated name was invisible to
 * every other language: a Spanish player's "Fatiga" did not match the English GM's
 * remove filter, and the − button silently did nothing for them both ways round.
 *
 * Storing it in English also keeps the system's own rule (i18n-content.js): stored
 * documents stay English and translation happens at display. The sheet localizes
 * the label it shows, so nobody actually reads this string.
 */
export const FATIGUE_NAME = "Fatigue";

/**
 * Every spellscroll is petty and single-use — the Warden's rule, and the one thing
 * that separates a scroll from the book of the same spell. So it is derived from
 * the `scroll` flag rather than typed in: the sheet offers no Petty box and no Max
 * uses field for a spellbook, and these values are written whenever the flag is.
 *
 * `uses.value` is deliberately absent: it is set once, on the transition to
 * `scroll: true` (a fresh scroll has its use), and left alone afterwards so
 * marking one spent survives the next save. Forcing it here would silently refill
 * every scroll on every edit.
 */
const SCROLL_PINNED = { weightless: true, equipped: false, "uses.max": 1 };

/** What ticking `scroll` off restores: a book is not petty and has no uses. */
const BOOK_PINNED = { weightless: false, "uses.max": 0, "uses.value": 0 };

/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class CairnItem extends Item {
  /**
   * Hold a spellbook to the scroll invariant at write time, whichever path wrote
   * it: the sheet's Scroll box, generation, a drag-and-drop copy, an importer, or
   * `Actor#createOwnedItem` (which rebuilds `system.weightless` from a top-level
   * field, so it would hand back an un-petty scroll on its own).
   *
   * Written to the document rather than derived in `prepareData`, so the stored
   * data is true — a derived-only petty flag would be a lie to anything reading the
   * document instead of the prepared model, and re-deriving a value that a form
   * also binds is how the HP clobber bug worked.
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    // Class art for anything created WITHOUT its own image. Foundry's Item schema
    // initialises `img` to `icons/svg/item-bag.svg`, so every item made through the
    // Create Item dialog kept the generic bag: a hand-made weapon, armor, spellbook
    // or scroll looked nothing like the shipped ones. `Actor#createOwnedItem` has
    // always done this for items it mints; the world/dialog path never did.
    //
    // It also unblocked the scroll art. `_preUpdate` only re-arts an item whose
    // image is still ours to change, and a bag was not — so ticking Scroll on a
    // dialog-created spellbook silently left the bag in place.
    if (!this.img || this.img === this.constructor.DEFAULT_ICON) {
      const art = this.type === "spellbook" && this.system.scroll
        ? SPELLSCROLL_ICON
        : iconForItem(this.type, this.name);
      this.updateSource({ img: art });
    }

    if (this.type !== "spellbook" || !this.system.scroll) return;
    const pinned = { ...SCROLL_PINNED };
    // A scroll created straight from the flag arrives UNSPENT — pinning only `max`
    // left `value` at the schema default of 0, so a new scroll rendered as already
    // used up. One created with an explicit count keeps it, which is what lets the
    // spellscroll migration carry a spent scroll across without refilling it.
    if (foundry.utils.getProperty(data ?? {}, "system.uses.value") === undefined) {
      pinned["uses.value"] = 1;
    }
    this.updateSource({ system: pinned });
  }

  /**
   * The same invariant on edit, plus the two transitions. Ticking Scroll makes a
   * fresh scroll (its one use unspent) and unticking restores a book; while the
   * flag merely stays on, `uses.value` is left alone so a spent scroll stays spent.
   *
   * The art follows the flag only when it is still ours to change — a Warden who
   * picked their own image keeps it.
   * @override
   */
  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate(changed, options, user);
    if (allowed === false) return false;
    if (this.type !== "spellbook") return;
    if (changed.system?.scroll === undefined) {
      // No transition: just hold the invariant for a scroll being edited.
      if (this.system.scroll) foundry.utils.mergeObject(changed, { system: SCROLL_PINNED });
      return;
    }
    const becomingScroll = !!changed.system.scroll;
    foundry.utils.mergeObject(changed, {
      system: becomingScroll ? { ...SCROLL_PINNED, "uses.value": 1 } : BOOK_PINNED,
    });
    // Re-art only while the image is still ours to change — a Warden who picked their
    // own keeps it. The default bag counts as ours: items created before the
    // class-art fill above still carry it, and leaving those on a bag was the whole
    // reported defect.
    const was = becomingScroll ? SPELLBOOK_ICON : SPELLSCROLL_ICON;
    if (this.img === was || this.img === this.constructor.DEFAULT_ICON) {
      changed.img = becomingScroll ? SPELLSCROLL_ICON : SPELLBOOK_ICON;
    }
  }

  /**
   * Augment the basic item data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();
    // Items in containers cannot be equippable.
    const actorType = this.actor ? this.actor.type : "";
    // A spellscroll is read once and consumed, never held ready, so it is the one
    // spellbook that cannot be equipped.
    this.system.isEquipable =
      ["weapon", "armor", "spellbook"].includes(this.type) &&
      !this.system.scroll &&
      actorType != "container";
    this.system.hasPlusMinus = (this.system.uses?.max ?? 0) > 0;
    if (this.system.uses) {
      if (this.system.uses.value > this.system.uses.max)
        this.system.uses.value = this.system.uses.max;
    }
    this.system.isFatigue = this.name === FATIGUE_NAME;

    // Grant-source chip (Background / Bond / Question) shown beside the item's
    // other tags, so the three sources are distinguishable. Starting gear and
    // bought items get none. The source rides on the item as
    // flags.air-bladder.grantSource ("background" / "bond:<id>" / "question:<i>"),
    // set at generation; the re-roll/replacement machinery keys off it, so the
    // display-only "show-grant-tags" setting never affects the flag itself.
    // A container that a background/question rolled, but recorded as a plain
    // (weightless) inventory item because the Containers tab is off. It keeps its
    // grantSource for the re-roll machinery, so the "Container" tag rides on a
    // separate flag and takes precedence over the source label. That flag also
    // suppresses the "Petty" (weightless) chip in the inventory row — a cart isn't
    // a petty item, it just isn't tracked as cargo when the feature is off.
    const grantSource = this.getFlag("air-bladder", "grantSource");
    const isContainerItem = !!this.getFlag("air-bladder", "containerItem");
    this.system.isContainerItem = isContainerItem;
    this.system.grantLabel =
      !game.settings.get(SETTINGS_NS, "show-grant-tags") ? ""
      : isContainerItem ? game.i18n.localize("CAIRN.GrantContainer")
      : grantSource === "background" ? game.i18n.localize("CAIRN.GrantBackground")
      : typeof grantSource === "string" && grantSource.startsWith("bond:") ? game.i18n.localize("CAIRN.GrantBond")
      : typeof grantSource === "string" && grantSource.startsWith("question:") ? game.i18n.localize("CAIRN.GrantQuestion")
      : grantSource === "failed-career" ? game.i18n.localize("CAIRN.GrantFailedCareer")
      : "";

    this.system.useItemIcons = game.settings.get(SETTINGS_NS, "use-item-icons");
    if (this.system.useItemIcons) {
      this.system.icon = "";
      switch (this.type) {
        case "spellbook":
          this.system.icon = this.system.scroll ? "scroll" : "book";
          break;
        case "weapon":
          this.system.icon = "sword";
          break;
        case "armor":
          this.system.icon = "shield";
          break;
        case "item":
          if (this.name === FATIGUE_NAME) {
            this.system.icon = "weight-hanging";
          }
          break;
      }
    }
    // Quantity fallback
    if (this.system.quantity == undefined) {
      this.system.quantity = 1;
    }
  }
}
