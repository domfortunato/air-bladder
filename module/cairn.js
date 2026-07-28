// Import Modules
import { CairnActor } from "./actor/actor.js";
import { CairnActorSheet } from "./actor/actor-sheet.js";
import { CairnItem, FATIGUE_NAME } from "./item/item.js";
import { CairnItemSheet } from "./item/item-sheet.js";
import { createCharacter, createHireling } from "./character-generator.js";
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

  // Register sheet application classes
  foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  foundry.documents.collections.Actors.registerSheet("cairn", CairnActorSheet, { makeDefault: true });
  foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
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
  await migrateSettingsNamespace();
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
// Table-agnostic and synchronous (preCreateChatMessage isn't awaited) — it matches
// each rendered result cell against the table.result overlay with English fallback,
// so it covers EVERY draw path (world tables, compendium tables, our own draws in
// damage.js, and a Warden rolling a pack table by hand) without resolving the source
// table. An enriched result (e.g. an @UUID link) whose rendered HTML no longer equals
// its raw key simply misses and stays English — the same graceful degradation as the
// rest of the overlay. The .table-results markup is unique to RollTable draw cards,
// so non-draw messages (damage, saves) are never touched. See i18n-content.js.
Hooks.on("preCreateChatMessage", (message, data) => {
  if (!contentLocalized()) return;
  const content = message.content ?? data?.content ?? "";
  if (!content.includes("table-results")) return;
  const el = document.createElement("div");
  el.innerHTML = content;
  const cells = el.querySelectorAll(".table-results li");
  if (!cells.length) return;
  let changed = false;
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
    changed = true;
  };
  for (const li of cells) {
    const nameEl = li.querySelector("strong.name, .name");
    if (nameEl && !nameEl.querySelector("a")) swap(nameEl, false); // skip @UUID document links
    const descEl = li.querySelector(".description");
    if (descEl) swap(descEl, true);
  }
  if (changed) message.updateSource({ content: el.innerHTML });
});

// Cairn calls the Game Master the "Warden". When the setting is on, override
// the localized GM role labels before any UI that reads them renders (Players
// list, User Management, permission dialogs). Settings are readable by `setup`,
// which runs before those render.
Hooks.on("setup", () => {
  if (!game.settings.get(SETTINGS_NS, "use-warden-title")) return;
  foundry.utils.setProperty(game.i18n.translations, "USER.RoleGamemaster", game.i18n.localize("CAIRN.Warden"));
  foundry.utils.setProperty(game.i18n.translations, "USER.RoleAssistant", game.i18n.localize("CAIRN.AssistantWarden"));
});

// One-time-feeling but idempotent migration: rename the default GM account to
// "Warden". Only the acting GM writes (avoids multi-GM races); it matches only
// the default names, which stop matching once renamed, so re-runs are no-ops.
Hooks.once("ready", async () => {
  if (!game.settings.get(SETTINGS_NS, "use-warden-title")) return;
  if (!game.user.isGM) return;
  if (game.users.activeGM && game.users.activeGM !== game.user) return;

  const warden = game.i18n.localize("CAIRN.Warden");
  const defaults = ["gamemaster", "game master"];
  const toRename = game.users.filter(
    (u) => u.role === CONST.USER_ROLES.GAMEMASTER && defaults.includes(u.name.trim().toLowerCase())
  );
  for (const u of toRename) {
    await u.update({ name: warden });
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

  const updates = game.actors
    .filter((a) => a.type === "container" && LEGACY_CONTAINER_ART.has(a.img))
    .map((a) => {
      const art = iconForTransport(a.name, a.system?.transportKind);
      return { _id: a.id, img: art, "prototypeToken.texture.src": art };
    });
  if (updates.length) {
    await Actor.updateDocuments(updates);          // one batch, so it can't half-finish
    console.log(`Air Bladder | remapped ${updates.length} container(s) to class icons`);
  }

  // Custom character portraits: make sure the GM's folder exists, then refresh the
  // cached image list so players (who cannot scan folders) see the current set.
  // Both are non-fatal — a host that forbids folder ops just leaves the pool empty
  // and generation falls back to the shipped art.
  await characterGenerator.ensureCustomPortraitFolder();
  await characterGenerator.refreshCustomPortraits();
});

// Dialogs get the black-and-white sheet look. The styling lives in css/cairn.css
// (.cairn-dialog); here we just tag each dialog on render. Covers both the AppV1
// Dialog (renderDialog) and ApplicationV2 DialogV2 (renderDialogV2). World-wide by
// design: in a Cairn world essentially every dialog is the system's, and one
// uniform look is the point -- the CSS themes only chrome (header, body, action
// button row), never inner form content, so a core or module dialog is
// recoloured but never structurally broken.
Hooks.on("renderDialog", (app) => app.element?.addClass?.("cairn-dialog"));
Hooks.on("renderDialogV2", (app) => app.element?.classList?.add?.("cairn-dialog"));

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
    if (!document.getElementById('cairn-character-gen-button')) {
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
      // be selected, placed as tokens, and owned by players.
      const kind = actor.system?.transportKind;
      const directoryTransport = actor.type == "container" && (kind === "mount" || kind === "vehicle");
      a.classList.toggle('hidden', actor.type == "container" && !directoryTransport);
    }
  });
});

Hooks.on("renderChatMessageHTML", (message, html, data) => {
  // Roll Str Save
  const token = canvas?.scene?.tokens?.get(message.speaker?.token);

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

  // True when `str` already begins with `prefix`. Used to keep the spellbook name
  // prefix idempotent: a name that already reads "Spellbook — ..." (older data, or
  // a hand-typed one) must not get a second prefix bolted on at display time.
  Handlebars.registerHelper("startsWith", function (str, prefix) {
    return typeof str === "string" && typeof prefix === "string" && str.startsWith(prefix);
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
