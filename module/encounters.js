/**
 * Encounter tables — a Warden-authorable convention, and the one button it earns.
 *
 * A RollTable result row is an ENCOUNTER ROW when its text parses — there are
 * no flags anywhere, deliberately: Foundry's table editor exposes no flags UI,
 * so a convention any Warden can type in the core editor is the only design
 * that lets them build their own tables (user requirement, 2026-08-09). A row
 * qualifies by:
 *
 *   - a LEADING quantity term (`1d6` or `3`) followed anywhere later by the
 *     first Actor `@UUID[…]{…}` link — which ProseMirror mints by itself when
 *     the Warden drags a monster into the result's text field; or
 *   - the phrase "random NPC" (case-insensitive), quantity parsed the same
 *     way, defaulting to 1 — this row runs the NPC generator instead of a
 *     lookup, a fresh person each time (user ruling); or
 *   - a DOCUMENT-type result whose `documentUuid` names an Actor, quantity
 *     from the description when present, else 1.
 *
 * Anything else ("All quiet") is plain text and earns no button. Parseability
 * IS the detection: the shipped examples in `warden-encounters` light up the
 * same way a Warden's home-made table does, with zero setup.
 *
 * Parsing runs on the STORED description, never the rendered card — the card
 * is display-localized by the content overlay (the anchor rule,
 * `module/i18n-content.js`), so a Spanish client parses the same English the
 * table stores. The drawn rows are recovered from the MESSAGE document, not
 * the DOM: core stamps `flags.core.RollTable` with the table id and rides the
 * Roll along (roll-table.mjs:60), so `getResultsForRoll(roll.total)` re-derives
 * exactly what was drawn. (The card's `data-result-id` attribute is EMPTY on
 * 14.365 — table-result.hbs reads `{{result.id}}` off a `toObject()`, which
 * only carries `_id` — so the DOM could not be the source even if it were the
 * right layer.)
 *
 * The button is Warden-only BOTH ways (affordance/enforcement, as everywhere):
 * injected only into a GM client's copy at render — one visibility gate,
 * resolved per viewer, the chat-card rule — and `spawnEncounterFromMessage`
 * re-checks `isGM` and re-derives its own specs from the message, so a player
 * driving the export directly is refused before anything rolls or writes.
 *
 * What a click does: per parsed row, roll the quantity as a real evaluated
 * Roll posted to chat (Dice So Nice animates a roll riding a message; the
 * speaker is pinned to the USER's name — a bare getSpeaker would post as
 * whatever token the Warden happens to control). Then resolve ONE world actor
 * — a world Actor link is used as-is; a compendium link REUSES the world copy
 * whose `_stats.compendiumSource` matches (imports stamp it), importing once
 * into an "Encounters" folder otherwise — and place N prototype-token copies,
 * `actorLink: false`, disposition FORCED NEUTRAL (user ruling), clustered
 * grid-snapped around the view centre (`canvas.stage.pivot`), each on its own
 * cell so none stack exactly. Never one world actor per token. The message is
 * then stamped (`encounterSpawned`) and re-renders as "Added" — the
 * damage-card "already applied" precedent, and the stamp, not the greying, is
 * the refusal.
 *
 * House-rule note: this automates Warden LOGISTICS (minting tokens), not
 * player-facing rules prose — the no-automation deviation's own reasoning
 * (trust players) is untouched. CLAUDE.md's bullet carries the dated carve-out.
 */

import { createNpc } from "./character-generator.js";
import { t } from "./i18n-content.js";

export const ENCOUNTER_SPAWNED_FLAG = "encounterSpawned";

/* -------------------------------------------- */
/*  Parsing                                     */
/* -------------------------------------------- */

/** An Actor uuid, world (`Actor.id`) or compendium (`…pack.Actor.id`) — the
 *  `.Actor.` segment is what no other document type's uuid can carry. */
const ACTOR_LINK = /@UUID\[((?:[^\]]*\.)?Actor\.[^\]\s]+)\](?:\{([^}]*)\})?/;

/**
 * Parse one stored result description. Returns `{ qty, uuid, label }` for an
 * actor row, `{ qty, npc: true }` for a random-NPC row, null for plain text.
 * The quantity must LEAD the row's plain text for an actor link to count —
 * prose that merely mentions a monster ("…flee to the Ogre bridge…") must not
 * grow a button, and the leading term is what separates a spawnable row from
 * a reference.
 */
export const parseEncounterText = (stored) => {
  const text = String(stored ?? "");
  const plain = text.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  const qty = plain.match(/^(\d+[dD]\d+|\d+)\b/)?.[1] ?? null;
  const link = text.match(ACTOR_LINK);
  if (qty && link) return { qty, uuid: link[1], label: link[2] ?? "" };
  if (/\brandom\s+npc\b/i.test(plain)) return { qty: qty ?? "1", npc: true };
  return null;
};

/** Spec for one drawn TableResult, or null when the row is plain text. */
const resultSpec = (result) => {
  const stored = result.description ?? "";
  if (result.type === "document" && /(^|\.)Actor\./.test(result.documentUuid ?? "")) {
    const plain = stored.replace(/<[^>]*>/g, " ").trim();
    const qty = plain.match(/^(\d+[dD]\d+|\d+)\b/)?.[1] ?? "1";
    return { qty, uuid: result.documentUuid, label: result.name ?? "" };
  }
  return parseEncounterText(stored);
};

/** The drawn table, world-first: a Warden's own table wins its id, and a draw
 *  made straight from a pack still resolves (`getDocument` caches — never
 *  `getDocuments()`, the round-trip rule). */
const resolveTable = async (tableId) => {
  const world = game.tables.get(tableId);
  if (world) return world;
  for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
    if (pack.index.has(tableId)) return pack.getDocument(tableId);
  }
  return null;
};

/** Every spawnable spec on a draw card's message, [] when there are none. */
export const encounterSpecsForMessage = async (message) => {
  const tableId = foundry.utils.getProperty(message.flags ?? {}, "core.RollTable");
  const roll = message.rolls?.[0];
  if (!tableId || !roll) return [];
  const table = await resolveTable(tableId);
  if (!table) return [];
  return table.getResultsForRoll(roll.total).map(resultSpec).filter(Boolean);
};

/* -------------------------------------------- */
/*  The card button                             */
/* -------------------------------------------- */

/** "1d6 × Goblins and 1 × Mimic" — the button says what it will do before it is
 *  clicked. Labels route through the overlay (`monster.name`) so a Spanish
 *  Warden reads the name their own card shows, and the JOIN is localized too:
 *  the list is read inside a translated sentence, and a hardcoded ", " leaves
 *  the one English fragment in it. `Intl.ListFormat` via core's helper, as
 *  cairn.js:1869 and :1990 already do. */
const specList = (specs) => game.i18n.getListFormatter().format(specs.map((s) => {
  const name = s.npc
    ? game.i18n.localize("CAIRN.Encounter.RandomNpc")
    : t("monster.name", s.label || game.i18n.localize("CAIRN.Encounter.UnknownActor"));
  return `${s.qty} × ${name}`;
}));

/**
 * Called from the renderChatMessageHTML hook (cairn.js), beside the damage
 * buttons. Injection, not trimming: the button is never part of the stored
 * content, so a player's copy has nothing to reveal.
 */
export const injectEncounterButton = async (message, html) => {
  if (!game.user?.isGM) return;
  const draw = html.querySelector(".table-draw");
  if (!draw || draw.querySelector(".encounter-spawn")) return;
  const specs = await encounterSpecsForMessage(message);
  if (!specs.length) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "encounter-spawn";
  if (message.getFlag(game.system.id, ENCOUNTER_SPAWNED_FLAG)) {
    btn.disabled = true;
    btn.classList.add("spent");
    btn.textContent = game.i18n.localize("CAIRN.Encounter.Added");
  } else {
    btn.textContent = game.i18n.format("CAIRN.Encounter.Add", { what: specList(specs) });
    btn.onclick = () => spawnEncounterFromMessage(message);
  }
  draw.append(btn);
};

/* -------------------------------------------- */
/*  Spawning                                    */
/* -------------------------------------------- */

/** Ring of grid offsets around the view centre — every token its own cell,
 *  scaled outward when a big roll outruns one ring. */
const CLUSTER_OFFSETS = [
  [0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, 1], [1, -1], [-1, -1],
  [2, 0], [0, 2], [2, 1], [1, 2], [-2, 0], [0, -2], [2, 2],
];

/** The world "Encounters" folder, found by FLAG first (survives a rename and a
 *  language switch — the name is only the label it was born with), created on
 *  first use. */
const encounterFolder = async () => {
  const existing = game.folders.find(
    (f) => f.type === "Actor" && f.getFlag(game.system.id, "encounters"));
  if (existing) return existing;
  return Folder.create({
    name: game.i18n.localize("CAIRN.Encounter.Folder"),
    type: "Actor",
    flags: { [game.system.id]: { encounters: true } },
  });
};

/**
 * ONE world actor for a parsed uuid. A world Actor link is the actor. A
 * compendium link reuses the world copy `importFromCompendium` stamped
 * (`_stats.compendiumSource` holds the full pack uuid) and imports into the
 * Encounters folder only when no copy exists — N tokens share it; never one
 * actor per token.
 */
const resolveWorldActor = async (uuid) => {
  const doc = await fromUuid(uuid).catch(() => null);
  if (!doc || doc.documentName !== "Actor") return null;
  if (!doc.pack) return doc;
  const existing = game.actors.find((a) => a._stats?.compendiumSource === uuid);
  if (existing) return existing;
  const folder = await encounterFolder();
  const pack = game.packs.get(doc.pack);
  return game.actors.importFromCompendium(pack, doc.id, { folder: folder.id });
};

/** Place `count` unlinked NEUTRAL copies of the actor's prototype token in the
 *  cluster, `start` deep so consecutive specs keep filling the same ring. */
const spawnTokens = async (actor, count, start) => {
  const scene = canvas.scene;
  const gs = scene.grid.size;
  const c = canvas.stage.pivot;
  const docs = [];
  for (let i = 0; i < count; i++) {
    const n = start + i;
    const [dx, dy] = CLUSTER_OFFSETS[n % CLUSTER_OFFSETS.length];
    const ring = Math.floor(n / CLUSTER_OFFSETS.length) + 1;
    const p = canvas.grid.getTopLeftPoint({ x: c.x + dx * gs * ring, y: c.y + dy * gs * ring });
    // getTokenDocument, not prototypeToken.toObject() (review): it resolves a
    // wildcard randomImg to an actual file and applies appendNumber /
    // prependAdjective — which a raw toObject() ships literally (a broken
    // wildcard src, an unnumbered name). It also stamps actorId and merges this
    // data LAST, so the forced NEUTRAL disposition and actorLink:false still win.
    // Latent only because no shipped monster sets those prototype flags; live
    // the moment a Warden does.
    const tokenDoc = await actor.getTokenDocument({
      x: p.x,
      y: p.y,
      actorLink: false,
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
    });
    docs.push(tokenDoc.toObject());
  }
  // Batched create; the result is ID-ordered, never input-ordered, so nothing
  // downstream may index into it.
  await scene.createEmbeddedDocuments("Token", docs);
  return count;
};

/** Cards with a spawn currently running on this client, keyed by message id.
 *  The spent stamp lands only after the whole roll-import-mint loop, so this
 *  serializes a doubled click across that window; the finally in the handler
 *  releases it however the run exits. The encounter twin of pcGenerationInFlight
 *  (cairn.js). */
const encounterSpawnInFlight = new Set();

/**
 * The button's action, and the enforcement layer. Re-derives everything from
 * the message — a caller's arguments are not trusted — and refuses for a
 * non-GM, a spent stamp, and a missing scene, in that order, before anything
 * rolls or writes.
 */
export const spawnEncounterFromMessage = async (message) => {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.WardenOnly"));
    return null;
  }
  if (message.getFlag(game.system.id, ENCOUNTER_SPAWNED_FLAG)) return null;
  // In-flight lock, taken SYNCHRONOUSLY before the first await: the spent stamp
  // lands only after a loop that rolls, imports actors and mints tokens (whole
  // seconds on a random-NPC row), so without this a second click inside that
  // window clears the flag check and spawns the encounter twice while the card
  // still reads "Added" once. The finally releases it however the run exits, so
  // a no-scene refusal or a throw cannot wedge the card out of ever spawning.
  if (encounterSpawnInFlight.has(message.id)) return null;
  encounterSpawnInFlight.add(message.id);
  try {
    if (!canvas?.ready || !canvas.scene) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoSceneForEncounter"));
      return null;
    }
    const specs = await encounterSpecsForMessage(message);
    if (!specs.length) return null;

    const placedNames = [];
    let placed = 0;
    for (const spec of specs) {
      const roll = await new Roll(spec.qty).evaluate();
      const name = spec.npc
        ? game.i18n.localize("CAIRN.Encounter.RandomNpc")
        : t("monster.name", spec.label || "");
      await roll.toMessage({
        flavor: game.i18n.format("CAIRN.Encounter.QtyFlavor", { what: name }),
        speaker: { alias: game.user.name },
      });
      const count = Math.max(0, Math.floor(roll.total));
      if (!count) continue;

      if (spec.npc) {
        // A fresh PERSON each time (user ruling): the generator mints the actor
        // with statblock, biography and paired portrait/token art.
        const folder = await encounterFolder();
        for (let i = 0; i < count; i++) {
          const npc = await createNpc({ folder: folder.id });
          // Document.create resolves undefined when a _preCreate refuses; the
          // monster branch guards the same way through createMonster's `?? null`
          // (review #18). A refused person is skipped, the rest still placed.
          if (!npc) continue;
          placed += await spawnTokens(npc, 1, placed);
          placedNames.push(npc.name);
        }
      } else {
        const actor = await resolveWorldActor(spec.uuid);
        if (!actor) {
          ui.notifications.warn(game.i18n.format("CAIRN.Notify.EncounterActorMissing", { uuid: spec.uuid }));
          continue;
        }
        placed += await spawnTokens(actor, count, placed);
        placedNames.push(`${count} × ${t("monster.name", actor.name)}`);
      }
    }

    // The stamp is the refusal (the greyed button is only the affordance), and
    // setting it re-renders the card into its "Added" state on every client.
    await message.setFlag(game.system.id, ENCOUNTER_SPAWNED_FLAG, true);
    if (placedNames.length) {
      // Localized join, same reason as specList above: this list is dropped
      // into a translated sentence, so its separator has to be translated too.
      ui.notifications.info(game.i18n.format("CAIRN.Notify.EncounterPlaced", {
        what: game.i18n.getListFormatter().format(placedNames), scene: canvas.scene.name,
      }));
    }
    return placed;
  } catch (err) {
    // A mid-spawn throw used to vanish: the onclick is fire-and-forget and
    // this was try/FINALLY only, so a failed import or token mint left half
    // an encounter placed, the card un-stamped, and the Warden told nothing.
    // The card staying un-stamped is kept: the button still works, and the
    // Warden — told, now — can see what landed before retrying. A retry
    // re-places the specs that already succeeded (only actor imports dedupe);
    // the toast is what makes that a visible cleanup rather than a mystery.
    console.error("Air Bladder | encounter spawn failed", err);
    ui.notifications.error(game.i18n.localize("CAIRN.Notify.EncounterFailed"));
    return null;
  } finally {
    encounterSpawnInFlight.delete(message.id);
  }
};
