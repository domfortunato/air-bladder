import { SETTINGS_NS } from "../settings.js";
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
    this.system.isFatigue = this.name == game.i18n.localize("CAIRN.Fatigue");

    // Grant-source chip (Background / Bond / Question) shown beside the item's
    // other tags, so the three sources are distinguishable. Starting gear and
    // bought items get none. The source rides on the item as
    // flags.air-bladder.grantSource ("background" / "bond:<id>" / "question:<i>"),
    // set at generation; the re-roll/replacement machinery keys off it, so the
    // display-only "show-grant-tags" setting never affects the flag itself.
    const grantSource = this.getFlag("air-bladder", "grantSource");
    this.system.grantLabel =
      !game.settings.get(SETTINGS_NS, "show-grant-tags") ? ""
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
          if (this.name == game.i18n.localize("CAIRN.Fatigue")) {
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
