import { SETTINGS_NS } from "../settings.js";

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
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class CairnItem extends Item {
  /**
   * Augment the basic item data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();
    // Items in containers cannot be equippable.
    const actorType = this.actor ? this.actor.type : "";
    this.system.isEquipable =
      ["weapon", "armor", "spellbook"].includes(this.type) &&
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
          this.system.icon = "book";
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
