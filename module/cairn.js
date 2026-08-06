// Import Modules
import { CairnActor } from "./actor/actor.js";
import { CairnActorSheet } from "./actor/actor-sheet.js";
import { CairnItem, FATIGUE_NAME, SPELLSCROLL_NAME } from "./item/item.js";
import { CairnItemSheet } from "./item/item-sheet.js";
import { createCharacter, createNpc, requestPcGeneration, enabledContentSources, FLAG_SCOPE } from "./character-generator.js";
import * as characterGenerator from "./character-generator.js";
import { createMonster } from "./monster-generator.js";
import * as monsterGenerator from "./monster-generator.js";
import { generateFaction } from "./faction-generator.js";
import { reseedSpellTable } from "./spell-tables.js";
import { importKettlewrightCharacter } from "./kettlewright-import.js";
import * as kettlewrightImport from "./kettlewright-import.js";
import { Cairn } from "./config.js";
import { CairnCombat } from "./combat.js";
import { createCairnMacro, rollItemMacro } from "./macros.js";
import { Damage } from "./damage.js";
import { registerSettings, SETTINGS_NS, migrateSettingsNamespace } from "./settings.js";
import { ACTOR_DATA_MODELS, ITEM_DATA_MODELS, deriveNpcRole } from "./data-models.js";
import { connectionHeadroom, connectedOwnershipShape, syncPendingOwnership, OWNERSHIP_SYNC_FLAG } from "./connections.js";
import { loadContentOverlay, t, translationOf, contentLocalized } from "./i18n-content.js";

Hooks.once("init", async function () {
  game.cairn = {
    CairnActor,
    CairnItem,
    config: Cairn,
    characterGenerator: characterGenerator,
    monsterGenerator: monsterGenerator,
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
  // v14 render hooks pass the raw HTMLElement — no jQuery ever arrives here.
  const root = html;
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
/**
 * GM-side broker for the Actors a PLAYER's character generation grants.
 *
 * `Actor.create` needs ACTOR_CREATE, which players do not have, and granting it
 * world-wide to make one background work would let players create any actor at
 * all. So the player emits and exactly one GM client writes. This only works at
 * all because `system.json` declares `"socket": true` — the server binds no
 * handler for `system.<id>` without it and silently discards every emit, which
 * is exactly how this shipped doing nothing (review #5, critical).
 *
 * THIS IS A PRIVILEGE BOUNDARY AND IS TREATED AS ONE. Anything arriving here was
 * composed by a client we do not control: a player can emit whatever they like on
 * this socket, including a payload that is not a container at all. So the payload
 * is not trusted, it is REBUILT — only known fields are copied, the type is
 * forced, and the connection must point at an actor the SENDER can already
 * modify. Two identity rules make that check real (both learned from review #5,
 * which found the first version reading the requester out of the attacker's own
 * payload — a "guard" any player could satisfy with a GM's public user id,
 * because testUserPermission short-circuits to OWNER for any GM):
 *
 *   - WHO asked is `senderId`, the handler's second argument. Foundry's server
 *     re-emits a custom-socket event as (payload, this.user.id) with the id
 *     taken from the authenticated session — it is the one thing about the
 *     message a client cannot forge. Nothing inside `msg` names the sender.
 *   - WHAT it attaches to must be a WORLD Actor. `fromUuid` resolves more than
 *     those: an embedded Item resolves and delegates getUserLevel to its parent
 *     (so "OWNER" passes), and a compendium doc resolves too. Either would put
 *     a nonsense uuid in `connectedTo` on a document the Warden's client signed.
 *
 * Registered at init, not ready: the client buffers inbound socket events from
 * connect and REPLAYS them one line before the ready hook fires, so a listener
 * registered on ready misses anything a player sent while the GM's world was
 * still loading. `game.socket` exists from Game.connect, well before init ends.
 */

/** The only roles a grant payload may claim — the non-keeping ones. A payload
 *  saying anything else falls back to deriving from its class/legacy fields,
 *  clamped to `container` if even that derives a keeper. */
const GRANTABLE_ROLES = ["mount", "transport", "container"];
const grantableRole = (sys) => {
  const claimed = String(sys?.role ?? "");
  if (GRANTABLE_ROLES.includes(claimed)) return claimed;
  const derived = deriveNpcRole(sys ?? {});
  return GRANTABLE_ROLES.includes(derived) ? derived : "container";
};

/** Requesters with a generatePC currently running on this client. One request
 *  per player at a time: generation takes seconds, and without this a doubled
 *  click (or a hostile loop) has the Warden's client minting a PC per emit. */
const pcGenerationInFlight = new Set();

Hooks.once("init", () => {
  game.socket.on(`system.${game.system.id}`, async (msg, senderId) => {
    // A player's connect/break asks the active GM's client to apply the
    // ownership shape their own client is forbidden to write. NOTHING in the
    // message is trusted: the sync flag on the document is the authorization
    // (only the child's owners can have set it), and syncPendingOwnership
    // recomputes the shape from the document's own connectedTo. A flagless
    // uuid is a no-op; an embedded or compendium uuid is refused the same way
    // grantActors refuses one.
    //
    // `senderId` is passed as well now — not as the authorization, which is
    // still the flag, but so the BOTH-ENDS rule can be re-checked where a
    // crafted client cannot skip it. It is the one field the server
    // authenticates. See syncPendingOwnership for what it refuses and why a
    // refusal must clear the flag.
    if (msg?.action === "ownershipSync") {
      if (game.users.activeGM !== game.user) return;
      const child = await fromUuid(msg.childUuid);
      if (!(child instanceof getDocumentClass("Actor")) || child.pack || child.parent) return;
      await syncPendingOwnership(child, { requester: game.users.get(senderId) ?? null });
      return;
    }
    // A permission-less player's Generate PC. The payload carries NOTHING and
    // nothing in it is read: who gets the character is senderId, the one fact
    // a client cannot forge. The requester is stamped OWNER in the CREATE
    // data (createActorWithCharacter threads it through), so a background's
    // granted mule derives its ownership from a keeper that already names
    // them. GM senders are refused — they hold the direct button, and a
    // request claiming to be one could only be console-crafted.
    if (msg?.action === "generatePC") {
      if (game.users.activeGM !== game.user) return;
      const user = game.users.get(senderId);
      if (!user || user.isGM) return;
      if (pcGenerationInFlight.has(senderId)) return;
      pcGenerationInFlight.add(senderId);
      try {
        // Everything below is inside a try that CATCHES, not merely a finally.
        // It was a bare try/finally, so a throw anywhere in generation — a pack
        // that would not open, a background whose grant failed — released the
        // in-flight lock and then propagated out of an async socket handler,
        // where nothing awaits it. No emit was ever sent, so the player sat on
        // "rolling your character…" for the rest of the session with no way to
        // ask again: the lock was clear, but they had no reason to press
        // anything. The comment below already called that outcome unacceptable
        // for the null case; a throw is the same outcome by a worse route.
        // The wire names a content source (the player answered the picker on
        // their own client — a prompt HERE would hang their request on this
        // screen's modal), but the wire is not trusted: anything not currently
        // enabled clamps to the only enabled source, or to 2e under the same
        // everything-off kindness promptContentSource applies. A source is
        // always passed, so generateCharacter never prompts on this client.
        const enabled = enabledContentSources().map((s) => s.key);
        const source = enabled.includes(msg.source) ? msg.source : (enabled[0] ?? "2e");
        const actor = await createCharacter({
          source,
          ownership: { [senderId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
          // The generation chat card is headed by the ROLLER's name, and the
          // roller is the PLAYER who asked -- this branch runs on the Warden's
          // client, so leaving it to default would head every character a player
          // rolled with the Warden's name instead.
          roller: user,
        });
        // A null actor is a real outcome (the Warden dismissed the
        // content-source picker); answer anyway, or the player's "rolling
        // your character…" toast is the last they ever hear of it.
        if (actor) {
          ui.notifications.info(game.i18n.format("CAIRN.Notify.PcGeneratedFor", {
            name: actor.name, player: user.name,
          }));
        }
        game.socket.emit(`system.${game.system.id}`, {
          action: "pcGenerated", userId: senderId, uuid: actor?.uuid ?? null,
        });
      } catch (err) {
        console.error(`Air Bladder | generatePC failed for ${user.name}:`, err);
        ui.notifications.error(game.i18n.format("CAIRN.Notify.PcGenFailedFor", { player: user.name }));
        // `failed` distinguishes this from the Warden dismissing the picker:
        // the player is told to ask again, not told it was cancelled.
        game.socket.emit(`system.${game.system.id}`, {
          action: "pcGenerated", userId: senderId, uuid: null, failed: true,
        });
      } finally {
        pcGenerationInFlight.delete(senderId);
      }
      return;
    }
    // The answer to a generatePC, addressed by userId. Only a GM client ever
    // sends one — an emit from anyone else is a player trying to pop windows
    // on another player's screen, and is dropped on the sender check.
    if (msg?.action === "pcGenerated") {
      if (msg.userId !== game.user.id) return;
      if (!game.users.get(senderId)?.isGM) return;
      if (!msg.uuid) {
        ui.notifications.warn(game.i18n.localize(msg.failed
          ? "CAIRN.Notify.PcGenFailed"
          : "CAIRN.Notify.PcGenCancelled"));
        return;
      }
      // The custom emit can outrun the document broadcast that carries the
      // actor itself — poll briefly rather than racing it.
      for (let i = 0; i < 20; i++) {
        const actor = await fromUuid(msg.uuid);
        if (actor) { actor.sheet?.render(true); return; }
        await new Promise((r) => setTimeout(r, 150));
      }
      return;
    }
    if (msg?.action !== "grantActors") return;
    // Exactly ONE client acts, or every logged-in GM mints its own copy.
    if (game.users.activeGM !== game.user) return;

    const owner = await fromUuid(msg.ownerUuid);
    const user = game.users.get(senderId);
    if (!owner || !user) return;
    // A world Actor, not whatever else the uuid resolved to.
    if (!(owner instanceof getDocumentClass("Actor")) || owner.pack || owner.parent) {
      console.warn(`Air Bladder | refused a grant request from ${user.name}: ${msg.ownerUuid} is not a world Actor`);
      return;
    }
    // The SENDER must already own the character they are attaching to.
    if (!owner.testUserPermission(user, "OWNER")) {
      console.warn(`Air Bladder | refused a grant request from ${user.name}: not an owner of ${owner.name}`);
      return;
    }
    // ...and the target must be able to KEEP. Alice owns the mule her horse
    // grant minted (ownership is copied), so without this she could aim a
    // second request at the mule and chain-nest through the Warden's client.
    if (!owner.canKeepConnected) {
      console.warn(`Air Bladder | refused a grant request from ${user.name}: ${owner.name} cannot keep connected actors`);
      return;
    }
    // A background grants a handful; anything more is not a background. And
    // never past the connection ceiling: this handler runs on the WARDEN'S
    // client, so it is the wall — the matching clamp in grantContainers runs in
    // the player's browser, where a crafted message ignores it. Clamped rather
    // than refused so a request that is partly grantable grants that part; the
    // console names what was cut, because a wall that trims silently reads as
    // "generation lost my mule".
    const room = Math.min(8, connectionHeadroom(owner));
    const asked = Array.isArray(msg.payloads) ? msg.payloads : [];
    if (asked.length > room) {
      console.warn(`Air Bladder | grant request from ${user.name} clamped: ${owner.name} has room for ${room} of ${asked.length} (connection limit)`);
    }
    const payloads = asked.slice(0, room);
    // `img` comes off the wire into a FilePathField, which refuses an unknown
    // extension by THROWING — and createDocuments below is one batched call, so
    // a single malformed path rejected every grant in the request, not the one
    // payload carrying it. A path we cannot recognise is dropped instead, and
    // the document takes Foundry's own default art. Extension only: whether the
    // file EXISTS is the server's business, and a broken-but-plausible path
    // renders as a missing image rather than losing the actor.
    const imageOf = (v) => {
      const s = String(v ?? "");
      const ext = s.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
      return ext in CONST.IMAGE_FILE_EXTENSIONS ? s : "";
    };
    const clean = payloads.map((p) => ({
      type: "npc",                                   // forced, never taken from the wire
      name: String(p?.name ?? "").slice(0, 120),
      img: imageOf(p?.img),
      prototypeToken: { texture: { src: imageOf(p?.img) } },
      system: {
        connectedTo: owner.uuid,                     // forced to the verified owner
        slots: Number(p?.system?.slots) || 0,
        description: String(p?.system?.description ?? ""),
        containerClass: String(p?.system?.containerClass ?? ""),
        // Grants mint beasts and things, never people: a role that can KEEP
        // would let a crafted message mint a keeper and chain further grants
        // through it — the same hole the canKeepConnected check above closes
        // for the TARGET, closed here for what the grant creates. Anything
        // else on the wire derives from the class, as a pre-roles payload did.
        role: grantableRole(p?.system),
        cost: Number(p?.system?.cost) || 0,
        generationEnabled: false,
        ...(p?.system?.hp ? { hp: { value: Number(p.system.hp.value) || 0, max: Number(p.system.hp.max) || 0 } } : {}),
        ...(p?.system?.armorOverride != null ? { armorOverride: Number(p.system.armorOverride) || 0 } : {}),
      },
      // Only the one flag generation uses to find its own grants later.
      flags: { [FLAG_SCOPE]: { grantSource: String(p?.flags?.[FLAG_SCOPE]?.grantSource ?? "background") } },
    })).filter((p) => p.name);
    if (!clean.length) return;

    // Caught, not left to reject an async socket handler nobody awaits. A throw
    // here loses the player's whole background grant with no console line and
    // no notification on either screen — the same silence generatePC used to
    // have, one handler down.
    try {
      const made = await getDocumentClass("Actor").createDocuments(clean);
      // The CONNECTED ownership shape, not the old wholesale copy of the
      // owner's ownership: {default: OBSERVER, the keeper's players: OWNER}.
      // This client is the active GM's, so the write cannot be refused.
      // ONE batched write (review 2026-08-04, same rule as the orphan sweep in
      // actor.js): a per-document loop that throws midway leaves grant 1
      // connected and grants 2-3 on the LIMITED default — a player staring at
      // silhouettes of half their background's animals with nothing naming
      // which. A batch lands or fails as one.
      await getDocumentClass("Actor").updateDocuments(made.map((a) => ({
        _id: a.id,
        ownership: foundry.data.operators.ForcedReplacement.create(connectedOwnershipShape(owner)),
      })));
    } catch (err) {
      console.error(`Air Bladder | grant request from ${user.name} for ${owner.name} failed:`, err);
      ui.notifications.error(game.i18n.format("CAIRN.Notify.GrantFailedFor", { player: user.name }));
    }
  });
});

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

/* The "container art migration" phase lived here (a LEGACY_CONTAINER_ART set of
   Foundry core paths, remapped to our class icons on every container-TYPED
   actor). It went with the type on 2026-07-31: it selected on
   `a.type === "container"`, so with the type retired it could only ever match
   nothing. An npc that came through the built type migration already carries a
   systems/air-bladder/icons/ path, which was never in the set anyway. */

// GM-only, single-writer, like the rename above.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  if (game.users.activeGM && game.users.activeGM !== game.user) return;

  // Each phase is isolated, because Foundry cannot catch a failure here for us:
  // Hooks.#call wraps a hook callback in a SYNCHRONOUS try/catch, so a rejected
  // promise from an async callback escapes it entirely. Unguarded, one bad document
  // in a migration became a bare unhandled rejection AND silently skipped every phase
  // after it — custom portraits would simply stop working with no visible cause and
  // nothing in the log tying it to the migration. Failing one phase must not cost the
  // others; every phase is independent of every other.
  const phase = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`Air Bladder | ${label} failed (continuing):`, err);
    }
  };

  await phase("icon .png -> .svg migration", migrateIconsToSvg);

  await phase("gallery art -> art/ path migration", migrateArtPaths);

  await phase("spellscroll -> flagged spellbook migration", migrateScrollsToSpellbooks);

  await phase("npc role migration", migrateNpcRoles);

  await phase("connections flatten + ownership migration", flattenConnections);

  // Stray sync flags: a player can connect or break while NO GM client is
  // open, and the flag then waits for one. Every GM load processes whatever
  // accumulated — NOT marker-gated, because it is not a migration; it is the
  // relay's catch-up half, and it must run every time. Idempotent and cheap:
  // a flagless world is one pass over game.actors reading a flag.
  await phase("pending ownership sync sweep", async () => {
    for (const a of game.actors) {
      if (a.getFlag(FLAG_SCOPE, OWNERSHIP_SYNC_FLAG) !== undefined) await syncPendingOwnership(a);
    }
  });

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
 * The four picker galleries moved under `art/` (2026-08-04): Aspeheim's split
 * `character_portraits/` + `character_tokens/` became `art/jon-aspeheim/
 * portraits|tokens/`, and tlomdev's and game-icons' folders each gained the
 * `art/` prefix. `icons/` did NOT move — it is stamped class art, not a
 * browsable gallery, and it is deliberately absent from the table below.
 *
 * SAME PROBLEM AS THE .png -> .svg MIGRATION ABOVE, and it is the reason a
 * cosmetic-looking folder move is not cosmetic: an image path is COPIED onto a
 * document when it is created, never read live off the system. So every actor
 * in every existing world still points at where its portrait used to be, and
 * without this a 0.1.9 world upgrades to a broken image on every sheet, every
 * canvas token and every re-arted monster — including art the Warden picked by
 * hand, which is exactly the art they would mind losing.
 *
 * Prefix rewrite rather than a lookup, so it carries hand-picked images too:
 * anything under a moved folder moves with it, and nothing else is touched. A
 * pasted URL, a custom upload and anything under icons/ all fail the prefix and
 * are left alone. Idempotent by construction — a rewritten path begins
 * `systems/air-bladder/art/…` and matches no `from` — which matters because
 * this runs on every GM load, not behind a version marker.
 *
 * Covers ROLLTABLE RESULTS as well, which the .svg migration above does not
 * need to: a result stores its own `img` as a SNAPSHOT rather than reading the
 * referenced document, so a Warden's own gear or monster table keeps pointing
 * at the old path after every actor in the world has been fixed.
 */
const ART_MOVES = [
  ["systems/air-bladder/character_portraits/", "systems/air-bladder/art/jon-aspeheim/portraits/"],
  ["systems/air-bladder/character_tokens/", "systems/air-bladder/art/jon-aspeheim/tokens/"],
  // The two tlomdev folders that lost their SPACES (2026-08-04, user ruling —
  // Foundry's media guidance forbids them, and a spaced path was invisible to
  // licence-check's reference regex). These four sit ABOVE the generic
  // tlomdev rules because the loop takes the FIRST match and stops: a
  // pre-art/ path through the generic rule would land on the spaced art/
  // folder that no longer exists, and a second pass never comes. Two entries
  // per folder — the pre-art/ prefix and the art/-era spaced prefix — because
  // a world can hold either, depending on when it last opened.
  ["systems/air-bladder/tlomdev/human npcs for itmod/", "systems/air-bladder/art/tlomdev/human-npcs-for-itmod/"],
  ["systems/air-bladder/tlomdev/Kettlewright Portraits/", "systems/air-bladder/art/tlomdev/kettlewright-portraits/"],
  ["systems/air-bladder/art/tlomdev/human npcs for itmod/", "systems/air-bladder/art/tlomdev/human-npcs-for-itmod/"],
  ["systems/air-bladder/art/tlomdev/Kettlewright Portraits/", "systems/air-bladder/art/tlomdev/kettlewright-portraits/"],
  ["systems/air-bladder/tlomdev/", "systems/air-bladder/art/tlomdev/"],
  ["systems/air-bladder/game-icons/", "systems/air-bladder/art/game-icons/"],
  // Lydia's never reached a RELEASE — it landed and moved within the same day —
  // and it was left out of this table on that reasoning. dev:smoke then found a
  // token in the dev world still pointing at it. `dev` mirrors to GitHub in
  // seconds precisely so people can clone it and test unreleased code, so "it
  // never shipped" is only ever true of tagged releases, and a migration that
  // reasons about releases misses every world that tracked the branch. One line.
  ["systems/air-bladder/lydia-comer/", "systems/air-bladder/art/lydia-comer/"],
];

/**
 * Galleries whose files were RE-ENCODED, not moved.
 *
 * Lydia Comer's creatures shipped as `.jpg` squares and `.png` circles until
 * 2026-08-04, when the artist extended her grant to allow format conversion and
 * they became WebP. That halves the download, and it breaks every world made
 * before it: an image path is COPIED onto a document at creation and never
 * re-read from the system, so a hand-picked portrait keeps pointing at a file
 * that no longer exists — and a 404 image in Foundry is a blank, not an error.
 *
 * A prefix rule cannot express this. `ART_MOVES` rewrites the front of the
 * string; here the front is already right and the EXTENSION is wrong.
 */
const ART_REENCODED = [
  { prefix: "systems/air-bladder/art/lydia-comer/", from: /\.(jpe?g|png)$/i, to: ".webp" },
  // tlomdev's 298 category drawings, the same day. CC BY-SA 4.0 permits the
  // conversion outright — no grant to negotiate — but it obliges the change to
  // be INDICATED, which is what the Modifications section of that gallery's
  // CREDITS.md is for.
  //
  // `kettlewright-portraits/` is untouched and needs no rule: those arrived as
  // WebP from Kettlewright and the extension pattern cannot match them. That is
  // luck rather than design, so the importer skips the folder BY NAME.
  { prefix: "systems/air-bladder/art/tlomdev/", from: /\.png$/i, to: ".webp" },
];

/**
 * The new path for an image under a moved or re-encoded gallery, or null to
 * leave it alone.
 *
 * The two rules CHAIN, and they have to: a world last opened before the `art/`
 * restructure holds `systems/air-bladder/lydia-comer/portraits/Dragon.jpg`,
 * which needs both the move and the re-encode to arrive anywhere real. Applying
 * only one leaves a path that is wrong in a different way, and the migration
 * runs once — there is no second pass to catch it.
 */
const movedArt = (src) => {
  const s = String(src ?? "");
  let out = null;
  for (const [from, to] of ART_MOVES) {
    if (s.startsWith(from)) { out = to + s.slice(from.length); break; }
  }
  const now = out ?? s;
  for (const { prefix, from, to } of ART_REENCODED) {
    if (now.startsWith(prefix) && from.test(now)) return now.replace(from, to);
  }
  return out;
};

const migrateArtPaths = async () => {
  let count = 0;

  const itemUpdates = game.items.filter((i) => movedArt(i.img)).map((i) => ({ _id: i.id, img: movedArt(i.img) }));
  if (itemUpdates.length) { await Item.updateDocuments(itemUpdates); count += itemUpdates.length; }

  const actorUpdates = [];
  for (const a of game.actors) {
    const img = movedArt(a.img);
    const tok = movedArt(a.prototypeToken?.texture?.src);
    if (img || tok) {
      const u = { _id: a.id };
      if (img) u.img = img;
      if (tok) u["prototypeToken.texture.src"] = tok;
      actorUpdates.push(u);
    }
    const owned = a.items.filter((i) => movedArt(i.img)).map((i) => ({ _id: i.id, img: movedArt(i.img) }));
    if (owned.length) { await a.updateEmbeddedDocuments("Item", owned); count += owned.length; }
  }
  if (actorUpdates.length) { await Actor.updateDocuments(actorUpdates); count += actorUpdates.length; }

  // Unlinked tokens hold their own texture rather than the actor's — and their
  // own ActorDELTA, which is a second, separate copy of the art (review
  // 2026-08-04). The scene-token loop below fixes what the CANVAS draws;
  // without the delta pass the token's SHEET portrait — and any item created
  // directly on the token, which lives only in the delta — kept the old path,
  // rendering blank with no error. The base-actor sweep above cannot reach
  // these: a synthetic actor's update routes to the delta, not the world actor.
  //
  // Reading through `token.actor` is deliberately self-limiting: a delta that
  // does NOT override a field shows the base actor's value, which the loops
  // above already migrated — movedArt() returns null on it and nothing is
  // written, so no needless override is minted. Only a genuinely stale
  // delta-held path matches. Same pattern as migrateIconsToSvg's token pass.
  for (const scene of game.scenes) {
    const tokens = scene.tokens
      .filter((t) => movedArt(t.texture?.src))
      .map((t) => ({ _id: t.id, "texture.src": movedArt(t.texture.src) }));
    if (tokens.length) { await scene.updateEmbeddedDocuments("Token", tokens); count += tokens.length; }

    for (const token of scene.tokens) {
      if (token.actorLink || !token.actor) continue;
      const img = movedArt(token.actor.img);
      if (img) { await token.actor.update({ img }); count++; }
      const owned = token.actor.items
        .filter((i) => movedArt(i.img))
        .map((i) => ({ _id: i.id, img: movedArt(i.img) }));
      if (owned.length) { await token.actor.updateEmbeddedDocuments("Item", owned); count += owned.length; }
    }
  }

  for (const table of game.tables) {
    const results = table.results
      .filter((r) => movedArt(r.img))
      .map((r) => ({ _id: r.id, img: movedArt(r.img) }));
    if (results.length) { await table.updateEmbeddedDocuments("TableResult", results); count += results.length; }
  }

  // Macros snapshot an item's img on drag-to-hotbar (module/macros.js), the
  // same copy-at-creation rule as everything above.
  const macroUpdates = game.macros.filter((m) => movedArt(m.img)).map((m) => ({ _id: m.id, img: movedArt(m.img) }));
  if (macroUpdates.length) { await Macro.updateDocuments(macroUpdates); count += macroUpdates.length; }

  // WORLD compendium packs — a Warden's own curated compendia. Documents there
  // are exactly the copy-at-creation case, and unlike world documents nothing
  // ever re-migrates them; skipping them turns a curated monster pack into
  // blank art with no recovery, since the old files are gone from disk and a
  // second run has nothing left to match. System packs need no pass — they are
  // rebuilt from src/packs, whose paths were rewritten at the move.
  // A locked pack is unlocked for the write and restored, whatever happens.
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "world") continue;
    if (!["Actor", "Item", "RollTable", "Macro"].includes(pack.documentName)) continue;
    const docs = await pack.getDocuments();
    const stale = docs.some((d) =>
      movedArt(d.img) || movedArt(d.prototypeToken?.texture?.src)
      || d.items?.some((i) => movedArt(i.img)) || d.results?.some((r) => movedArt(r.img)));
    if (!stale) continue;
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    try {
      for (const d of docs) {
        const u = {};
        if (movedArt(d.img)) u.img = movedArt(d.img);
        if (movedArt(d.prototypeToken?.texture?.src)) u["prototypeToken.texture.src"] = movedArt(d.prototypeToken.texture.src);
        if (Object.keys(u).length) { await d.update(u); count++; }
        const owned = (d.items ?? []).filter((i) => movedArt(i.img)).map((i) => ({ _id: i.id, img: movedArt(i.img) }));
        if (owned.length) { await d.updateEmbeddedDocuments("Item", owned); count += owned.length; }
        const results = (d.results ?? []).filter((r) => movedArt(r.img)).map((r) => ({ _id: r.id, img: movedArt(r.img) }));
        if (results.length) { await d.updateEmbeddedDocuments("TableResult", results); count += results.length; }
      }
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }

  if (count) console.log(`Air Bladder | repointed ${count} document(s) at the art/ gallery folders`);
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


/**
 * Persist `system.role` on every npc-typed world actor, whatever it currently
 * derives to. ONE migration doing what two used to attempt: it stamps the role
 * on pre-roles documents (which store `forHire`/`inanimate` and no role at all)
 * AND converts `role: "hireling"`, retired from NPC_ROLES on 2026-08-01, into
 * the `npc` that `NpcData.migrateData` already substitutes on every read.
 *
 * **It selects on NOTHING, and that is the entire design.** Both states it fixes
 * are invisible from a running client:
 *
 *   - `migrateData` rewrites `_source` during construction, so a document stored
 *     as "hireling" and one stored as "npc" read identically.
 *   - `cleanData` PRUNES unknown keys out of `_source`
 *     (`common/data/fields.mjs` `#cleanKeys`), so a legacy `inanimate` sitting in
 *     the database is not there to be found either.
 *
 * That second one killed its predecessor. `migrateNpcRoles` selected on
 * `"inanimate" in _source.system` and therefore matched **nothing, ever** — it
 * ran to completion, logged nothing, and set its marker, while the key it was
 * looking for sat in the database untouched. Nobody could see it, because the
 * probe that covered it read `_source` too and read the same pruned object. It
 * only surfaced once the migration probe started planting state through the raw
 * socket and reading the raw server record back. A selection is only as good as
 * the view it selects through; this one has no selection to be wrong.
 *
 * Blind is affordable because of what `{diff: false}` does, measured against
 * 14.365 rather than assumed:
 *
 *   - It skips the empty-diff `continue` in `client/data/client-backend.mjs:262`,
 *     so the key is TRANSMITTED even though the client can see no change. A
 *     value diverged in memory (updateSource) and then written this way lands on
 *     the server and survives a reload — which is precisely this migration's
 *     shape, and it was confirmed that way before this was written.
 *   - The server still answers with a real diff, so a document that already held
 *     the same role is echoed back as `{_id}` alone: no write, no `modifiedTime`
 *     bump. Re-stamping every npc costs nothing on the ones that did not need it.
 *
 * Only `role`. `forHire` is deliberately NOT written: its schema initial is
 * `true`, which is exactly what the shim gives a converted hireling, so storing
 * it would touch every npc, mount, transport, container and monster in the world
 * to record a value they already read. The one case that needs it stored — a
 * Warden unticking the box — writes itself through the sheet. A retired
 * `inanimate` is likewise left where it lies: with `role` now stored beside it,
 * `migrateData`'s guard never looks at it again, so it is inert.
 *
 * Gated on a marker, not on state — role is a pick-list, so any state test would
 * re-stamp whatever the Warden changed away from (untick, reload, it is back).
 * The marker is set even when nothing matched, and only after the writes land:
 * a throw leaves it unset so a failed migration is retried rather than recorded
 * as done.
 *
 * World actors only, like every sibling phase. An unlinked token's delta stores
 * DIFFERENCES from its base actor, so flipping the base is enough — no
 * scene-token walk (see the spellscroll migration above for the shape that DOES
 * need one). Compendium documents are read through the same shim.
 */
const migrateNpcRoles = async () => {
  if (game.settings.get(SETTINGS_NS, "roles-restamped")) return;
  const updates = game.actors
    .filter((a) => ["npc", "hireling"].includes(a.type))
    .map((a) => ({ _id: a.id, "system.role": a.system.role }));
  if (updates.length) {
    await Actor.updateDocuments(updates, { diff: false });   // one batch, so it can't half-finish
    console.log(`Air Bladder | stamped role on ${updates.length} npc(s)`);
  }
  await game.settings.set(SETTINGS_NS, "roles-restamped", true);
};

/**
 * Flatten the connection graph and normalize connection-driven ownership —
 * Phase B of the 2026-08-01 redesign, running after the role re-stamp above.
 *
 * The FLAT rule ("every `connectedTo` points at a character") shipped with
 * the code the day before this migration; the data a world accumulated under
 * Round 2 can still say PC → hireling → sack. For each npc/hireling-typed
 * world actor with a link, walk UP from its immediate keeper with a seen-set:
 *
 *   - immediate keeper is a character           → already flat, keep it;
 *   - the chain ROOTS in a character            → re-point at that root — the
 *     sack a hireling carried belongs to the hireling's PC, which is what the
 *     table always meant by it;
 *   - npc root / dangling uuid / cycle          → clear the link and stamp
 *     `formerlyBelongedTo` with the immediate keeper's name when it still
 *     resolves — the same labelled-loot-pile shape every other break leaves.
 *
 * Ownership rides the same batch, because the shape needs the FINAL keeper
 * and only the flatten knows it (the reason this is ONE phase, ONE marker):
 * a connected non-monster takes the connected shape from its final keeper; an
 * unconnected non-monster whose STORED default is NONE is raised to LIMITED —
 * and never lowered from anything else, because a default the Warden raised
 * is a grant, and fighting the Warden's grants is exactly what the
 * transitions-only rule forbids. Monsters are untouched throughout.
 *
 * The CAP is deliberately NOT enforced here: a PC may come out of the flatten
 * keeping more than maxConnections(). The cap gates NEW connections only —
 * a migration never destroys data.
 *
 * World actors only, one batched update, marker set only after success, like
 * every sibling phase. Unlinked-token deltas inherit from their base actor;
 * no scene-token walk (see migrateNpcRoles' docblock for why not).
 */
const flattenConnections = async () => {
  if (game.settings.get(SETTINGS_NS, "connections-migrated")) return;
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const ops = foundry.data.operators;
  const updates = [];
  for (const a of game.actors) {
    if (!["npc", "hireling"].includes(a.type)) continue;
    const u = { _id: a.id };
    let keeper = null;
    const link = a.system.connectedTo || "";
    if (link) {
      const immediate = game.actors.find((x) => x.uuid === link);
      // Walk up until a character, a chain end, or a repeat. The seen-set is
      // what keeps a pre-existing A→B→A corruption from hanging the phase.
      let cur = immediate;
      const seen = new Set();
      while (cur && cur.type !== "character") {
        if (seen.has(cur.uuid)) { cur = null; break; }   // cycle → treat as rootless
        seen.add(cur.uuid);
        const up = cur.system?.connectedTo || "";
        cur = up ? game.actors.find((x) => x.uuid === up) : null;
      }
      if (immediate?.type === "character") {
        keeper = immediate;
      } else if (cur?.type === "character") {
        keeper = cur;
        u["system.connectedTo"] = cur.uuid;
      } else {
        u["system.connectedTo"] = "";
        // The stored formerlyBelongedTo survives when the immediate keeper is
        // gone — a dangling uuid preserves nothing worth overwriting it with.
        if (immediate) u["system.formerlyBelongedTo"] = immediate.name;
      }
    }
    if (a.system.role !== "monster") {
      if (keeper) {
        u.ownership = ops.ForcedReplacement.create(connectedOwnershipShape(keeper));
      } else if ((a._source.ownership?.default ?? 0) === L.NONE) {
        u["ownership.default"] = L.LIMITED;
      }
    }
    if (Object.keys(u).length > 1) updates.push(u);
  }
  if (updates.length) {
    await Actor.updateDocuments(updates);                 // one batch, so it can't half-finish
    console.log(`Air Bladder | flattened/ownership-normalized ${updates.length} connected actor(s)`);
  }
  await game.settings.set(SETTINGS_NS, "connections-migrated", true);
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
 * The name is PRE-FILLED rather than left to the placeholder, and with the ENGLISH
 * `SPELLSCROLL_NAME` rather than the localized option label — see that constant for
 * both halves of why.
 *
 * Degrades quietly. If core reworks this dialog the option stops appearing, and the
 * worst case is a plain spellbook that the sheet's Scroll box still converts.
 *
 * Registered as a NAMED function expression so a probe can find it in
 * `Hooks.events.renderDialogV2` and switch it off in the live page — that is how
 * dev:spellscroll negative-controls this feature without editing source and
 * re-running (tools/dev/lib.mjs `withHookOff`). Renaming it breaks that probe.
 */
Hooks.on("renderDialogV2", function abSpellscrollTypeOption(dialog, element) {
  // Raw HTMLElement in v14 — the jQuery unwrap this once carried could never fire.
  const root = element;
  const select = root?.querySelector('select[name="type"]');
  const form = select?.form;
  if (!select || !form || select.querySelector("option[data-ab-scroll]")) return;

  // Identify the ITEM create dialog specifically: this hook sees every DialogV2 in
  // the world, including the system's own five and any other package's.
  const bookOption = select.querySelector('option[value="spellbook"]');
  const itemTypes = getDocumentClass("Item").TYPES;
  if (!bookOption || [...select.options].some((o) => !itemTypes.includes(o.value))) return;

  // Two strings, deliberately: the option is READ, so it is localized; the name is
  // STORED, so it is English (SPELLSCROLL_NAME). They were one variable, which made
  // the type list's label leak into the document and broke the system's own
  // English-storage invariant (item.js, i18n-content.js) on every non-English client.
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
    if (scroll && !nameInput.value) nameInput.value = SPELLSCROLL_NAME;
    else if (!scroll && nameInput.value === SPELLSCROLL_NAME) nameInput.value = "";
  });
});

/* `abHideHirelingType` stood here and is GONE (2026-08-02). It removed the
   retired `hireling` TYPE from core's Create Actor dialog by surgery on the
   rendered DOM — necessary while core's type-picker rendered at all, because a
   registered subtype is always offered and there is no manifest flag to hide
   one. `CairnActor.createDialog` (actor.js) replaces that dialog with the role
   SWITCHBOARD now, so core's picker never renders on the world path and there
   is no option to remove; the one fallback that still shows it (a compendium
   target) is restricted to real types, which excludes hireling structurally.
   The type itself stays registered and aliased to NpcData — ids are immutable
   — exactly as before. */

/**
 * Group and compact the system's rows in the GM's Configure Settings tab.
 *
 * Foundry renders a flat list of every setting with a bold name and a hint
 * beneath, which for seventeen settings is a wall of text. Insert section
 * headers before the first setting of each group, then collapse every row to one
 * compact line (full-width plain label, control pinned right, hint hidden).
 */
Hooks.on("renderSettingsConfig", (app, element) => {
  const root = element; // raw HTMLElement in v14, same as every render hook
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

  // Core's settings search (CategoryBrowser._onSearchFilter,
  // category-browser.mjs:215-248) toggles `hidden` on .form-group elements and
  // nothing else, so a query would leave these <h3>s hovering over whatever
  // rows survived from OTHER groups (review #6). React to core's toggles
  // instead of trying to hook its private filter: a header stays visible
  // exactly while some .form-group between it and the next header still is.
  // Hiding via the `hidden` property rides the same core rule the rows use
  // ([hidden] { display: none !important }, foundry2.css:5698).
  const headers = [...root.querySelectorAll(".cairn-settings-header")];
  if (headers.length) {
    const syncHeaders = () => {
      for (const header of headers) {
        let anyVisible = false;
        for (let el = header.nextElementSibling; el && !el.classList.contains("cairn-settings-header"); el = el.nextElementSibling) {
          if (el.classList.contains("form-group") && !el.hidden) { anyVisible = true; break; }
        }
        header.hidden = !anyVisible;
      }
    };
    // The observer dies with the rendered DOM; setting `hidden` on the <h3>s
    // re-fires it once, recomputes the same answer and settles.
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.target.classList?.contains("form-group"))) syncHeaders();
    });
    for (const parent of new Set(headers.map((h) => h.parentNode))) {
      observer.observe(parent, { subtree: true, attributeFilter: ["hidden"] });
    }
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

  // Bold the source name within the three Character Generation labels (Foundry
  // renders setting names as plain text, so we do it here with text nodes).
  // The phrase is LOCALIZED, not an English literal (review #6): the label this
  // searches is the translated setting name, so an English phrase only ever
  // matched where a translator happened to keep the product name verbatim. A
  // language whose label drops the phrase still degrades to no bold — the
  // i < 0 guard below — never to a wrong one.
  const boldPhrase = (key, phraseKey) => {
    const label = root.querySelector(`[name="${SETTINGS_NS}.${key}"]`)?.closest(".form-group")?.querySelector("label");
    if (!label) return;
    const phrase = game.i18n.localize(phraseKey);
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
  boldPhrase("content-source-2e", "CAIRN.ContentSource2e");
  boldPhrase("content-source-custom", "CAIRN.ContentSourceCustom");
  boldPhrase("content-source-barebones", "CAIRN.ContentSourceBarebones");
});

Hooks.on("renderActorDirectory", (app, html) => {
  // Core's own Create Actor button goes (2026-08-02, ruled: "unnecessary and
  // an invitation for trouble") — every creation path below carries a complete
  // workflow instead of core's bare type-picker. The folder "+" STAYS: it
  // routes through CairnActor.createDialog, which is the role switchboard now.
  // Removal runs per-render on THIS directory root, so the docked and
  // popped-out instances are both covered.
  html.querySelector(".directory-header .create-entry")?.remove();
  if (game.user.can("ACTOR_CREATE")) {
    // Scope the "already injected?" test to THIS directory, not the document.
    // Foundry renders a second, independent ActorDirectory when the tab is
    // popped out, and a document-wide getElementById sees the docked one's
    // button and skips injection -- so the popped-out window had no Generate,
    // NPC or Import buttons at all. The id is duplicated across the two
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
          <button class="create-npc-button"><i class="fas fa-user-plus"></i>${game.i18n.localize(
          "CAIRN.CreateNpc"
        )}</button>
          ${game.user.isGM ? `<button class="create-monster-button"><i class="fas fa-dragon"></i>${game.i18n.localize("CAIRN.CreateMonster")}</button>` : ""}
          <button class="create-mount-button"><i class="fas fa-horse"></i>${game.i18n.localize("CAIRN.CreateMount")}</button>
          <button class="create-transport-button"><i class="fas fa-cart-flatbed"></i>${game.i18n.localize("CAIRN.CreateTransport")}</button>
          <button class="create-container-button"><i class="fas fa-box-open"></i>${game.i18n.localize("CAIRN.CreateContainer")}</button>
          ${game.user.isGM ? `<button class="create-faction-button"><i class="fas fa-flag"></i>${game.i18n.localize("CAIRN.CreateFaction")}</button>` : ""}
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
        .querySelector(".create-npc-button")
        .addEventListener("click", async () => {
          const actor = await createNpc();
          if (actor) actor.sheet.render(true);
        });
      // The three thing roles share one name+Type workflow
      // (CairnActor.createThing): pre-filtered kinds plus Other, minting an
      // unconnected npc of that role. ACTOR_CREATE-gated like Create NPC —
      // players who may create actors may create the things they own.
      for (const [cls, role] of [
        ["create-container-button", "container"],
        ["create-mount-button", "mount"],
        ["create-transport-button", "transport"],
      ]) {
        section.querySelector(`.${cls}`)?.addEventListener("click", async () => {
          const actor = await CairnActor.createThing(role);
          if (actor) actor.sheet.render(true);
        });
      }
      // Warden-only: monsters are the Warden's to mint. The tier picker inside
      // createMonster is dismissible, and a dismiss creates nothing.
      section
        .querySelector(".create-monster-button")
        ?.addEventListener("click", async () => {
          const actor = await createMonster();
          if (actor) actor.sheet.render(true);
        });
      // Warden-only: one click, one faction dossier (a JournalEntry — a
      // faction is campaign machinery, not an Actor). No confirm: creating a
      // journal is non-destructive, and nothing is ever overwritten.
      section
        .querySelector(".create-faction-button")
        ?.addEventListener("click", async () => {
          const entry = await generateFaction();
          if (entry) entry.sheet.render(true);
        });
      // GM-only: import a Kettlewright character export into a new Actor.
      section
        .querySelector(".import-kettlewright-button")
        ?.addEventListener("click", async () => {
          const actor = await importKettlewrightCharacter();
          if (actor) actor.sheet.render(true);
        });
    }
  } else if (!html.querySelector("#cairn-character-gen-button")) {
    // A player with no ACTOR_CREATE at all still gets Generate PC — the one
    // creation the game owes every player. Their client cannot create an
    // Actor (a server wall, not a UI gate), so the click asks the active
    // Warden's client to run the same generator and stamp them OWNER — the
    // generatePC relay above, the grantActors shape. Same section id as the
    // full row: it is the injected-already test, and the two variants are
    // mutually exclusive per user.
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
      </div>
      `
    );
    section
      .querySelector(".create-character-generator-button")
      .addEventListener("click", () => requestPcGeneration());
  }
  const actors = html.querySelectorAll('.actor');
  actors.forEach((a) => {
    const aid = a.dataset.entryId;
    const actor = game.actors.find((v) => v.id == aid);
    if (!actor) return;
    // Container/transport art (packs, mounts, vehicles) is Foundry's colour core
    // icons; the sheet shows it grayscale to match the black-and-white look, so
    // the directory thumbnail must match — the same actor should not read colour
    // in the list and grey on its sheet.
    //
    // ROLE, not type. This test read `type == "container"` until 2026-07-31,
    // which under the roles model matched nothing at all: the conversion had
    // already made every container an npc, so no thumbnail was ever greyed.
    // The mapping is the old `transportKind` vocabulary one-for-one.
    //
    // The `show-container-actors` hide rule that lived beside this is GONE
    // (2026-08-02, by ruling): every container actor is always listed.
    const containerLine = actor.isThing || actor.npcRole === "mount";
    a.classList.toggle('cairn-grayscale-portrait', containerLine);
  });
});

Hooks.on("renderRollTableDirectory", (app, html) => {
  // Warden-only: reseed a world spell table from a compendium's index,
  // update-in-place (module/spell-tables.js). Same injection rules as the
  // Actor directory's row above: scope the injected-already test to THIS
  // directory root — the popped-out window is a second, independent render.
  if (!game.user.isGM) return;
  if (html.querySelector(".cairn-reseed-spell-table")) return;
  const dirHeader = html.querySelector(".directory-header");
  if (!dirHeader) return;
  const section = document.createElement("header");
  section.classList.add("character-generator", "directory-header");
  dirHeader.parentNode.insertBefore(section, dirHeader);
  section.insertAdjacentHTML(
    "afterbegin",
    `<div class="header-actions action-buttons flexrow">
      <button class="cairn-reseed-spell-table"><i class="fas fa-arrows-rotate"></i>${game.i18n.localize("CAIRN.ReseedSpellTable")}</button>
    </div>`
  );
  section.querySelector(".cairn-reseed-spell-table")
    .addEventListener("click", () => reseedSpellTable());
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
    // Same `scene` the STR-save block above resolved, and for the same reason:
    // data-targets holds token ids from the scene the roll was made on. Reading
    // the viewer's scene inside the handler meant every id missed after a scene
    // change and the button applied nothing, silently.
    if (btn)
      btn.onclick = (ev) => Damage.onClickChatMessageApplyButton(ev, html, data, scene);
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
    "systems/air-bladder/templates/parts/bio-block.html",
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
  // Keeping this idempotent needs EVERY form tested, which is why it is a helper
  // rather than an {{#unless startsWith}} in the template:
  //
  //   - the stored name is English, and the content overlay translates it only
  //     where it has an entry — so `item.name` here may be either language;
  //   - the original guard compared that name against the TRANSLATED prefix
  //     alone, so on a Spanish client it never matched and every spellbook
  //     rendered "Hechizo — Spellbook — Detect Magic".
  //
  // The English forms are stored-data constants, like FATIGUE_NAME — not UI
  // strings. A scroll is checked against BOTH families, not just its own: scrolls
  // were stored as "Spellscroll — X" before they became flagged spellbooks, the
  // migration strips that, and a hand-typed name may carry either.
  const STORED_SPELLBOOK_PREFIXES = ["Spellbook — ", "Spellbook (", "Spellscroll — ", "Spellscroll ("];

  // Both shapes a prefix takes in front of a name: "Kind — X" and "Kind (X)".
  // The English list above carries both by hand; the LOCALIZED side used to carry
  // only the em-dash one, and that asymmetry was the bug. Five shipped 2e
  // backgrounds spell their grant "Spellbook (Detect Magic)" — Bonekeeper,
  // Foundling, Half-Witch, Hexenbane, Mountebank — so the parenthesised shape is
  // the one a content overlay is most likely to be translating, and a translated
  // "Hechizo (Detectar Magia)" matched nothing and got a second "Hechizo — "
  // bolted on. Observed, not reasoned: dev:i18n-render rendered
  // "ZZ-hechizo — ZZ-hechizo (Aro de Cáñamo)".
  //
  // Derived from the prefix rather than asking translators for a second key: a
  // language file that carries "CAIRN.SpellbookPrefix" alone stays complete, and
  // there is no way for the two keys to drift apart.
  //
  // The trailing separator is stripped by what it is NOT — anything that is not a
  // letter or a digit — rather than by a list of the punctuation we happened to
  // think of. That list was `[\s—:(-]`, i.e. whitespace, EM dash, colon, paren,
  // hyphen; it did not include the EN dash U+2013, which is visually near-identical
  // to the em dash `en.json` ships and is the conventional dash in several of the
  // languages this system has files for. A translator writing "Hechizo – " got
  // bare "Hechizo –", so the parenthesised form came out "Hechizo – (" and never
  // matched a translated "Hechizo (Detectar Magia)" — re-creating exactly the
  // doubled prefix this helper exists to prevent, in the one shape five shipped
  // backgrounds use. A comma had the same problem. Nothing told a translator: no
  // doc mentions these keys, and a punctuation constraint nobody states is a
  // constraint nobody keeps.
  const prefixForms = (prefix) => {
    const bare = String(prefix ?? "").replace(/[^\p{L}\p{N}]+$/u, "");
    return bare ? [prefix, `${bare} (`, `${bare}(`] : [];
  };

  Handlebars.registerHelper("spellbookPrefix", function (name, scroll) {
    const n = String(name ?? "");
    const localized = game.i18n.localize(scroll ? "CAIRN.SpellscrollPrefix" : "CAIRN.SpellbookPrefix");
    const localizedForms = [
      ...prefixForms(game.i18n.localize("CAIRN.SpellbookPrefix")),
      ...prefixForms(game.i18n.localize("CAIRN.SpellscrollPrefix")),
    ];
    // `p &&` is load-bearing: "".startsWith("") is true, so one language file
    // shipping an empty prefix would strip the prefix off every row in the game.
    const carried = [...STORED_SPELLBOOK_PREFIXES, ...localizedForms].some((p) => p && n.startsWith(p));
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
