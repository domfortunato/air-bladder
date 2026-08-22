import { Cairn } from "./config.js";
import { registerSettingMenus } from "./settings-menus.js";

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
  "show-grant-tags-print", "show-omens",
  "use-warden-title", "change-log", "auto-record-scars", "enable-glog-magic",
  // Character Generation
  "content-source-2e", "content-source-custom", "content-source-barebones",
  "barebones-failed-career", "show-generate-header",
  "allow-player-generate", "allow-player-randomization", "show-generation-rolls",
  // disabled-backgrounds is Warden CONFIGURATION (which 2e backgrounds are
  // switched off), not a migration marker — it must ride the namespace
  // migration like custom-portrait-list does. It was registered without being
  // listed here (review #9); the six completion markers (roles-restamped,
  // companion-restamped, hireling-split, grimoire-keys-stamped,
  // connections-migrated, art-migration-generation) stay unlisted on purpose.
  // Every one of them dates
  // from AFTER the namespace move, so there is no "cairn.<key>" value for this
  // list to carry across — listing them would iterate keys that cannot exist.
  //
  // The old wording here said the reason was that losing a marker only re-runs
  // an idempotent migration. True of the other four — the grimoire stamp skips
  // anything already keyed — and NOT true of `hireling-split`, which selects on
  // a stored `role: "npc"` that a real NPC also carries once it has run. Do not
  // reason about any new marker from that sentence; reason about the migration.
  "custom-portrait-folder", "custom-portrait-list", "age-formula",
  "disabled-backgrounds",
  // Internal but CONFIGURATION, not a marker: the parked-Connections flag
  // (2026-08-09) must ride the namespace migration — losing it would re-park
  // a world the user had unparked.
  "connections-ui-enabled",
  // Inventory & Encumbrance
  "max-equip-slots", "character-inventory-limit", "allow-player-marketplace",
  "use-gold-threshold",
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
 * Re-render every open actor sheet on this client.
 *
 * The onChange body shared by every no-reload toggle whose value a sheet reads
 * in `_prepareContext`: the read is live, but "live" only means the NEXT
 * render — without this fan an open sheet keeps its stale surface until
 * something unrelated redraws it (review #13; the failed-career comment in
 * actor-sheet.js had promised "switching it off hides the line" since the
 * toggle shipped, and delivered it only on reopen). onChange fires on every
 * client, so each client sweeps its own windows. One helper, not five copies
 * of the loop — the fifth copy is where the drift starts.
 */
const rerenderActorSheets = () => {
  for (const app of foundry.applications.instances.values()) {
    if (app.document instanceof Actor && app.rendered) app.render();
  }
};

/**
 * Internal CONFIGURATION keys: in SETTING_KEYS because they must ride the
 * namespace migration, but Warden-invisible by design — caches and flags no
 * settings UI ever shows. Everything else in SETTING_KEYS is Warden-facing and
 * must belong to exactly one group below, which `npm run dev:settings` gates:
 * a setting in neither list is registered, migrated, and unreachable.
 */
export const INTERNAL_SETTING_KEYS = [
  "custom-portrait-list", "disabled-backgrounds", "connections-ui-enabled",
];

/**
 * The Warden's settings, as SUBMENUS (2026-08-22, user ruling: "one submenu
 * per group" — four of them, once GLOG & Other Hacks was asked for the same
 * day): the main Configure Settings window shows one button per group under
 * Air Bladder and nothing else, and each opens a small application holding
 * that group's rows — see `settings-menus.js`. Every key listed here is
 * registered `config: false`, which is what keeps it off the flat list.
 *
 * This is the ONE declaration of the grouping. `settings-menus.js` registers
 * a menu per entry and renders its `keys` in this order; `dev:settings`,
 * `dev:ui-parity` and `dev:age-override` read it to assert membership and
 * order on the rendered apps. Until 2026-08-22 the grouping was three
 * positional `<h3>` headers inserted into the flat list (cairn.js
 * `renderSettingsConfig`), which made REGISTRATION ORDER load-bearing — a
 * moved `register()` call silently re-filed a setting under another heading,
 * the order needed its own gate (review #16), and the compact rows that went
 * with it hid every hint for a year. None of that is true any more: the order
 * of `register()` calls below is readability only, and the order a Warden
 * sees is `keys`.
 *
 * Per-group decorations are declared here too, so the app stays generic:
 * `subOptions` greys rows out while a master checkbox is off, `boldPhrases`
 * bolds a localized phrase inside a label.
 */
export const SETTING_GROUPS = [
  {
    id: "general",
    title: "CAIRN.Settings.GroupGeneral",
    hint: "CAIRN.Settings.GroupGeneralHint",
    icon: "fa-solid fa-gears",
    keys: [
      "use-panic", "use-cairn-dice-notation", "use-item-icons", "show-grant-tags",
      "show-grant-tags-print", "show-omens", "use-warden-title", "change-log",
      "auto-record-scars",
    ],
  },
  {
    id: "generation",
    title: "CAIRN.Settings.GroupGeneration",
    hint: "CAIRN.Settings.GroupGenerationHint",
    icon: "fa-solid fa-user-plus",
    keys: [
      "content-source-2e", "content-source-custom", "content-source-barebones",
      "show-generate-header", "allow-player-generate",
      "allow-player-randomization", "show-generation-rolls",
      "custom-portrait-folder", "age-formula",
    ],
    // The phrase is the SOURCE AS THE LABEL NAMES IT, which is not always the
    // source's own name: the two 2e labels distinguish canon from custom, and
    // the qualifier is the point of the sentence — bolding "Cairn 2e" inside
    // "Offer canon Cairn 2e backgrounds" emphasises the half the reader already
    // knew (user ask, 2026-08-07). `CAIRN.ContentSource2e` cannot simply be
    // widened: it is the source's name, reused by the generation picker and
    // utils' SOURCE_KEYS, where "canon Cairn 2e" would read as a different
    // edition. Hence a key of its own.
    boldPhrases: {
      "content-source-2e": "CAIRN.ContentSourceCanon2e",
      "content-source-custom": "CAIRN.ContentSourceCustom",
      "content-source-barebones": "CAIRN.ContentSourceBarebones",
    },
  },
  {
    id: "inventory",
    title: "CAIRN.Settings.GroupInventory",
    hint: "CAIRN.Settings.GroupInventoryHint",
    icon: "fa-solid fa-weight-hanging",
    keys: [
      "max-equip-slots", "character-inventory-limit", "allow-player-marketplace",
      "use-gold-threshold",
    ],
  },
  {
    // The optional rule hacks, in a menu of their own (2026-08-22, user ask):
    // the GLOG Magic conversion and the Knave-style failed career for Barebones
    // characters, moved out of General and Character Generation respectively.
    id: "hacks",
    title: "CAIRN.Settings.GroupHacks",
    hint: "CAIRN.Settings.GroupHacksHint",
    icon: "fa-solid fa-flask",
    keys: ["enable-glog-magic", "barebones-failed-career"],
    // The failed career is meaningless unless Barebones sheets are offered —
    // and that master checkbox lives in the Character Generation menu, not
    // here, so this app greys the row from the STORED value at render instead
    // of following a checkbox live (settings-menus.js handles both shapes).
    // Down to one carrier: the omen/bond lending settings went 2026-08-09.
    subOptions: { master: "content-source-barebones", keys: ["barebones-failed-career"] },
  },
];

/**
 * The registration blocks below are kept roughly in group order for the
 * reader's sake only — General, then Character Generation, then Inventory &
 * Encumbrance, with the two Hacks settings still sitting in the blocks they
 * grew up in. Nothing positional depends on it (see SETTING_GROUPS).
 */
export const registerSettings = () => {
  // Not a setting anyone sets: the completion marker for the role migration.
  // `config: false` and in no group, so no settings UI ever shows it — it is
  // first only so the grouped blocks stay contiguous and easy to read.
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

  // Completion marker for the NPC/Hireling split (2026-08-20): every person who
  // was role `npc` becomes role `hireling`, because that is what role `npc`
  // MEANT until this release and the key is being reused for the new NPC.
  //
  // MARKER-GATED AND IT MUST BE, more strictly than either sibling above. Those
  // two are blind restamps whose "before" value is unobservable, so re-running
  // them is harmless. This one selects on a stored `role: "npc"` — and once it
  // has run, a genuine NEW npc stores exactly that. A second pass would convert
  // every real NPC in the world into a hireling, silently. The marker is the
  // only thing standing between those two states, so it is set only after the
  // writes land: a failed run must retry, never record itself done.
  game.settings.register(SETTINGS_NS, "hireling-split", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Completion marker for the art-path migrations (review #17): which
  // GENERATION of cairn.js's ART_MOVES/ART_REENCODED tables this world has
  // been swept to. A NUMBER, not the usual boolean, because those tables
  // grow — a future art move adds a rule, and a stamp made before the rule
  // existed must not block it (bump ART_MIGRATION_GENERATION beside the
  // tables). Before this the sweep ran marker-less on every GM load,
  // forever, pack.getDocuments() round trips included.
  game.settings.register(SETTINGS_NS, "art-migration-generation", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });

  // Completion marker for the Grimoire page-key stamp (issue #17, 2026-08-16):
  // every book gets an identity, every bound page names its own. Marker-gated
  // rather than state-gated for the usual reason — an unkeyed page can also be
  // one a Warden has legitimately left unmatched (the migration leaves the
  // unreadable case alone on purpose), and a state test would re-ask that
  // question on every load. `config: false`, so it cannot disturb the
  // positional grouping below.
  game.settings.register(SETTINGS_NS, "grimoire-keys-stamped", {
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

  // The Connections UI is PARKED (user ruling 2026-08-09): the mechanic is not
  // being pursued further for now, and its surfaces hide until it is — the PC
  // Connections tab, the npc header attach/detach line and wording (the For
  // Hire checkbox on that line SURVIVES — it is the day-rate mechanic, not
  // connections), the four connection sheet actions, and drag-to-connect.
  // Everything underneath keeps working: the minting flows (marketplace
  // transports, generation grants), carry capacity from connected containers,
  // the ownership automation and its socket brokers, and the flatten
  // migration. Flipping this to true restores the whole UI.
  //
  // `config: false` on purpose, and NOT a Warden-visible setting: this repo
  // removed `show-containers-tab` (2026-07-31) on the reasoning that a display
  // toggle hiding a live graph is not a setting worth having, and a visible
  // toggle here would re-litigate that. Probes exercise the enabled state by
  // SHADOWING the settings read in-page (the dev:print failed-career pattern)
  // — never by writing this into a world.
  game.settings.register(SETTINGS_NS, "connections-ui-enabled", {
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
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "use-cairn-dice-notation", {
    name: "CAIRN.Settings.UseCairnDiceNotation.label",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "use-item-icons", {
    name: "CAIRN.Settings.UseItemIcons.label",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // Show a "Background / Bond / Question" chip on items that generation granted.
  game.settings.register(SETTINGS_NS, "show-grant-tags", {
    name: "CAIRN.Settings.ShowGrantTags.label",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // The same tags on the PRINTED sheet, under their own switch (user ask
  // 2026-08-11) — deliberately independent of show-grant-tags above: the
  // print reads the ungated grantLabelRaw at print time, so no reload.
  game.settings.register(SETTINGS_NS, "show-grant-tags-print", {
    name: "CAIRN.Settings.ShowGrantTagsPrint.label",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  // Cairn 2e hands the party's YOUNGEST member an omen; a table that does not
  // use the rule had no way to get the field off the sheet (user ask
  // 2026-08-17). Off hides the Omen checkbox and field on every character sheet
  // AND drops the printed page's Omen section — ONE switch, both surfaces, by
  // ruling: a field a Warden has hidden must not reappear on paper. That is
  // deliberately NOT the show-grant-tags / show-grant-tags-print split, which
  // exists because a grant tag is an annotation both surfaces legitimately
  // show; switching omens off says the table does not use the rule at all.
  // Stored omen TEXT is never touched and returns if this goes back on.
  //
  // NOT the return of `show-omens-barebones` (removed 2026-08-09, see the note
  // below): that one LENT the 2e field to Barebones. This one WITHDRAWS it from
  // 2e. Opposite direction, and a new key, so no world's orphaned row for the
  // old one can be read as a value for this.
  //
  // General, not Character Generation: an omen is not generated —
  // character-generator.js lands every new character with omenEnabled false —
  // so this is a rules/display question and belongs beside use-panic, not among
  // the parameters of the character being made. World-scoped and it applies to
  // everyone including the Warden; it is a table preference, not a permission
  // like allow-player-randomization.
  //
  // The sheet reads it in _prepareContext, so the fan is what makes "read live"
  // true for a sheet already open (the review #13 rule rerenderActorSheets
  // exists for) — hence no reload.
  game.settings.register(SETTINGS_NS, "show-omens", {
    name: "CAIRN.Settings.ShowOmens.label",
    hint: "CAIRN.Settings.ShowOmens.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: rerenderActorSheets,
  });

  // `show-features-section` was registered here and is GONE (2026-08-09, user
  // ruling): the Features list it toggled was removed outright — a
  // fork-inherited UI nobody here uses. The `system.features` field SURVIVES,
  // orphaned, so anything a Warden recorded is still on the document (the
  // character-`description` precedent).

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
    // The one visible setting that had no hint (review #17) — which meant no
    // tooltip at all once hints surfaced (2026-08-21), on the one setting
    // that renames a User document.
    hint: "CAIRN.Settings.UseWardenTitle.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  // The manual-change log: whisper a ledger card (to the actor's
  // owners/observers plus the Warden) whenever someone HAND-changes a tracked
  // field or adds/removes an item — see CairnActor#postChangeLog for what
  // counts as manual. Default ON (user ruling 2026-08-08: existing worlds
  // start logging on upgrade). No reload and no onChange: the posting sites
  // read it live, so the shipped "Toggle Change Log" macro takes effect on the
  // next change.
  game.settings.register(SETTINGS_NS, "change-log", {
    name: "CAIRN.Settings.ChangeLog.label",
    hint: "CAIRN.Settings.ChangeLog.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  // The one AUTOMATED sheet write in the damage flow, and a deliberate,
  // bounded breach of the "trust players, no automation" house line (user
  // ruling 2026-08-09): when the Scars draw fires for a PLAYER CHARACTER,
  // the drawn scar is also checked on the sheet's scar list. Default OFF —
  // the generationEnabled precedent: an update must not change a table's
  // behavior until the Warden flips it. The write site, with the PC-only /
  // owner-only / dedupe rules, is damage.js `_rollScarsTable`; read live
  // there, no reload.
  game.settings.register(SETTINGS_NS, "auto-record-scars", {
    name: "CAIRN.Settings.AutoRecordScars.label",
    hint: "CAIRN.Settings.AutoRecordScars.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: false,
  });

  // GLOG Magic (the official Cairn hack) — a RULES setting like use-panic, not
  // a content source: it never joins SOURCE_KEYS or the floor below. OVERRIDING
  // by ruling (2026-08-05): while on, generation uses only GLOG and custom
  // spells and every granted spell lands as a spellscroll — and TURNING IT ON
  // CONVERTS THE WORLD, totally: every canon spellbook anywhere becomes a GLOG
  // spellscroll and every canon scroll's text swaps (module/glog.js). Turning
  // it OFF converts nothing back; that asymmetry was accepted at ruling time,
  // which is why the hint says so out loud. The onChange runs the sweep on the
  // active GM's client only, and the sweep is idempotent, so the two-tab GM
  // quirk cannot double-convert.
  game.settings.register(SETTINGS_NS, "enable-glog-magic", {
    name: "CAIRN.Settings.EnableGlogMagic.label",
    hint: "CAIRN.Settings.EnableGlogMagic.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: async (value) => {
      // Either flip drops the create seam's cached swap map (module/glog.js)
      // — caution, not need: the pack is locked, but a stale cache after an
      // unlock-edit-relock would be a silent wrong text with no error.
      const { runGlogConversion, clearGlogTextCache } = await import("./glog.js");
      clearGlogTextCache();
      // The sweep is a one-way world conversion with no rollback, and the
      // client fires onChange WITHOUT awaiting it (Setting._onUpdate), so a
      // throw out of here is an unhandled rejection naming neither the system
      // nor the operation, with the world left half-converted and no signal
      // but the ABSENCE of the "converted N" toast. Caught and surfaced, the
      // way every other async seam in this system is (cairn.js phase/socket).
      if (value) {
        try {
          await runGlogConversion();
        } catch (err) {
          console.error("air-bladder | GLOG world conversion failed:", err);
          ui.notifications.error(game.i18n.localize("CAIRN.Notify.GlogConversionFailed"));
        }
      }
      // The per-scroll Cast control (canCastScroll, actor-sheet.js) is read
      // live in _prepareContext but only takes effect on the NEXT render.
      // Turning the setting OFF converts nothing, so no document update fires
      // and without this fan an open sheet keeps its now-dead Cast controls
      // until an unrelated redraw (the review #13 rule that rerenderActorSheets
      // exists for). Both directions, and on every client the onChange reaches.
      rerenderActorSheets();
    },
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
    config: false,
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
    config: false,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: enforceSourceFloor,
  });

  game.settings.register(SETTINGS_NS, "content-source-barebones", {
    name: "CAIRN.Settings.ContentSourceBarebones.label",
    hint: "CAIRN.Settings.ContentSourceBarebones.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: enforceSourceFloor,
  });

  // A second background name -- the career that didn't work out -- plus ONE
  // item drawn at random from that career's gear, made weightless and tagged
  // `failed-career` (character-generator.js `failedCareerItemFromBg`). This
  // comment said "grants nothing" until 2026-08-22, and the hint said the
  // same; the code never did. The sheet reads the setting in _prepareContext
  // (the header's failed-career block), so the fan below is what makes "read
  // live" true for a sheet already open.
  game.settings.register(SETTINGS_NS, "barebones-failed-career", {
    name: "CAIRN.Settings.BarebonesFailedCareer.label",
    hint: "CAIRN.Settings.BarebonesFailedCareer.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: rerenderActorSheets,
  });

  // `show-omens-barebones` and `show-bonds-barebones` were REMOVED here
  // (2026-08-09, user ruling): the lending they toggled is gone — Barebones
  // sheets never show the Omen field and Barebones generation never mints a
  // bond (Additional Gear always runs). Both defaulted false, so the removal
  // makes the default the only behaviour. Legacy lent bonds survive as data
  // and keep displaying (the Notes section shows on content); stored omen
  // TEXT survives invisibly. Their orphaned world rows are harmless, like
  // the three settings retired in 2026-07/08.
  game.settings.register(SETTINGS_NS, "show-generate-header", {
    name: "CAIRN.Settings.ShowGenerateHeader.label",
    scope: "world",
    config: false,
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
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof foundry.applications.sidebar.tabs.ActorDirectory && app.rendered) app.render();
      }
    },
  });

  // The Warden's switch for the SHEET's randomization surface as seen by
  // players: the title-bar Randomization toggle, the Roll button behind it,
  // and every per-line re-roll die (background, failed career, age, omen, an
  // npc's name/profession/portrait). Off hides ALL of it from players — even
  // on an actor whose own Randomization flag is on, because the sheet derives
  // its generationEnabled context through _mayRandomize (render-only; no
  // actor is written). The Warden keeps everything; the shipped "Toggle
  // Player Randomization" macro flips this. Third sibling of the two switches
  // above, same onChange shape as allow-player-marketplace: re-render every
  // open actor sheet on every client, so the surface leaves and returns
  // mid-session.
  game.settings.register(SETTINGS_NS, "allow-player-randomization", {
    name: "CAIRN.Settings.AllowPlayerRandomization.label",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: rerenderActorSheets,
  });

  // Post the five generation rolls -- HP, STR, DEX, WIL, Gold -- as one chat
  // message carrying the real Roll objects, so Dice So Nice animates them and
  // core supplies the dice sound without it. Read live at the posting site
  // (postGenerationRolls), hence no reload. World-scoped because the generatePC
  // relay runs generation on the Warden's client for a player who lacks
  // ACTOR_CREATE: the posting client must read the same value the roller would.
  // NO rerenderActorSheets fan, deliberately (review #13 weighed and dropped
  // it): no sheet reads this in _prepareContext — the read happens when a
  // generation POSTS, so there is no open surface to go stale.
  game.settings.register(SETTINGS_NS, "show-generation-rolls", {
    name: "CAIRN.Settings.ShowGenerationRolls.label",
    hint: "CAIRN.Settings.ShowGenerationRolls.hint",
    scope: "world",
    config: false,
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
    config: false,
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
      // formatCount, not format: the key carried an "image(s)" hack because no
      // plural machinery reached this toast. Dynamic import for the same reason
      // as the line above — utils.js imports SETTINGS_NS from here, so a static
      // import is a cycle. `{count}` stays the placeholder (formatCount's `n`
      // rides unused) because lang/es.json already carries it, and that file is
      // the translator's to edit.
      const { formatCount } = await import("./utils.js");
      ui.notifications.info(
        formatCount("CAIRN.Notify.PortraitFolderScanned", files.length, { count: files.length })
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

  // The Warden's age FORMULA (issue #21, both halves fsmalecho's). This
  // REPLACES min-age and max-age (2026-08-21, user ruling): clamping a bell
  // curve piles ages onto the bound -- with a ceiling of 30, ~57% of 2d20+10
  // rolls came out exactly 30, which reads as "every character is the same
  // age". The cap worked as coded; the design was the defect. Editing the
  // DICE gives a range as a distribution, which no clamp can.
  //
  // The default is the config's one copy (see config.js): RAW 2d20 + 10,
  // by user ruling -- rules as written win over preserving the retired
  // min-age's 21 default, which was an override, not the game. So upgrading
  // CAN change ages (12..20 are possible again out of the box), accepted
  // with eyes open; a Warden who wants the floor back writes the pool form
  // {2d20 + 10, 21}kh, the hint's own example. A retired min-age or max-age
  // value survives as an orphaned world row, the established precedent --
  // never re-read, never reused as a key.
  //
  // No onChange fan and no reload: read at ROLL time, not in
  // _prepareContext, so no open sheet shows a stale value. It governs the
  // age DIE only -- the sheet's age field is free text and always has been.
  // Blank falls back to the default silently; a formula that does not parse
  // -- or carries an `@` reference, which Roll.validate cannot be trusted
  // about -- falls back too and WARNS (rollAge in character-generator.js).
  //
  // Grouped under Character Generation, where min-age sat before it: a
  // parameter of the character being made, looked for beside the rest of
  // generation. Placement is positional -- see the ordering note above.
  game.settings.register(SETTINGS_NS, "age-formula", {
    name: "CAIRN.Settings.AgeFormula.label",
    hint: "CAIRN.Settings.AgeFormula.hint",
    scope: "world",
    config: false,
    type: String,
    default: Cairn.characterGenerator2e.biography.age,
    requiresReload: false,
  });

  // ---- Inventory & Encumbrance ---------------------------------------------
  game.settings.register(SETTINGS_NS, "max-equip-slots", {
    name: "CAIRN.Settings.MaxEquipSlots.label",
    scope: "world",
    config: false,
    type: Number,
    default: 10,
    requiresReload: true,
  });

  game.settings.register(SETTINGS_NS, "character-inventory-limit", {
    name: "CAIRN.Settings.CharacterInventoryLimit.label",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: true,
  });

  // The Warden's switch for player shopping — the sheet's Marketplace button
  // and both acquire paths (marketplace.js reads it live; the shipped "Toggle
  // Player Marketplace" macro flips it). The GM always shops. Sibling of
  // allow-player-generate in the Generation group; this one lives here
  // because shopping is an INVENTORY affair. No reload: the onChange fires on
  // every client and re-renders each open actor sheet, so the button
  // hides/returns mid-session — and a sheet that somehow keeps a stale button
  // still cannot buy, because acquire() refuses (the shop's own
  // affordance/enforcement split).
  game.settings.register(SETTINGS_NS, "allow-player-marketplace", {
    name: "CAIRN.Settings.AllowPlayerMarketplace.label",
    hint: "CAIRN.Settings.AllowPlayerMarketplace.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: rerenderActorSheets,
  });

  // Cairn 2e (p.9): coins are heavy. The first N are petty; every further N fills
  // a slot. N is this "coins per slot" value (default 100). 0 = coins weightless.
  game.settings.register(SETTINGS_NS, "use-gold-threshold", {
    name: "CAIRN.Settings.UseGoldThreshold.label",
    hint: "CAIRN.Settings.UseGoldThreshold.hint",
    scope: "world",
    config: false,
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

  /* `enable-inventory-reorder` was registered here and is GONE (2026-08-22, by
     ruling: drag-to-reorder "should not be optional and just be an always-on
     setting"). It gated whether the sheet READ each item's `sort` and honoured
     a same-actor drop as a reorder; with it off the list fell back to
     equipped-first alphabetical and a generated loadout's arrangement was
     invisible. Both paths are unconditional now. A stored value may sit unread
     in old worlds — harmless, like the other retired keys. `dev:ui-parity`
     asserts it is not registered, so re-adding it fails a gate. */

  // The submenu buttons, in group order — registered after every
  // setting so each app finds its keys registered when it opens. These are
  // the only air-bladder rows the main settings window shows.
  registerSettingMenus(SETTINGS_NS, SETTING_GROUPS);
};
