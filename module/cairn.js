// Import Modules
import { CairnActor } from "./actor/actor.js";
import { CairnActorSheet } from "./actor/actor-sheet.js";
import { CairnItem, FATIGUE_NAME } from "./item/item.js";
import { CairnItemSheet } from "./item/item-sheet.js";
import { createCharacter, createHireling, FLAG_SCOPE } from "./character-generator.js";
import * as characterGenerator from "./character-generator.js";
import { importKettlewrightCharacter } from "./kettlewright-import.js";
import * as kettlewrightImport from "./kettlewright-import.js";
import { Cairn } from "./config.js";
import { CairnCombat } from "./combat.js";
import { createCairnMacro, rollItemMacro } from "./macros.js";
import { Damage } from "./damage.js";
import { registerSettings, SETTINGS_NS, migrateSettingsNamespace } from "./settings.js";
import { iconForTransport } from "./icons.js";
import { ACTOR_DATA_MODELS, ITEM_DATA_MODELS } from "./data-models.js";
import { loadContentOverlay, t, translationOf, contentLocalized } from "./i18n-content.js";

Hooks.once("init", async function () {
  game.cairn = {
    CairnActor,
    CairnItem,
    config: Cairn,
    characterGenerator: characterGenerator,
    kettlewrightImport: kettlewrightImport,
    rollItemMacro,
  };

  // Define custom Entity classes
  CONFIG.Actor.documentClass = CairnActor;
  CONFIG.Item.documentClass = CairnItem;

  // Sub-type shapes. These replace template.json, which Foundry deprecated in v14
  // and removes in V16 — the sub-types themselves are declared in system.json
  // under documentTypes, and their schemas live in module/data-models.js.
  CONFIG.Actor.dataModels = ACTOR_DATA_MODELS;
  CONFIG.Item.dataModels = ITEM_DATA_MODELS;

  // configure combat
  CONFIG.Combat.documentClass = CairnCombat;
  CONFIG.Combat.initiative = {
    formula: "1d20",
  };

  // Register sheet application classes.
  //
  // No `unregisterSheet("core", …)` calls: core's `_registerDefaultSheets`
  // (client/applications/sheets/_module.mjs:84) has no Actor or Item entry, so
  // there has never been a core sheet to unregister on this target — the two calls
  // that used to be here were no-ops that named `foundry.appv1.sheets.ActorSheet`
  // and `…ItemSheet`. Those are deprecated {since: 13, until: 16}; at removal they
  // become `undefined`, `unregisterSheet` reads `sheetClass.name`
  // (document-sheet-config.mjs:472) and the whole system fails to load out of
  // `init`. Removing them is the fix and it costs nothing today.
  //
  // The "cairn" scope is deliberate and must NOT be renamed to "air-bladder": it
  // is baked into the `core.sheetClasses` setting of every existing world as
  // `cairn.CairnActorSheet`, so changing it silently resets any sheet a Warden
  // chose by hand.
  foundry.documents.collections.Actors.registerSheet("cairn", CairnActorSheet, { makeDefault: true });
  foundry.documents.collections.Items.registerSheet("cairn", CairnItemSheet, { makeDefault: true });

  registerSettings();
  configureHandleBar();
});

Hooks.once("ready", async () => {
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    // Let Foundry place an existing Macro normally; only Items (and other
    // documents) get a Cairn hotbar wrapper. Without this, dragging a Macro made
    // a wrapper that opened the macro's own edit sheet instead of running it.
    if (data.type === "Macro") return true;
    createCairnMacro(data, slot);
    return false;
  });
  // Settings used to be registered under the "cairn" namespace, which Foundry
  // could not map to this package — they rendered as "Unmapped" and a Warden
  // could not reach them. Carry any already-chosen value over to the real one.
  //
  // Caught here, not left to escape: Hooks.#call wraps a hook callback in a
  // SYNCHRONOUS try/catch, so a rejection out of an async one is not caught at
  // all — it surfaces as a bare unhandled rejection naming neither the system
  // nor the migration. (Same reasoning as the `phase` helper below.)
  try {
    await migrateSettingsNamespace();
  } catch (err) {
    console.error("Air Bladder | settings namespace migration failed (continuing):", err);
  }
});

// Load the content-localization overlay (compendium names/descriptions) for the
// active language, as soon as i18n is up and before sheets render. An English
// world — or a language with no overlay shipped — gets none, and every content
// string stays English (module/i18n-content.js).
Hooks.once("i18nInit", loadContentOverlay);

// Compendium browser: translate the visible entry names into the active language.
// Display-only — the pack index and documents stay English; each render rebuilds
// names from the index, so re-translating every render is idempotent. Names are
// only match keys internally (drag uses data-entry-id, not text), so this is safe.
Hooks.on("renderCompendium", (app, html) => {
  if (!contentLocalized()) return;
  const meta = app.collection?.metadata;
  const ns =
    meta?.type === "Actor" ? "monster.name" :
    meta?.type === "RollTable" ? "table.name" :
    (meta?.name ?? "").startsWith("backgrounds") ? "bg.name" :
    "item.name";
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? html);
  root?.querySelectorAll?.(".entry-name").forEach((el) => {
    if (el.children.length) return; // don't clobber an icon/child, only plain-text names
    const en = el.textContent.trim();
    const es = t(ns, en);
    if (es !== en) el.textContent = es;
  });
});

// Table draws to chat: localize the drawn result text into the active language.
//
// RENDER-TIME, NOT CREATE-TIME. This rewrites the already-rendered DOM of one
// client's chat card and never touches the ChatMessage document. That is the whole
// point: the stored message stays English, so a reader sees the draw in THEIR
// language (Foundry's language setting is client-scoped, so mixed-language tables
// are normal), the log re-localizes for free if a world switches language, and
// messages this system did not author — core's own RollTable#draw cards, other
// modules' draws — are only ever restyled locally, never permanently modified.
// Doing this in preCreateChatMessage instead (via updateSource) baked the roller's
// language into the stored document, breaking the display-only invariant that
// i18n-content.js:10-11 states.
//
// Table-agnostic: it matches each rendered result cell against the table.result
// overlay with English fallback, so it covers EVERY draw path (world tables,
// compendium tables, our own draws in damage.js, and a Warden rolling a pack table
// by hand) without resolving the source table. An enriched result (e.g. an @UUID
// link) whose rendered HTML no longer equals its raw key simply misses and stays
// English — the same graceful degradation as the rest of the overlay. The
// .table-results markup is unique to RollTable draw cards, so non-draw messages
// (damage, saves) are never touched. See i18n-content.js.
const localizeTableResults = (root) => {
  if (!contentLocalized()) return;
  const cells = root?.querySelectorAll?.(".table-results li");
  if (!cells?.length) return;
  const swap = (node, html) => {
    // Read the whole cell (text-type results land in .description, sometimes .name),
    // look it up as a table.result, and write the translation back if there is one.
    const en = (html ? node.innerHTML : node.textContent).trim();
    if (!en) return;
    // translationOf (not t) returns overlay-or-undefined, never the English source,
    // so the value written below is provably from our trusted overlay JSON — DOM text
    // can't round-trip back out as markup (js/xss-through-dom).
    const es = translationOf("table.result", en);
    if (es === undefined || es === en) return;
    if (html) node.innerHTML = es; else node.textContent = es;
  };
  for (const li of cells) {
    const nameEl = li.querySelector("strong.name, .name");
    if (nameEl && !nameEl.querySelector("a")) swap(nameEl, false); // skip @UUID document links
    const descEl = li.querySelector(".description");
    if (descEl) swap(descEl, true);
  }
};

// Cairn calls the Game Master the "Warden". When the setting is on, override
// the localized GM role labels before any UI that reads them renders (Players
// list, User Management, permission dialogs). Settings are readable by `setup`,
// which runs before those render.
Hooks.on("setup", () => {
  if (!game.settings.get(SETTINGS_NS, "use-warden-title")) return;
  foundry.utils.setProperty(game.i18n.translations, "USER.RoleGamemaster", game.i18n.localize("CAIRN.Warden"));
  foundry.utils.setProperty(game.i18n.translations, "USER.RoleAssistant", game.i18n.localize("CAIRN.AssistantWarden"));
});

// Rename the default GM account to "Warden". Only the acting GM writes (avoids
// multi-GM races).
//
// The name is a WORLD value but the label is localized per CLIENT, so whichever
// GM logs in first decides what every other player sees. That used to be
// one-way and unrecoverable: the rename matched only the two default names, so
// the moment it wrote, nothing matched again -- a GM who then switched language,
// or turned the setting off, was stuck with the old name and no way back short
// of editing the user by hand.
//
// Remembering the name we replaced fixes both halves. `renamedFrom` marks the
// accounts this system renamed (so a deliberately-named GM is never touched),
// lets a language switch re-apply the new label, and lets the original name come
// back if the setting is turned off. Idempotent: it writes only when the stored
// name and the wanted name actually differ.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  if (game.users.activeGM && game.users.activeGM !== game.user) return;

  const on = game.settings.get(SETTINGS_NS, "use-warden-title");
  const warden = game.i18n.localize("CAIRN.Warden");
  const defaults = ["gamemaster", "game master"];

  // Foundry enforces UNIQUE user names and rejects the update outright. A world
  // with two GMs -- or one where somebody already typed "Warden" by hand -- would
  // otherwise throw out of this hook on the second account, aborting the loop and
  // leaving a half-applied rename. Skip a name that is already spoken for, and
  // keep going if a write fails for any other reason.
  const nameTaken = (name, self) => game.users.some((x) => x.id !== self.id && x.name === name);

  for (const u of game.users) {
    if (u.role !== CONST.USER_ROLES.GAMEMASTER) continue;
    const previous = u.getFlag(FLAG_SCOPE, "renamedFrom");
    const ours = previous !== undefined;
    try {
      if (!on) {
        // Setting off: hand back the name we took, and only that.
        if (!ours) continue;
        if (!nameTaken(previous, u)) await u.update({ name: previous });
        await u.unsetFlag(FLAG_SCOPE, "renamedFrom");
        continue;
      }

      if (!ours && !defaults.includes(u.name.trim().toLowerCase())) continue;
      if (u.name === warden || nameTaken(warden, u)) continue;
      // Read the old name BEFORE the update -- u.name is the new one afterwards.
      const original = u.name;
      await u.update({ name: warden });
      if (!ours) await u.setFlag(FLAG_SCOPE, "renamedFrom", original);
    } catch (err) {
      console.warn(`Air Bladder | could not rename user "${u.name}":`, err);
    }
  }
});

// The Foundry-core art the system used to assign to container/transport actors
// (the old CONTAINER_ART gallery + the default silhouette). A container still
// wearing one of these was made before the class-icon change; anything else — a
// systems/air-bladder/icons/ path or a custom upload — was chosen deliberately.
const LEGACY_CONTAINER_ART = new Set([
  "icons/svg/mystery-man.svg",
  "icons/svg/item-bag.svg",
  "icons/containers/bags/pack-leather-brown.webp",
  "icons/containers/bags/pack-simple-leather-tan.webp",
  "icons/containers/bags/sack-cloth-tan.webp",
  "icons/containers/bags/satchel-leather-brown.webp",
  "icons/containers/chest/chest-worn-oak-tan.webp",
  "icons/containers/chest/chest-oak-steel-brown.webp",
  "icons/containers/barrels/barrel-chestnut-brown.webp",
  "icons/containers/boxes/crate-heavy-brown.webp",
  "icons/environment/creatures/horse-brown.webp",
  "icons/environment/creatures/horse-tan.webp",
  "icons/environment/creatures/horse-white.webp",
  "icons/environment/settlement/wagon.webp",
  "icons/environment/settlement/wagon-black.webp",
  "icons/environment/settlement/mine-cart-rocks-red.webp",
  "icons/environment/settlement/ship.webp",
]);

// One-time-feeling but idempotent migration: existing transport/container actors
// keep the image they were CREATED with, so the class-icon change never reached
// them. Remap ONLY the known-old defaults (above) to the new class icon by
// name/kind, so a hand-picked or uploaded portrait is left untouched. Once
// remapped the img is a systems/air-bladder/icons/ path — no longer in the set —
// so re-runs are no-ops. GM-only, single-writer, like the rename above.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  if (game.users.activeGM && game.users.activeGM !== game.user) return;

  // Each phase is isolated, because Foundry cannot catch a failure here for us:
  // Hooks.#call wraps a hook callback in a SYNCHRONOUS try/catch, so a rejected
  // promise from an async callback escapes it entirely. Unguarded, one bad document
  // in a migration became a bare unhandled rejection AND silently skipped every phase
  // after it — custom portraits would simply stop working with no visible cause and
  // nothing in the log tying it to the migration. Failing one phase must not cost the
  // others; all three are independent.
  const phase = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`Air Bladder | ${label} failed (continuing):`, err);
    }
  };

  await phase("container art migration", async () => {
    const updates = game.actors
      .filter((a) => a.type === "container" && LEGACY_CONTAINER_ART.has(a.img))
      .map((a) => {
        const art = iconForTransport(a.name, a.system?.transportKind);
        return { _id: a.id, img: art, "prototypeToken.texture.src": art };
      });
    if (updates.length) {
      await Actor.updateDocuments(updates);        // one batch, so it can't half-finish
      console.log(`Air Bladder | remapped ${updates.length} container(s) to class icons`);
    }
  });

  await phase("icon .png -> .svg migration", migrateIconsToSvg);

  await phase("spellscroll -> flagged spellbook migration", migrateScrollsToSpellbooks);

  // Custom character portraits: make sure the GM's folder exists, then refresh the
  // cached image list so players (who cannot scan folders) see the current set.
  // Both are non-fatal — a host that forbids folder ops just leaves the pool empty
  // and generation falls back to the shipped art.
  await phase("custom portrait folder", async () => {
    await characterGenerator.ensureCustomPortraitFolder();
    await characterGenerator.refreshCustomPortraits();
  });
});

/**
 * The class icons shipped as 512x512 PNGs up to 0.1.6 and are SVGs from 0.1.7 on
 * (492 KB -> 25 KB, and crisp at token size). An image path is COPIED onto a
 * document when it is created, so every item, container and monster already in a
 * world still points at a .png that the update deleted — a broken image on every
 * sheet, every token and every marketplace row.
 *
 * Rewrite only our own icons/*.png paths, so an uploaded or hand-picked image is
 * never touched. Idempotent by construction: a rewritten path no longer matches.
 * Batched per collection so a failure cannot leave half a world remapped.
 */
const ICON_PNG = /^systems\/air-bladder\/icons\/([a-z-]+)\.png$/;
const toSvg = (src) => (ICON_PNG.test(src ?? "") ? src.replace(/\.png$/, ".svg") : null);

const migrateIconsToSvg = async () => {
  let count = 0;

  const itemUpdates = game.items.filter((i) => toSvg(i.img)).map((i) => ({ _id: i.id, img: toSvg(i.img) }));
  if (itemUpdates.length) { await Item.updateDocuments(itemUpdates); count += itemUpdates.length; }

  const actorUpdates = [];
  for (const a of game.actors) {
    const img = toSvg(a.img);
    const tok = toSvg(a.prototypeToken?.texture?.src);
    if (img || tok) {
      const u = { _id: a.id };
      if (img) u.img = img;
      if (tok) u["prototypeToken.texture.src"] = tok;
      actorUpdates.push(u);
    }
    // Owned items carry their own copy of the path.
    const owned = a.items.filter((i) => toSvg(i.img)).map((i) => ({ _id: i.id, img: toSvg(i.img) }));
    if (owned.length) { await a.updateEmbeddedDocuments("Item", owned); count += owned.length; }
  }
  if (actorUpdates.length) { await Actor.updateDocuments(actorUpdates); count += actorUpdates.length; }

  // Unlinked tokens hold their own texture rather than the actor's.
  for (const scene of game.scenes) {
    const tokens = scene.tokens
      .filter((t) => toSvg(t.texture?.src))
      .map((t) => ({ _id: t.id, "texture.src": toSvg(t.texture.src) }));
    if (tokens.length) { await scene.updateEmbeddedDocuments("Token", tokens); count += tokens.length; }
  }

  if (count) console.log(`Air Bladder | moved ${count} document(s) from .png to .svg class icons`);
};

/**
 * Spellscrolls were generated as `type: "item"` named "Spellscroll — X" until they
 * became spellbooks with `system.scroll` ticked. Convert the old shape so there is
 * ONE representation of a scroll: otherwise a character's existing scrolls are
 * invisible to everything that now keys off the flag (the sheet's Scroll box, the
 * display prefix, the not-equippable rule), and a Warden looking at two scrolls
 * side by side would find only one of them editable as such.
 *
 * A document's `type` is immutable in Foundry, so this is a create-then-delete, not
 * an update — the trap the hireling merge hit. Create first so a failure can never
 * lose a scroll; the transient duplicate costs nothing, since a scroll is petty at
 * both ends and no slot count moves.
 *
 * Carried across: the name (with the prefix stripped, since the inventory row adds
 * it back at display time), the spell text, cost, quantity, whether the use was
 * already spent, `sort` (so drag-ordered inventories keep their order) and ALL
 * flags — `flags.air-bladder.grantSource` is how a bond or question re-roll finds
 * the items it granted, so dropping it would orphan them.
 *
 * Idempotent: a converted scroll is no longer `type: "item"`, so a re-run matches
 * nothing.
 */
const STORED_SCROLL_PREFIXES = ["Spellscroll — ", "Spellscroll ("];

/** True for a pre-flag scroll. The name prefix is the only marker the old shape
 *  had — which is the defect being fixed, and it also catches a Warden's
 *  hand-built "Spellscroll — X" generic item, the only authoring path there was. */
const isLegacyScroll = (item) =>
  item.type === "item" && STORED_SCROLL_PREFIXES.some((p) => item.name?.startsWith(p));

/** "Spellscroll — Adhere" / "Spellscroll (Adhere)" -> "Adhere". */
const bareScrollName = (name) => {
  const s = String(name ?? "");
  for (const p of STORED_SCROLL_PREFIXES) {
    if (!s.startsWith(p)) continue;
    const rest = s.slice(p.length);
    return (p.endsWith("(") ? rest.replace(/\)\s*$/, "") : rest).trim();
  }
  return s;
};

const asFlaggedScroll = (old) => {
  const o = old.toObject();
  return {
    name: bareScrollName(o.name),
    type: "spellbook",
    img: o.img,                       // already the scroll art, or a Warden's own
    sort: o.sort ?? 0,
    flags: o.flags ?? {},
    system: {
      description: o.system?.description ?? "",
      cost: o.system?.cost ?? 0,
      quantity: o.system?.quantity ?? 1,
      scroll: true,
      weightless: true,
      equipped: false,
      // A spent scroll stays spent. `max` is pinned at 1 by the invariant anyway.
      uses: { value: Math.min(o.system?.uses?.value ?? 1, 1), max: 1 },
    },
  };
};

const migrateScrollsToSpellbooks = async () => {
  let count = 0;
  const ItemCls = getDocumentClass("Item");

  /** @param {Document|null} parent  the owning Actor, or null for world items */
  const convert = async (parent, items) => {
    const legacy = items.filter(isLegacyScroll);
    if (!legacy.length) return;
    const payload = legacy.map(asFlaggedScroll);
    const ids = legacy.map((i) => i.id);
    if (parent) {
      await parent.createEmbeddedDocuments("Item", payload);
      await parent.deleteEmbeddedDocuments("Item", ids);
    } else {
      await ItemCls.createDocuments(payload);
      await ItemCls.deleteDocuments(ids);
    }
    count += legacy.length;
  };

  await convert(null, [...game.items]);
  for (const actor of game.actors) await convert(actor, [...actor.items]);

  // An unlinked token keeps its own copy of the actor's items in its delta, so the
  // world actor's inventory says nothing about it. Writing through the synthetic
  // `token.actor` updates that delta. Linked tokens are skipped — they ARE the
  // world actor already handled above, and converting twice would duplicate.
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actorLink || !token.actor) continue;
      await convert(token.actor, [...token.actor.items]);
    }
  }

  if (count) console.log(`Air Bladder | converted ${count} spellscroll(s) to flagged spellbooks`);
};

// Two hooks used to tag every dialog world-wide with `.cairn-dialog` so
// css/cairn.css could give it the sheet's black-and-white chrome. f00e72c
// (2026-07-23) reverted dialogs to Foundry's own theme-aware look and deleted
// that CSS, but left these behind -- so they ran on every dialog any package
// opened, to add a class that styled nothing, under a comment claiming styles
// that no longer existed. Removed 2026-07-28. Dialogs are Foundry's surface now;
// if that is ever revisited, re-add BOTH hooks (AppV1 `renderDialog` and V2
// `renderDialogV2`) alongside the CSS, not one without the other.

/**
 * "Spellscroll" in the Create Item type list — without a spellscroll TYPE.
 *
 * Core builds that list from `Object.keys(game.model.Item)`, labelled through
 * `CONFIG.Item.typeLabels` (client-document.mjs `createDialog`), so as a TYPE only a
 * declared document type can ever appear there. Declaring one is the wrong shape for
 * the same reasons a `relic` type was: a scroll carries no data a spellbook does not,
 * and Foundry treats `type` as immutable — so a book could never be converted into a
 * scroll or back, which is the whole affordance the flag buys.
 *
 * The dialog's other seam does the job instead. Its OK handler runs
 * `FormDataExtended` over the WHOLE form and passes the result straight to
 * `cls.create()`, so a field added here reaches the new document, and
 * `CairnItem._preCreate` pins petty + one use from the flag. The extra option
 * deliberately carries `value="spellbook"`, the same as its neighbour: two options may
 * share a value, and `selectedOptions[0].dataset` is what tells them apart —
 * `select.value` cannot, and does not need to.
 *
 * The name is PRE-FILLED rather than left to the placeholder, because core's fallback
 * for an empty name is `defaultName({type})` and the type here really is "spellbook":
 * an unnamed create would otherwise produce a scroll called "Spellbook".
 *
 * Degrades quietly. If core reworks this dialog the option stops appearing, and the
 * worst case is a plain spellbook that the sheet's Scroll box still converts.
 */
Hooks.on("renderDialogV2", (dialog, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const select = root?.querySelector('select[name="type"]');
  const form = select?.form;
  if (!select || !form || select.querySelector("option[data-ab-scroll]")) return;

  // Identify the ITEM create dialog specifically: this hook sees every DialogV2 in
  // the world, including the system's own five and any other package's.
  const bookOption = select.querySelector('option[value="spellbook"]');
  const itemTypes = getDocumentClass("Item").TYPES;
  if (!bookOption || [...select.options].some((o) => !itemTypes.includes(o.value))) return;

  const label = game.i18n.localize("CAIRN.Spellscroll");
  const option = document.createElement("option");
  option.value = "spellbook";
  option.dataset.abScroll = "1";
  option.textContent = label;
  bookOption.after(option);

  // `data-dtype` is load-bearing: FormDataExtended casts the string "false" to false
  // for a Boolean field, where a BooleanField handed that non-empty STRING would
  // coerce it to true and every item created here would be a scroll.
  const flag = document.createElement("input");
  flag.type = "hidden";
  flag.name = "system.scroll";
  flag.value = "false";
  flag.dataset.dtype = "Boolean";
  form.append(flag);

  const nameInput = form.querySelector('input[name="name"]');
  select.addEventListener("change", () => {
    const scroll = select.selectedOptions[0]?.dataset.abScroll === "1";
    flag.value = scroll ? "true" : "false";
    if (!nameInput) return;
    if (scroll && !nameInput.value) nameInput.value = label;
    else if (!scroll && nameInput.value === label) nameInput.value = "";
  });
});

/**
 * Group and compact the system's rows in the GM's Configure Settings tab.
 *
 * Foundry renders a flat list of every setting with a bold name and a hint
 * beneath, which for seventeen settings is a wall of text. Insert section
 * headers before the first setting of each group, then collapse every row to one
 * compact line (full-width plain label, control pinned right, hint hidden).
 */
Hooks.on("renderSettingsConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const groups = [
    ["use-panic", "CAIRN.Settings.GroupGeneral"],
    ["content-source-2e", "CAIRN.Settings.GroupGeneration"],
    ["max-equip-slots", "CAIRN.Settings.GroupInventory"],
  ];
  for (const [key, titleKey] of groups) {
    const group = root.querySelector(`[name="${SETTINGS_NS}.${key}"]`)?.closest(".form-group");
    if (!group || group.previousElementSibling?.classList?.contains("cairn-settings-header")) continue;
    const header = document.createElement("h3");
    header.className = "cairn-settings-header";
    header.textContent = game.i18n.localize(titleKey);
    group.parentNode.insertBefore(header, group);
  }
  root.querySelectorAll(`[name^="${SETTINGS_NS}."]`).forEach((input) => {
    input.closest(".form-group")?.classList.add("cairn-setting-compact");
  });

  // Barebones sub-options are meaningless unless Barebones character sheets are
  // offered, so grey them out (and disable them) while that master toggle is off.
  const barebonesSubKeys = ["barebones-failed-career", "show-omens-barebones", "show-bonds-barebones"];
  const barebonesToggle = root.querySelector(`[name="${SETTINGS_NS}.content-source-barebones"]`);
  const syncBarebonesSubs = () => {
    const on = !!barebonesToggle?.checked;
    for (const key of barebonesSubKeys) {
      const input = root.querySelector(`[name="${SETTINGS_NS}.${key}"]`);
      if (!input) continue;
      input.disabled = !on;
      input.closest(".form-group")?.classList.toggle("cairn-setting-disabled", !on);
    }
  };
  if (barebonesToggle) {
    barebonesToggle.addEventListener("change", syncBarebonesSubs);
    syncBarebonesSubs();
  }

  // Bold the source name within the two Character Generation labels (Foundry
  // renders setting names as plain text, so we do it here with text nodes).
  const boldPhrase = (key, phrase) => {
    const label = root.querySelector(`[name="${SETTINGS_NS}.${key}"]`)?.closest(".form-group")?.querySelector("label");
    if (!label) return;
    const text = label.textContent;
    const i = text.indexOf(phrase);
    if (i < 0) return;
    const strong = document.createElement("strong");
    strong.textContent = phrase;
    label.replaceChildren(
      document.createTextNode(text.slice(0, i)),
      strong,
      document.createTextNode(text.slice(i + phrase.length)),
    );
  };
  boldPhrase("content-source-2e", "Cairn 2e");
  boldPhrase("content-source-custom", "Custom 2e");
  boldPhrase("content-source-barebones", "Cairn Barebones");
});

Hooks.on("renderActorDirectory", (app, html) => {
  if (game.user.can("ACTOR_CREATE")) {
    // Scope the "already injected?" test to THIS directory, not the document.
    // Foundry renders a second, independent ActorDirectory when the tab is
    // popped out, and a document-wide getElementById sees the docked one's
    // button and skips injection -- so the popped-out window had no Generate,
    // Hireling or Import buttons at all. The id is duplicated across the two
    // windows by design; the class is what the click handlers below bind to.
    if (!html.querySelector("#cairn-character-gen-button")) {
      const section = document.createElement("header");
      section.classList.add("character-generator");
      section.classList.add("directory-header");
      const dirHeader = html.querySelector(".directory-header");
      dirHeader.parentNode.insertBefore(section, dirHeader);
      section.insertAdjacentHTML(
        "afterbegin",
        `
        <div class="header-actions action-buttons flexrow" id="cairn-character-gen-button">
          <button class="create-character-generator-button"><i class="fas fa-dice-d6"></i>${game.i18n.localize(
          "CAIRN.CharacterGenerator"
        )}</button>
          <button class="create-hireling-button"><i class="fas fa-user-plus"></i>${game.i18n.localize(
          "CAIRN.CreateHireling"
        )}</button>
          ${game.user.isGM ? `<button class="import-kettlewright-button"><i class="fas fa-file-import"></i>${game.i18n.localize("CAIRN.KWImport.Button")}</button>` : ""}
        </div>
        `
      );
      section
        .querySelector(".create-character-generator-button")
        .addEventListener("click", async () => {
          const actor = await createCharacter();
          if (actor) actor.sheet.render(true);
        });
      section
        .querySelector(".create-hireling-button")
        .addEventListener("click", async () => {
          const actor = await createHireling();
          if (actor) actor.sheet.render(true);
        });
      // GM-only: import a Kettlewright character export into a new Actor.
      section
        .querySelector(".import-kettlewright-button")
        ?.addEventListener("click", async () => {
          const actor = await importKettlewrightCharacter();
          if (actor) actor.sheet.render(true);
        });
    }
  }
  const showContainers = game.settings.get(SETTINGS_NS, "show-container-actors");
  const actors = html.querySelectorAll('.actor');
  actors.forEach((a) => {
    const aid = a.dataset.entryId;
    const actor = game.actors.find((v) => v.id == aid);
    if (!actor) return;
    // Container/transport art (packs, mounts, vehicles) is Foundry's colour core
    // icons; the sheet shows it grayscale to match the black-and-white look, so
    // the directory thumbnail must match — the same actor should not read colour
    // in the list and grey on its sheet.
    a.classList.toggle('cairn-grayscale-portrait', actor.type == "container");

    if (!showContainers) {
      // Plain/worn containers stay hidden (they're reached via a character's
      // Containers tab), but transport MOUNTS and VEHICLES are standalone
      // carriers that travel alongside — they show in the directory so they can
      // be selected, placed as tokens, and owned by players. An ITEM PILE is the
      // same argument taken further: nothing carries it at all, so the Containers
      // tab is the one place it could never be reached from.
      const kind = actor.system?.transportKind;
      const standalone = kind === "mount" || kind === "vehicle" || kind === "pile";
      const directoryTransport = actor.type == "container" && standalone;
      a.classList.toggle('hidden', actor.type == "container" && !directoryTransport);
    }
  });
});

Hooks.on("renderChatMessageHTML", (message, html, data) => {
  // Display-only content overlay for RollTable draw cards (see above).
  localizeTableResults(html);

  // Roll Str Save.
  //
  // Resolve the token from the scene the message was SPOKEN in, not from whatever
  // scene the viewer is currently looking at. `canvas.scene` is a property of the
  // viewer, not of the message, so reading it meant that the moment the party
  // changed scene the lookup missed and the button was hidden on every damage card
  // already in the log — for the owner and the GM alike, and permanently, since
  // the chat log re-renders against the new scene too. `speaker.scene` is recorded
  // on the message itself and does not move.
  const speaker = message.speaker ?? {};
  const scene = speaker.scene ? game.scenes?.get(speaker.scene) : canvas?.scene;
  const token = scene?.tokens?.get(speaker.token);

  if (token?.actor) {
    if (token.actor.testUserPermission(game.user, "OWNER") || game.user.isGM) {
      const btn = html.querySelector(".roll-str-save");
      if (btn)
        btn.onclick = (ev) => Damage._rollStrSave(token, html);
    } else {
      html.querySelectorAll(".roll-str-save").forEach((btn) => {
        btn.style.display = "none";
      });
    }
  } else {
    html.querySelectorAll(".roll-str-save").forEach((btn) => {
      btn.style.display = "none";
    });
  }

  // Offer (from a failed STR save — damage-flow OR the sheet's d20) to flag
  // Critical Damage. Needs only the actor, which a sheet save carries via the
  // speaker even with no token; STR is already reduced, so this only sets the
  // status.
  const critBtn = html.querySelector(".mark-critical-damage");
  if (critBtn) {
    const critActor = token?.actor ?? game.actors.get(message.speaker?.actor);
    if (critActor && (critActor.testUserPermission(game.user, "OWNER") || game.user.isGM)) {
      critBtn.onclick = async (ev) => {
        // Capture the button before awaiting: event.currentTarget is null once
        // the (async) handler resumes after the update.
        const b = ev.currentTarget;
        await critActor.update({ "system.critical": true });
        b.setAttribute("disabled", "disabled");
      };
    } else {
      critBtn.style.display = "none";
    }
  }

  if (game.user.isGM) {
    const btn = html.querySelector(".apply-dmg");
    if (btn)
      btn.onclick = (ev) => Damage.onClickChatMessageApplyButton(ev, html, data);
  } else {
    html.querySelectorAll(".apply-dmg").forEach((btn) => {
      btn.style.display = "none";
    });
  }
});

const configureHandleBar = () => {
  // Pre-load templates
  const templatePaths = [
    "systems/air-bladder/templates/parts/items-list.html",
    "systems/air-bladder/templates/parts/container-list.html",
    "systems/air-bladder/templates/parts/feature-list.html",
  ];

  foundry.applications.handlebars.loadTemplates(templatePaths);

  Handlebars.registerHelper("toLowerCase", function (str) {
    return str.toLowerCase();
  });

  Handlebars.registerHelper("boldIf", function (cond, options) {
    return cond
      ? "<strong>" + options.fn(this) + "</strong>"
      : options.fn(this);
  });

  Handlebars.registerHelper("ifPrint", (cond, v1) => (cond ? v1 : ""));
  Handlebars.registerHelper("ifPrintElse", (cond, v1, v2) => (cond ? v1 : v2));

  Handlebars.registerHelper("times", function (n, block) {
    var accum = "";
    for (var i = 0; i < n; ++i) {
      block.data.index = i;
      block.data.first = i === 0;
      block.data.last = i === n - 1;
      accum += block.fn(this);
    }
    return accum;
  });

  Handlebars.registerHelper("isNotNull", function (val) {
    return val !== null && val != undefined;
  });

 Handlebars.registerHelper("isFatigue", function (val) {
    return val === FATIGUE_NAME;
  });

  // The display prefix for a spellbook row — "Spellbook — " for a book,
  // "Spellscroll — " for a scroll — or "" when the name already carries one.
  // Keeping this idempotent needs BOTH forms tested, which is why it is a
  // helper rather than an {{#unless startsWith}} in the template:
  //
  //   - the stored name is English ("Spellbook (Detect Magic)" is shipped pack
  //     data), and the content overlay translates names only where it has an
  //     entry — so `item.name` here may be either language;
  //   - the old guard compared that name against the TRANSLATED prefix alone, so
  //     on a Spanish client it never matched and every spellbook rendered
  //     "Hechizo — Spellbook — Detect Magic".
  //
  // The English forms are stored-data constants, like FATIGUE_NAME — not UI
  // strings. Both separators appear in shipped names. A scroll is checked against
  // BOTH families, not just its own: scrolls were stored as "Spellscroll — X"
  // before they became flagged spellbooks, the migration strips that, and a
  // hand-typed name may carry either.
  const STORED_SPELLBOOK_PREFIXES = ["Spellbook — ", "Spellbook (", "Spellscroll — ", "Spellscroll ("];
  Handlebars.registerHelper("spellbookPrefix", function (name, scroll) {
    const n = String(name ?? "");
    const localized = game.i18n.localize(scroll ? "CAIRN.SpellscrollPrefix" : "CAIRN.SpellbookPrefix");
    const both = [game.i18n.localize("CAIRN.SpellbookPrefix"), game.i18n.localize("CAIRN.SpellscrollPrefix")];
    const carried = [...STORED_SPELLBOOK_PREFIXES, ...both].some((p) => n.startsWith(p));
    return carried ? "" : localized;
  });

  Handlebars.registerHelper("markItemUsed", function (item, options) {
    const usable =
      item.system.uses &&
      item.system.uses.max;
    return usable && item.system.uses.value <= 0
      ? '<span style="opacity: 0.65;">' +
      options.fn(this) +
      "</span>"
      : options.fn(this);
  });

  Handlebars.registerHelper("hidden", function (val) {
    if (val) return "display: none";
    return "";
  });
};
