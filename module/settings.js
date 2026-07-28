/**
 * The namespace every game setting is registered under.
 *
 * It MUST be the package id. Foundry groups the settings sheet by package, so a
 * namespace that names no installed package cannot be rendered under a heading —
 * every setting lands in a bucket literally labelled "Unmapped", and a Warden has
 * no way to reach any of them. This system was still registering under "cairn",
 * inherited from the system it descends from, so all 16 settings were invisible.
 *
 * Do not "tidy" this back to a friendlier string. It is not a label; it is a key.
 */
export const SETTINGS_NS = "air-bladder";

/**
 * Every key registered below, kept in registration order.
 *
 * The order is a maintenance convention so this list mirrors registerSettings()
 * and a missing key is easy to spot -- it is NOT load-bearing. The migration
 * iterates it as an unordered set (each key is copied independently), and the dev
 * probes only filter and count it. Registration order IS load-bearing, but that
 * lives in registerSettings(), not here.
 */
export const SETTING_KEYS = [
  // General
  "use-panic", "use-cairn-dice-notation", "use-item-icons", "show-grant-tags",
  "show-features-section", "show-containers-tab", "use-warden-title",
  // Character Generation
  "content-source-2e", "content-source-custom", "content-source-barebones",
  "barebones-failed-career",
  "show-omens-barebones", "show-bonds-barebones", "show-generate-header",
  "custom-portrait-folder", "custom-portrait-list", "min-age",
  // Inventory & Encumbrance
  "max-equip-slots", "character-inventory-limit", "use-gold-threshold",
  "show-gold-not-cost", "show-container-actors", "enable-inventory-reorder",
];

/**
 * Carry a Warden's existing configuration across from the old "cairn" namespace.
 *
 * Settings are stored per-world as documents keyed "<namespace>.<key>", so simply
 * fixing the namespace would strand every value a Warden had already chosen and
 * silently revert their world to defaults. This copies each one over the first
 * time a GM loads the world, and only where the new namespace has no value yet,
 * so it cannot clobber a deliberate change. The old documents are left in place —
 * they are inert once unregistered, and keeping them means a mis-migration is
 * recoverable.
 */
export const migrateSettingsNamespace = async () => {
  if (!game.user?.isGM) return;
  const store = game.settings.storage.get("world");
  const has = (key) => !!store.find((s) => s.key === key);
  const moved = [];
  for (const key of SETTING_KEYS) {
    const old = store.find((s) => s.key === `cairn.${key}`);
    if (!old || has(`${SETTINGS_NS}.${key}`)) continue;
    try {
      await game.settings.set(SETTINGS_NS, key, JSON.parse(old.value));
      moved.push(key);
    } catch (e) {
      console.warn(`Air Bladder | could not migrate setting "${key}":`, e);
    }
  }
  if (moved.length) {
    console.log(`Air Bladder | migrated ${moved.length} setting(s) from the "cairn" namespace: ${moved.join(", ")}`);
  }
};

/**
 * Registration ORDER is meaningful here, not cosmetic.
 *
 * The Configure Settings tab is grouped by inserting a header before the first
 * setting of each group (cairn.js renderSettingsConfig anchors on use-panic,
 * content-source-2e and max-equip-slots). Foundry renders settings in
 * registration order, so everything between two anchors is what lands under that
 * heading. Move a register() call and you silently move the setting into a
 * different section. Keep the three blocks below contiguous and in this order —
 * it is the order they appear on the tab: General, then Character Generation,
 * then Inventory & Encumbrance.
 */
export const registerSettings = () => {
  // ---- General -------------------------------------------------------------
  game.settings.register(SETTINGS_NS, "use-panic", {
    name: game.i18n.localize("CAIRN.Settings.UsePanic.label"),
    hint: game.i18n.localize("CAIRN.Settings.UsePanic.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "use-cairn-dice-notation", {
    name: game.i18n.localize("CAIRN.Settings.UseCairnDiceNotation.label"),
    hint: game.i18n.localize("CAIRN.Settings.UseCairnDiceNotation.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "use-item-icons", {
    name: game.i18n.localize("CAIRN.Settings.UseItemIcons.label"),
    hint: game.i18n.localize("CAIRN.Settings.UseItemIcons.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // Show a "Background / Bond / Question" chip on items that generation granted.
  game.settings.register(SETTINGS_NS, "show-grant-tags", {
    name: game.i18n.localize("CAIRN.Settings.ShowGrantTags.label"),
    hint: game.i18n.localize("CAIRN.Settings.ShowGrantTags.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "show-features-section", {
    name: game.i18n.localize("CAIRN.Settings.ShowFeatures.label"),
    hint: game.i18n.localize("CAIRN.Settings.ShowFeatures.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // The Containers tab is off by default: a character with no pack, mount or
  // vehicle has no use for it, and an empty tab beside Items is just noise.
  game.settings.register(SETTINGS_NS, "show-containers-tab", {
    name: game.i18n.localize("CAIRN.Settings.ShowContainersTab.label"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  // Cairn calls the Game Master the "Warden". When enabled, relabel the GM role
  // wherever Foundry localizes it and rename the default account. Applied in
  // cairn.js; reload to take effect.
  game.settings.register(SETTINGS_NS, "use-warden-title", {
    name: game.i18n.localize("CAIRN.Settings.UseWardenTitle.label"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // ---- Character Generation ------------------------------------------------
  // Which editions a Warden offers when generating a character. Both on means
  // the Generate button asks; exactly one means it just uses that one. These
  // gate GENERATION ONLY -- every rule after a character exists is identical
  // across editions, by design (see CLAUDE.md, "one system, two generators").
  game.settings.register(SETTINGS_NS, "content-source-2e", {
    name: game.i18n.localize("CAIRN.Settings.ContentSource2e.label"),
    hint: game.i18n.localize("CAIRN.Settings.ContentSource2e.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  // GM-authored 2e backgrounds living in a world compendium. They are 2e-format
  // and share the 2e generation path -- with content-source-2e on they merge into
  // the same picker; with it off they are the only backgrounds (a homebrew-only
  // game). Default off: a fresh world has no custom backgrounds to offer.
  game.settings.register(SETTINGS_NS, "content-source-custom", {
    name: game.i18n.localize("CAIRN.Settings.ContentSourceCustom.label"),
    hint: game.i18n.localize("CAIRN.Settings.ContentSourceCustom.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register(SETTINGS_NS, "content-source-barebones", {
    name: game.i18n.localize("CAIRN.Settings.ContentSourceBarebones.label"),
    hint: game.i18n.localize("CAIRN.Settings.ContentSourceBarebones.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  // A second background name as pure flavor -- the career that didn't work out.
  // Grants nothing; it is a story hook, not a mechanic.
  game.settings.register(SETTINGS_NS, "barebones-failed-career", {
    name: game.i18n.localize("CAIRN.Settings.BarebonesFailedCareer.label"),
    hint: game.i18n.localize("CAIRN.Settings.BarebonesFailedCareer.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  // Barebones has no omens of its own. Unlike bonds this changes nothing about
  // generation -- an omen is never rolled at creation in either edition -- it
  // only decides whether the Description tab offers the field at all.
  game.settings.register(SETTINGS_NS, "show-omens-barebones", {
    name: game.i18n.localize("CAIRN.Settings.BarebonesOmens.label"),
    hint: game.i18n.localize("CAIRN.Settings.BarebonesOmens.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  // Barebones has no bonds of its own either; this lends it 2e's Bonds table.
  // When on, the bond REPLACES the Additional Gear step rather than adding to it
  // -- a bond already grants an item and gold, and rolling both overloads ten
  // slots.
  game.settings.register(SETTINGS_NS, "show-bonds-barebones", {
    name: game.i18n.localize("CAIRN.Settings.BarebonesBonds.label"),
    hint: game.i18n.localize("CAIRN.Settings.BarebonesBonds.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register(SETTINGS_NS, "show-generate-header", {
    name: game.i18n.localize("CAIRN.Settings.ShowGenerateHeader.label"),
    hint: game.i18n.localize("CAIRN.Settings.ShowGenerateHeader.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // A GM-curated folder of custom character portraits (per-world local pool). When
  // it holds images, new characters/hirelings draw ONLY from it and the portrait
  // picker gains a "Custom" tab; empty, everything falls back to the shipped Jon
  // Aspeheim art. Default is a folder at the Foundry data root -- NEVER inside the
  // system folder, which is overwritten on update. Portraits are its OWN token
  // (no paired token art), so each image doubles as portrait and token.
  game.settings.register(SETTINGS_NS, "custom-portrait-folder", {
    name: game.i18n.localize("CAIRN.Settings.CustomPortraitFolder.label"),
    hint: game.i18n.localize("CAIRN.Settings.CustomPortraitFolder.hint"),
    scope: "world",
    config: true,
    type: String,
    default: "air-bladder-portraits",
    requiresReload: false,
    // requiresReload: false was a claim nothing made true. Both functions that act
    // on this setting ran only in the `ready` hook and from the gallery's GM
    // refresh button, so changing the folder did NOTHING: no reload prompt, the new
    // folder was never created, and the cached custom-portrait-list still held the
    // OLD folder's files. Every character generated afterwards silently drew from
    // the old folder, and if it had been moved the assigned img paths 404'd on both
    // sheet and token.
    //
    // onChange fires on every client, so this is GM-gated: scanning a folder needs
    // FILES_BROWSE and writing custom-portrait-list is a world-setting write. The
    // work happens once, on the GM who made the change, and every other client
    // picks the new list up through the setting.
    //
    // Imported dynamically to avoid a static cycle — character-generator.js already
    // imports SETTINGS_NS from here.
    onChange: async () => {
      if (!game.user?.isGM) return;
      const gen = await import("./character-generator.js");
      await gen.ensureCustomPortraitFolder();
      const files = await gen.refreshCustomPortraits();
      ui.notifications.info(
        game.i18n.format("CAIRN.Notify.PortraitFolderScanned", { count: files.length })
      );
    },
  });

  // The scanned file list for the folder above, cached so players (who lack the
  // FILES_BROWSE permission a folder scan needs) can still see and pick custom
  // portraits. A GM refresh (or GM login) rewrites it. Not shown in the UI.
  game.settings.register(SETTINGS_NS, "custom-portrait-list", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    requiresReload: false,
  });

  // A minimum age applied to EVERY generated character, no toggle. Age rolls as
  // 2d20 + 10 (12..50) and the final age is the greater of that roll and this
  // floor, so no character comes out younger than the Warden wants. Always in
  // effect (default 21); to switch it off, set it below 12 -- the lowest a
  // 2d20 + 10 roll can produce -- so the floor never binds. Applied in
  // character-generator.js rollAge, the single choke point for generation AND
  // the sheet's age re-roll, so it needs no reload.
  //
  // Grouped here rather than under General (where it sat until 2026-07-28): it is
  // a parameter of the character being made, and a Warden looks for it beside the
  // rest of generation. It also floors the age of an IMPORTED Kettlewright
  // character (kettlewright-import.js), which is a secondary consumer, not the
  // setting's purpose. Placement is positional -- see the ordering note above.
  game.settings.register(SETTINGS_NS, "min-age", {
    name: game.i18n.localize("CAIRN.Settings.MinAge.label"),
    hint: game.i18n.localize("CAIRN.Settings.MinAge.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 21,
    requiresReload: false,
  });

  // ---- Inventory & Encumbrance ---------------------------------------------
  game.settings.register(SETTINGS_NS, "max-equip-slots", {
    name: game.i18n.localize("CAIRN.Settings.MaxEquipSlots.label"),
    hint: game.i18n.localize("CAIRN.Settings.MaxEquipSlots.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "character-inventory-limit", {
    name: game.i18n.localize("CAIRN.Settings.CharacterInventoryLimit.label"),
    hint: game.i18n.localize("CAIRN.Settings.CharacterInventoryLimit.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  // Cairn 2e (p.9): coins are heavy. The first N are petty; every further N fills
  // a slot. N is this "coins per slot" value (default 100). 0 = coins weightless.
  game.settings.register(SETTINGS_NS, "use-gold-threshold", {
    name: game.i18n.localize("CAIRN.Settings.UseGoldThreshold.label"),
    hint: game.i18n.localize("CAIRN.Settings.UseGoldThreshold.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "show-gold-not-cost", {
    name: game.i18n.localize("CAIRN.Settings.ShowGoldNotCost.label"),
    hint: game.i18n.localize("CAIRN.Settings.ShowGoldNotCost.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "show-container-actors", {
    name: game.i18n.localize("CAIRN.Settings.ShowContainerActors.label"),
    hint: game.i18n.localize("CAIRN.Settings.ShowContainerActors.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // Drag-to-reorder inventory items. On by default; turning it off keeps the
  // item list's automatic order (equipped first, then alphabetical, Fatigue last).
  game.settings.register(SETTINGS_NS, "enable-inventory-reorder", {
    name: game.i18n.localize("CAIRN.Settings.EnableInventoryReorder.label"),
    hint: game.i18n.localize("CAIRN.Settings.EnableInventoryReorder.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });
};
