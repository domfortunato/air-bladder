import { warmPackDocuments } from "./compendium.js";

/**
 * Shared gear resolution for Air Bladder.
 *
 * Gear has one source of truth: it lives in the shipped Item compendia.
 * Character generation (2e AND Barebones), hireling loadouts, bonds, and the
 * marketplace all reference an item BY NAME and resolve it here — so a fix to a
 * pack item reaches everywhere it is granted. Those packs are TEMPLATES, not a
 * Warden's workbench: a system update replaces them wholesale, so an edit made
 * inside one in Foundry lasts only until then (as core's own unlock warning
 * says).
 *
 * This is the resolve-time half. The author-time half (turning an inline
 * {name, tags, uses, ...} record into an item's type/system fields) is
 * `buildGearItem`, kept here too so the two halves stay in one place; the
 * tools/import/marketplace.mjs authoring script carries a byte-identical copy of
 * it and of the aliases (Node can't import this browser module across the
 * ESM/CJS boundary, so the copies are kept in sync by hand — see the note
 * there).
 *
 * Nothing here touches Foundry globals at module load; `game`/`foundry` are read
 * only inside resolveGearItem's body.
 */

import { iconForItem, SPELLSCROLL_ICON, SPELLBOOK_ICON } from "./icons.js";
import { glogEnabled, grimoiresEnabled, GLOG_PACK, GLOG_SPELL_PACKS, GLOG_NAME_ALIASES } from "./glog.js";
import { isBulky, handsFullHack, concealmentWhisper } from "./utils.js";
import { lightSource, lightSourceKey } from "./light-sources.js";
import { t, speakerDisplayName, MONSTER_ITEM_NAMESPACES, ITEM_NAMESPACES } from "./i18n-content.js";

// Packs searched to resolve a gear name, in precedence order — an earlier pack
// wins a name collision. Spellbook packs are separate (spell grants route there).
//
// `market-goods` is last and is still a full member: it holds real gear that only
// the shop happened to stock (a Sedative, a Sewing Kit), and a background that
// grants one must resolve it. Leaving it out silently split the pool in two — the
// importer saw those items and skipped authoring them, while this list could not
// reach them, so the grant resolved to nothing. Any pack an importer counts as
// "already in the pool" MUST be listed here.
export const CANONICAL_GEAR_PACKS = [
  "air-bladder.expeditionary-gear",
  "air-bladder.tools",
  // Holds Lodestone, moved here 2026-07-29 when the one-item `extra` pack was
  // retired -- so the three backgrounds that grant it by name still resolve.
  "air-bladder.trinkets",
  "air-bladder.weapons",
  "air-bladder.armor",
  "air-bladder.market-goods",
  // The distinctive one-off items each background grants (Alchemical Sigils,
  // Catring, …), consolidated out of the type packs by tools/import/background-items.mjs.
  // Last in precedence: every name here is unique, so ordering is belt-and-braces.
  "air-bladder.background-items",
];

/**
 * Where a by-NAME spell grant ("Spellbook (Shield)") resolves: the canon
 * spellbooks, then the background-items pack, which holds the ONE granted
 * spell Cairn lacks — the class backgrounds' Shield (BECMI). It lived in the
 * More Spellbooks pack until 2026-09-14, when that pack was REMOVED from the
 * repo (user ruling: "including it was a mistake" — 217 non-SRD spells from
 * cairnrpg.com's extended list, none of them GLOG-worded, and two thirds of
 * the GLOG random pool by accident). The spell branch of resolveGearItem
 * filters the index by TYPE, so a background-items ITEM sharing a spell's
 * name can never answer a spellbook grant.
 */
export const SPELL_PACKS = ["air-bladder.spellbooks", "air-bladder.background-items"];

// Genuine spelling variants — NOT mere casing (the resolver is already
// case-insensitive). Key: lowercased grant spelling → canonical pack item name.
export const GEAR_ALIASES = new Map([
  ["lockpick", "Lockpicks"],
  ["hand drill", "Hand-Drill"],
  ["torches", "Torch"],
  ["rope (25ft)", "Rope"],
  ["chain (10ft)", "Chain, 10ft"],
  ["chains (10ft)", "Chain, 10ft"],
  ["chains", "Chain, 10ft"],
  ["chain", "Chain, 10ft"],
  ["pole (10ft)", "Pole, 10ft"],
  ["pole", "Pole, 10ft"],
  ["plate", "Plate Mail"],
  // The pack item carries the SRD shop's plural spelling, pairing it with
  // "Complex Instruments (Bagpipes, Fiddle, etc.)"; Jongleur grants the singular.
  ["simple instrument (pipes, lute, etc.)", "Simple Instruments (Pipes, Lute, etc.)"],
  ["boltcutters", "Bolt Cutters"],
  // The shop's tent IS the pool's tent: the barebones item is already bulky
  // with "fits 2" as its description. Without this the shop cannot see it and
  // authors a second, identical tent as a market-only good.
  ["tent (fits 2)", "Tent"],
]);

/* -------------------------------------------------------------------------- */
/*  What a granted item IS, for ordering it                                     */
/* -------------------------------------------------------------------------- */

/**
 * Light sources, BY NAME. There is no field for this: `weapon` and `armor` are
 * Item types, but a Torch, a Candle and a Lantern are all plain `type: "item"`
 * and nothing in the data says any of them gives light.
 *
 * A keyword match rather than an exact list, because it is right for the
 * background-items pack too — a Wisp Lantern and a Torch Fungus ("when crushed,
 * it creates a heatless light") are genuine light sources and an exact list
 * would have to grow an entry per background. The known cost is the Candle of
 * Ward, a ward that happens to burn, which files here; one item in the wrong
 * block, against a rule that keeps working when someone adds a Bullseye Lantern.
 */
export const LIGHT_SOURCE_RE = /\b(torch(es)?|lanterns?|lamps?|candles?)\b/i;

/**
 * What FEEDS a light source: lowercased fuel name → lowercased source name, so
 * the oil can be filed directly beneath the lamp it belongs to.
 *
 * An exact map and NOT a regex, and the asymmetry with LIGHT_SOURCE_RE above is
 * deliberate: `\boil\b` would swallow Fire Oil (a thrown incendiary) and
 * Miracle Oil, neither of which has ever gone into a lantern. A keyword rule is
 * safe for lights because every word in it names a light; there is no such word
 * for fuel.
 */
export const LIGHT_FUEL = new Map([
  ["oil can", "lantern"],
]);

/**
 * A light a character can HOLD (2026-11-20, user ask: "Hold light"): a plain
 * `item` named as a light source, never its fuel. Held is equipped, as a
 * shield's is, so a light gets the inventory's hand and the character sheet's
 * "Hold light" switch. `item` type only: the Candle Helmet is armor and is
 * worn, not held. By the stored ENGLISH name (the content overlay is
 * display-only), with LIGHT_SOURCE_RE's known cost (the Candle of Ward).
 * @param {Item|Object} item
 * @returns {Boolean}
 */
export const isHoldableLight = (item) => item?.type === "item"
  && isLightName(item?.name)
  && !LIGHT_FUEL.has(String(item?.name ?? "").trim().toLowerCase());

/**
 * Light (or put out) a held light through the Torch module (2026-11-20, user
 * ask), the ONE call the "Hold light" switch and a light's inventory hand
 * share. Nothing happens unless Torch is active and the actor has a token on
 * the viewed scene. Holding selects the light by its stored name
 * (`game.Torch.selectSource`) and lights it if Torch says it is off; stowing
 * puts the token's light out (`extinguish`). The SYSTEM spends the use, on
 * lighting, since 2026-11-21 (`lightIt`); the Torch file marks nothing
 * consumable, so Torch never spends a second one. One-way: Torch's own HUD
 * button does not move the switch.
 *
 * Review #35, measured against the guide's promise ("A light Torch doesn't
 * know ... is still held, but it doesn't shine"):
 * - a light missing from the radius table (`lightSource`, the same names the
 *   Torch file carries) is held and NOT selected: Torch does not throw on an
 *   unknown name, it lit whatever other source the token carried;
 * - a light with uses whose count is spent is not held at all since
 *   2026-11-21: lighting it is refused (`registerHeldLightSync`);
 * - stowing while another usable light is still held puts the old one out
 *   and lights that one (one light is held at once; legacy data can hold two).
 * A throw is still swallowed and the hold stands, unlit.
 *
 * Called by `registerHeldLightSync` on the client that made the change, for
 * every route a light enters or leaves the hand (switch, row hand, Broken,
 * delete, give, drop), never by the sheet directly.
 * @param {Actor} actor
 * @param {Item} item     the light held, or one of those stowed
 * @param {Boolean} held
 */
export const holdLight = async (actor, item, held) => {
  if (!game.modules.get("torch")?.active || !game.Torch) return;
  const token = actor?.getActiveTokens?.(false, true)?.[0];
  const sceneId = token?.parent?.id;
  if (!token?.id || !sceneId) return;
  const light = async (it) => {
    if (!shinesInTorch(it)) return;
    await game.Torch.selectSource(sceneId, token.id, it.name);
    if ((await game.Torch.currentState(sceneId, token.id)) === "off") await game.Torch.toggle(sceneId, token.id);
  };
  try {
    if (held) {
      await light(item);
    } else {
      await game.Torch.extinguish(sceneId, token.id);
      const still = actor.items.find((i) => i.id !== item.id && isHeldLight(i));
      if (still) await light(still);
    }
  } catch {
    // Torch failed: the hold stands, unlit.
  }
};

/**
 * Are a CHARACTER's hands full under the "Hands full" hack (2026-11-20, user
 * ask)? Holding = EQUIPPED: an armor ticked Shield and a light source, neither
 * broken. The ONE test the sheet's rollers, the Attack window and the hotbar
 * macro read (review #35: the macro had none).
 * @param {Actor} actor
 */
export const handsFull = (actor) => {
  if (actor?.type !== "character" || !handsFullHack()) return false;
  const held = actor.items.filter((i) => i.system?.equipped && !i.system?.broken);
  return held.some((i) => i.type === "armor" && i.system?.shield === true) && held.some((i) => isHoldableLight(i));
};

/**
 * Does "Hands full" keep this item from attacking? True for anything that is
 * not the held shield or light, on a character whose hands are full.
 * @param {Item} item
 */
export const handsBlock = (item) => {
  if (!handsFull(item?.actor)) return false;
  return !((item.type === "armor" && item.system?.shield === true) || isHoldableLight(item));
};

/** Is this item a light held right now (equipped and not broken)? */
export const isHeldLight = (item) => isHoldableLight(item) && item.system?.equipped === true && !item.system?.broken;

/**
 * A book a creature can EQUIP (2026-11-21, user asks: a badge on page 1
 * showing "if a spell book, grimoire or scroll is equipped", and scrolls and
 * the Grimoire made equippable): a spellbook or scroll that is not a bound
 * Grimoire page, or the Grimoire itself. One is equipped at a time, as a
 * light is: the badge and a row's hand put the others away.
 * @param {Item|Object} item
 * @returns {Boolean}
 */
export const isHoldableBook = (item) => (item?.type === "spellbook" && !item.system?.bound)
  || (item?.type === "item" && item.system?.grimoire === true);

/** Is this item a book equipped right now (and not broken)? */
export const isHeldBook = (item) => isHoldableBook(item) && item.system?.equipped === true && !item.system?.broken;

/**
 * Does an item have a use to spend? An item that doesn't count uses (max 0)
 * is never used up: a Lantern, a homebrew lamp, an Oil Can nobody numbered.
 * A STACK standing at 0 with another unit to hand has one too (review #36):
 * `CairnItem#spendUse` opens the next unit, as the row's minus does.
 * @param {Item} item
 */
const hasUseLeft = (item) => !(Number(item?.system?.uses?.max) > 0)
  || Number(item?.system?.uses?.value) > 0
  || Number(item?.system?.quantity) > 1;

/** Does the item count its uses at all? */
const countsUses = (item) => Number(item?.system?.uses?.max) > 0;

/**
 * What the Lantern burns (2026-11-21, user ask: "a lantern can't be used
 * without candle or oil and one use of them is marked off"): an Oil Can
 * first, then a Candle (my call, told), each unbroken with a use left. By the
 * stored English name, as every light rule here, Candle through the radius
 * table so "Candles" and "Vela" count. Null when there is none.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export const lanternFuel = (actor) => {
  const usable = (i) => !i.system?.broken && hasUseLeft(i);
  const items = actor?.items?.contents ?? [];
  return items.find((i) => String(i.name ?? "").trim().toLowerCase() === "oil can" && usable(i))
    ?? items.find((i) => i.type === "item" && lightSourceKey(i.name) === "Candle" && usable(i))
    ?? null;
};

/** Is this THE Lantern, the one that needs fuel? Never the Wisp Lantern. */
const needsFuel = (item) => lightSourceKey(item?.name) === "Lantern";

/**
 * Why this light can't be lit right now, as a warning to show, or null when
 * it can: a light whose uses are spent, or the Lantern with no fuel. It comes
 * back as a KEY and its values, shown with
 * `ui.notifications.warn(why.key, { format: why.format })`, never as a
 * finished sentence: core escapes each value and leaves a known key alone,
 * where a sentence handed over already formatted is cleaned WHOLE as HTML and
 * a name with an angle bracket in it cuts the toast short (review #36). The
 * `preUpdateItem` hook (`registerHeldLightSync`) enforces it for every route;
 * a caller that sends the light in ONE write with something else asks first
 * (the row's hand, `#onItemToggleEquipped`: review #36).
 * @param {Item} item
 * @returns {{key: String, format: Object}|null}
 */
export const lightingRefusal = (item) => {
  const npc = item.parent?.type !== "character";
  const name = item.name;
  if (!hasUseLeft(item)) return { key: npc ? "CAIRN.LightUsedUpNpc" : "CAIRN.LightUsedUp", format: { name } };
  if (needsFuel(item) && !lanternFuel(item.parent)) {
    return { key: npc ? "CAIRN.LanternNoFuelNpc" : "CAIRN.LanternNoFuel", format: { name } };
  }
  return null;
};

/**
 * The light card's kinds: which sentence each one is, and what it needs. A
 * kind that counts picks its singular key from `n` when it is worded.
 */
const LIGHT_CARD_KINDS = {
  lit: { key: () => "CAIRN.LightCard.Lit" },
  litUses: { key: (n) => (n === 1 ? "CAIRN.LightCard.LitUse" : "CAIRN.LightCard.LitUses"), counts: true },
  litFuel: { key: (n) => (n === 1 ? "CAIRN.LightCard.LitFuelOne" : "CAIRN.LightCard.LitFuel"), counts: true, fuel: true },
  litFuelFree: { key: () => "CAIRN.LightCard.LitFuelFree", fuel: true },
  out: { key: () => "CAIRN.LightCard.Out" },
  wardenOut: { key: () => "CAIRN.LightCard.WardenOut" },
};

/**
 * The card's sentence, as plain text, from the record its flag carries: the
 * ONE wording both the stored body and the per-viewer rebuild go through.
 * Null for a record that isn't one: the kind is looked up with hasOwn (a
 * crafted "constructor" finds no kind), the names must be strings and a
 * counting kind's `n` a finite number.
 * @param {Object} data          { k, actor, light, fuel, n, m }
 * @param {String} [actorName]   the actor as this viewer names it
 * @returns {String|null}
 */
const lightCardText = (data, actorName = data?.actor) => {
  if (!data || typeof data !== "object" || typeof data.k !== "string" || !Object.hasOwn(LIGHT_CARD_KINDS, data.k)) return null;
  const kind = LIGHT_CARD_KINDS[data.k];
  if (typeof actorName !== "string" || typeof data.light !== "string") return null;
  if (kind.fuel && typeof data.fuel !== "string") return null;
  const n = Number(data.n);
  if (kind.counts && (typeof data.n !== "number" || !Number.isFinite(n))) return null;
  // A light's name as its inventory row shows it: a monster's items are read
  // under its own namespaces first (`itemNamespaces`).
  const ns = (data.m === true ? MONSTER_ITEM_NAMESPACES : ITEM_NAMESPACES).nameNs;
  return game.i18n.format(kind.key(n), {
    actor: actorName,
    light: t(ns, data.light),
    fuel: kind.fuel ? t(ns, data.fuel) : "",
    n: kind.counts ? n : "",
  });
};

/**
 * Rebuild a light card's sentence in THIS viewer's language and names
 * (renderChatMessageHTML; review #36). The stored body is the acting client's
 * and stays as the fallback: a card from before the flag, or one whose record
 * doesn't hold up, keeps it. The light and the fuel read through the content
 * overlay, as their inventory rows do; the actor as the card's header names
 * it (`speakerDisplayName`: a player's character is never localized).
 * `textContent`, never innerHTML: every name in it is authored text.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 * @returns {boolean} whether the sentence was rebuilt
 */
export const localizeLightCard = (message, html) => {
  // Hidden stays hidden: the rule every rebuild in this hook follows.
  if (!message?.isContentVisible) return false;
  const data = message?.getFlag?.("air-bladder", "lightCard");
  if (!data || typeof data !== "object" || typeof data.actor !== "string") return false;
  const p = html.querySelector(".cairn-light-card > p");
  if (!p) return false;
  const text = lightCardText(data, speakerDisplayName(message, data.actor));
  if (text === null) return false;
  p.textContent = text;
  return true;
};

/**
 * Post the light card (2026-11-21, user pick: a notice to everyone when a
 * light is lit and when it goes out). Its own container class,
 * `cairn-light-card`, so a probe can pick it out of a busy chat log.
 *
 * The body is this client's sentence; the flag carries the KIND and the
 * stored English names, and `localizeLightCard` rebuilds the sentence for
 * each viewer (review #36).
 *
 * PUBLIC UNLESS THE TOKEN IS CONCEALED (review #36): a hidden or secret
 * token's creature lighting a lantern isn't table news, so the card goes to
 * whoever may name the token (`concealmentWhisper`, as the status card). The
 * token is a synthetic actor's own, or for a linked actor the one on the
 * scene this client is viewing, the same token `holdLight` lights. With no
 * token there the card stays public.
 * @param {Actor} actor
 * @param {Object} record  { k, light, fuel, n }: the kind and English names
 */
const postLightCard = (actor, record) => {
  const data = { ...record, actor: actor.name };
  if (actor.npcRole === "monster") data.m = true;
  const text = lightCardText(data);
  if (text === null) return null;
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="cairn-light-card"><p>${foundry.utils.escapeHTML(text)}</p></div>`,
    flags: { "air-bladder": { lightCard: data } },
  };
  const whisper = concealmentWhisper(actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null);
  if (whisper) messageData.whisper = whisper;
  return ChatMessage.create(messageData);
};

/**
 * Light it: spend the light's own use, or the Lantern's fuel, then tell the
 * table. The spend is `CairnItem#spendUse`, the row's minus control's own
 * arithmetic (review #36), so a stack rolls over to its next unit; the card's
 * count is the open unit's, as the row shows it. It is a write of its own
 * with `abNoStatusCard`, so the change log doesn't repeat what the card says.
 * @param {Item} item
 * @param {Object} options  the update's options (abNoStatusCard: no card)
 */
const lightIt = async (item, options) => {
  const actor = item.parent;
  const spend = async (it) => {
    const diff = it.spendUse();
    await it.update(diff, { abNoStatusCard: true });
    return diff["system.uses.value"];
  };
  let record;
  if (needsFuel(item)) {
    const fuel = lanternFuel(actor);
    if (fuel && countsUses(fuel)) record = { k: "litFuel", light: item.name, fuel: fuel.name, n: await spend(fuel) };
    else if (fuel) record = { k: "litFuelFree", light: item.name, fuel: fuel.name };
  } else if (countsUses(item)) {
    record = { k: "litUses", light: item.name, n: await spend(item) };
  }
  record ??= { k: "lit", light: item.name };
  if (!options?.abNoStatusCard) await postLightCard(actor, record);
};

/**
 * It went out: tell the table. The Warden putting out a light a PLAYER's
 * character holds gets its own line (2026-11-21, user ask: "The warden should
 * be able to put someone's lamp out and the notice in chat should notify
 * everyone").
 * @param {Item} item
 * @param {Object} options
 */
const putItOut = async (item, options) => {
  if (options?.abNoStatusCard) return;
  const actor = item.parent;
  const k = game.user.isGM && actor.hasPlayerOwner ? "wardenOut" : "out";
  await postLightCard(actor, { k, light: item.name });
};

/** Can Torch light it: a name it knows (the radius table it shares). A spent
 *  light never gets this far since 2026-11-21: lighting it is refused. */
const shinesInTorch = (item) => !!lightSource(item?.name);

/**
 * Keep Torch in step with whatever a light's HELD state does (review #35):
 * the switch, a row's hand, Broken (which unequips), a delete, a gift or a
 * drop to the pile (both delete the giver's copy). Only on the client that
 * made the change (`userId`), so the call is made once. The held state is
 * read before the write (`preUpdateItem`) and after it. Calls for one actor
 * run one after another: a single write can move two lights (a row's hand
 * puts the other away), and Torch's calls must not interleave.
 */
export const registerHeldLightSync = () => {
  const queues = new Map();
  const queue = (actor, item, held) => {
    const key = actor.uuid;
    const next = (queues.get(key) ?? Promise.resolve()).then(() => holdLight(actor, item, held));
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  };
  Hooks.on("preUpdateItem", (item, changes, options) => {
    if (isHoldableLight(item) && item.parent) {
      // Lighting it (2026-11-21): a spent light, or the Lantern with no fuel,
      // is refused here, on the client making the change, whatever route
      // asked (the badge, a row's hand, the Warden). Core refuses THIS item
      // only and writes the rest of the batch, so a caller that stows the
      // burning light in the same write asks `lightingRefusal` first, as the
      // row's hand does (review #36): otherwise the stow lands and nothing
      // is lit.
      const lighting = !isHeldLight(item)
        && foundry.utils.getProperty(changes, "system.equipped") === true
        && !(foundry.utils.getProperty(changes, "system.broken") ?? item.system?.broken);
      if (lighting) {
        const why = lightingRefusal(item);
        if (why) {
          ui.notifications.warn(why.key, { format: why.format });
          return false;
        }
      }
      options.abHeldLight ??= {};
      options.abHeldLight[item.id] = isHeldLight(item);
    }
  });
  Hooks.on("updateItem", (item, _changes, options, userId) => {
    if (userId !== game.user.id || !item.parent || !isHoldableLight(item)) return;
    const was = options.abHeldLight?.[item.id];
    const now = isHeldLight(item);
    if (was === undefined || was === now) return;
    // Spend and tell the table BEFORE Torch is asked, in the same queue, so a
    // light's calls stay in order.
    const key = item.parent.uuid;
    const told = (queues.get(key) ?? Promise.resolve()).then(() => (now ? lightIt(item, options) : putItOut(item, options)))
      .catch((e) => console.error("air-bladder | light card:", e));
    queues.set(key, told);
    queue(item.parent, item, now);
  });
  Hooks.on("deleteItem", (item, _options, userId) => {
    if (userId !== game.user.id || !item.parent || !isHeldLight(item)) return;
    queue(item.parent, item, false);
  });
};

/** Food, which sits at the very bottom of a granted loadout. */
export const RATIONS_RE = /\brations?\b/i;

/** True for a light source or the fuel that feeds one — the block that sits
 *  directly above Rations. */
export const isLightGear = (name) =>
  isLightName(name) || LIGHT_FUEL.has(String(name ?? "").trim().toLowerCase());

/**
 * Is this the name of a light? The keyword rule, OR a name in the radius
 * table (light-sources.js), which brings in the Glowsnail and the Sun Stick
 * (user ruling 2026-11-20). ONE test for the loadout's light band and for
 * what a character can hold, so the two cannot disagree.
 * @param {String} name
 */
export const isLightName = (name) => LIGHT_SOURCE_RE.test(String(name ?? "")) || !!lightSource(name);

/**
 * The six ordering bands a granted loadout is arranged into, lowest first.
 * Tested IN ORDER, which is what settles the overlaps: the Candle Helmet is
 * `type: "armor"`, so it files as armor rather than as a light, and a
 * spellbook named for a candle would still file as a book — type outranks
 * name throughout.
 *
 * `book` (2026-08-21, user ask): spellbooks and spellscrolls sort together
 * near the top, directly after weapons and armor. One band for both because
 * they are one TYPE — a scroll is a spellbook with the `scroll` flag — and
 * a type test is the only marker that survives renaming a spell.
 */
export const GRANT_BANDS = { weapon: 0, armor: 1, book: 2, other: 3, light: 4, rations: 5 };

/** Which band a built item belongs to. @param {Object} item @returns {Number} */
export const grantBand = (item) => {
  if (item?.type === "weapon") return GRANT_BANDS.weapon;
  if (item?.type === "armor") return GRANT_BANDS.armor;
  if (item?.type === "spellbook") return GRANT_BANDS.book;
  const name = String(item?.name ?? "");
  if (RATIONS_RE.test(name)) return GRANT_BANDS.rations;
  if (isLightGear(name)) return GRANT_BANDS.light;
  return GRANT_BANDS.other;
};

/**
 * Arrange a freshly built loadout and write each item's `sort`: weapons, then
 * armor, then everything else in the order the generator built it, then the
 * light sources with each one's fuel directly beneath it, then Rations.
 *
 * `sort` is Foundry's own field and the one `_sortItemsForDisplay` honours when
 * drag-to-reorder is on, so the player can still drag any row afterwards and
 * the printed page follows without knowing this function exists. Spaced by
 * CONST.SORT_INTEGER_DENSITY, matching core, so `performIntegerSort` has room
 * to insert between two rows rather than having to renormalise the whole list
 * on the first drag.
 *
 * Stable within a band: the "everything else" band keeps build order, which is
 * the order the generator granted things in and the only order it has.
 *
 * @param {Object[]} items  built item payloads, mutated in place and returned
 * @returns {Object[]}
 */
export const orderGrantedItems = (items) => {
  const list = items ?? [];
  const bands = [[], [], [], [], [], []];
  for (const item of list) bands[grantBand(item)].push(item);

  // The light band pairs up: each fuel goes directly beneath the source it
  // feeds. A fuel whose source was never granted keeps its place in the band
  // rather than being dropped or promoted — an oil can with no lamp is still
  // lamp oil, and the Warden can see they are short a lamp.
  const lights = bands[GRANT_BANDS.light];
  const sources = lights.filter((i) => !LIGHT_FUEL.has(String(i.name ?? "").trim().toLowerCase()));
  const fuels = lights.filter((i) => LIGHT_FUEL.has(String(i.name ?? "").trim().toLowerCase()));
  const paired = [];
  const placed = new Set();
  for (const source of sources) {
    paired.push(source);
    const lower = String(source.name ?? "").toLowerCase();
    for (const fuel of fuels) {
      if (placed.has(fuel)) continue;
      const feeds = LIGHT_FUEL.get(String(fuel.name ?? "").trim().toLowerCase());
      if (feeds && lower.includes(feeds)) { paired.push(fuel); placed.add(fuel); }
    }
  }
  // An orphan keeps its place rather than being tracked on the payload itself:
  // a scratch property set on a built item would ride into the created document.
  for (const fuel of fuels) if (!placed.has(fuel)) paired.push(fuel);
  bands[GRANT_BANDS.light] = paired;

  const ordered = bands.flat();
  ordered.forEach((item, i) => { item.sort = (i + 1) * CONST.SORT_INTEGER_DENSITY; });
  return ordered;
};

/**
 * A grant may name a spell as "Spellbook (X)", "Scroll (X)", or "X Spellbook".
 * Return the bare spell name X (to resolve against SPELL_PACKS), else null.
 */
export const spellNameFromGrant = (name) => {
  const s = String(name).trim();
  const m =
    s.match(/^spellbook\s*\((.+)\)$/i) ||
    s.match(/^scroll\s*\((.+)\)$/i) ||
    s.match(/^(.+?)\s+spellbook$/i);
  return m ? m[1].trim() : null;
};

/**
 * True when a grant names a SCROLL specifically ("Scroll (X)") rather than a book
 * ("Spellbook (X)", "X Spellbook"). Both route to the same spell in the spellbook
 * packs, but a scroll must resolve to a single-use petty item, a book to the
 * slot-taking spellbook — spellNameFromGrant deliberately erases that difference,
 * so resolveGearItem consults this to decide which to build.
 */
export const isScrollGrant = (name) => /^scroll\s*\(.+\)$/i.test(String(name).trim());

/**
 * A single-use petty scroll built from a resolved spellbook document: the SAME
 * spellbook type with `scroll` ticked, the spell's own text as its description, and
 * stored under the bare spell name — the inventory row adds the "Spellscroll — "
 * prefix at display time, exactly as it does for a book. THE one definition of
 * "what a scroll is", shared by named scroll grants (resolveGearItem) and the
 * random-scroll path (character-generator.js randomScrollItem) so the two cannot
 * drift.
 *
 * This used to emit `type: "item"` under the name "Spellscroll — X", which made a
 * generated scroll a THIRD representation no Warden could author or recognise: not
 * a spellbook, not flagged, identifiable only by a word in its name (which is what
 * `iconForItem` keys the scroll art off). `CairnItem._preUpdate` re-pins petty and
 * the use count on every write, so the values below are the initial state rather
 * than the only thing holding the invariant.
 */
export const spellScrollItem = (book, { quantity = 1, uses } = {}) => ({
  name: book.name,
  type: "spellbook",
  img: SPELLSCROLL_ICON,
  system: {
    // toObject() rather than deepClone — see resolveGearItem. The spread saved
    // this one from mutating the pack, but it also copied prepared/derived
    // fields off the live model into stored data.
    ...book.system.toObject(),
    scroll: true,
    weightless: true,
    equipped: false,
    quantity,
    uses: { value: uses ?? 1, max: 1 },
  },
});

/**
 * Author-time inference: map an inline {name, tags, uses/charges, description,
 * cost} record to an item's {type, system}. The one place tag→field inference
 * lives. Rules:
 *   - a whole-string dice tag (d6, d8, d6+d6, 2d6) → weapon + damageFormula
 *   - an "N Armor" tag                             → armor + system.armor = N
 *   - "petty" → weightless, "bulky" → bulky, "blast" → blast (weapons)
 *   - uses / charges / maxCharges → uses{value,max}; else lift "N use(s)" from prose
 * Weapon wins over armor when a record carries both (e.g. a bow tagged 1 Armor).
 */
export const buildGearItem = (g) => {
  const tags = g.tags ?? [];
  const lower = tags.map((t) => String(t).toLowerCase());
  const damageTag = tags.find((t) => /^\s*\d*d\d+(\s*\+\s*\d*d\d+)*\s*$/i.test(String(t)));
  const armorTag = tags.find((t) => /armor/i.test(String(t)));

  // "charges" is the relabelled "uses" field (relic-style items); fold either
  // spelling into uses. A structured count always beats a prose one.
  let usesMax = g.uses ?? g.maxCharges ?? g.charges ?? 0;
  let usesValue = g.uses ?? g.charges ?? usesMax;
  if (!usesMax) {
    const m = String(g.description ?? "").match(/\b(\d+)\s+uses?\b/i);
    if (m) { usesMax = Number(m[1]); usesValue = usesMax; }
  }

  const system = {
    description: g.description ?? "",
    weightless: lower.includes("petty"),
    bulky: lower.includes("bulky"),
    equipped: false,
    cost: g.cost ?? 0,
    quantity: 1,
    uses: { value: usesValue, max: usesMax },
  };

  let type = "item";
  if (damageTag) {
    type = "weapon";
    system.damageFormula = String(damageTag).trim();
    system.criticalDamage = "";
    system.blast = lower.includes("blast");
  } else if (armorTag) {
    type = "armor";
    const n = parseInt(String(armorTag), 10);
    system.armor = Number.isNaN(n) ? 1 : n;
  }
  return { name: g.name, type, img: iconForItem(type, g.name), system };
};

/**
 * Resolve-time: find a gear item by name across the canonical packs
 * (case-insensitive, honouring aliases and spell routing) and return a fresh
 * owned-item payload — a deep clone, so the pack document is never mutated — with
 * per-grant quantity/uses overrides applied. Returns null on a miss (and warns);
 * generation should degrade gracefully rather than throw.
 *
 * Still not cached: the match is found in the pack INDEX (names only, kept in
 * memory and updated live when a document changes), then that one document is
 * materialized with `getDocument`. So an edit to a pack item is reflected on the
 * next resolve (until an update replaces the pack — see the module docblock)
 * without loading every document in eight packs.
 *
 * This runs once per gear name, and `getDocuments()` was walking ~1,000 documents
 * across eight packs each time to read one name off each. Measured on the dev
 * world (Foundry 14.365): twenty names went 34.5s -> 5.2s, and the six a typical
 * Kettlewright character carries cost 1.8s cold (building the indexes, once per
 * session) and 0ms warm, against ~1.7s PER NAME before.
 */
export const resolveGearItem = async (name, { quantity = 1, uses } = {}) => {
  let found = null;
  for (const { pack, entry } of await gearEntries(name)) {
    const doc = await pack.getDocument(entry._id);
    if (doc) { found = doc; break; }
  }
  if (!found) {
    console.warn(`resolveGearItem: no item named "${name}" in the canonical packs`);
    return null;
  }

  return itemDataFromDocument(found, { quantity, uses, grantName: name });
};

/**
 * Fetch, ONE REQUEST PER PACK, the documents these grant names resolve to
 * (review #34 finding 207), so a loop that then resolves them one by one with
 * `resolveGearItem` reads the cache. That loop's every name was a server
 * request in series: a background's starting gear on every generation, swap
 * and re-deal, each Kettlewright item, Test ×10's lint. Each name is looked up
 * by `gearEntries`, resolveGearItem's own lookup; a miss is left for
 * resolveGearItem to warn about.
 * @param {Iterable<string>} names
 * @returns {Promise<void>}
 */
export const warmGearItems = async (names) => {
  const byPack = new Map();   // pack → [id]
  for (const name of names ?? []) {
    const [hit] = await gearEntries(name);
    if (!hit) continue;
    if (!byPack.has(hit.pack)) byPack.set(hit.pack, []);
    byPack.get(hit.pack).push(hit.entry._id);
  }
  await Promise.all([...byPack].map(([pack, ids]) => warmPackDocuments(pack, ids)));
};

/**
 * Where a grant name lives: every canonical pack whose INDEX carries it, in
 * pack order, with its entry. The one lookup `resolveGearItem` and
 * `warmGearItems` share, so the two cannot disagree about a name.
 * @param {string} name
 * @returns {Promise<{pack: CompendiumCollection, entry: object}[]>}
 */
const gearEntries = async (name) => {
  const spell = spellNameFromGrant(name);
  let targetName = spell ?? GEAR_ALIASES.get(String(name).trim().toLowerCase()) ?? name;
  // Under GLOG only GLOG and custom spells are used (ruling 2026-08-05):
  // spell grants resolve against the GLOG wordings and the custom set, with
  // canon EXCLUDED — a "Spellbook (Charm)" grant must come back scaling on
  // [dice]/[sum], not as the canon sentence. Non-spell gear is untouched.
  // Two canon spells exist in the GLOG list under NEW names (Marble Craze,
  // Missile Shield — see GLOG_NAME_ALIASES); the alias applies ONLY while GLOG
  // is in force, so canon-mode resolution never sees it. glog.js is imported
  // STATICALLY: a per-call `await import()` cost ~600ms every call in the live
  // page — once per resolved gear NAME — and glog.js → settings.js is a leaf
  // chain, no cycle.
  const useGlog = !!spell && glogEnabled();
  if (useGlog) targetName = GLOG_NAME_ALIASES.get(targetName.toLowerCase()) ?? targetName;
  const packs = spell
    ? (useGlog ? GLOG_SPELL_PACKS : SPELL_PACKS)
    : CANONICAL_GEAR_PACKS;
  const lower = String(targetName).toLowerCase();

  const hits = [];
  for (const key of packs) {
    const pack = game.packs.get(key);
    if (!pack) continue;
    // Spell names and gear names are TWO namespaces: a spell grant answers to a
    // spellbook only, a gear grant to anything but. background-items holds
    // both kinds since 2026-09-14 (the class backgrounds' Shield spellbook
    // beside their one-off items) and armor ships a Shield of its own, so
    // without this a plain "Shield" grant would depend on pack ORDER to find
    // the armor. check:refs keys its duplicate-name gate the same way.
    const entry = (await pack.getIndex()).find((e) => e.name.toLowerCase() === lower
      && (spell ? e.type === "spellbook" : e.type !== "spellbook"));
    if (entry) hits.push({ pack, entry });
  }
  return hits;
};

/**
 * A spellBOOK built from a resolved spell document, the inverse of
 * `spellScrollItem`: not petty, no uses, never equipped, the book art. For GLOG
 * without Grimoires (2026-11-20): the GLOG pack ships every spell as a SCROLL
 * (it was built when GLOG meant scrolls), so a book grant resolved there would
 * otherwise arrive as the pack stores it. The spell's GLOG wording and its
 * `glog` flag ride along in the copied system data.
 * @param {Item} book
 * @param {{quantity?: number}} [options]
 */
export const spellbookItem = (book, { quantity = 1 } = {}) => ({
  name: book.name,
  type: "spellbook",
  img: SPELLBOOK_ICON,
  system: {
    ...book.system.toObject(),
    scroll: false,
    weightless: false,
    equipped: false,
    quantity,
    uses: { value: 0, max: 0 },
  },
});

/**
 * A fresh owned-item payload built from an item DOCUMENT — the tail of
 * `resolveGearItem`, factored out 2026-09-14 for the Barebones table reader,
 * which hands over a row's own WORLD item rather than looking its name up in
 * the shipped packs (character-generator.js resolveBarebonesResult). One
 * definition, so a row's item and a named grant of the same thing arrive in
 * the same shape — the scroll rule included.
 *
 * @param {Item} doc
 * @param {{quantity?: number, uses?: number, grantName?: string}} [options]
 *   `grantName` is the wording the grant used, which is what decides the scroll
 *   question; it defaults to the document's own name.
 */
export const itemDataFromDocument = (doc, { quantity = 1, uses, grantName } = {}) => {
  // A "Scroll (X)" grant is the spell as a single-use petty scroll, not the
  // slot-taking book. Without this a background handing out a scroll silently
  // grants a full spellbook (and the sheet even labels it "Spellbook — X").
  // Under GLOG WITH GRIMOIRES, every spell grant is a scroll — "Spellbook (X)"
  // included: found magic is a scroll you copy into your grimoire, and
  // permanent books are treasure, never handed out (rulings 2 and 7,
  // 2026-08-05). Without Grimoires (2026-11-20) a book grant is a book; the
  // GLOG pack stores its spells as scrolls, so one resolved there is rebuilt
  // as a book (`spellbookItem`).
  if (doc.type === "spellbook" && (isScrollGrant(grantName ?? doc.name) || grimoiresEnabled())) {
    return spellScrollItem(doc, { quantity, uses });
  }
  if (doc.type === "spellbook" && doc.system?.scroll && doc.pack === GLOG_PACK && glogEnabled()) {
    return spellbookItem(doc, { quantity });
  }

  const item = {
    name: doc.name,
    type: doc.type,
    img: doc.img,
    // toObject(), NOT deepClone. `doc.system` is a TypeDataModel, and
    // foundry.utils.deepClone returns any non-plain object UNCHANGED — by
    // reference (common/utils/helpers.mjs:280-282, "Unsupported advanced
    // objects"). So this used to hand back the compendium document's own
    // system, and the two writes below mutated the pack in place: every item
    // resolved in a session aliased one object per pack entry, last write wins.
    // It was invisible until a grant asked for `uses`, because everything else
    // was writing the same value back.
    system: doc.system.toObject(),
  };
  item.system.quantity = quantity;
  if (uses != null) item.system.uses = { value: uses, max: uses };
  return item;
};

/**
 * The stack an arriving item may merge into — the ONE discriminator, shared by
 * the cross-sheet drag-move (actor-sheet.js `_onDropItem`) and the offer
 * delivery (item-offer.js), so the two can never disagree about what a stack
 * is. A stack is only a stack when the flag-shaped discriminators agree:
 * a spellbook and a spellscroll share name AND type (this file stores a
 * scroll under the bare spell name), so a plain name+type test merged a
 * dropped book into a scroll stack — the book was never created, and a
 * cross-actor drop deleted the source scroll while bumping the target's book
 * (review #9). A bound page and the loose book of the same spell are
 * different things (the page is the book's), and a GRIMOIRE never stacks at
 * all: each book carries its own pages, and quantity 2 on one document would
 * make two libraries indistinguishable. A SPENT scroll and a fresh one of the
 * same spell are different things too: the merge only adds quantity, so a
 * fresh scroll dropped on a spent one became uncastable, and a spent one
 * dropped on a fresh one became castable (review #34 finding 95). BROKEN
 * splits likewise (review #35). Any future
 * flag-style splitter joins this test rather than growing a new merge.
 * @param {CairnActor} actor  the receiving actor
 * @param {CairnItem|Object} itemLike  the arriving item or its plain data
 * @returns {CairnItem|null}
 */
export const findMatchingStack = (actor, itemLike) =>
  actor.items.find(
    (it) => it.name === itemLike.name && it.type === itemLike.type
      && !!it.system?.scroll === !!itemLike.system?.scroll
      && !!it.system?.bound === !!itemLike.system?.bound
      && !it.system?.grimoire && !itemLike.system?.grimoire
      && isSpentScroll(it) === isSpentScroll(itemLike)
      // A broken item and an intact one are different things for the same
      // reason (review #35): the merge only adds quantity, so an intact unit
      // arriving on a broken stack broke, and a broken one arriving on an
      // intact stack was mended.
      && !!it.system?.broken === !!itemLike.system?.broken
  ) ?? null;

/** A spellscroll whose single use is gone (the strike-through row). Plain data
 *  with no count at all is a fresh scroll: that is what `CairnItem#_preCreate`
 *  makes of it. */
const isSpentScroll = (itemLike) => {
  const value = itemLike.system?.uses?.value;
  return !!itemLike.system?.scroll && value !== undefined && (Number(value) || 0) < 1;
};

/**
 * What happens if `need` slots arrive on this actor? THREE verdicts.
 *
 * One test, because the same question was being spelled three different ways —
 * the drop handler's strict projected check for a thing, its `isEncumbered()`
 * check for everyone else, and the offer card's own arithmetic — and three
 * spellings of one rule is three things to drift. It sits beside
 * `findMatchingStack` for exactly that reason.
 *
 * THE THREE VERDICTS DIFFER IN WHO MAY BUY WHICH.
 *
 * - `"fits"` — nothing to decide.
 * - `"overburden"` — a PERSON (a character, an npc or a hireling) would be left
 *   with no free slot, which sets Hit Protection to 0 until something is
 *   dropped or handed away. This is the case the rules OWE, and an informed
 *   click may buy it: an accepted gift, generation, Fatigue. Ordinary
 *   acquisition (a drop, Create Item, the shop) does NOT ask this verdict for a
 *   person: it refuses only a person who has no free slot already
 *   (`isEncumbered`), so a buy at 9/10 lands, bulky or not — a feature by the
 *   2026-07-18 ruling.
 * - `"full"` — a THING, a companion or a monster has no room. NOBODY may buy
 *   this, on either route. "Overflow is owed, never merely allowed" is a rule
 *   about a person being handed what the rules give them; a sack has no Hit
 *   Protection to pay the cost with, so there is no cost to consent to — only
 *   "it does not fit". It is also the only answer that keeps an offer from
 *   disagreeing with the drop handler's own ContainerFull refusal.
 *
 * @param {CairnActor} actor
 * @param {Number} need  slots the arriving item wants: bulky 2, weightless 0, else 1
 * @returns {"fits"|"overburden"|"full"}
 */
export const capacityVerdict = (actor, need) => {
  const used = actor?.system?.slotsUsed ?? 0;
  const max = actor?.system?.slotsMax ?? 0;
  // Weightless costs nothing and can never fill anything — the same exemption
  // `createOwnedItem` already makes.
  if (need <= 0) return "fits";
  if (actor?.livesByPlayerRules) return used + need >= max ? "overburden" : "fits";
  return used + need > max ? "full" : "fits";
};

/**
 * Must this character drop something before taking a Fatigue instead of
 * Critical Damage? Only when they are ALREADY overburdened.
 *
 * The gate on the Fatigue bargain, ruled three times on 2026-10-02/03: every
 * press asked ("the Fatigue has to be paid for"); then only when the Fatigue
 * would not fit — `capacityVerdict(actor, 1)`, so 9 of 10 asked; then, the
 * same night, only when they are already overburdened (user: "it only prompts
 * a character to drop something and requires them to do so if the player is
 * already overburdened"), because asking at 9 of 10 was "an undesired
 * situation". So a character at 9 of 10 takes the Fatigue without a word and
 * lands overburdened, at 0 Hit Protection, which the ruling accepts.
 *
 * "Overburdened" is `isEncumbered()` — no free slot, so 10 of 10 counts — the
 * one predicate HP 0 and every acquisition refusal already read.
 * @param {CairnActor} actor
 * @returns {Boolean}
 */
export const mustDropForFatigue = (actor) => actor?.isEncumbered?.() === true;

/**
 * Slots an item wants. Bulky 2 (`isBulky`, so the Shields are Bulky hack
 * counts), weightless 0, otherwise 1. Takes the item's `system` (or a gift
 * snapshot shaped like one).
 */
export const slotsNeeded = (itemLike) =>
  (isBulky(itemLike) ? 2 : itemLike?.weightless ? 0 : 1);

/**
 * The slots one arriving unit adds to `actor`, on the branch it will take: one
 * more of a matching stack costs what one of THAT stack costs, and anything
 * else costs its own size (review #34 finding 156 — a one-slot Rope merging
 * into a Bulky "Rope" adds two, and was priced at one). The `need` to hand
 * capacityVerdict for anything that lands through findMatchingStack.
 * @param {CairnActor} actor
 * @param {Object} itemLike  an item, or its source data
 * @returns {Number}
 */
export const landingNeed = (actor, itemLike) =>
  slotsNeeded((findMatchingStack(actor, itemLike) ?? itemLike).system);
