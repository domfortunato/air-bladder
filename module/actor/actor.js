import { SETTINGS_NS } from "../settings.js";
import { iconForItem } from "../icons.js";
/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class CairnActor extends Actor {
  equipContainers = [];

  /** @override */
  static async create(data, options = {}) {
    // Hirelings are player-facing helpers, so they get the same friendly, linked,
    // sighted token defaults a character does.
    if (data.type === "character" || data.type === "hireling") {
      foundry.utils.mergeObject(
        data,
        {
          prototypeToken: {
            disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
            actorLink: true,
            vision: true,
          },
        },
        { override: false }
      );
    }
    return super.create(data, options);
  }

  /**
   * Augment the basic actor data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    this.system.useItemIcons = game.settings.get(SETTINGS_NS, "use-item-icons");
    this.system.showFeatures = game.settings.get(SETTINGS_NS, "show-features-section");
    this.system.showContainersTab = game.settings.get(SETTINGS_NS, "show-containers-tab");
    this.system.showBio = (this.system.biography !== undefined && this.system.biography !== null);
    this.system.showDesc = (this.system.description !== undefined && this.system.description !== null);
    
    // A hireling shares the character's inventory/armor/HP model wholesale --
    // slots, coins-as-slots, encumbrance, derived armor. Only the sheet differs.
    if (this.type === "character" || this.type === "hireling") this._prepareCharacterData();
    if (this.type === "npc") this._prepareNpcData();
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

  async createOwnedContainer(data) {
    if (!this.system.containers) this.system.containers = [];
    if (!data || data.type != "container") return;
    if (this.system.containers.find((c) => c.uuid == data.uuid) != undefined)
      return;

    const newValue = this.system.containers;
    newValue.push(data.uuid);
    await this.update({ "system.containers": newValue });
    // update container owner - named 'keeper' to avoid conflict.
    await data.update({ "system.keeper": this.uuid });
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
      const proceed = await foundry.applications.api.DialogV2.confirm({
        content:
          game.i18n.localize("CAIRN.Notify.ConfirmDelete") +
          " " +
          item.name +
          "?",
        rejectClose: false,
        modal: true,
      });
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
    const proceed = await foundry.applications.api.DialogV2.confirm({
      content:
        game.i18n.localize("CAIRN.Notify.ConfirmDelete") +
        " " +
        container.name +
        "?",
      rejectClose: false,
      modal: true,
    });
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
    const proceed = await foundry.applications.api.DialogV2.confirm({
      content:
        game.i18n.localize("CAIRN.Notify.ConfirmDelete") +
        " " +
        ft.name +
        "?",
      rejectClose: false,
      modal: true,
    });
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
    if (keeper.sheet._state > 0) {
      // sheet visible
      keeper.sheet.render(false);
    }
  }

  /** @override */
  _onUpdate(changed, options, userId) {
    this.system.slotsMax = this.calcCurrentMaxSlots();
    super._onUpdate(changed, options, userId);
    this._synchronizeKeeperSheet();
  }

  /** @override */
  async _onDelete(options, userId) {
    const id = this.uuid;
    super._onDelete(options, userId);
    // _onDelete runs on EVERY connected client — that is what the userId argument
    // is for. Without this guard one container delete fired the same prune from
    // every browser: clients that do not own the keeper got a permission-error
    // toast for an action they did not take, and clients that do own it raced each
    // other writing the same array. Let the acting client do it once.
    if (userId !== game.user.id) return;
    // Sequential, not forEach(async …): the callbacks there are never awaited, so
    // the prunes overlapped and could write back a stale array.
    for (const ac of game.actors) {
      // Hirelings and NPCs share the character data model (and so can keep
      // containers); without them here a deleted container leaves a dangling uuid.
      if ((ac.type == "character" || ac.type == "hireling" || ac.type == "npc") && ac.system.containers?.includes(id)) {
        await ac.update({
          "system.containers": ac.system.containers.filter((it) => it !== id),
        });
        // ClientDocument#render re-renders only the applications actually open for
        // this document. The old `ac.sheet._state > 0` probe read a private member
        // AND instantiated a sheet on every actor it touched, because `.sheet` is a
        // lazily-constructing getter.
        ac.render(false);
      }
    }
  }


}
