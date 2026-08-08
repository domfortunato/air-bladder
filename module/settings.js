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
  "show-features-section", "use-warden-title",
  // Character Generation
  "content-source-2e", "content-source-custom", "content-source-barebones",
  "barebones-failed-career",
  "show-omens-barebones", "show-bonds-barebones", "show-generate-header",
  "allow-player-generate", "show-generation-rolls",
  // disabled-backgrounds is Warden CONFIGURATION (which 2e backgrounds are
  // switched off), not a migration marker — it must ride the namespace
  // migration like custom-portrait-list does. It was registered without being
  // listed here (review #9); the three completion markers (roles-restamped,
  // companion-restamped, connections-migrated) stay unlisted on purpose,
  // because losing one only re-runs an idempotent migration.
  "custom-portrait-folder", "custom-portrait-list", "min-age",
  "disabled-backgrounds",
  // Inventory & Encumbrance
  "max-equip-slots", "character-inventory-limit", "use-gold-threshold",
  "enable-inventory-reorder",
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
 *
 * Single-writer, like the two `ready` migrations in cairn.js. `isGM` alone is not
 * enough: with two GMs connected, both pass it and both run this concurrently, and
 * each `has()` check reads a store that the other's write has not reached yet. Two
 * Setting DOCUMENTS then exist for one key — Foundry keeps the first it indexes, so
 * the second is permanently shadowed and the losing GM's value is silently gone.
 */
export const migrateSettingsNamespace = async () => {
  if (!game.user?.isGM) return;
  if (game.users.activeGM && game.users.activeGM !== game.user) return;
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
  // Not a setting anyone sets: the completion marker for the role migration.
  // `config: false` means it is never rendered, so it cannot disturb the positional
  // grouping described above no matter where it sits — it is first only so the
  // three visible blocks stay contiguous and easy to read.
  //
  // A marker rather than a state test, because `system.role` is a PICK-LIST. The
  // three sibling migrations get away with selecting on current state because their
  // "before" value is unreachable once migrated (a remapped container is no longer
  // one of the legacy art paths; a .svg icon is never .png again). A role the
  // Warden changes away from would go straight back into any selection set, so a
  // state test would re-stamp it on every world load — the exact trap the retired
  // forHire migration fell into with its checkbox (its marker, `forhire-migrated`,
  // may still sit unread in old world settings; harmless).
  //
  // **A NEW key, replacing `roles-migrated` (2026-08-01).** That one is `true` in
  // every world that has already opened — and those are exactly the worlds
  // holding a stored `role: "hireling"`, so reusing it would skip the population
  // the re-stamp exists for. It joins `forhire-migrated` as an unread leftover.
  // The name says what the migration does now: it re-stamps every npc's role
  // BLIND, because neither state it fixes can be seen from a client at all.
  game.settings.register(SETTINGS_NS, "roles-restamped", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Completion marker for the mount→companion restamp (2026-08-08, the role
  // evolved — see NPC_ROLES). Its own marker rather than a reuse of
  // `roles-restamped`, which is long true in every existing world and would
  // skip exactly the population this exists for.
  game.settings.register(SETTINGS_NS, "companion-restamped", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Completion marker for the connections flatten + ownership migration
  // (2026-08-01, the flat graph). Same reasoning as its sibling above: gated
  // on a marker, not on state, because both things it writes are re-editable
  // — a Warden can re-raise an ownership default or re-break a link, and a
  // state test would put the migration's answer back on the next load.
  // `config: false`, so it cannot disturb the positional grouping below.
  game.settings.register(SETTINGS_NS, "connections-migrated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // The 2e backgrounds a Warden has switched off, as an array of UUIDs — the
  // eye toggle on the picker's rows (2026-08-04; canon and custom rows alike,
  // Barebones is all-or-nothing via its source checkbox). World state, NOT a
  // flag on the documents: the shipped packs are replaced wholesale on every
  // system update, so anything written into them is one release from gone.
  // `config: false` — the picker is the whole UI, so it cannot disturb the
  // positional grouping below.
  game.settings.register(SETTINGS_NS, "disabled-backgrounds", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  // `name`/`hint` are i18n KEYS, not localized strings. registerSettings runs on
  // the `init` hook, which the client fires (game.mjs:652) BEFORE it loads any
  // translations (`await i18n.initialize()`, game.mjs:663) — so calling
  // game.i18n.localize() here returns the key verbatim and stores that. Core
  // re-localizes name/hint at display time (settings/config.mjs:126-127), which
  // is what the key is for. Do NOT wrap these in game.i18n.localize().
  // ---- General -------------------------------------------------------------
  game.settings.register(SETTINGS_NS, "use-panic", {
    name: "CAIRN.Settings.UsePanic.label",
    hint: "CAIRN.Settings.UsePanic.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "use-cairn-dice-notation", {
    name: "CAIRN.Settings.UseCairnDiceNotation.label",
    hint: "CAIRN.Settings.UseCairnDiceNotation.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "use-item-icons", {
    name: "CAIRN.Settings.UseItemIcons.label",
    hint: "CAIRN.Settings.UseItemIcons.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // Show a "Background / Bond / Question" chip on items that generation granted.
  game.settings.register(SETTINGS_NS, "show-grant-tags", {
    name: "CAIRN.Settings.ShowGrantTags.label",
    hint: "CAIRN.Settings.ShowGrantTags.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "show-features-section", {
    name: "CAIRN.Settings.ShowFeatures.label",
    hint: "CAIRN.Settings.ShowFeatures.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // `show-containers-tab` was registered here and is GONE. It dated from when a
  // container was a bag of slots a character might not own one of, so an empty
  // tab beside Items was noise. Under the roles model the tab is the only view
  // of the connection graph — who travels with whom, who owns what — and the
  // graph exists whether or not it is displayed, so the switch could only hide
  // relationships that went on mattering. The tab is now structural: everything
  // but a Monster and an unlinked token's actor shows it (CairnActor#prepareData).
  // Do not re-add it as a display toggle.

  // Cairn calls the Game Master the "Warden". When enabled, relabel the GM role
  // wherever Foundry localizes it and rename the default account. Applied in
  // cairn.js; reload to take effect.
  game.settings.register(SETTINGS_NS, "use-warden-title", {
    name: "CAIRN.Settings.UseWardenTitle.label",
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
  //
  // THE FLOOR (user ruling 2026-08-04, "option 2"): unchecking the LAST
  // enabled source switches Cairn 2e back on, with a toast. Generation
  // already falls back to the shipped 2e pack when every source is off, so
  // an all-off settings window was LYING — the honest fix is the checkbox
  // following the behavior, not a veto (Foundry has no hook that can block a
  // settings save). The write-back is idempotent and convergent, so the
  // activeGM two-tab quirk (both tabs elect themselves) is harmless here —
  // both write the same true. Re-entrancy: the write-back flips a source ON,
  // so the guard below cannot fire again from it.
  const SOURCE_KEYS = ["content-source-2e", "content-source-custom", "content-source-barebones"];
  const enforceSourceFloor = async () => {
    if (SOURCE_KEYS.some((k) => game.settings.get(SETTINGS_NS, k))) return;
    if (game.users.activeGM !== game.user) return;
    await game.settings.set(SETTINGS_NS, "content-source-2e", true);
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.LastSource"));
  };

  game.settings.register(SETTINGS_NS, "content-source-2e", {
    name: "CAIRN.Settings.ContentSource2e.label",
    hint: "CAIRN.Settings.ContentSource2e.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: enforceSourceFloor,
  });

  // GM-authored 2e backgrounds living in a world compendium. They are 2e-format
  // and share the 2e generation path -- with content-source-2e on they merge into
  // the same picker; with it off they are the only backgrounds (a homebrew-only
  // game). Default off: a fresh world has no custom backgrounds to offer.
  game.settings.register(SETTINGS_NS, "content-source-custom", {
    name: "CAIRN.Settings.ContentSourceCustom.label",
    hint: "CAIRN.Settings.ContentSourceCustom.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: enforceSourceFloor,
  });

  game.settings.register(SETTINGS_NS, "content-source-barebones", {
    name: "CAIRN.Settings.ContentSourceBarebones.label",
    hint: "CAIRN.Settings.ContentSourceBarebones.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: enforceSourceFloor,
  });

  // A second background name as pure flavor -- the career that didn't work out.
  // Grants nothing; it is a story hook, not a mechanic.
  game.settings.register(SETTINGS_NS, "barebones-failed-career", {
    name: "CAIRN.Settings.BarebonesFailedCareer.label",
    hint: "CAIRN.Settings.BarebonesFailedCareer.hint",
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
    name: "CAIRN.Settings.BarebonesOmens.label",
    hint: "CAIRN.Settings.BarebonesOmens.hint",
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
    name: "CAIRN.Settings.BarebonesBonds.label",
    hint: "CAIRN.Settings.BarebonesBonds.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  game.settings.register(SETTINGS_NS, "show-generate-header", {
    name: "CAIRN.Settings.ShowGenerateHeader.label",
    hint: "CAIRN.Settings.ShowGenerateHeader.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // The Warden's switch for the PLAYER-facing Generate PC button in the Actor
  // Directory (both variants: the create-row button and the no-ACTOR_CREATE
  // relay button). Sibling of show-generate-header above — that one gates the
  // sheet's Regenerate button, this one gates the directory's Generate PC —
  // and the toggle the shipped "Toggle Player Generate PC" macro flips. The
  // GM's own button never hides: the read site ORs in isGM.
  //
  // No reload: onChange fires on EVERY client (the settings-fanout primitive
  // the custom-portrait folder scan also rides), so each connected player's
  // directory re-renders itself the moment the Warden flips it — the whole
  // point of a mid-session switch. The pop-out directory is a second,
  // independent ActorDirectory application (the render hook already handles
  // its DOM separately), so the sweep covers both.
  game.settings.register(SETTINGS_NS, "allow-player-generate", {
    name: "CAIRN.Settings.AllowPlayerGenerate.label",
    hint: "CAIRN.Settings.AllowPlayerGenerate.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof foundry.applications.sidebar.tabs.ActorDirectory && app.rendered) app.render();
      }
    },
  });

  // Post the five generation rolls -- HP, STR, DEX, WIL, Gold -- as one chat
  // message carrying the real Roll objects, so Dice So Nice animates them and
  // core supplies the dice sound without it. Read live at the posting site
  // (postGenerationRolls), hence no reload. World-scoped because the generatePC
  // relay runs generation on the Warden's client for a player who lacks
  // ACTOR_CREATE: the posting client must read the same value the roller would.
  game.settings.register(SETTINGS_NS, "show-generation-rolls", {
    name: "CAIRN.Settings.ShowGenerationRolls.label",
    hint: "CAIRN.Settings.ShowGenerationRolls.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  // A GM-curated folder of custom character portraits (per-world local pool). When
  // it holds images, new characters/hirelings draw ONLY from it and the portrait
  // picker gains a "Custom" tab; empty, everything falls back to the shipped Jon
  // Aspeheim art. Default is a folder at the Foundry data root -- NEVER inside the
  // system folder, which is overwritten on update. Portraits are its OWN token
  // (no paired token art), so each image doubles as portrait and token.
  game.settings.register(SETTINGS_NS, "custom-portrait-folder", {
    name: "CAIRN.Settings.CustomPortraitFolder.label",
    hint: "CAIRN.Settings.CustomPortraitFolder.hint",
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
    // FILES_BROWSE and writing custom-portrait-list is a world-setting write.
    // Single-writer via activeGM, not bare isGM — the top of this file explains
    // why isGM alone is not enough (two GMs both scan and race Setting.create;
    // the loser's write is permanently shadowed). Every other client picks the
    // new list up through the setting.
    //
    // Imported dynamically to avoid a static cycle — character-generator.js already
    // imports SETTINGS_NS from here.
    onChange: async () => {
      if (!game.user?.isGM) return;
      if (game.users.activeGM && game.users.activeGM !== game.user) return;
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
    name: "CAIRN.Settings.MinAge.label",
    hint: "CAIRN.Settings.MinAge.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 21,
    requiresReload: false,
  });

  // ---- Inventory & Encumbrance ---------------------------------------------
  game.settings.register(SETTINGS_NS, "max-equip-slots", {
    name: "CAIRN.Settings.MaxEquipSlots.label",
    hint: "CAIRN.Settings.MaxEquipSlots.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "character-inventory-limit", {
    name: "CAIRN.Settings.CharacterInventoryLimit.label",
    hint: "CAIRN.Settings.CharacterInventoryLimit.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  // Cairn 2e (p.9): coins are heavy. The first N are petty; every further N fills
  // a slot. N is this "coins per slot" value (default 100). 0 = coins weightless.
  game.settings.register(SETTINGS_NS, "use-gold-threshold", {
    name: "CAIRN.Settings.UseGoldThreshold.label",
    hint: "CAIRN.Settings.UseGoldThreshold.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    requiresReload: true,
  });

  /* `show-gold-not-cost` was registered here and is GONE (2026-07-31), for the
     same reason `show-containers-tab` went: the behaviour it toggled no longer
     exists. It swapped the Cost box on a CONTAINER SHEET for a Gold box, and
     the container type — sheet, model and all — is retired. The npc sheet that
     replaced it has no Cost box to swap: Round 2 settled that Gold simply hides
     on a thing or a mount (`system.showGold`), which is a role fact, not a
     world preference. Do not re-add it without a field for it to govern. */

  /* `show-container-actors` was registered here and is GONE (2026-08-02, by
     ruling: "this feature should always be on and should never be disabled").
     It hid plain/worn containers from the Actor Directory while keeping
     mounts, transports and piles listed; the hide rule in renderActorDirectory
     went with it, so every container actor is simply always listed. The
     grayscale-thumbnail rule survives — it never depended on this setting. */

  // Drag-to-reorder inventory items. On by default; turning it off keeps the
  // item list's automatic order (equipped first, then alphabetical, Fatigue last).
  game.settings.register(SETTINGS_NS, "enable-inventory-reorder", {
    name: "CAIRN.Settings.EnableInventoryReorder.label",
    hint: "CAIRN.Settings.EnableInventoryReorder.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });
};
