import { CairnActor } from "./actor/actor.js";
import { compendiumInfoFromString, drawTableText, resultText, findTableByName } from "./compendium.js";
import { Cairn } from "./config.js";
import { evaluateFormula, formatCount } from "./utils.js";
import {
  resolveGearItem, GEAR_ALIASES, spellScrollItem,
  orderGrantedItems, isLightGear, RATIONS_RE,
} from "./gear.js";
import { containerClass, iconForTransport } from "./icons.js";
import { connectionHeadroom, maxConnections, connectedOwnershipShape, OWNERSHIP_SYNC_FLAG } from "./connections.js";
import { SETTINGS_NS } from "./settings.js";
import { glogEnabled, GLOG_SPELL_PACKS } from "./glog.js";
import { PERSON_ROLES } from "./data-models.js";
import { t } from "./i18n-content.js";

// Foundry validates a document flag's scope against real package ids, so flags
// use the system id "air-bladder" (NOT the internal "cairn" JS/settings namespace,
// which is fine for game.settings but is rejected by Document#getFlag/setFlag).
/** Flag scope for grant provenance. Exported so other modules (the Kettlewright
 *  importer) tag and read the same namespace rather than hardcoding a copy. */
export const FLAG_SCOPE = "air-bladder";

/*
 * Cairn 2e character generation.
 *
 * Gear is NEVER inlined here: a background's starting gear, a bond's item, and a
 * choice-table option's items are all BY-NAME references into the editable gear
 * pool. `resolveGearItem` (module/gear.js) turns each reference into a fresh
 * owned-item payload cloned from the current pack document — so editing a pool
 * item flows into every character generated afterwards. That single-source-of-
 * truth is the whole reason this system was rebuilt off the fork's inlined model.
 */

/* -------------------------------------------------------------------------- */
/*  Portrait / token art                                                       */
/* -------------------------------------------------------------------------- */

// The manifest is a list of paired basenames that live in BOTH
// character_portraits/ and character_tokens/ (see tools/import/portraits.mjs).
// Fetched lazily and cached so neither generation nor the gallery needs the
// FILES_BROWSE permission that listing a server folder would require -- both run
// player-side.
let _portraitManifest = null;

/** @returns {Promise<{portraitDir:String, tokenDir:String, names:String[]}>} */
export const getPortraitManifest = async () => {
  if (_portraitManifest === null) {
    try {
      const resp = await fetch("systems/air-bladder/module/portrait-manifest.json");
      _portraitManifest = resp.ok ? await resp.json() : { names: [] };
    } catch {
      _portraitManifest = { names: [] };
    }
  }
  return _portraitManifest;
};

// The Game-Icons gallery: 2,275 game-icons.net glyphs in 38 categories, browsed
// category-first in the portrait picker (see tools/import/game-icons.mjs). Same
// lazy-fetch-and-cache shape as the portraits above, and for the same reason —
// a player picking art cannot enumerate a server folder. Kept here rather than
// in icons.js because that file is deliberately Foundry-free so the Node
// importers can import it; a fetch would end that.
let _gameIconManifest = null;

/** @returns {Promise<{iconDir:String, categories:{key:String, names:String[]}[]}>} */
export const getGameIconManifest = async () => {
  if (_gameIconManifest === null) {
    try {
      const resp = await fetch("systems/air-bladder/module/game-icons-manifest.json");
      _gameIconManifest = resp.ok ? await resp.json() : { categories: [] };
    } catch {
      _gameIconManifest = { categories: [] };
    }
  }
  return _gameIconManifest;
};

// The Tlomdev gallery: tlomdev's CC BY-SA 4.0 token drawings, browsed by the
// artist's own category folders, plus Kettlewright's copies under
// "kettlewright-portraits" (see tools/import/tlomdev.mjs). Same
// lazy-fetch-and-cache shape as the two above, for the same reason.
let _tlomdevManifest = null;

/** @returns {Promise<{artDir:String, categories:{key:String, names:String[]}[]}>} */
export const getTlomdevManifest = async () => {
  if (_tlomdevManifest === null) {
    try {
      const resp = await fetch("systems/air-bladder/module/tlomdev-manifest.json");
      _tlomdevManifest = resp.ok ? await resp.json() : { categories: [] };
    } catch {
      _tlomdevManifest = { categories: [] };
    }
  }
  return _tlomdevManifest;
};

// The Lydia Comer gallery: her monster art (© Lydia Comer, all rights reserved,
// by direct grant — NOT Creative Commons; see lydia-comer/license.txt). Same
// lazy-fetch-and-cache shape as the three above, for the same reason.
//
// Shaped unlike either of them: it is a PAIRED gallery, a flat list of
// {portrait, token} the way Aspeheim's is, not category folders. Each creature
// is a square drawing plus the circle-cropped token made from it, matched by
// stem. `pairs` holds BOTH filenames rather than one shared name the way
// portrait-manifest.json does — a habit from when the halves carried different
// extensions (.jpg square, .png circle), kept now that both are .webp because
// the two halves live in different folders and nothing should quietly depend on
// their names agreeing.
let _lydiaManifest = null;

/** @returns {Promise<{portraitDir:String, tokenDir:String, pairs:{portrait:String, token:String}[]}>} */
export const getLydiaManifest = async () => {
  if (_lydiaManifest === null) {
    try {
      const resp = await fetch("systems/air-bladder/module/lydia-manifest.json");
      _lydiaManifest = resp.ok ? await resp.json() : { pairs: [] };
    } catch {
      _lydiaManifest = { pairs: [] };
    }
  }
  return _lydiaManifest;
};

/** Full portrait paths for the Lydia gallery, in manifest order. */
const lydiaPortraits = (m) =>
  (m?.pairs ?? []).map((p) => `${m.portraitDir}/${p.portrait}`);

// --- Custom portraits (GM-curated, per-world local pool) --------------------
// A folder of the GM's own portraits, scanned into a world setting so players
// (who lack FILES_BROWSE) can still see and pick them. When non-empty it REPLACES
// the shipped art for auto-assignment; empty, everything falls back to Aspeheim.
// Custom portraits have no paired token file, so each image doubles as its token.

const IMAGE_RE = /\.(?:webp|png|jpe?g|gif|svg|avif|bmp)$/i;

// How far the custom-portrait scan walks, and how many folders it will visit.
// Both exist because the scan is one HTTP round trip per folder, run on the
// Warden's client while they wait, and the setting is a free-text path — point
// it at the data root by mistake and an uncapped walk would crawl the whole
// install. Six levels is deeper than anyone files portraits; 200 folders is far
// above a portrait collection and far below a Foundry data directory. Hitting
// either is warned about rather than passed over in silence, because a short
// list looks exactly like a small collection.
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_DIRS = 200;

/**
 * The FilePicker implementation. Named in full, not resolved through a
 * v13/v14 chain: the target is v14 and nothing older, and the global
 * `FilePicker` such a chain ends on is a deprecation shim (client.mjs:213,
 * 230). The same three-way lookup stood in art-picker.js and went with this
 * one.
 */
const filePicker = () => foundry.applications.apps.FilePicker.implementation;

/** The configured custom-portrait folder (data-root-relative), or "" if blank. */
export const customPortraitFolder = () =>
  String(game.settings.get(SETTINGS_NS, "custom-portrait-folder") ?? "").trim();

/**
 * The cached custom portrait image paths. Written by a GM refresh, read by anyone
 * — so players need no FILES_BROWSE to use custom portraits. Always a string[].
 * @returns {String[]}
 */
export const getCustomPortraitPaths = () => {
  const list = game.settings.get(SETTINGS_NS, "custom-portrait-list");
  return Array.isArray(list) ? list.filter((s) => typeof s === "string" && s) : [];
};

/* --- Reserved category folders (issue #18, fsmalecho) ----------------------
 * A Warden can keep one custom folder per KIND of thing being made: a folder
 * named `pc`, `npc`, `monster` or `companion` at the TOP LEVEL of the custom
 * folder becomes that category's auto-assignment pool. Everything else is one
 * general pool, which is what a Warden using none of these names has always
 * had.
 *
 * Reserved by CONVENTION rather than by four more settings, deliberately: it
 * would be four more rows in the Character Generation submenu, a
 * second folder setting is a second folder to scan on every Warden's login
 * (the scan is one HTTP round trip per directory, capped at 200), and the
 * picker already renders subfolders as tiles. Nothing here adds a register()
 * call, so the counts in CLAUDE.md stand.
 *
 * THE GENERAL POOL EXCLUDES THE RESERVED FOLDERS, and that is a ruling rather
 * than an implementation detail. If it did not, a Warden who filed only
 * `monster/` would have every player character generated from monster art —
 * the reserved folder would have made things worse for the one category they
 * had bothered to sort.
 *
 * No cross-category fallback either: a Warden with only `pc/` filled gets the
 * shipped art on NPCs, not their PC art. "NPCs borrow PC art but monsters do
 * not" is a rule nobody can hold in their head.
 *
 * TOP LEVEL only, so `Kindred/monster` is an ordinary folder — but anything
 * NESTED inside a reserved one counts toward it, which keeps the "file them
 * however you like" promise inside each category.
 *
 * `character`/`characters` is deliberately NOT reserved. It is the likeliest
 * name for a folder a Warden already uses to mean ALL their portraits, and
 * capturing it would silently take their NPC art away.
 */
export const PORTRAIT_CATEGORIES = ["pc", "npc", "monster", "companion"];

const RESERVED_FOLDERS = new Map([
  ["pc", "pc"], ["pcs", "pc"],
  ["npc", "npc"], ["npcs", "npc"],
  ["monster", "monster"], ["monsters", "monster"],
  ["companion", "companion"], ["companions", "companion"],
]);

/**
 * The category a top-level folder name reserves, or null for an ordinary one.
 * Percent-decoded first: `browse` hands back web paths, so a folder arrives as
 * "OSR%20Fantasy". None of the reserved names contains a character that
 * encodes, but decoding is what keeps that true of the COMPARISON rather than
 * true by luck.
 *
 * EXPORTED so the art picker can label a reserved folder tile without keeping
 * a second copy of the alias list. A second copy of one list is this project's
 * most-repeated bug: CREATURE_CATEGORIES, the settings groups and the pack
 * count have each gone stale that way.
 * @param {String} segment
 * @returns {String|null}
 */
export const reservedPortraitCategory = (segment) => {
  let name = String(segment ?? "");
  try { name = decodeURIComponent(name); } catch { /* malformed escape: match as written */ }
  return RESERVED_FOLDERS.get(name.trim().toLowerCase()) ?? null;
};

/**
 * The flat cached list, bucketed into the four reserved categories plus
 * `general`. Derived on every call rather than cached: the list changes under
 * a Warden's Refresh and there is no invalidation hook worth owning for a walk
 * over a few hundred strings.
 *
 * A path that does not sit under the configured root falls to GENERAL — the
 * same rule `splitCustomPaths` states in art-picker.js: a path this cannot
 * classify must never become a path this hides.
 * @returns {Object<String, String[]>}
 */
const customBuckets = () => {
  const root = customPortraitFolder().replace(/\/+$/, "");
  const prefix = root ? `${root}/` : "";
  const buckets = { general: [] };
  for (const cat of PORTRAIT_CATEGORIES) buckets[cat] = [];
  for (const p of getCustomPortraitPaths()) {
    const rest = prefix && p.startsWith(prefix) ? p.slice(prefix.length) : null;
    const cut = rest === null ? -1 : rest.indexOf("/");
    const cat = cut > 0 ? reservedPortraitCategory(rest.slice(0, cut)) : null;
    buckets[cat ?? "general"].push(p);
  }
  return buckets;
};

/**
 * The categories that inherit the GENERAL pool when they have no reserved
 * folder of their own — and the two that do not.
 *
 * The general pool is historically a pool of PEOPLE: until this change the
 * custom folder fed exactly three things, all of them someone with a face
 * (a player character, an npc person, a Kettlewright import). So `pc` and
 * `npc` inheriting it IS the old behaviour, unchanged for every Warden who
 * never adopts a reserved name.
 *
 * `monster` and `companion` deliberately do NOT inherit it, and that is the
 * opposite of what it looks like. Both already have a category-appropriate
 * shipped fallback — game-icons creature glyphs for a monster, the pack
 * document's own art or a class icon for a beast — and handing them the
 * general pool instead would mean a Warden with an unsorted folder of
 * portraits woke up to every generated monster wearing a shopkeeper's face
 * and every granted mule wearing a woman's. Neither of them ever drew from
 * this pool before; opting in by naming a folder is how they start.
 */
const GENERAL_POOL_CATEGORIES = new Set(["pc", "npc"]);

/**
 * The custom images a category may draw from: its own reserved folder when
 * that holds anything, else the general pool for the two categories above,
 * else nothing. Empty means "no custom art for this category" and the caller
 * falls back to whatever shipped art it owns — which is NOT the same art for
 * every category, so that fallback stays with the caller rather than being
 * decided here.
 *
 * `null` asks for the general pool outright, which is what an un-converted
 * caller gets and what every caller got before this existed.
 * @param {String|null} [category] one of PORTRAIT_CATEGORIES
 * @returns {String[]}
 */
export const customPoolFor = (category = null) => {
  const buckets = customBuckets();
  if (!category) return buckets.general;
  if (buckets[category]?.length) return buckets[category];
  return GENERAL_POOL_CATEGORIES.has(category) ? buckets.general : [];
};

/**
 * The portrait category an actor belongs to, or null for one that wears no
 * portrait at all (a cart, a chest — they take class icons from the container
 * gallery). BOTH person roles land on `npc`: a hireling SHARES the npc folder
 * (user ruling 2026-08-21), deliberately not a fifth reserved name — the
 * generator's own call sites have always passed "npc" for hirelings, and this
 * mapping said `role === "npc"` instead, which went stale the day the split
 * brought the hireling role back and sent the sheet die to the general pool.
 * @param {Actor} actor
 * @returns {String|null}
 */
export const portraitCategoryFor = (actor) => {
  if (!actor) return null;
  if (actor.type === "character") return "pc";
  const role = actor.npcRole
    ?? (["npc", "hireling"].includes(actor.type) ? (actor.system?.role || "npc") : null);
  if (role === "monster" || role === "companion") return role;
  return PERSON_ROLES.includes(role) ? "npc" : null;
};

/**
 * Ensure the custom-portrait folder exists (GM-side; needs FILES permission).
 * Non-fatal: a host that forbids creation just leaves it absent and the feature
 * falls back to shipped art. Never throws.
 */
export const ensureCustomPortraitFolder = async () => {
  const dir = customPortraitFolder();
  if (!dir) return;
  const FP = filePicker();
  try {
    await FP.browse("data", dir); // already there
  } catch {
    try { await FP.createDirectory("data", dir); }
    catch { /* permission/quirk — leave absent, shipped art still works */ }
  }
};

/**
 * Scan the custom-portrait folder and cache its image list into the world setting.
 * GM only (writing a world setting and listing a folder both require it). Returns
 * the fresh list; non-fatal — on failure keeps and returns the prior cache.
 * @returns {Promise<String[]>}
 */
export const refreshCustomPortraits = async () => {
  if (!game.user?.isGM) return getCustomPortraitPaths();
  const dir = customPortraitFolder();
  if (!dir) { await game.settings.set(SETTINGS_NS, "custom-portrait-list", []); return []; }
  try {
    const FP = filePicker();
    const root = await FP.browse("data", dir);
    const files = (root?.files ?? []).filter((f) => IMAGE_RE.test(f));
    // SUBFOLDERS, to any depth (2026-08-14, user report, twice). `browse`
    // returns `{dirs, files}` for the target directory ALONE and does not
    // recurse — and this read only `files`, throwing the folder list away. A
    // Warden who had organised their portraits into category folders
    // (clerics-paladins, thieves, magic-users…) therefore got a browse that
    // returned eleven dirs and zero files, an empty cache, and a picker reading
    // "No custom portraits found" over a folder that was full. The information
    // was already arriving; nothing was reading it.
    //
    // The first fix walked ONE level, on the reasoning that one level is what
    // the shipped galleries use. That reasoning was about OUR folders, not the
    // Warden's: a folder inside a category folder is an ordinary way to file
    // art, and on the live server it produced the same silent nothing the
    // original bug did — a category tile that simply never appeared. So the
    // walk is now breadth-first to `MAX_SCAN_DEPTH`, and the limits are stated
    // in the constants rather than implied by the code.
    //
    // A failed subfolder is skipped, not fatal: one unreadable folder must not
    // cost the Warden every other portrait they have. `seen` guards against a
    // directory link that points back up its own tree — the walk is over paths,
    // so a cycle would otherwise never terminate.
    const seen = new Set([dir]);
    const queue = (root?.dirs ?? []).map((path) => ({ path, depth: 1 }));
    let scanned = 0;
    let truncated = false;
    while (queue.length) {
      const { path, depth } = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      if (++scanned > MAX_SCAN_DIRS) { truncated = true; break; }
      let res;
      try {
        res = await FP.browse("data", path);
      } catch (e) {
        console.warn(`Air Bladder | could not scan custom portrait subfolder ${path}:`, e);
        continue;
      }
      files.push(...(res?.files ?? []).filter((f) => IMAGE_RE.test(f)));
      const subs = res?.dirs ?? [];
      if (depth < MAX_SCAN_DEPTH) queue.push(...subs.map((p) => ({ path: p, depth: depth + 1 })));
      else if (subs.length) truncated = true;
    }
    if (truncated) {
      console.warn(`Air Bladder | custom portrait scan stopped early in "${dir}" — `
        + `more than ${MAX_SCAN_DIRS} folders or deeper than ${MAX_SCAN_DEPTH} levels. `
        + "Some portraits will be missing from the Custom tab.");
    }
    await game.settings.set(SETTINGS_NS, "custom-portrait-list", files);
    return files;
  } catch (e) {
    console.warn("Air Bladder | could not scan custom portrait folder:", e);
    return getCustomPortraitPaths();
  }
};

/**
 * The tlomdev category every generated actor's portrait is drawn from
 * (user ruling 2026-08-18, replacing the Aspeheim pairs for characters, NPCs
 * and hirelings alike). 70 drawings of people; the sibling folders are beasts,
 * statues and the like, so the KEY is the whole of the decision.
 */
const DEFAULT_PORTRAIT_CATEGORY = "humanoid";

/**
 * Every path in the default portrait category, or [] when the manifest is
 * missing or has been re-keyed. Callers treat empty as "no shipped pool".
 * @returns {Promise<String[]>}
 */
const defaultPortraitPool = async () => {
  const tl = await getTlomdevManifest();
  const dir = tl?.artDir ?? "systems/air-bladder/art/tlomdev";
  const cat = (tl?.categories ?? []).find((c) => c.key === DEFAULT_PORTRAIT_CATEGORY);
  return (cat?.names ?? []).map((n) => `${dir}/${DEFAULT_PORTRAIT_CATEGORY}/${n}`);
};

/**
 * A random {img, token} portrait pair for a new character/hireling/npc. Draws
 * ONLY from the GM's custom pool when it is non-empty; otherwise from tlomdev's
 * `humanoid` folder. Null only if BOTH are empty.
 *
 * `category` picks WHICH custom pool (issue #18): a reserved `pc/` or `npc/`
 * folder when the Warden keeps one, else the general pool. Omitting it asks
 * for the general pool, which is what every caller got before categories
 * existed — so an un-converted caller behaves exactly as it always did. The
 * shipped fallback is NOT category-aware and must not become so here: monsters
 * have their own (game-icons creatures, in monster-generator.js) and would be
 * badly served by 70 drawings of people.
 *
 * THE TOKEN IS THE PORTRAIT. Aspeheim's gallery was the one paired set this
 * drew from — two folders sharing a filename, a 1000px face and a 256px token
 * drawn for the canvas — and tlomdev ships no token half, so a drawing is its
 * own token exactly as a custom upload is. That is a real loss of the prepped
 * canvas art and it was accepted at ruling time; the 240px source is already
 * token-sized, and the sheet portrait renders well below its own resolution.
 *
 * Aspeheim's gallery still SHIPS and is still offered in the picker for every
 * face-wearing role — this changes what generation ASSIGNS, nothing else. And
 * nothing rewrites an existing actor: an img is copied onto the document at
 * creation and never re-read, so every character made before today keeps the
 * portrait and paired token it already has.
 * @param {String|null} [category] one of PORTRAIT_CATEGORIES
 * @returns {Promise<{img:String, token:String}|null>}
 */
export const randomPortraitPair = async (category = null) => {
  const custom = customPoolFor(category);
  const pool = custom.length ? custom : await defaultPortraitPool();
  if (!pool.length) return null;
  const path = pool[Math.floor(Math.random() * pool.length)];
  return { img: path, token: path };
};

/**
 * The prepped token image paired with a portrait path, or null when the
 * portrait isn't from one of the two PAIRED galleries (e.g. a custom upload, a
 * game-icons glyph, a tlomdev drawing — each of which is its own token).
 * Callers decide the fallback.
 *
 * TWO galleries answer here. Aspeheim's halves share one filename across two
 * folders, so a basename lookup settles it. Lydia's manifest names both halves
 * and the lookup is by the PORTRAIT filename — which was load-bearing while the
 * halves were .jpg and .png, and is merely honest now that both are .webp.
 * Matching on the DIRECTORY as well as the name is the part that still matters:
 * an Aspeheim and a Lydia file could in principle share a stem, and the answer
 * must not depend on which gallery is consulted first.
 * @param {String} portraitPath
 * @returns {Promise<String|null>}
 */
export const pairedTokenFor = async (portraitPath) => {
  const src = String(portraitPath ?? "");
  const base = src.split("/").pop();

  const m = await getPortraitManifest();
  if (m?.names?.includes(base) && src === `${m.portraitDir}/${base}`) return `${m.tokenDir}/${base}`;

  const l = await getLydiaManifest();
  const pair = (l?.pairs ?? []).find((p) => src === `${l.portraitDir}/${p.portrait}`);
  return pair ? `${l.tokenDir}/${pair.token}` : null;
};

/**
 * The pool `img` belongs to inside a category gallery (game-icons or tlomdev):
 * every file of the category the image sits in, or null when it is not from
 * one. Membership is checked against the MANIFEST, not just the path shape, so
 * a stale path to a renamed file falls through to the caller's fallback.
 */
const categoryPoolFor = (img, dir, categories) => {
  if (!dir || !img.startsWith(`${dir}/`)) return null;
  const rest = img.slice(dir.length + 1);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const key = rest.slice(0, slash);
  const cat = categories.find((c) => c.key === key);
  return cat?.names?.includes(rest.slice(slash + 1))
    ? cat.names.map((n) => `${dir}/${key}/${n}`)
    : null;
};

/**
 * The portrait die re-rolls WITHIN THE FOLDER the current portrait came from:
 * an Aspeheim face rolls another Aspeheim face, a custom portrait another from
 * the Warden's folder, a game-icons or tlomdev pick another from the SAME
 * CATEGORY — a beast stays a beast rather than turning into a librarian's
 * portrait. Only when the current image is from no known gallery folder (the
 * default mystery-man, a pasted URL, a Kind glyph) does it fall back to the
 * auto-assignment pool (custom when non-empty, else the generator's own default
 * folder), which was the die's whole behaviour before this rule.
 *
 * Avoids returning the current image while the pool holds anything else, so
 * the die always visibly does something.
 *
 * `category` scopes the CUSTOM half (issue #18). The promise in the first
 * sentence was never kept for custom art: every custom image was one folder as
 * far as this function was concerned, so the die on a monster wearing the
 * Warden's art could hand it a shopkeeper's face. With a reserved folder in
 * play the pool is that folder, so a monster stays a monster — the same
 * promise the category galleries below already make.
 * @param {String} current the actor's current img
 * @param {String|null} [category] one of PORTRAIT_CATEGORIES, from portraitCategoryFor
 * @returns {Promise<String|null>} a portrait src, or null when every pool is empty
 */
export const randomPortraitInSameFolder = async (current, category = null) => {
  const img = String(current ?? "");
  const m = await getPortraitManifest();
  const portraitDir = m?.portraitDir ?? "systems/air-bladder/art/jon-aspeheim/portraits";
  const aspeheim = (m?.names ?? []).map((n) => `${portraitDir}/${n}`);
  const custom = customPoolFor(category);
  // The WHOLE cached list, only to answer "is this image custom art at all".
  // `customPoolFor` can legitimately return nothing (a monster in a world with
  // no `monster/` folder inherits no general pool), and testing membership
  // against that would send a monster wearing the Warden's own art down to the
  // bottom fallback and hand it a tlomdev human. Today that case re-rolls
  // inside the custom folder, and it still does.
  const customAll = getCustomPortraitPaths();

  let pool = null;
  if (aspeheim.includes(img)) pool = aspeheim;
  if (!pool && customAll.includes(img)) pool = custom.length ? custom : customAll;
  if (!pool) {
    // Lydia's gallery is flat, so the whole of it is the folder — a dragon can
    // roll into a were-rat, which is the same promise the category galleries
    // make one folder down. It is never the FALLBACK pool at the bottom of this
    // function, though: these are creatures, and the die on an actor wearing no
    // known art must not turn a hireling into a black pudding.
    const l = await getLydiaManifest();
    const lydia = lydiaPortraits(l);
    if (lydia.includes(img)) pool = lydia;
  }
  if (!pool) {
    const gi = await getGameIconManifest();
    pool = categoryPoolFor(img, gi?.iconDir ?? "systems/air-bladder/art/game-icons", gi?.categories ?? []);
  }
  if (!pool) {
    const tl = await getTlomdevManifest();
    pool = categoryPoolFor(img, tl?.artDir ?? "systems/air-bladder/art/tlomdev", tl?.categories ?? []);
  }
  // Unknown art falls back to whatever GENERATION would have assigned, so the
  // die and the generator cannot disagree about what the house pool is. That is
  // tlomdev's `humanoid` folder since 2026-08-18 — it was Aspeheim before, and
  // an Aspeheim portrait still re-rolls within Aspeheim above, because the
  // gallery still ships and this branch is only for art from no known folder.
  if (!pool) pool = custom.length ? custom : await defaultPortraitPool();

  if (!pool.length) return null;
  const others = pool.filter((src) => src !== img);
  const choices = others.length ? others : pool;
  return choices[Math.floor(Math.random() * choices.length)];
};

/**
 * The shipped tlomdev copy of a Kettlewright stock portrait ("portrait17.webp"),
 * or null when the name is not in the shipped set. The Kettlewright importer
 * maps stock picks through this — the filenames under
 * tlomdev/kettlewright-portraits/ are Kettlewright's own numbering on purpose.
 * @param {String} name a bare filename as Kettlewright's export stores it
 * @returns {Promise<String|null>}
 */
export const kettlewrightPortraitPath = async (name) => {
  const tl = await getTlomdevManifest();
  const cat = tl?.categories?.find((c) => c.key === "kettlewright-portraits");
  return cat?.names?.includes(name) ? `${tl.artDir}/${cat.key}/${name}` : null;
};

/* -------------------------------------------------------------------------- */
/*  Shared dice/table rolls                                                    */
/* -------------------------------------------------------------------------- */

/*
 * These three return the evaluated Roll, NOT its total, so the generation chat
 * card (postGenerationRolls) can hand the real Roll objects to ChatMessage and
 * let Dice So Nice animate them. Callers read `.total` themselves. rollAge is
 * deliberately NOT part of this: age is excluded from the card, and it answers
 * with a NUMBER off the Warden's age-formula setting, not a Roll.
 */

/** @param {String} formula @returns {Promise<{STR:Roll,DEX:Roll,WIL:Roll}>} */
export const rollAbilities = async (formula) => ({
  STR: await evaluateFormula(formula),
  DEX: await evaluateFormula(formula),
  WIL: await evaluateFormula(formula),
});

/** @param {String} formula @returns {Promise<Roll>} */
export const rollHitProtection = async (formula) => evaluateFormula(formula);

/** @param {String} formula @returns {Promise<Roll>} */
export const rollGold = async (formula) => evaluateFormula(formula);

/**
 * Roll an age from the Warden's `age-formula` setting, falling back to the
 * caller's formula (the config's one copy, RAW `2d20 + 10`) when the
 * setting is blank or does not parse.
 *
 * This REPLACED the min-age/max-age clamp (2026-08-21, issue #21 both ways —
 * fsmalecho asked for the ceiling AND then reported what clamping did):
 * holding 2d20 + 10 under a ceiling of 30 made ~57% of rolls exactly 30,
 * because a clamp piles the distribution onto its bound. The cap worked as
 * coded; the design was the defect. The Warden edits the DICE now, so a
 * chosen range arrives as a spread — and with no bounds left to conflict,
 * the floor-wins ruling retired with them. A retired min-age or max-age
 * world row is orphaned data, never read again and never reused as a key.
 *
 * Blank falls back SILENTLY — blank is "reset to default", not a mistake. A
 * non-blank formula that fails Roll.validate falls back too and WARNS,
 * naming the rejected text: a typo the Warden never hears about is just
 * "the setting does nothing". Validation is on the RAW text, which is right
 * in both dice-notation dialects — the Cairn keep-highest rewrite only maps
 * valid arithmetic to valid pool syntax. A formula carrying an `@` reference
 * is refused the same way, BEFORE Roll.validate gets a say — see the guard
 * below for why the validator cannot be trusted about that class.
 *
 * ROLLS ONLY, and deliberately. Age is a free-text input on the sheet
 * (templates/parts/bio-block.html) with this die beside it, so a hand-typed
 * age is nobody's business but the player's — the old bounds never
 * constrained it and the formula does not either. Since 2026-08-21 an
 * IMPORTED age is verbatim too (kettlewright-import.js): parsed, not rolled.
 *
 * The single choke point for age: all four generation call sites and the
 * sheet's re-roll come through here, so the setting lands everywhere at once.
 * @param {String} fallback @returns {Promise<Number>}
 */
export const rollAge = async (fallback) => {
  const { formula, configured, usable } = effectiveAgeFormula(fallback);
  if (!usable && configured) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.BadAgeFormula", { formula: configured }));
  }
  return (await evaluateFormula(formula)).total;
};

/**
 * The formula the age die will ACTUALLY roll: the Warden's `age-formula`
 * setting when it is set and usable, else `fallback`. ONE answer for the die
 * above and for the sheet's tooltip beside Age (review #18 finding 10: the
 * tooltip said "(2d20 + 10)" while the die obeyed the setting), so the two
 * cannot disagree — the tooltip shows what a click will roll, fallback
 * included.
 *
 * `usable` is the test rollAge always applied, moved here whole. `@`
 * references are refused before validation — warden-damage.js's guard, copied
 * because the same two client stubs make Roll.validate lie about the whole
 * class: it replaces every `@ref` with "1" before evaluating
 * (dice/roll.mjs:772-790) so it ACCEPTS them, while real evaluation resolves
 * them with `{missing: "0"}` (:689-701) — so "2d20 + @bonus" passed the gate
 * and rolled "2d20 + 0", and "@x + 3" made every age exactly 3, with the
 * warn-and-fall-back contract unreachable for the one input class that needed
 * it most (review #17). Generation has no actor to resolve against, so
 * refusing is the honest answer, not a workaround.
 * @param {string} fallback
 * @returns {{formula: string, configured: string, usable: boolean}}
 *   `configured` is the trimmed setting (blank when unset), for the warning.
 */
export const effectiveAgeFormula = (fallback) => {
  const configured = String(game.settings.get(SETTINGS_NS, "age-formula") ?? "").trim();
  const candidate = configured || String(fallback ?? "");
  const usable = !candidate.includes("@") && Roll.validate(candidate);
  return { formula: usable ? candidate : fallback, configured, usable };
};

/**
 * Draw one text result from each named table (used for the eight 2e traits).
 * @param {Object<string,string>} items  key -> "pack;TableName"
 * @returns {Promise<Object<string,string>>}
 */
export const rollTextItems = async (items) => {
  const data = {};
  for (const [key, value] of Object.entries(items)) {
    const [compendium, table] = compendiumInfoFromString(value);
    data[key] = await drawTableText(compendium, table);
  }
  return data;
};

/**
 * Roll a name off a name table, given a "pack;Table Name" config string. Cairn 2e
 * dropped 1e's name tables, so everything that needs a random person's name — a
 * hireling, a Barebones character — draws from the Warden NPC name table. Uses
 * roll(), never draw(), so the table's drawn state is never mutated.
 * @param {String} config  "packId;Table Name"
 * @param {String} fallback  used when the table is missing or empty
 * @returns {Promise<String>}
 */
export const rollNameFromTable = async (config, fallback) => {
  const [packName, tableName] = compendiumInfoFromString(config);
  const pack = game.packs.get(packName);
  const table = pack ? (await pack.getDocuments()).find((t) => t.name === tableName) : null;
  if (!table) return fallback;
  const { results } = await table.roll();
  return resultText(results[0]).trim() || fallback;
};

/* -------------------------------------------------------------------------- */
/*  Gear references -> owned items                                             */
/* -------------------------------------------------------------------------- */

/**
 * Turn a snapshot (a frozen copy of an item, as authored on a custom background
 * via drag-to-snapshot) into a fresh owned-item payload. This is the portable
 * counterpart to by-name resolution: the item travels *inside* the background, so
 * a GM's one-off gear resolves even on a table that has never seen it. Per-grant
 * quantity/uses still override, exactly as by-name resolution does.
 * @param {Object} data  a serialized item {name, type, img, system}
 * @param {{quantity?:Number, uses?:Number}} [overrides]
 * @returns {Object}
 */
const ownedFromSnapshot = (data, { quantity, uses } = {}) => {
  const system = foundry.utils.deepClone(data.system ?? {});
  system.quantity = quantity ?? system.quantity ?? 1;
  system.equipped = false;
  if (uses != null) system.uses = { value: uses, max: uses };
  return { name: data.name, type: data.type ?? "item", img: data.img, system };
};

/**
 * Resolve one gear reference to an owned-item payload, or null on a miss
 * (resolveGearItem warns). A reference is EITHER a snapshot (`itemData`, a frozen
 * copy authored on a custom background — self-contained, always resolves) OR a
 * by-name pointer {name, quantity?, uses?} into the canonical packs. The
 * `uses`/`quantity` on a reference override, letting two backgrounds grant the
 * same item with different counts.
 * @param {{name:String, quantity?:Number, uses?:Number, itemData?:Object}} ref
 * @returns {Promise<Object|null>}
 */
const resolveRef = (ref) =>
  ref?.itemData
    ? Promise.resolve(ownedFromSnapshot(ref.itemData, { quantity: ref.quantity ?? 1, uses: ref.uses }))
    : resolveGearItem(ref.name, { quantity: ref.quantity ?? 1, uses: ref.uses });

/** Resolve an array of references, dropping any that miss. @returns {Promise<Object[]>} */
export const resolveRefs = async (refs) =>
  (await Promise.all((refs ?? []).map(resolveRef))).filter(Boolean);

/**
 * Tag a built item with the generation source that granted it, so the sheet can
 * later find and remove exactly those items when that source is re-rolled (a
 * specific bond or background question). Starting gear carries the "background"
 * source; base/bought gear carries none and is never touched by a re-roll.
 * @param {Object} item @param {String} source  e.g. "bond:<id>" or "question:0"
 */
export const withGrantSource = (item, source) => ({
  ...item,
  flags: { ...(item.flags ?? {}), [FLAG_SCOPE]: { ...(item.flags?.[FLAG_SCOPE] ?? {}), grantSource: source } },
});

/**
 * Mundane background gear that needs no "Background" source chip — light and
 * food whose provenance nobody tracks. Left untagged on purpose.
 *
 * Asked of the SHARED classification in gear.js rather than of a second regex
 * of its own, so "what counts as a light" is decided in one place: the ordering
 * rules and this rule were two overlapping lists, and a third copy of a list is
 * a third thing to drift. One consequence, intended rather than incidental —
 * the old regex named only rations, torches and lanterns, so a granted CANDLE
 * wore a Background chip until now and no longer does. That is exactly what the
 * sentence above says should happen to it.
 *
 * PC path only: buildNpcItems tags every grant it makes, chip or no chip,
 * because an untagged grant is indistinguishable from a Warden's own gift and
 * would survive every re-roll.
 */
const isUntaggedMundaneGear = (name) =>
  RATIONS_RE.test(String(name ?? "")) || isLightGear(name);

/** Tag built starting gear "background" (so it can show a source chip later),
 *  EXCEPT the mundane items above, which stay untagged. */
const tagBackgroundGear = (items) =>
  items.map((it) => (isUntaggedMundaneGear(it.name) ? it : withGrantSource(it, "background")));

/* -------------------------------------------------------------------------- */
/*  Bonds                                                                       */
/* -------------------------------------------------------------------------- */

/** The shipped 2e Bonds table. */
const shippedBondsTable = async () => {
  const pack = game.packs.get("air-bladder.tables-2e");
  return pack ? (await pack.getDocuments()).find((t) => t.name === "Bonds") ?? null : null;
};

/**
 * A bond's identity, for telling two of them apart. A stored bond keeps no
 * reference to the table row it came from — only prose, gold and an id minted at
 * draw time — so the text is all there is to compare, and it is enough: two rows
 * carrying identical text would be the same bond by any reading a player has.
 */
const bondKey = (text) => String(text ?? "").trim().toLowerCase();

/**
 * How many times a duplicate draw is re-rolled before the duplicate is accepted.
 *
 * A CAP, not a preference. A custom background may name a bonds table with fewer
 * rows than the character is entitled to bonds — one row is legal and narratively
 * fine — and there every draw is a duplicate, so an unbounded loop would hang
 * generation on content the Warden is allowed to author. Ten attempts costs
 * nothing (a table roll is local) and on the shipped 20-row table the odds of
 * stopping on a duplicate by chance are (1/20)^10.
 *
 * When the cap IS reached the duplicate is returned rather than null: a repeated
 * bond is a nuisance, a missing one leaves the character short of what the rules
 * owe them, and the second is the worse failure.
 */
const BOND_DRAW_ATTEMPTS = 10;

/**
 * Draw a Cairn 2e bond. With no argument this is the shipped `tables-2e` "Bonds"
 * table, whose each result carries its mechanical payload in flags.air-bladder
 * (starting gold and a gear reference, resolved here); the result text is the
 * narrative. Uses roll(), never draw(), so the table's drawn state is never mutated.
 *
 * `tableName` is a custom background's own bonds table. Such a table is NARRATIVE
 * ONLY by design: Foundry's RollTable UI cannot author custom flags, so a hand-made
 * row has no gold and no gear — and rather than invent structure by parsing its prose,
 * the payload simply comes back empty and the text carries the meaning, which is the
 * same call the system makes everywhere else about mechanical text. The shipped table
 * keeps its automatic payload because the importer writes those flags.
 *
 * A named table that cannot be found falls back to the shipped one, so a typo or a
 * table left behind when a background was shared degrades to a normal 2e bond rather
 * than to no bond at all.
 *
 * `avoid` is the text of bonds the character already holds; a draw matching one of
 * them is re-rolled, up to BOND_DRAW_ATTEMPTS. Every caller passes it — generation
 * rolling a Fieldwarden's two bonds, the sheet's re-roll, the sheet's "Add a bond" —
 * because the rule is the same wherever a second bond comes from, and a character
 * holding one bond twice is a generation nobody wants to keep.
 * @param {String} [tableName]
 * @param {Object} [options]
 * @param {String[]} [options.avoid]  descriptions already held
 * @returns {Promise<{description:String, gold:Number, items:Object[]}|null>}
 */
export const drawBond = async (tableName, { avoid = [] } = {}) => {
  const wanted = String(tableName ?? "").trim();
  // World-first, by name — the rationale lives on findTableByName.
  let table = wanted ? await findTableByName(wanted) : null;
  if (wanted && !table) {
    console.warn(`Air Bladder | no RollTable named "${wanted}" — falling back to the 2e Bonds table`);
  }
  table ??= await shippedBondsTable();
  if (!table) return null;

  // Re-roll a repeat. `taken` is built once; the table is not mutated by roll(),
  // so each attempt is an independent draw over the whole table.
  const taken = new Set((avoid ?? []).map(bondKey).filter((k) => k));
  let result = null;
  for (let attempt = 0; attempt < BOND_DRAW_ATTEMPTS; attempt++) {
    const { results } = await table.roll();
    result = results[0] ?? null;
    if (!result) return null;
    if (!taken.has(bondKey(resultText(result)))) break;
  }
  if (!result) return null;
  return {
    description: resultText(result),
    gold: result.getFlag(FLAG_SCOPE, "gold") ?? 0,
    // Items are unflagged here; bondRecordFrom tags them with the bond's id.
    items: await resolveRefs(result.getFlag(FLAG_SCOPE, "items") ?? []),
  };
};

/**
 * Wrap a drawn bond in a record with a stable id, and source-tag its items with
 * that id (`bond:<id>`) so the sheet can re-roll or remove one bond among several
 * and keep the inventory in sync. A character can hold several bonds (Fieldwarden
 * always rolls twice; Outrider's "Always pay your debts" option does too).
 * @param {{description:String, gold:Number, items:Object[]}} drawn
 */
export const bondRecordFrom = (drawn) => {
  if (!drawn) return null;   // no Bonds table / no result — don't fabricate a blank bond
  const id = foundry.utils.randomID();
  return {
    bond: { id, description: drawn.description ?? "", gold: drawn.gold ?? 0 },
    items: (drawn.items ?? []).map((it) => withGrantSource(it, `bond:${id}`)),
  };
};

/** Does this text instruct rolling another bond? (Fieldwarden bg, Outrider option.) */
export const mentionsSecondBond = (text) =>
  /roll a second time on the bonds table/i.test(String(text ?? ""));

/**
 * How many bonds a 2e character with this background and these question
 * answers may hold. THE rule, in one place: generation rolls this many, the
 * sheet's "Add a bond" stops at it, and changeBackground clamps down to it.
 * It lived as two hand-kept twins (here and the sheet) that agreed only by
 * luck until 2026-08-02.
 *
 * The background-level extra is an OR, not a sum: a custom background may
 * carry the `secondBond` checkbox AND describe it in prose, and that must
 * still be one extra bond, not two. Per-question extras stay a sum — each
 * rolled answer that says to roll again really does add one.
 * @param {CairnItem|null} bg the background item (null: base entitlement)
 * @param {{answer: String}[]} [questions] the stored/rolled question answers
 * @returns {Number}
 */
export const bondEntitlement = (bg, questions = []) => {
  const bgSecond =
    bg?.system?.secondBond || mentionsSecondBond(bg?.system?.description) ? 1 : 0;
  const qSecond = (questions ?? []).filter((q) => mentionsSecondBond(q.answer ?? "")).length;
  return 1 + bgSecond + qSecond;
};

/* -------------------------------------------------------------------------- */
/*  Background choice tables                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Roll each of a background's two d6 choice tables (e.g. "What went horribly
 * wrong?") and collect what the rolled option grants: narrative, gear (resolved
 * against the pool), and bonus gold. Each table becomes a structured
 * {question, answer, gold} entry, index-aligned with bg.system.tables, so the
 * sheet can re-roll one question in isolation later; its items are tagged
 * question:<i>.
 *
 * An option may also grant a CONTAINER (Kettlewright's donkey, Outrider's horse,
 * Bonekeeper's burial wagon). A container is an Actor, not an embedded item, so
 * those specs are only collected here and minted once the character Actor exists
 * — see grantContainers.
 * @param {CairnItem} bg
 * @returns {Promise<{questions:{question:String,answer:String,gold:Number}[], items:Object[], containers:Object[], gold:Number}>}
 */
export const applyChoiceTables = async (bg) => {
  const out = { questions: [], items: [], containers: [], gold: 0 };
  const tables = bg.system.tables ?? [];
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const options = table.options ?? [];
    if (!options.length) {
      out.questions.push({ question: table.question ?? "", answer: "", gold: 0 });
      continue;
    }
    const roll = await evaluateFormula(`1d${options.length}`);
    const opt = options[roll.total - 1] ?? options[0];
    const gold = opt.bonusGold ?? 0;
    const items = (await resolveRefs(opt.items)).map((it) => withGrantSource(it, `question:${i}`));
    out.items.push(...items);
    // The option's own prose rides along with the container spec. What the
    // background PROMISED about this beast — "4 HP. +6 slots (only +2 slots if
    // carrying two people)" — belongs ON the beast, not only in the question
    // list on the character it is connected to.
    out.containers.push(...(opt.containers ?? []).map((c) => ({
      ...c, grantSource: `question:${i}`,
    })));
    out.gold += gold;
    out.questions.push({ question: table.question ?? "", answer: opt.description ?? "", gold });
  }
  return out;
};

/* -------------------------------------------------------------------------- */
/*  Authoring preview / linter                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How a single gear/option reference would resolve at generation. A snapshot is
 * self-contained; an instruction row rolls a random item; a by-name reference
 * resolves only if the canonical packs carry that name; an empty name never
 * resolves. This is the check the sheet's preview surfaces so a grant that would
 * silently vanish (resolveGearItem returns null on a miss, resolveRefs drops it)
 * becomes visible before it reaches a player — or another GM.
 * @returns {Promise<"snapshot"|"rolled"|"name"|"missing"|"empty">}
 */
const classifyRef = async (ref) => {
  if (ref?.itemData) return "snapshot";
  const lower = String(ref?.name ?? "").trim().toLowerCase();
  if (!lower) return "empty";
  if (INSTRUCTION_ROWS.has(lower)) return "rolled";
  return (await resolveGearItem(ref.name)) ? "name" : "missing";
};

/**
 * A dry-run report on a draft background, powering the sheet's "Test ×10" button.
 * Two halves, no actor created and nothing persisted:
 *  - a STATIC lint (deterministic): every starting-gear ref and every table-option
 *    item classified snapshot/rolled/name/missing/empty, plus discovery checks
 *    (source must be "2e", an archetype, at least one example name). This is the
 *    pre-share, is-it-self-contained linter (docs/custom-backgrounds-plan.md §7/§9).
 *  - a SAMPLING run (n iterations of the REAL applyChoiceTables): which of each
 *    table's six options fired and the choice-gold spread, so a Warden sees the
 *    shape of what they built.
 * @param {CairnItem} bg
 * @param {Number} [n=10]
 * @returns {Promise<Object>}
 */
export const previewBackground = async (bg, n = 10) => {
  const problems = [];
  const sys = bg.system ?? {};

  if (sys.source !== "2e") problems.push({ level: "warn", msg: game.i18n.localize("CAIRN.BgAuthor.LintSource") });
  if (!sys.archetype) problems.push({ level: "warn", msg: game.i18n.localize("CAIRN.BgAuthor.LintArchetype") });
  if (!(sys.names ?? []).some((s) => String(s).trim())) problems.push({ level: "warn", msg: game.i18n.localize("CAIRN.BgAuthor.LintNames") });

  const gear = [];
  for (const ref of sys.startingGear ?? []) {
    const kind = await classifyRef(ref);
    gear.push({ name: ref.name ?? "", kind });
    if (kind === "missing") problems.push({ level: "error", msg: game.i18n.format("CAIRN.BgAuthor.LintMissingGear", { name: ref.name }) });
    if (kind === "empty") problems.push({ level: "warn", msg: game.i18n.localize("CAIRN.BgAuthor.LintEmptyGear") });
  }

  const tables = [];
  const rawTables = sys.tables ?? [];
  for (let ti = 0; ti < rawTables.length; ti++) {
    const options = [];
    for (let oi = 0; oi < (rawTables[ti].options ?? []).length; oi++) {
      const opt = rawTables[ti].options[oi];
      const items = [];
      for (const it of opt.items ?? []) {
        const kind = await classifyRef(it);
        items.push({ name: it.name ?? "", kind });
        if (kind === "missing") problems.push({ level: "error", msg: game.i18n.format("CAIRN.BgAuthor.LintMissingOption", { t: ti + 1, o: oi + 1, name: it.name }) });
      }
      const blank = !String(opt.description ?? "").trim() && !items.length && !(opt.bonusGold > 0) && !(opt.containers ?? []).length;
      if (blank) problems.push({ level: "warn", msg: game.i18n.format("CAIRN.BgAuthor.LintEmptyOption", { t: ti + 1, o: oi + 1 }) });
      options.push({ description: opt.description ?? "", bonusGold: opt.bonusGold ?? 0, items, blank });
    }
    tables.push({ question: rawTables[ti].question ?? "", options, fired: new Array(options.length).fill(0) });
  }

  let goldMin = Infinity, goldMax = -Infinity, goldSum = 0;
  for (let i = 0; i < n; i++) {
    const choices = await applyChoiceTables(bg);
    const g = choices.gold ?? 0;
    goldSum += g; goldMin = Math.min(goldMin, g); goldMax = Math.max(goldMax, g);
    choices.questions.forEach((q, ti) => {
      const idx = tables[ti]?.options.findIndex((o) => o.description === q.answer) ?? -1;
      if (idx >= 0) tables[ti].fired[idx] += 1;
    });
  }
  const sampling = {
    n,
    goldMin: goldMin === Infinity ? 0 : goldMin,
    goldMax: goldMax === -Infinity ? 0 : goldMax,
    goldAvg: n ? Math.round(goldSum / n) : 0,
  };

  return { name: bg.name, gear, tables, sampling, problems };
};

/* -------------------------------------------------------------------------- */
/*  Duplicate a background into an editable world pack                         */
/* -------------------------------------------------------------------------- */

/** The world Item compendium custom backgrounds are duplicated into. */
const CUSTOM_BG_PACK = "world.custom-backgrounds";

/**
 * The GM's editable "Custom Backgrounds" world compendium, created on first use.
 * A world pack (never a system pack — Foundry overwrites those on update) is the
 * only place user backgrounds survive; the discovery scan finds them there
 * regardless of pack name, so this is purely a predictable, auto-created home.
 * @returns {Promise<CompendiumCollection|null>}
 */
const ensureCustomBackgroundPack = async () => {
  const existing = game.packs.get(CUSTOM_BG_PACK);
  if (existing) return existing;
  // The label is stored on the pack, so it is fixed in whatever language the
  // Warden was running when it was first created — Foundry has no i18n for
  // world-compendium labels. Localizing here at least means a Spanish Warden's
  // world does not acquire an English compendium out of nowhere.
  return foundry.documents.collections.CompendiumCollection.createCompendium({
    type: "Item",
    label: game.i18n.localize("CAIRN.CustomBackgroundsPack"),
    name: "custom-backgrounds",
  });
};

/**
 * Copy a background into the GM's editable world pack as a fully-formed starting
 * point to rename and rework — the "Duplicate into my backgrounds" action
 * (docs/custom-backgrounds-plan.md §8). By-name gear references are kept as-is
 * (they point at shipped items every install already has, so the copy is portable
 * within the system); a GM who wants a one-off item re-drops it to snapshot. The
 * copy is forced to source "2e" so it is immediately discoverable.
 * @param {CairnItem} bg
 * @returns {Promise<CairnItem|null>}
 */
export const duplicateBackgroundToWorld = async (bg) => {
  const pack = await ensureCustomBackgroundPack();
  if (!pack) return null;
  const data = bg.toObject();
  delete data._id;
  delete data.folder;
  data.name = `${bg.name} (${game.i18n.localize("CAIRN.BgAuthor.CopySuffix")})`;
  data.system = { ...data.system, source: "2e" };
  const created = await Item.implementation.create(data, { pack: pack.collection });
  return created ?? null;
};

/* -------------------------------------------------------------------------- */
/*  Background-granted containers                                              */
/* -------------------------------------------------------------------------- */

/** A wagon or cart is a vehicle; anything else a background grants (a donkey, a
 *  horse breed) is a mount. No container weighs on the carrier — they are reached
 *  through the Containers tab and never count against the carrier's own slots. */
const containerKindFor = (name) => (/\b(wagon|cart|sled|sledge)\b/i.test(name) ? "vehicle" : "mount");

/**
 * Mint the container Actors a background's rolled options granted, connected
 * to the new character and inheriting its ownership — the same shape the shop
 * produces (marketplace.js acquireTransport), so a granted donkey and a bought
 * one behave identically.
 *
 * The spec's name is resolved against the editable Mounts & Transports Actor
 * pack first, so a Warden who retunes "Donkey" there changes every donkey granted
 * afterwards; the grant's own `slots` still wins, because that number is the
 * background's (a Rivertooth is +6 where a Blacklegged Dandy is +4). A name with
 * no pack document — the one-off beasts — is minted from the spec alone.
 *
 * Each container is flagged with the question that granted it, so a re-roll or a
 * regenerate can delete exactly those and leave bought/manual containers alone.
 * @param {CairnActor} actor
 * @param {Object[]} specs  {name, slots, grantSource, load?, carried_by?}
 * @returns {Promise<CairnActor[]>}  the containers created
 */
export const grantContainers = async (actor, specs) => {
  if (!actor || !specs?.length) return [];
  // The connection ceiling, CLAMPED rather than refused outright: a background
  // granting three beasts to a keeper with room for one still owes the
  // character that one. What was dropped is SAID — a silent clamp reads as
  // "the background granted nothing", which is a bug report waiting to be
  // filed against the wrong code. At zero headroom nothing can land, so that
  // case gets the plain at-the-ceiling message instead of a count of zero
  // survivors. On the player path this clamp runs in the player's browser and
  // cannot bind anyone; the socket broker re-clamps on the Warden's client,
  // which is the wall. This copy exists so the player is TOLD — the broker
  // can only console.warn on a client the player is not looking at.
  const headroom = connectionHeadroom(actor);
  if (headroom <= 0) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.ConnectionLimit", { name: actor.name, max: maxConnections() }));
    return [];
  }
  if (specs.length > headroom) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.ConnectionLimitPartial", {
      name: actor.name,
      max: maxConnections(),
      count: specs.length - headroom,
    }));
    specs = specs.slice(0, headroom);
  }
  // The Mounts & Transports ACTOR pack, not the legacy transport Item pack. The
  // payload below copies hp / armorOverride / role / containerClass off the
  // resolved document, and only the Actor documents HAVE those fields — resolving
  // against the Item pack made every one of those reads a miss, so a granted
  // Rivertooth arrived with the schema's default 6 HP instead of its stated 8
  // (review #5, critical: the pack was stocked by nothing).
  const pack = game.packs.get("air-bladder.mounts-transports");
  const docs = pack ? await pack.getDocuments() : [];
  // Resolve a spec against that editable pack (art/stats/description), with
  // sensible fallbacks for one-off beasts the pack doesn't carry. `kind` only
  // matters on the no-document path (icon + class inference by name); a resolved
  // Actor carries its class outright.
  // A one-off beast the pack does not carry takes the Warden's own art when
  // they keep a reserved `companion/` folder (issue #18), else the class icon
  // it has always taken. Two bounds, both deliberate:
  //
  //   - A RESOLVED document's own art always wins. Same doctrine as the
  //     `!data.img` guard on the npc auto-portrait: something that arrived
  //     wearing art keeps it. So a granted Rivertooth keeps its illustration
  //     and only a "Mangy Wolfdog" gets a face from the folder.
  //   - `customPoolFor("companion")` is the reserved folder ALONE — it inherits
  //     no general pool — so this is silent for every Warden who has not named
  //     one, and a folder of human portraits never lands on a mule.
  //
  // Rolled per spec rather than once, so two granted beasts are two beasts.
  const companionArt = () => {
    const pool = customPoolFor("companion");
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  };
  const resolve = (spec) => {
    const doc = docs.find((d) => d.name.toLowerCase() === String(spec.name).toLowerCase());
    const kind = doc ? (doc.system.role === "companion" ? "mount" : "vehicle") : containerKindFor(spec.name);
    const art = doc?.img
      ?? (kind === "mount" ? companionArt() : null)
      ?? iconForTransport(spec.name, kind);
    return { doc, kind, art };
  };

  /* A granted beast or vehicle is ALWAYS an Actor now.
   *
   * There used to be a fork here: with the Containers tab off, each rolled
   * container was recorded as a weightless inventory ITEM instead. That was
   * tolerable while a container was a bag of slots. It is not tolerable now --
   * an Outrider's horse is a creature with 6 HP, and collapsing it into an
   * inventory line because a DISPLAY setting is off is a lie about what the
   * character has. The user's words: "an outrider's horse should never appear in
   * their inventory."
   *
   * Deleting the fork exposed what it was really doing, which was not display at
   * all: it was the reason a PLAYER could generate an Outrider. Minting an Actor
   * needs ACTOR_CREATE, which players do not have, so the item branch was a
   * permissions workaround wearing a display setting's name. Hence the broker
   * below. */
  /* Resolved ONCE, because the keeper's notes need the same answers the payload
   * does: what this thing IS (role + Kind) and, where the granting option said
   * nothing itself, the stock description off its pack document. */
  const entries = specs.map((spec) => {
    const { doc, kind, art } = resolve(spec);
    return {
      spec, doc, kind, art,
      cls: doc?.system.containerClass || containerClass(spec.name, kind),
      role: doc?.system.role
        ?? ({ mount: "companion", vehicle: "transport", worn: "container", pile: "container" }[kind] ?? "companion"),
    };
  });
  const payloads = entries.map(({ spec, doc, art, cls, role }) => {
    return {
      type: "npc",
      name: spec.name,
      img: art,
      prototypeToken: { texture: { src: art } },
      system: {
        connectedTo: actor.uuid,
        slots: spec.slots ?? doc?.system.slots ?? 0,
        description: doc?.system.description ?? "",
        // The Actor document records its class; a one-off beast with no document
        // infers it from the name the way the sheet does. Leaving it blank would
        // have shipped a horse whose art and one-word label were both decided by
        // a keyword table at render time, rather than recorded once at creation.
        containerClass: cls,
        // A resolved pack Actor states its role; a one-off beast maps its
        // inferred kind (a granted "Mangy Wolfdog" is a mount-shaped creature
        // and keeps its stat block, exactly as the old animate default did).
        role,
        cost: doc?.system.cost ?? 0,
        generationEnabled: false,
        ...(doc?.system.hp ? { hp: { value: doc.system.hp.value, max: doc.system.hp.max } } : {}),
        ...(doc?.system.armorOverride != null ? { armorOverride: doc.system.armorOverride } : {}),
        // The ABILITIES too — the stat block travels whole. hp/armorOverride
        // have been copied since review #5 ("a granted Rivertooth arrived with
        // the schema's default 6 HP"); abilities joined 2026-08-08 when the
        // Falcon arrived, whose whole point is DEX 16 — landing it with the
        // schema's 10/10/10 is the same bug class. Via toObject(), never by
        // reference: a DataModel getter hands back the LIVE object, and a
        // shared reference here poisons the pack document.
        ...(doc ? { abilities: doc.system.toObject().abilities } : {}),
      },
      flags: {
        [FLAG_SCOPE]: { grantSource: spec.grantSource ?? "background" },
      },
    };
  });

  // A player cannot create an Actor, so ask the Warden's client to do it. Returns
  // [] on the player's side -- the documents appear when the GM's client answers.
  if (!game.user.hasPermission("ACTOR_CREATE")) {
    await requestGrantedActors(payloads, actor);
    return [];
  }

  // ONE batched create, then ONE batched follow-up (review 2026-08-04, the
  // same rule the orphan sweep in actor.js already paid for): a per-payload
  // create+update loop that dies midway leaves the first mule connected and
  // owned while the cart never comes into being — a partially-granted
  // background with nothing naming the missing half.
  const made = (await CairnActor.createDocuments(payloads)).filter(Boolean);
  if (!made.length) return made;
  // The CONNECTED ownership shape, not the old wholesale copy — same change
  // as the till's (marketplace.js). GM-only for the same reason as ever:
  // Foundry refuses an `ownership` write from anyone below Assistant, and
  // for a player with ACTOR_CREATE that threw AFTER the container was
  // created and linked, aborting the loop. A player with ACTOR_CREATE
  // already owns what they create; the sync flag asks the active GM's
  // client to fill in the OBSERVER default their client cannot write —
  // same tail as the till's. (The common player path never gets here at
  // all: it goes through the broker above, which writes the shape on the
  // Warden's client.)
  if (game.user.isGM) {
    await CairnActor.updateDocuments(made.map((c) => ({
      _id: c.id,
      ownership: foundry.data.operators.ForcedReplacement.create(connectedOwnershipShape(actor)),
    })));
  } else {
    await CairnActor.updateDocuments(made.map((c) => ({
      _id: c.id, [`flags.air-bladder.${OWNERSHIP_SYNC_FLAG}`]: true,
    })));
    for (const c of made) {
      game.socket.emit(`system.${game.system.id}`, { action: "ownershipSync", childUuid: c.uuid });
    }
  }
  return made;
};

/**
 * Every container connected to this actor that GENERATION granted (it carries
 * a grantSource flag). Bought and hand-made containers have no such flag and are
 * never returned, so a regenerate cannot delete a player's mule.
 * @param {CairnActor} actor @returns {CairnActor[]}
 */
export const grantedContainersOf = (actor) =>
  (game.actors ?? []).filter(
    (a) => a.system?.connectedTo === actor.uuid && a.getFlag(FLAG_SCOPE, "grantSource")
  );

/**
 * Ask the Warden's client to create the Actors a player's generation granted.
 *
 * `Actor.create` needs ACTOR_CREATE, which players do not have, and granting it
 * world-wide to fix one background would let players create any actor at all.
 * This is Foundry's standard shape for a player-initiated GM action: emit on the
 * system socket, let exactly ONE client — `game.users.activeGM`, so two logged-in
 * GMs cannot both act and mint doubles — do the write.
 *
 * Fire-and-forget by design. Generation must not block on another client
 * answering, and the documents simply appear when it does. The one thing worth
 * saying out loud is the case where nobody can act.
 * @param {object[]} payloads
 * @param {CairnActor} owner
 */
export const requestGrantedActors = async (payloads, owner) => {
  if (!payloads.length) return;
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoGmForGrant"));
    return;
  }
  // No `userId` in the payload, deliberately. The broker identifies the sender
  // by the server-authenticated id Foundry passes as the handler's second
  // argument — a self-declared id in the message is exactly what an attacker
  // would forge, and the first version of this socket was ownable because the
  // receiving side trusted it (review #5).
  game.socket.emit(`system.${game.system.id}`, {
    action: "grantActors",
    payloads,
    ownerUuid: owner.uuid,
  });
};

/**
 * Ask the Warden's client to generate a character for the CURRENT user.
 *
 * The directory shows Generate PC to players who hold no ACTOR_CREATE at all —
 * making a character is the one creation the game owes every player, and
 * granting the world-wide right for it would open all the others. Same shape
 * as requestGrantedActors above: emit, and exactly one GM client answers,
 * running this same generator with the requester stamped OWNER into the
 * create data. Fire-and-forget — the pcGenerated answer (cairn.js) opens the
 * sheet on this client when the document lands. The payload carries nothing:
 * WHO asked is the server-authenticated senderId on the receiving side.
 */
export const requestPcGeneration = async () => {
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoWardenForPcGen"));
    return;
  }
  // The SOURCE question is the player's, exactly as it is on the direct path —
  // ask it HERE, on the clicking client, and send the answer. Asked on the
  // answering side instead, generateCharacter's picker pops on the Warden's
  // screen out of nowhere and the player's request hangs on someone else's
  // modal (which is precisely how the first cut of this relay behaved).
  const source = await promptContentSource();
  if (!source) return; // ✕ is an instruction, here as everywhere
  ui.notifications.info(game.i18n.localize("CAIRN.Notify.PcGenRequested"));
  game.socket.emit(`system.${game.system.id}`, { action: "generatePC", source });
};

/**
 * May the current user run a (re)generation that could create or delete this
 * actor's container Actors? Deleting an Actor requires an Assistant GM+ (Foundry
 * gates it by ROLE, with no player-grantable permission — unlike ACTOR_CREATE), so
 * a plain player cannot. This is the UP-FRONT guard: (re)generation deletes items
 * BEFORE it touches containers, so a mid-way permission throw corrupts the
 * character — better to refuse before mutating anything, with a clear notice.
 *
 * A container op is only in play when there is an existing granted container to
 * DELETE. Creation is brokered (see below), and there is no "containers feature"
 * switch any more — `show-containers-tab` was the display toggle this comment
 * used to call one, and it is gone. Pass `source` to scope the delete check to
 * one grant source (a single question's containers) rather than all of them.
 * @param {CairnActor} actor @param {String|null} source
 * @returns {Boolean} true to proceed
 */
export const canRegenerateContainers = (actor, source = null, warnKey = "CAIRN.Notify.NoContainerRegen") => {
  if (game.user.isGM) return true; // isGM === role >= ASSISTANT, exactly what Actor delete needs
  // CREATION is no longer a reason to refuse: a player's grants are brokered to
  // the Warden's client over the system socket (requestGrantedActors). Only a
  // DELETE still needs Assistant+, because there is no broker for it and there
  // should not be -- a socket that deletes actors on request is a very different
  // thing from one that creates the ones a background just rolled.
  //
  // This used to read `show-containers-tab` as `mayCreate`, which is how a
  // DISPLAY setting came to decide a permission: with the tab on, every non-GM
  // was refused whether or not anything needed deleting. That coupling is gone.
  const existing = grantedContainersOf(actor);
  const mustDelete = source
    ? existing.some((c) => c.getFlag(FLAG_SCOPE, "grantSource") === source)
    : existing.length > 0;
  if (!mustDelete) return true;
  // The refusal is shared; the SENTENCE is not. This guard began as the
  // regenerate check and its message says "ask them to re-roll it for you" —
  // correct there, and wrong the moment the background swap started calling it,
  // because that instructs a player to request an operation that discards their
  // abilities, HP and traits when all they touched was a background. Callers that
  // refuse a different operation pass their own key.
  ui.notifications.warn(game.i18n.localize(warnKey));
  return false;
};

/**
 * Delete container Actors — ONE batched operation, not a per-actor loop
 * (review #13 #20). The loop was N sequential server round trips, and a
 * throw mid-loop left the earlier deletes committed with nothing recording
 * where it stopped; a batch is one request that the caller sees succeed or
 * fail whole. Returns the targets on success, re-raises on failure.
 *
 * It used to prune the keeper's `system.containers` uuid array in the same
 * breath — ahead of the delete, so CairnActor._onDeleteOperation's own prune
 * found nothing to do, and putting uuids back if a delete threw so a failure
 * could not orphan a live Actor. That array went with the `container` type
 * (2026-07-31): the link is one field on the CHILD now, so deleting the child
 * IS the whole operation and there is no second half to keep in step.
 * @param {CairnActor} actor @param {CairnActor[]} targets
 * @returns {Promise<CairnActor[]>}
 * @private
 */
const deleteContainers = async (actor, targets) => {
  if (!targets.length) return [];
  await CairnActor.deleteDocuments(targets.map((c) => c.id));
  return targets;
};

/**
 * Delete every generation-granted container this actor keeps (a regenerate
 * re-rolls the background's options, so last roll's donkey has to go).
 * @param {CairnActor} actor
 */
export const clearGrantedContainers = async (actor) => {
  // The bullets those grants left go with them, but NOT from here: the delete
  // itself is what removes them (CairnActor._onDeleteOperation → pruneGrantNotes),
  // so every route that ends a grant cleans up the same way — this one, a
  // re-rolled question, a changed background, and a Warden deleting the mule
  // straight out of the directory.
  await deleteContainers(actor, grantedContainersOf(actor));
};

/**
 * Swap the containers granted by ONE source (a re-rolled question): delete just
 * that source's, mint the new option's. Containers from other questions, and any
 * the player bought, are untouched — the Actor-side twin of the sheet's
 * _replaceGrantedItems.
 * @param {CairnActor} actor @param {String} source e.g. "question:1"
 * @param {Object[]} specs  the new option's container specs
 */
export const replaceGrantedContainers = async (actor, source, specs) => {
  const stale = grantedContainersOf(actor).filter((c) => c.getFlag(FLAG_SCOPE, "grantSource") === source);
  // The previous answer's bullet goes with the beast it described — carried by
  // the delete, not by this function (see clearGrantedContainers) — and the new
  // one is added by grantContainers below.
  await deleteContainers(actor, stale);
  return grantContainers(actor, (specs ?? []).map((c) => ({ ...c, grantSource: source })));
};

/* -------------------------------------------------------------------------- */
/*  Generation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Generate a Cairn 2e character: 3d6 abilities, 1d6 HP, a 2e background (chosen or
 * random) with a name drawn from its list and its starting gear granted from the
 * pool (weapons/armor equipped), a bond supplying gold and an item, the eight
 * physical/personality traits and age, and the background's two d6 choice tables
 * rolled for extra gear, gold, and story.
 * @param {CairnItem|null} chosenBg  a background Item, or null to pick at random
 * @returns {Promise<Object|null>}
 */
export const generate2eCharacter = async (chosenBg = null) => {
  // Draw from getBackgroundsFor("2e"), NOT from the shipped pack directly. This
  // read `game.packs.get("air-bladder.backgrounds-2e")` inline, so random
  // generation ignored both content toggles: a Warden running a homebrew-only
  // game (shipped off, custom on) still got shipped backgrounds, and their own
  // were never rolled at all. Only the picker and changeBackground went through
  // the union, which is why it looked like a settings bug rather than a
  // generation one. generateBarebonesCharacter had it right all along via
  // getBarebonesBackgrounds(). Reported as issue #9.
  const backgrounds = await getBackgroundsFor("2e");
  if (!chosenBg && !backgrounds.length) {
    ui.notifications?.warn(game.i18n.localize(customOnly()
      ? "CAIRN.NoCustomBackgrounds"
      : "CAIRN.NoBackgrounds2e"));
    return null;
  }
  // A chosen background (from a picker / persisted across regenerate) is used
  // as-is; otherwise pick at random. Everything else derives from it.
  const bg = chosenBg ?? backgrounds[Math.floor(Math.random() * backgrounds.length)];
  const names = bg.system.names ?? [];
  const name = names.length ? names[Math.floor(Math.random() * names.length)] : bg.name;

  // Starting gear: resolve each reference against the editable pool, tag it
  // "background", and equip weapons/armor so Armor derives to its intended value
  // (pool items are equipped:false).
  const gear = tagBackgroundGear(await resolveRefs(bg.system.startingGear));
  for (const it of gear) {
    if (it.type === "weapon" || it.type === "armor") it.system.equipped = true;
  }

  const traits = await rollTextItems(Cairn.characterGenerator2e.biography.items);
  const age = String(await rollAge(Cairn.characterGenerator2e.biography.age));
  const choices = await applyChoiceTables(bg);

  // One bond by default; the Fieldwarden background and Outrider's "Always pay
  // your debts" option each add another — bondEntitlement is THE rule, shared
  // with the sheet's "Add a bond" cap and changeBackground's clamp. Each bond
  // has a stable id so its granted items can be re-rolled/removed later.
  const bondCount = bondEntitlement(bg, choices.questions);
  const bonds = [];
  const bondItems = [];
  let bondGold = 0;
  for (let i = 0; i < bondCount; i++) {
    // A custom background may name its own bonds table; empty means the 2e one.
    // `avoid` grows as the loop runs, so a Fieldwarden's second bond cannot repeat
    // the first (and a third could not repeat either).
    const rec = bondRecordFrom(await drawBond(bg.system.bondsTable, {
      avoid: bonds.map((b) => b.description),
    }));
    if (!rec) continue;
    bonds.push(rec.bond);
    bondItems.push(...rec.items);
    bondGold += rec.bond.gold;
  }

  const hpRoll = await rollHitProtection("1d6");
  const goldRoll = await rollGold(Cairn.characterGenerator2e.gold);
  const abilityRolls = await rollAbilities("3d6");

  return {
    name,
    hp: hpRoll.total,
    gold: goldRoll.total + bondGold + choices.gold,
    abilities: {
      STR: abilityRolls.STR.total,
      DEX: abilityRolls.DEX.total,
      WIL: abilityRolls.WIL.total,
    },
    // The five Rolls the generation chat card shows, carried out whole so
    // postGenerationRolls can hand them to ChatMessage for Dice So Nice.
    // characterToActorData never reads this key, so it stops here and never
    // reaches the document. `gold` is the BARE roll -- the gold FIELD above adds
    // bond and background-choice gold on top, and the card must show what the
    // dice on screen actually read, not the bonus-inflated total.
    rolls: { hp: hpRoll, STR: abilityRolls.STR, DEX: abilityRolls.DEX, WIL: abilityRolls.WIL, gold: goldRoll },
    background: bg.name,
    backgroundUuid: bg.uuid,
    contentSource: "2e",
    bonds,
    age,
    traits,
    // Arranged before it is handed over (gear.js orderGrantedItems): weapons,
    // armor, everything else in the order it was granted, the light with its
    // fuel beneath it, Rations last. It writes each item's `sort`, which is
    // Foundry's own field, so the player can drag any row afterwards and the
    // printed page follows without knowing this happened.
    items: orderGrantedItems([...gear, ...bondItems, ...choices.items]),
    // Container Actors cannot ride in items[]; they are minted after the actor
    // exists (createActorWithCharacter / updateActorWithCharacter).
    // A background can grant a container outright as well as from a choice table
    // — the Mountebank's cart is part of the act, not a roll. Both kinds go here;
    // Barebones and changeBackground already combined them the same way.
    containers: [
      ...(bg.system.containers ?? []).map((c) => ({ ...c, grantSource: "background" })),
      ...choices.containers,
    ],
    questions: choices.questions,
  };
};

/* ==========================================================================
 * Cairn Barebones
 *
 * Barebones and 2e are ONE system that differs only in how a character is made,
 * so everything below is generation and nothing else. A Barebones background is
 * the same `background` Item type 2e uses — it simply carries a name and three
 * gear references, with the archetype/names/choice-table fields left empty.
 *
 * Its three creation steps are RollTables in `tables-barebones` whose results
 * REFERENCE pool items, so a Warden restocks a step by dragging an item into the
 * table. Rolling is always table.roll(), never draw(): drawing marks results as
 * used and would silently exhaust a table over a campaign.
 * ======================================================================== */

const BAREBONES_BG_PACK = "air-bladder.backgrounds-barebones";
const BAREBONES_TABLE_PACK = "air-bladder.tables-barebones";

/** The 100 Barebones background documents. @returns {Promise<CairnItem[]>} */
export const getBarebonesBackgrounds = async () => {
  const pack = game.packs.get(BAREBONES_BG_PACK);
  return pack ? pack.getDocuments() : [];
};

/** The Barebones background with this name — used to keep it across a regenerate
 *  (Barebones characters are keyed by uuid like 2e; this is the fallback for one
 *  generated before the uuid was stored). @returns {Promise<CairnItem|null>} */
export const getBarebonesBackgroundByName = async (name) =>
  (await getBarebonesBackgrounds()).find((b) => b.name === name) ?? null;

/** One table out of the Barebones pack, by name. @returns {Promise<RollTable|null>} */
const barebonesTable = async (name) => {
  const pack = game.packs.get(BAREBONES_TABLE_PACK);
  if (!pack) return null;
  return (await pack.getDocuments()).find((t) => t.name === name) ?? null;
};

/**
 * The pack a RANDOM spell is drawn from — canon only, by ruling (2026-08-05):
 * "random assignment of spells and spell scrolls during character generation
 * with Cairn 2e Canon Backgrounds [uses] only the spells listed in the
 * Spellbooks compendium." Deliberately NOT `SPELL_PACKS`: that list answers a
 * different question — which packs a by-NAME grant like "Spellbook (Shield)"
 * resolves against — and a shared constant would let widening one silently
 * widen the other.
 */
const SPELL_POOL_PACK = "air-bladder.spellbooks";

/**
 * One random spellbook DOCUMENT out of `packIds`, index-first.
 *
 * No cache, on purpose. The old shape memoized `getDocuments()` across both
 * spell packs and never invalidated, so a spell a Warden added to an unlocked
 * pack was undrawable until the browser reloaded — silently. There is nothing
 * to invalidate here: core maintains `pack.index` live on every client
 * (client-document.mjs _onCreate/_onUpdate/_onDelete all reindex), so reading
 * the index each draw is both current and effectively free, and only the one
 * winning document pays a server fetch.
 *
 * The type filter is load-bearing: an unlocked pack accepts ANY item, and a
 * Dagger dropped into Spellbooks must not come out of "a random spellbook".
 * @returns {Promise<CairnItem|null>}
 */
export const randomSpellbookDoc = async (packIds = null) => {
  // Under GLOG the pool is the GLOG wordings plus the custom set, canon
  // excluded (ruling 2026-08-05). The setting is read per DRAW, so flipping it
  // needs no reload. Statically imported: a per-call `await import()` here
  // cost ~600ms EVERY call in the live page (it is why dev:spell-pool timed
  // out on 2026-08-05), and glog.js → settings.js is a leaf chain, no cycle.
  if (!packIds) {
    packIds = glogEnabled() ? GLOG_SPELL_PACKS : [SPELL_POOL_PACK];
  }
  const candidates = [];
  for (const key of packIds) {
    const pack = game.packs.get(key);
    if (!pack) continue;
    for (const e of await pack.getIndex()) {
      if (e.type === "spellbook") candidates.push({ pack, id: e._id });
    }
  }
  if (!candidates.length) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick.pack.getDocument(pick.id);
};

/** A random spellbook as an owned item, named for the spell it holds. The
 *  inventory list adds the "Spellbook — " prefix at display time
 *  (templates/parts/items-list.html), so the stored name stays the bare spell
 *  name — baking the prefix in here too would double it. */
export const randomSpellbookItem = async () => {
  const b = await randomSpellbookDoc();
  if (!b) return null;
  // Under GLOG every granted spell is a SCROLL, and this path is reachable then:
  // the Barebones "Spellbook" / "Random Spellbook" instruction rows call it, and
  // GLOG is a rules setting, not a content source — it does not turn Barebones
  // off. Same rule as resolveGearItem's book grants (rulings 2 and 7, 2026-08-05).
  if (glogEnabled()) return spellScrollItem(b);
  // toObject(), not deepClone — deepClone returns a TypeDataModel by reference,
  // so this would alias the compendium document. See gear.js resolveGearItem.
  return { name: b.name, type: b.type, img: b.img, system: b.system.toObject() };
};

/** A random spellbook as a single-use petty scroll. The spell's effect is the
 *  description; casting consumes it. */
export const randomScrollItem = async () => {
  const b = await randomSpellbookDoc();
  if (!b) return null;
  return spellScrollItem(b);   // shared scroll shape — see gear.js
};

/**
 * Turn one rolled table result into something a character can be given.
 * Three shapes, decided by what the result points at:
 *   - a carrier document    → a container spec (minted as a connected NPC later);
 *                             either a Mounts & Transports npc Actor or a legacy
 *                             `transport` Item — old worlds' tables still point
 *                             at the Item pack
 *   - a nested ROLLTABLE    → roll that table and resolve its result instead
 *   - anything else         → the pool item of that name, or, for the SRD's two
 *                             instruction rows, a random spellbook or scroll
 *
 * The first two branches now ask what the referenced document IS, rather than which
 * pack it came out of. They used to compare `result.documentCollection` against two
 * hardcoded pack ids — `documentCollection` is deprecated `{since: 13, until: 15}`,
 * but the pack id was only ever standing in for the question the docstring above
 * actually asks. Keying on the document closes a gap as a side effect: a Warden's
 * own Barebones table pointing at a world RollTable, or at a transport they made,
 * used to fall through to the gear-pool lookup and resolve to nothing.
 *
 * The third branch deliberately still resolves BY NAME against the gear pool, and
 * not by uuid. That is the pool's whole job — one canonical Dagger, whichever pack
 * a table points at — and it is why 116 of the 124 shipped Barebones rows do not
 * need their uuid at all.
 *
 * @param {TableResult} result
 * @returns {Promise<{item?:Object, container?:Object, name:String}|null>}
 */
const resolveBarebonesResult = async (result) => {
  if (!result) return null;
  const name = resultText(result).trim();
  const doc = result.type === CONST.TABLE_RESULT_TYPES.DOCUMENT
    ? await fromUuid(result.documentUuid)
    : null;

  if (doc?.documentName === "Item" && doc.type === "transport") {
    return { container: { name: doc.name, slots: doc.system.slots ?? 0 }, name };
  }
  // A row can point at a Mounts & Transports NPC now (the shipped Barebones
  // Cart/Wagon rows do, and a Warden's own table can too). Same shape out: a
  // container SPEC, not the document — grantContainers re-resolves by name, so
  // the grant still picks up the Warden's edits to the pack document.
  if (doc?.documentName === "Actor" && doc.type === "npc") {
    return { container: { name: doc.name, slots: doc.system.slots ?? 0 }, name };
  }
  if (doc?.documentName === "RollTable") {
    const { results } = await doc.roll();
    return resolveBarebonesResult(results[0]);
  }
  const lower = name.toLowerCase();
  if (lower === "scroll of random spellbook") {
    const s = await randomScrollItem();
    return s ? { item: s, name: s.name } : null;
  }
  if (lower === "spellbook" || lower === "random spellbook") {
    const s = await randomSpellbookItem();
    return s ? { item: s, name: s.name } : null;
  }
  if (lower === "none") return { name };            // the armor table's empty row
  const item = await resolveGearItem(name);
  return item ? { item, name: item.name } : null;
};

/** Roll a Barebones creation table and resolve what came up. */
const rollBarebonesTable = async (tableName) => {
  const table = await barebonesTable(tableName);
  if (!table) return null;
  const { results } = await table.roll();
  return resolveBarebonesResult(results[0]);
};

/**
 * Roll one item off the Additional Gear table (creation step 6), rerolling a
 * name already held — the SRD lets you reroll duplicate gear — and rerolling a
 * transport, which is a container Actor and cannot be an extra item here.
 * @param {Set<string>} avoid  lowercased names already granted
 */
/** The starting-gear rows the SRD writes as an INSTRUCTION rather than an item.
 *  Kept as one list so the dispatch below and the duplicate-guard that seeds
 *  `avoid` can never disagree about what counts as a literal item. */
const INSTRUCTION_ROWS = new Set([
  "random additional gear", "scroll of random spellbook", "spellbook", "random spellbook",
]);

const rollAdditionalGear = async (avoid = new Set()) => {
  for (let tries = 0; tries < 50; tries++) {
    const got = await rollBarebonesTable("Barebones: Creation - Additional Gear");
    if (!got?.item) continue;                        // a cart/wagon, or unresolved
    if (avoid.has(got.name.toLowerCase())) continue;
    return got.item;
  }
  return null;
};

/**
 * Resolve a background's starting gear, honouring the rows the SRD writes as an
 * INSTRUCTION rather than an item. Nine Barebones backgrounds grant one — the
 * Acolyte's "Spellbook", the Fence's "Random Additional Gear", the Cultist's
 * "Scroll of Random Spellbook" — and a plain reference lookup silently drops
 * every one of them, leaving those characters an item short with no error —
 * not every table entry is an object, and nobody notices until someone rolls
 * Acolyte. The importer skips the same rows; see `META` in
 * tools/import/barebones.mjs.
 *
 * 2e backgrounds carry no such rows, so this is a pass-through for them; it is
 * shared so that generation and a background swap can never disagree.
 * @param {CairnItem} bg
 * @param {Set<string>} [avoid]  names already granted, for the Additional Gear roll
 * @returns {Promise<Object[]>}
 */
export const resolveStartingGear = async (bg, avoid = new Set()) => {
  const out = [];
  const refs = bg.system.startingGear ?? [];

  // Seed `avoid` with everything this background grants OUTRIGHT, before rolling
  // anything. The SRD says to reroll duplicates, and `avoid` was only being filled
  // as the loop went — so an item listed AFTER the "Random Additional Gear" row
  // was invisible to that roll and could be handed out twice. The Merchant is
  // "Random Additional Gear, Stylus, Wagon" and Stylus is row 90 of the same d100
  // table, so roughly one Merchant in a hundred carried two of them (likewise the
  // Fence and Peddler, whose Sack sits after the roll). Seeding up front
  // makes the guard independent of the order the SRD happens to list gear in.
  // Both the reference name and what it resolves to are added, because an alias
  // means those differ ("Torches" -> "Torch") and the roll compares resolved
  // names.
  for (const ref of refs) {
    const name = String(ref.name).trim().toLowerCase();
    if (INSTRUCTION_ROWS.has(name)) continue;
    avoid.add(name);
    const alias = GEAR_ALIASES.get(name);
    if (alias) avoid.add(alias.toLowerCase());
  }

  for (const ref of refs) {
    const lower = String(ref.name).trim().toLowerCase();
    let item = null;
    // A snapshot travels inside the background (custom-authored gear), so it
    // resolves without ever touching the canonical packs or the instruction rows.
    if (ref.itemData) item = ownedFromSnapshot(ref.itemData, { quantity: ref.quantity ?? 1, uses: ref.uses });
    else if (lower === "random additional gear") item = await rollAdditionalGear(avoid);
    else if (lower === "scroll of random spellbook") item = await randomScrollItem();
    else if (lower === "spellbook" || lower === "random spellbook") item = await randomSpellbookItem();
    else item = await resolveGearItem(ref.name, { quantity: ref.quantity ?? 1, uses: ref.uses });
    if (item) { out.push(item); avoid.add(item.name.toLowerCase()); }
  }
  return out;
};

/**
 * Steps 5 and 6 of the Barebones equipment procedure: Rations and a Torch, a
 * rolled Weapon and Armor — both equipped, and "None" armor buys a SECOND
 * Additional Gear roll — then the Additional Gear roll(s). Five items by
 * construction.
 *
 * Shared by the Barebones character generator and the NPC kit since 2026-08-21
 * (user ruling): a generated NPC runs the SAME procedure a Barebones character
 * does, weapon and armor included, superseding the rations-torch-and-one-find
 * subset — and with the armor table now in play for NPCs, the no-armor
 * compensation roll comes with it, retiring the old "paying out for a loss
 * nobody took" carve-out. One routine, not a copy, so the two cannot drift.
 * @param {Set<string>} avoid  lower-cased names already granted; grows with
 *   every item handed out so the gear rolls cannot duplicate
 * @returns {Promise<Object[]>}
 */
const rollBarebonesEquipment = async (avoid = new Set()) => {
  // Every Barebones character starts with these; they come from the SRD's
  // procedure, not from the background, so a PC's carry no source chip.
  const base = await resolveRefs([{ name: "Rations", uses: 3 }, { name: "Torch", uses: 3 }]);
  for (const i of base) avoid.add(i.name.toLowerCase());

  // Step 5: Armor and Weapon, both equipped. "None" armor buys an extra gear roll.
  const weapon = (await rollBarebonesTable("Barebones: Creation - Weapon"))?.item ?? null;
  if (weapon) { weapon.system.equipped = true; avoid.add(weapon.name.toLowerCase()); }
  const armor = (await rollBarebonesTable("Barebones: Creation - Armor"))?.item ?? null;
  if (armor) { armor.system.equipped = true; avoid.add(armor.name.toLowerCase()); }

  // Step 6 — Additional Gear, always.
  const extras = [];
  for (let i = 0; i < 1 + (armor ? 0 : 1); i++) {
    const x = await rollAdditionalGear(avoid);
    if (x) { extras.push(x); avoid.add(x.name.toLowerCase()); }
  }
  return [...base, ...(weapon ? [weapon] : []), ...(armor ? [armor] : []), ...extras];
};

/**
 * Generate a Cairn Barebones character: a random d100 background (a name plus
 * three items), 3d6 abilities, 1d6 HP, 3d6 coins, the same eight traits and age
 * as 2e, and the SRD's equipment procedure — the background's gear, the base
 * Rations and Torch, a rolled Armor and Weapon (equipped), and one roll on
 * Additional Gear (a second if Armor came up None).
 *
 * Two GM-gated extras: a bond, which REPLACES the Additional Gear step because a
 * bond already grants an item and rolling both overloads a ten-slot inventory;
 * and a "failed career", a second background name as pure flavor (no items).
 *
 * @param {CairnItem|null} chosenBg  a Barebones background Item, or null for random
 * @returns {Promise<Object|null>}
 */
export const generateBarebonesCharacter = async (chosenBg = null) => {
  const backgrounds = await getBarebonesBackgrounds();
  if (!chosenBg && !backgrounds.length) {
    ui.notifications?.warn(game.i18n.localize("CAIRN.NoBackgroundsBarebones"));
    return null;
  }
  const bg = chosenBg ?? backgrounds[Math.floor(Math.random() * backgrounds.length)];

  // The background's three items, and (Merchant/Peddler only) its transport.
  // `avoid` is threaded in because one of those "items" can be a roll on the
  // Additional Gear table, which must not hand back something already granted.
  const avoid = new Set(["rations", "torch"]);
  const bgItems = tagBackgroundGear(await resolveStartingGear(bg, avoid));
  const containers = (bg.system.containers ?? []).map((c) => ({ ...c, grantSource: "background" }));

  // Steps 5 and 6 — the shared equipment procedure (rollBarebonesEquipment).
  // Barebones generation mints no bonds: the retired show-bonds-barebones
  // setting (removed 2026-08-09) used to let a lent 2e bond REPLACE step 6;
  // bonds are 2e's alone now.
  const equipment = await rollBarebonesEquipment(avoid);

  // A failed career (Knave-style): a second background name, plus one Petty
  // keepsake item drawn from that career's gear (weightless, so it costs no slot).
  let failedCareer = "";
  const failedCareerItems = [];
  if (game.settings.get(SETTINGS_NS, "barebones-failed-career") && backgrounds.length > 1) {
    const pool = backgrounds.filter((b) => b.name !== bg.name);
    const chosenFailed = pool[Math.floor(Math.random() * pool.length)];
    failedCareer = chosenFailed.name;
    const fcItem = await failedCareerItemFromBg(chosenFailed);
    if (fcItem) failedCareerItems.push(fcItem);
  }

  const hpRoll = await rollHitProtection(Cairn.barebonesGenerator.hitProtection);
  const goldRoll = await rollGold(Cairn.barebonesGenerator.gold);
  const abilityRolls = await rollAbilities(Cairn.barebonesGenerator.ability);

  return {
    name: await rollNameFromTable(Cairn.barebonesGenerator.name, bg.name),
    hp: hpRoll.total,
    gold: goldRoll.total,
    abilities: {
      STR: abilityRolls.STR.total,
      DEX: abilityRolls.DEX.total,
      WIL: abilityRolls.WIL.total,
    },
    // See generate2eCharacter: the five Rolls for the chat card, gold BARE.
    rolls: { hp: hpRoll, STR: abilityRolls.STR, DEX: abilityRolls.DEX, WIL: abilityRolls.WIL, gold: goldRoll },
    background: bg.name,
    backgroundUuid: bg.uuid,
    contentSource: "barebones",
    failedCareer,
    bonds: [],
    age: String(await rollAge(Cairn.characterGenerator2e.biography.age)),
    traits: await rollTextItems(Cairn.characterGenerator2e.biography.items),
    // Ordered, exactly as 2e above; the build order here is already close but
    // the rolled weapon and armor arrive AFTER the background's three items.
    items: orderGrantedItems([...bgItems, ...equipment, ...failedCareerItems]),
    containers,
    questions: [],
  };
};

/* -------------------------------------------------------------------------- */
/*  Source-aware entry points                                                   */
/* -------------------------------------------------------------------------- */

/** The content sources a Warden has enabled, in display order. */
export const CONTENT_SOURCES = [
  {
    key: "2e",
    label: "CAIRN.ContentSource2e",
    // The 2e generation path is offered when EITHER the shipped 2e backgrounds or
    // GM-authored custom (homebrew) 2e backgrounds are enabled. Custom backgrounds
    // are 2e-format and run the 2e generator, so they share its level-1 button
    // rather than adding a third one; getBackgroundsFor("2e") then unions whichever
    // pools are on. Shipped off + custom on = a homebrew-only game.
    enabled: () =>
      game.settings.get(SETTINGS_NS, "content-source-2e") ||
      game.settings.get(SETTINGS_NS, "content-source-custom"),
  },
  {
    key: "barebones",
    label: "CAIRN.ContentSourceBarebones",
    enabled: () => game.settings.get(SETTINGS_NS, "content-source-barebones"),
  },
];

/** The enabled sources. @returns {{key:String,label:String}[]} */
export const enabledContentSources = () => CONTENT_SOURCES.filter((s) => s.enabled());

/**
 * Which content source to generate from: the only enabled one, or a prompt when
 * a Warden has enabled both. Falls back to 2e if a Warden has turned everything
 * off, so the Generate button never dies silently — though since 2026-08-08 a
 * PLAYER is asked first when no chooser would appear, so for them "nothing"
 * is now a choice (null), never an accident.
 * @returns {Promise<String|null>} null = the user declined (confirm or picker ✕)
 */
export const promptContentSource = async () => {
  const sources = enabledContentSources();
  // With one or zero sources enabled, no chooser appears below — a player's
  // click would mint a character instantly, so interpose a Yes/No first (user
  // ask, 2026-08-08: an accidental click must not silently roll a PC). PLAYERS
  // only — the Warden's own button keeps rolling instantly (user ruling). With
  // 2+ sources the picker below is itself the interrupt, and its ✕ already
  // means "not now", so a confirm there would double-stack. This runs on the
  // ACTING user's client in both fresh paths (the GM directory button via
  // createCharacter, and requestPcGeneration which deliberately prompts on the
  // clicking player's client), so isGM is evaluated for the right person;
  // Regenerate never reaches here (it passes a background/source).
  if (sources.length <= 1 && !game.user.isGM) {
    const go = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CAIRN.GeneratePcConfirmTitle") },
      content: `<p>${game.i18n.localize("CAIRN.GeneratePcConfirm")}</p>`,
      rejectClose: false, // ✕ resolves falsy — an instruction, like the picker's
    });
    if (!go) return null; // No or ✕: create nothing (callers already bail on null)
  }
  if (sources.length === 1) return sources[0].key;
  if (!sources.length) return "2e";
  const buttons = sources.map((s) => ({ action: s.key, label: game.i18n.localize(s.label) }));
  const chosen = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("CAIRN.ContentSourceTitle") },
    content: `<p>${game.i18n.localize("CAIRN.ContentSourcePrompt")}</p>`,
    buttons,
    rejectClose: false,
  });
  // Dismissing the picker resolves null, and that is returned AS null: closing a
  // chooser with ✕ is an explicit "not now", so nothing should be created.
  //
  // This used to default to the first source (2e) under the same "the Generate
  // button never does nothing" rule that covers the no-sources-enabled case
  // above. Those two are not the same case. Everything OFF is a configuration
  // gap the Warden did not mean to create, so falling back is a kindness; a ✕ is
  // an instruction. Conflating them meant cancelling the dialog silently made a
  // 2e character (reported as issue #6), which is the more annoying of the two
  // failures because it leaves a stray actor behind to delete.
  return chosen ?? null;
};

/**
 * Source-aware character generation. A background may be passed to keep it
 * across a regenerate; its own `system.source` then decides the path, so a
 * character never switches edition behind the player's back.
 * @param {CairnItem|null} [background]
 * @param {String|null} [source]  skip the prompt and use this source
 * @returns {Promise<Object|null>}
 */
export const generateCharacter = async (background = null, source = null) => {
  const chosen = background?.system?.source ?? source ?? (await promptContentSource());
  // Only reachable when the picker was dismissed or a player declined the
  // roll-confirm — a background or an explicit source never yields null, so
  // Regenerate cannot land here.
  if (!chosen) return null;
  return chosen === "barebones"
    ? generateBarebonesCharacter(background)
    : generate2eCharacter(background);
};

/* ==========================================================================
 * Choosing a background
 *
 * Both editions store a background as a document with a uuid, and both tag the
 * gear it grants, so ONE picker and ONE swap serve both — the differences are in
 * the data, not the code. 2e backgrounds carry an archetype and a description, so
 * the picker groups and previews them; Barebones ones carry neither, so it falls
 * back to a flat list whose summary is the gear the background grants.
 * ======================================================================== */

/** The pack a content source's backgrounds live in. */
const BG_PACK_FOR = { "2e": "air-bladder.backgrounds-2e", barebones: BAREBONES_BG_PACK };

/**
 * The SHIPPED custom pack (2026-08-04 ruling): "custom" means not published in
 * the Cairn 2e Player's Guide — whoever wrote it. This pack ships third-party
 * CC BY-SA sets (currently "Backgrounds for Cairn", Gordon McCormick) and is
 * admitted by the same CUSTOM toggle as the Warden's own authored backgrounds.
 */
const SHIPPED_CUSTOM_BG_PACK = "air-bladder.backgrounds-custom";

/**
 * Everything the CUSTOM toggle admits: the shipped custom pack plus the
 * world/module scan. One function so the pool and the picker's Custom section
 * can never disagree about membership.
 * @returns {Promise<CairnItem[]>}
 */
const getAllCustomBackgrounds = async () => {
  const out = [];
  const shipped = game.packs.get(SHIPPED_CUSTOM_BG_PACK);
  if (shipped) out.push(...(await shipped.getDocuments()));
  out.push(...(await getCustomBackgrounds()));
  return out;
};

/**
 * The 2e backgrounds the Warden has switched off — the picker rows' eye
 * toggle (2026-08-04), canon and custom alike. Stored as UUIDs in a world
 * setting, never on the documents: a shipped pack is replaced wholesale on
 * every system update.
 * @returns {Set<String>}
 */
export const disabledBackgrounds = () =>
  new Set(game.settings.get(SETTINGS_NS, "disabled-backgrounds") ?? []);

/**
 * Flip one background's disabled state, refusing the disable that would leave
 * generation with NOTHING to roll — the same "can never do nothing" invariant
 * the pool holds, enforced at the only place the state changes. (The pool can
 * still go empty by flipping a content-source toggle afterwards — disabling
 * every custom while canon is on, then switching canon off — and that case
 * keeps its existing answer: generation notifies and does nothing.)
 * @param {String} uuid
 * @returns {Promise<Set<String>|null>}  the new set, or null if refused
 */
export const toggleBackgroundDisabled = async (uuid) => {
  const off = disabledBackgrounds();
  if (off.has(uuid)) {
    off.delete(uuid);
  } else {
    const left = (await get2eBackgrounds()).filter((b) => b.uuid !== uuid);
    if (!left.length) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.LastBackground"));
      return null;
    }
    off.add(uuid);
  }
  await game.settings.set(SETTINGS_NS, "disabled-backgrounds", [...off]);
  return off;
};

/**
 * A homebrew-only game: the Warden has switched the shipped 2e backgrounds OFF
 * and their own ON. The distinction that matters is "off on purpose" versus
 * "nothing configured" — only the first forbids falling back to shipped content.
 * @returns {Boolean}
 */
const customOnly = () =>
  !game.settings.get(SETTINGS_NS, "content-source-2e") &&
  game.settings.get(SETTINGS_NS, "content-source-custom");

/**
 * Homebrew backgrounds: every `background` Item with source "2e" that lives in a
 * WORLD or MODULE compendium. Location, not a flag, is the discriminator — shipped
 * 2e backgrounds live in the system pack (governed by the 2e toggle, excluded
 * here), a GM's own homebrew in the editable world pack, and shared homebrew in an
 * installed module's pack. The module case is how a GM shares a set: bundle the
 * world "Custom Backgrounds" pack into a module (Foundry's Module Maker); the
 * recipient installs it and the backgrounds show up here. Module packs are usually
 * locked/read-only, which is fine — they are a source; editing goes through the
 * "Duplicate into Custom Backgrounds" action, which copies into the world pack.
 *
 * System packs are overwritten on update, so authored content must live in a world
 * (or shipped-via-module) pack to survive. Scanning is zero-config: we read the
 * lightweight pack INDEX first and only materialize documents that are actually
 * source-"2e" backgrounds, so admitting (potentially large, third-party) module
 * item packs costs a cheap index read, not a full load. Only called when the custom
 * toggle is on.
 * @returns {Promise<CairnItem[]>}
 */
const getCustomBackgrounds = async () => {
  const out = [];
  for (const pack of game.packs) {
    if (pack.metadata.type !== "Item") continue;
    const pt = pack.metadata.packageType;
    if (pt !== "world" && pt !== "module") continue;
    const index = await pack.getIndex({ fields: ["system.source"] });
    for (const entry of index) {
      if (entry.type === "background" && entry.system?.source === "2e") {
        const doc = await pack.getDocument(entry._id);
        if (doc) out.push(doc);
      }
    }
  }
  return out;
};

/**
 * The 2e background pool: the shipped pack and/or the world's custom backgrounds,
 * each gated by its own toggle and unioned de-duped by id. Shipped-off + custom-on
 * is a homebrew-only game. An empty union (everything off, or custom-on with no
 * world backgrounds yet) falls back to the shipped pack so the picker is never
 * empty — the same "can never do nothing" invariant promptContentSource holds at
 * the source level.
 * @returns {Promise<CairnItem[]>}
 */
/**
 * One fetch, both answers: the 2e pool AND which ids the CUSTOM toggle
 * admitted. `pack.getDocuments()` is a server round trip on EVERY call
 * (~1.7s warm for the 20-doc pack, measured 2026-08-04), so the picker must
 * not build the pool twice just to learn which entries are custom — that
 * doubled cost is what pushed the picker's open past the probe's wait and
 * looked like a hang.
 */
const build2ePool = async ({ includeDisabled = false } = {}) => {
  const byId = new Map();
  const customIds = new Set();
  const addShipped = async () => {
    const pack = game.packs.get(BG_PACK_FOR["2e"]);
    if (pack) for (const b of await pack.getDocuments()) byId.set(b.id, b);
  };
  const shippedOn = game.settings.get(SETTINGS_NS, "content-source-2e");
  if (shippedOn) await addShipped();
  if (game.settings.get(SETTINGS_NS, "content-source-custom")) {
    for (const b of await getAllCustomBackgrounds()) {
      byId.set(b.id, b);
      customIds.add(b.id);
    }
  }
  // Fall back ONLY when no toggle expressed a preference. A homebrew-only game
  // with nothing authored yet must NOT be quietly handed the shipped pack: the
  // Warden switched it off on purpose, and substituting it is the same mistake
  // as defaulting a dismissed dialog to 2e (issue #6) — an explicit instruction
  // overridden by a convenience. The caller notifies and generates nothing
  // instead, which is recoverable; silently generating from content you disabled
  // is not, because nothing tells you it happened.
  if (!byId.size && !customOnly()) await addShipped();
  // The per-background eye toggle filters LAST, so a disabled background stays
  // disabled through every branch above, the fallback included. includeDisabled
  // is the Warden's picker view — the rows render greyed so they can be turned
  // back on; every other caller (random rolls, swaps, imports) gets the
  // filtered pool.
  const off = includeDisabled ? null : disabledBackgrounds();
  return { docs: [...byId.values()].filter((b) => !off || !off.has(b.uuid)), customIds };
};

const get2eBackgrounds = async (opts) => (await build2ePool(opts)).docs;

/** Every background for a content source. @returns {Promise<CairnItem[]>} */
export const getBackgroundsFor = async (source) => {
  if (source === "2e") return get2eBackgrounds();
  const pack = game.packs.get(BG_PACK_FOR[source] ?? BG_PACK_FOR["2e"]);
  return pack ? pack.getDocuments() : [];
};

/** Archetype grouping order; anything else falls to the end, alphabetically. */
const ARCHETYPE_ORDER = ["Fighter", "Wizard", "Thief"];

/**
 * Backgrounds grouped by archetype, each group name-sorted. A source whose
 * backgrounds carry no archetype (Barebones) comes back as ONE unnamed group,
 * which the picker renders as a plain alphabetical list.
 * @returns {Promise<{archetype:String, backgrounds:CairnItem[]}[]>}
 */
export const getBackgroundsByArchetype = async (source) => {
  // The Warden's 2e view keeps disabled backgrounds VISIBLE — the picker greys
  // them and offers the re-enable toggle; hiding them would make a disable
  // permanent-by-accident. Players get the filtered pool. ONE pool build
  // supplies both the documents and the custom membership — see build2ePool.
  //
  // CUSTOM backgrounds get their own picker section instead of being
  // interleaved into the archetype groups (user ruling 2026-08-04): a Warden
  // reading the list tells the Player's Guide twenty from everything else at
  // a glance. Membership is by PROVENANCE — the shipped custom pack plus the
  // world/module scan — never by a field on the document, so a duplicate a
  // Warden edited stays custom and a canon background can never drift in.
  let backgrounds, customIds;
  if (source === "2e") {
    ({ docs: backgrounds, customIds } = await build2ePool({ includeDisabled: game.user.isGM }));
  } else {
    backgrounds = await getBackgroundsFor(source);
    customIds = new Set();
  }
  // Sort on the DISPLAYED name (review #9): the picker renders t("bg.name", …),
  // so sorting on the stored English shuffled the list in any other language.
  // The radio VALUES still carry the English name — only the ordering key moved.
  const byName = (x, y) =>
    t("bg.name", x.name).localeCompare(t("bg.name", y.name), game.i18n.lang);
  const custom = backgrounds.filter((b) => customIds.has(b.id)).sort(byName);
  const canon = backgrounds.filter((b) => !customIds.has(b.id));

  let out;
  if (!canon.some((b) => b.system.archetype)) {
    // No archetypes at all (every Barebones background): one unnamed group the
    // picker renders as a plain alphabetical list.
    out = canon.length ? [{ archetype: "", backgrounds: [...canon].sort(byName) }] : [];
  } else {
    const groups = new Map();
    for (const bg of canon) {
      const a = bg.system.archetype || "Other";
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(bg);
    }
    const order = [
      ...ARCHETYPE_ORDER.filter((a) => groups.has(a)),
      ...[...groups.keys()].filter((a) => !ARCHETYPE_ORDER.includes(a)).sort(),
    ];
    out = order.map((a) => ({ archetype: a, backgrounds: groups.get(a).sort(byName) }));
  }
  // "Custom" resolves through archetypeLabel -> CAIRN.Archetype.Custom, the
  // "Custom 2e Backgrounds" heading. Last on purpose: canon first, then yours.
  if (custom.length) out.push({ archetype: "Custom", backgrounds: custom });
  return out;
};

/**
 * The one-line summary shown beside a background's name in the picker: the first
 * sentence of its description, or — for a background with no prose, which is
 * every Barebones one — the gear it grants. The gear line is DERIVED from the
 * references rather than stored, so it cannot go stale when a Warden edits them.
 * @param {CairnItem} bg
 * @returns {String}
 */
export const backgroundTagline = (bg) => {
  // Display-only, so everything here goes through the overlay: the first sentence
  // is taken from the TRANSLATED description (a first sentence sliced off English
  // and then looked up would never match a key), and gear names use the same
  // item.name namespace the inventory does.
  const text = t("bg.desc", String(bg.system?.description ?? "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text) return (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim();
  // This used to lowercase the "Slots" LABEL and concatenate "+N " onto it:
  // `toLowerCase()` is locale-unaware (German capitalises nouns and Turkish
  // dotless-i is the classic casualty), and "+2 slots" is English word order
  // nobody could reorder. `CAIRN.NSlot` is the counted noun, already lowercase
  // and already the translator's, and formatCount picks its plural form —
  // "+1 slots" was the other half of the same bug.
  const gear = (bg.system?.startingGear ?? []).map((g) => t("item.name", g.name));
  const carried = (bg.system?.containers ?? []).map((c) => game.i18n.format(
    "CAIRN.BgTagline.Carried",
    { name: t("item.name", c.name), slots: formatCount("CAIRN.NSlot", c.slots) }
  ));
  // Narrow conjunction: "A, B, C" in English, the locale's own form elsewhere.
  const list = new Intl.ListFormat(game.i18n.lang ?? "en", { style: "narrow", type: "conjunction" });
  return list.format([...gear, ...carried]);
};

/**
 * Display label for an archetype. The stored value is the English identity (it
 * groups and sorts, and a Warden-authored background may carry anything), so it is
 * translated only on the way to the screen, falling back to the raw string for a
 * custom archetype that has no key.
 * @param {String} archetype
 * @returns {String}
 */
const archetypeLabel = (archetype) => {
  const key = `CAIRN.Archetype.${archetype}`;
  const hit = game.i18n.localize(key);
  return hit === key ? archetype : hit;
};

/** Escape for interpolation into the picker's HTML. */
const bgEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** Sentinel radio value for the "Random" row. */
const BG_RANDOM = "__random__";

/**
 * The background picker. Grouped by archetype with a live description panel when
 * the source has prose (2e); a single wide column when it does not (Barebones),
 * where each row already shows everything the background gives you and a panel
 * would only repeat it.
 *
 * Instance pattern (as _onEditPortrait): render, then wire listeners on
 * dialog.element. Button callbacks resolve directly and a wrapped close() covers
 * manual dismissal (X / Escape); the `done` guard stops that close from
 * overwriting a choice already made.
 * @param {String} source  "2e" | "barebones"
 * @param {String|null} currentUuid  pre-checked, so the dialog opens on the current pick
 * @returns {Promise<{bg: CairnItem|null}|false>}  bg null = random; false = cancelled
 */
export const promptBackground = async (source, currentUuid = null) => {
  const groups = await getBackgroundsByArchetype(source);
  const all = groups.flatMap((g) => g.backgrounds);
  if (!all.length) return false;
  const hasProse = all.some((b) => b.system.description);

  // The eye toggle is a 2e concept and a Warden's control: canon and custom
  // rows alike carry it, Barebones is all-or-nothing via its source checkbox
  // (both ruled 2026-08-04). Players never reach this branch with a disabled
  // row — their pool is already filtered.
  const showEyes = source === "2e" && game.user.isGM;
  const off = source === "2e" ? disabledBackgrounds() : new Set();

  let list = `<label class="bg-pick-row"><input type="radio" name="bg" value="${BG_RANDOM}"${currentUuid ? "" : " checked"}>
    <span class="bg-pick-name"><i class="fas fa-dice"></i> ${game.i18n.localize("CAIRN.RandomBackground")}</span></label>`;
  const descs = {};
  for (const g of groups) {
    if (g.archetype) list += `<div class="bg-pick-group">${bgEsc(archetypeLabel(g.archetype))}</div>`;
    for (const bg of g.backgrounds) {
      // Display-only, exactly as the sheet renders the same two fields — the radio
      // VALUE stays the uuid, so what gets chosen is unaffected by language.
      descs[bg.uuid] = t("bg.desc", bg.system.description ?? "");
      // A disabled row cannot be checked — including the pre-check on the
      // character's current background; "nothing checked reads as Random".
      const isOff = off.has(bg.uuid);
      const eye = showEyes
        ? `<button type="button" class="bg-pick-eye" data-uuid="${bg.uuid}"
             title="${game.i18n.localize(isOff ? "CAIRN.BgPickEnable" : "CAIRN.BgPickDisable")}">
             <i class="fas ${isOff ? "fa-eye-slash" : "fa-eye"}"></i></button>`
        : "";
      list += `<label class="bg-pick-row${isOff ? " bg-pick-off" : ""}">
        <input type="radio" name="bg" value="${bg.uuid}"${bg.uuid === currentUuid && !isOff ? " checked" : ""}${isOff ? " disabled" : ""}>
        <span class="bg-pick-name">${bgEsc(t("bg.name", bg.name))}</span>
        <span class="bg-pick-tag">${bgEsc(backgroundTagline(bg))}</span>${eye}</label>`;
    }
  }
  // The authoring pointer (user ruling 2026-08-05, "option 1"): the picker is
  // the moment someone is looking at what backgrounds exist, so the how-to
  // link lives here — 2e only, because custom backgrounds are a 2e concept.
  const GUIDE_URL = "https://github.com/domfortunato/air-bladder/blob/master/docs/creating-custom-backgrounds.md";
  const foot = source === "2e"
    ? `<div class="bg-pick-foot">${game.i18n.localize("CAIRN.BgPickFootQuestion")}
        <a href="${GUIDE_URL}" target="_blank" rel="noopener">${game.i18n.localize("CAIRN.BgPickFootLink")}</a></div>`
    : "";
  const content = hasProse
    ? `<div class="bg-picker"><div class="bg-pick-list">${list}</div><div class="bg-pick-desc"></div>${foot}</div>`
    : `<div class="bg-picker single"><div class="bg-pick-list">${list}</div>${foot}</div>`;

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("CAIRN.ChooseBackground"), icon: "fas fa-book-open" },
      position: { width: hasProse ? 620 : 560 },
      content,
      buttons: [
        {
          action: "choose",
          label: game.i18n.localize("CAIRN.Choose"),
          default: true,
          callback: () => {
            const form = dialog.element.querySelector("form") ?? dialog.element;
            // Nothing checked (a Warden emptied the pack) reads as Random.
            finish(form?.elements?.bg?.value || BG_RANDOM);
          },
        },
        { action: "cancel", label: game.i18n.localize("CAIRN.Cancel"), callback: () => finish(false) },
      ],
    });
    const origClose = dialog.close.bind(dialog);
    dialog.close = (...a) => { finish(false); return origClose(...a); };
    dialog.render(true).then(() => {
      // DialogV2 serializes content to innerHTML, so listeners go on the LIVE
      // nodes here, after render — never on the built string's nodes.
      // The eye toggles (Warden only). The row is a <label>, so the click must
      // not fall through and check the radio it sits beside.
      dialog.element.querySelectorAll(".bg-pick-eye").forEach((btn) => {
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const uuid = btn.dataset.uuid;
          const now = await toggleBackgroundDisabled(uuid);
          if (now === null) return; // refused: it was the last enabled background
          const isOff = now.has(uuid);
          const row = btn.closest(".bg-pick-row");
          row.classList.toggle("bg-pick-off", isOff);
          const radio = row.querySelector('input[name="bg"]');
          radio.disabled = isOff;
          if (isOff && radio.checked) {
            // The selection cannot rest on a background players can't have.
            radio.checked = false;
            const rand = dialog.element.querySelector(`input[name="bg"][value="${BG_RANDOM}"]`);
            if (rand) { rand.checked = true; rand.dispatchEvent(new Event("change")); }
          }
          btn.title = game.i18n.localize(isOff ? "CAIRN.BgPickEnable" : "CAIRN.BgPickDisable");
          btn.querySelector("i").className = `fas ${isOff ? "fa-eye-slash" : "fa-eye"}`;
        });
      });
      if (!hasProse) return;
      const panel = dialog.element.querySelector(".bg-pick-desc");
      const update = (v) => {
        panel.innerHTML = v === BG_RANDOM
          ? `<em>${game.i18n.localize("CAIRN.RandomBackgroundHint")}</em>`
          : (descs[v] ?? "");
      };
      dialog.element.querySelectorAll('input[name="bg"]').forEach((r) => {
        r.addEventListener("change", () => update(r.value));
        if (r.checked) update(r.value);
      });
    });
  }).then(async (choice) => {
    if (!choice) return false;
    return { bg: choice === BG_RANDOM ? null : await fromUuid(choice) };
  });
};

/**
 * Pick a failed career: a second Barebones background NAME. The caller stores it
 * and swaps the one keepsake item (`failedCareerItemFromBg` below); this returns
 * only the name.
 *
 * Deliberately not `promptBackground`. That returns a document and swaps a real
 * background, gear and all; this returns a bare string and swaps nothing. Sharing
 * one function would mean one of the two callers passing a flag saying "but don't
 * actually do the thing", which is how the system this descends from ended up with
 * four near-identical background swappers.
 * @param {String|null} [currentName]
 * @returns {Promise<{name: String}|false>}  false when cancelled
 */
export const promptFailedCareer = async (currentName = null) => {
  const backgrounds = await getBarebonesBackgrounds();
  if (!backgrounds.length) return false;
  // Same display-name sort as promptBackground's groups (review #9).
  const sorted = [...backgrounds].sort((a, b) =>
    t("bg.name", a.name).localeCompare(t("bg.name", b.name), game.i18n.lang));

  let list = `<label class="bg-pick-row"><input type="radio" name="bg" value="${BG_RANDOM}"${currentName ? "" : " checked"}>
    <span class="bg-pick-name"><i class="fas fa-dice"></i> ${game.i18n.localize("CAIRN.RandomBackground")}</span></label>`;
  for (const bg of sorted) {
    // Show the career's gear so the player can see what the keepsake item might be.
    const gear = (bg.system?.startingGear ?? []).map((g) => bgEsc(t("item.name", g.name))).join(", ");
    // Display-only: the radio VALUE keeps the English name (it is what gets stored
    // as the failed career), only the visible label is localized.
    list += `<label class="bg-pick-row"><input type="radio" name="bg" value="${bgEsc(bg.name)}"${bg.name === currentName ? " checked" : ""}>
      <span class="bg-pick-name">${bgEsc(t("bg.name", bg.name))}</span>${gear ? `<span class="bg-pick-tag">${gear}</span>` : ""}</label>`;
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("CAIRN.ChangeFailedCareer"), icon: "fas fa-user-slash" },
      position: { width: 420 },
      content: `<div class="bg-picker single"><div class="bg-pick-list">${list}</div></div>`,
      buttons: [
        {
          action: "choose",
          label: game.i18n.localize("CAIRN.Choose"),
          default: true,
          callback: () => {
            const form = dialog.element.querySelector("form") ?? dialog.element;
            finish(form?.elements?.bg?.value || BG_RANDOM);
          },
        },
        { action: "cancel", label: game.i18n.localize("CAIRN.Cancel"), callback: () => finish(false) },
      ],
    });
    const origClose = dialog.close.bind(dialog);
    dialog.close = (...a) => { finish(false); return origClose(...a); };
    dialog.render(true);
  }).then((choice) => {
    if (!choice) return false;
    if (choice === BG_RANDOM) return { name: sorted[Math.floor(Math.random() * sorted.length)].name };
    return { name: choice };
  });
};

/**
 * A random Barebones background name for the failed-career field, avoiding
 * `exclude` (normally the character's real background, mirroring generation).
 * Returns the name only; the keepsake item is the caller's to grant
 * (`buildFailedCareerItem`). Empty string if the pack is empty.
 * @param {String} [exclude]
 * @returns {Promise<String>}
 */
export const rollFailedCareerName = async (exclude = "") => {
  const backgrounds = await getBarebonesBackgrounds();
  const pool = backgrounds.filter((b) => b.name !== exclude);
  const from = pool.length ? pool : backgrounds;
  return from.length ? from[Math.floor(Math.random() * from.length)].name : "";
};

/**
 * One Petty keepsake item drawn at random from a Barebones background's gear — the
 * single thing the character kept from the career that didn't work out. Forced
 * weightless so it never costs a slot (and so can never be displaced by fatigue,
 * which is just 1-slot items); the "Failed Career" chip comes from the grant flag,
 * the "Petty" chip from weightless. Null when the career has no resolvable gear.
 * @param {CairnItem} bg  a Barebones background Item
 * @returns {Promise<Object|null>}
 */
const failedCareerItemFromBg = async (bg) => {
  const gear = bg?.system?.startingGear ?? [];
  if (!gear.length) return null;
  const ref = gear[Math.floor(Math.random() * gear.length)];
  const item = await resolveRef(ref);
  if (!item) return null;
  item.system = { ...(item.system ?? {}), weightless: true, bulky: false };
  return withGrantSource(item, "failed-career");
};

/**
 * The same keepsake, resolved by failed-career NAME — the sheet's re-roll path,
 * where only the stored name is on hand.
 * @param {String} careerName
 * @returns {Promise<Object|null>}
 */
export const buildFailedCareerItem = async (careerName) =>
  failedCareerItemFromBg(await getBarebonesBackgroundByName(careerName));

/**
 * Swap the actor's failed-career keepsake for a fresh pick from `careerName`'s
 * gear. The generator-side twin of the sheet's `_grantFailedCareerItem` inner
 * swap (that one is instance-bound and adds a re-entry guard + render the
 * collision hook below does not need). Matched by the `grantSource:
 * "failed-career"` flag, the same convention `_replaceGrantedItems` keys on.
 * @param {CairnActor} actor
 * @param {String} careerName
 */
const replaceFailedCareerKeepsake = async (actor, careerName) => {
  const oldIds = actor.items
    .filter((i) => String(i.getFlag(FLAG_SCOPE, "grantSource") ?? "") === "failed-career")
    .map((i) => i.id);
  if (oldIds.length) await actor.deleteEmbeddedDocuments("Item", oldIds, { render: false, abNoStatusCard: true });
  const item = careerName ? await buildFailedCareerItem(careerName) : null;
  if (item) await actor.createEmbeddedDocuments("Item", [item], { render: false, abNoStatusCard: true });
};

/**
 * Swap a character's background WITHOUT re-rolling the character. Replaces the
 * background name/uuid, the gear it granted, its containers, and (2e) its two
 * questions and the gear those granted, adjusting coins for the question delta.
 * KEEPS abilities, HP, name, traits, age, bonds, portrait, omen, scars, notes,
 * conditions, and anything bought or picked up — regenerating all of that is
 * Regenerate's job, and conflating the two is why the fork needed four functions.
 *
 * Bonds are deliberately NOT re-rolled: a new background's second-bond
 * entitlement surfaces the sheet's "Add a bond" link instead of silently
 * rolling. But entitlement DOES clamp down (ruled 2026-08-02): landing on a
 * background whose entitlement is below the stored bond count removes the
 * excess from the END — the first bond always survives — with the ✕ button's
 * semantics (granted items deleted, gold refunded). Before the clamp, a
 * detour through Fieldwarden left a second bond stored forever.
 * A null `newBg` picks a random one, never the current.
 * @param {CairnActor} actor
 * @param {CairnItem|null} [newBg]
 */
export const changeBackground = async (actor, newBg = null) => {
  if (!canRegenerateContainers(actor)) return; // bail before deleting anything
  const source = actor.system.contentSource || "2e";
  let bg = newBg;
  if (!bg) {
    const backgrounds = await getBackgroundsFor(source);
    // Say why nothing happened. An empty pool is now reachable on purpose (a
    // homebrew-only game with nothing authored yet), so a bare `return` would
    // read as a dead button.
    if (!backgrounds.length) {
      ui.notifications?.warn(game.i18n.localize(
        source === "2e" && customOnly() ? "CAIRN.NoCustomBackgrounds" : "CAIRN.NoBackgrounds2e"));
      return;
    }
    const pool = backgrounds.filter((b) => b.uuid !== actor.system.backgroundUuid);
    const from = pool.length ? pool : backgrounds;
    bg = from[Math.floor(Math.random() * from.length)];
  }

  // Out with the old: everything the OLD background put there, and nothing else.
  // Matched by the grant tag; legacy untagged starting gear is matched by the old
  // background's own reference names, one item apiece, so a character generated
  // before tagging existed still swaps cleanly.
  const oldBg = actor.system.backgroundUuid ? await fromUuid(actor.system.backgroundUuid) : null;
  const toDelete = [];
  const claimed = new Set();
  for (const i of actor.items) {
    const src = String(i.getFlag(FLAG_SCOPE, "grantSource") ?? "");
    if (src === "background" || src.startsWith("question:")) { claimed.add(i.id); toDelete.push(i.id); }
  }
  for (const g of oldBg?.system?.startingGear ?? []) {
    const hit = actor.items.find(
      (i) => !claimed.has(i.id) && !i.getFlag(FLAG_SCOPE, "grantSource") && i.name === g.name
    );
    if (hit) { claimed.add(hit.id); toDelete.push(hit.id); }
  }
  // abNoStatusCard on every write in this swap (and in the generators below):
  // a background change is MACHINERY, and the change log defines "manual" as
  // an operation without the flag — without it a swap floods the ledger with a
  // dozen add/remove lines and a gold line nobody typed.
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete, { render: false, abNoStatusCard: true });
  await clearGrantedContainers(actor);

  // In with the new. Weapons and armor arrive equipped, as at generation, so
  // Armor derives to the value the background intends. resolveStartingGear, not a
  // plain reference lookup, so a Barebones background whose gear includes an SRD
  // instruction ("Spellbook", "Random Additional Gear") grants it here too.
  const gear = tagBackgroundGear(await resolveStartingGear(bg));
  for (const it of gear) {
    if (it.type === "weapon" || it.type === "armor") it.system.equipped = true;
  }
  const choices = await applyChoiceTables(bg);
  const newItems = [...gear, ...choices.items];
  if (newItems.length) await actor.createEmbeddedDocuments("Item", newItems, { render: false, abNoStatusCard: true });
  await grantContainers(actor, [
    ...(bg.system.containers ?? []).map((c) => ({ ...c, grantSource: "background" })),
    ...choices.containers,
  ]);

  // Clamp bonds to the NEW background's entitlement (ruled 2026-08-02). The
  // upward case stays manual ("Add a bond"), but excess is removed from the
  // END — the first bond always survives — with #onRemoveBond's semantics:
  // the bond's granted items go, its gold grant is refunded. Uses the shared
  // bondEntitlement (never the sheet's Barebones display policy: a lent bond
  // is not deleted because a display setting is off).
  const bonds = foundry.utils.duplicate(actor.system.bonds ?? []);
  const allowed = bondEntitlement(bg, choices.questions);
  let clampGold = 0;
  const clampItemIds = [];
  while (bonds.length > allowed) {
    const dropped = bonds.pop();
    clampGold += dropped.gold ?? 0;
    for (const i of actor.items) {
      if (String(i.getFlag(FLAG_SCOPE, "grantSource") ?? "") === `bond:${dropped.id}`) clampItemIds.push(i.id);
    }
  }
  if (clampItemIds.length) await actor.deleteEmbeddedDocuments("Item", clampItemIds, { render: false, abNoStatusCard: true });

  // Trade the old questions' coins for the new ones'.
  const oldQGold = (actor.system.questions ?? []).reduce((n, q) => n + (q.gold ?? 0), 0);
  // No `contentSource` here on purpose: a character does not change edition. Every
  // caller is source-scoped — the picker only ever offers this character's own
  // edition, and a cross-edition DROP is refused outright (_onDropBackground) — so a
  // background arriving here always matches. Code to follow a differing source would
  // be unreachable, and unreachable code that looks like protection is worse than
  // none.
  const update = {
    "system.background": bg.name,
    "system.backgroundUuid": bg.uuid,
    "system.questions": choices.questions,
    "system.gold": Math.max(0, (actor.system.gold ?? 0) - oldQGold + choices.gold - clampGold),
  };
  // Write bonds only when the clamp bit — preservation stays the default, and
  // an untouched array is not re-written wholesale for nothing.
  if (bonds.length !== (actor.system.bonds ?? []).length) update["system.bonds"] = bonds;
  await actor.update(update, { abNoStatusCard: true });

  // A background change may not land ON the failed career (ruled 2026-08-08).
  // Every ROLL path already excludes — generation filters the background from
  // the failed-career pool, and the sheet's failed-career die passes the
  // exclusion — so the one arrival left is this direction: the BACKGROUND
  // changing onto the name the failed career already holds. Re-roll the career
  // (rollFailedCareerName excludes the new background, so it cannot
  // re-collide) and its keepsake, silently: an automatic correction is
  // machinery, same as every other write in this function. Here at the end of
  // changeBackground, not in the sheet handlers, so roll, pick and drop are
  // all covered. A hand-PICKED collision on the failed-career line itself
  // stays allowed — that is a deliberate player choice; this hook only fires
  // when the collision arrives from the background side.
  if (source === "barebones" && actor.system.failedCareer && actor.system.failedCareer === bg.name) {
    const fresh = await rollFailedCareerName(bg.name);
    await actor.update({ "system.failedCareer": fresh }, { abNoStatusCard: true });
    await replaceFailedCareerKeepsake(actor, fresh);
  }
};

/* -------------------------------------------------------------------------- */
/*  Actor create / update                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {Object} characterData
 * @returns {Object} Foundry create/update data for a character
 */
const characterToActorData = (characterData) => ({
  name: characterData.name,
  system: {
    // Generated actors land with the Randomization switch OFF, explicitly —
    // the schema initial says the same since 2026-08-02, but the generator's
    // intent should survive any future default change (the container and
    // marketplace writers already model this).
    generationEnabled: false,
    abilities: {
      STR: { value: characterData.abilities.STR, max: characterData.abilities.STR },
      DEX: { value: characterData.abilities.DEX, max: characterData.abilities.DEX },
      WIL: { value: characterData.abilities.WIL, max: characterData.abilities.WIL },
    },
    hp: { max: characterData.hp, value: characterData.hp },
    background: characterData.background,
    backgroundUuid: characterData.backgroundUuid ?? "",
    contentSource: characterData.contentSource ?? "2e",
    // Barebones-only flavor (empty on 2e / when the setting is off). Set
    // unconditionally so a regenerate re-rolls or clears it with the rest.
    failedCareer: characterData.failedCareer ?? "",
    // Multiple bonds live in system.bonds (each with a stable id).
    bonds: characterData.bonds ?? [],
    age: characterData.age ?? "",
    ...(characterData.traits ? { traits: characterData.traits } : {}),
    // 2e stores the background's two choice-table answers as structured,
    // individually re-rollable questions.
    biography: characterData.biography ?? "",
    questions: characterData.questions ?? [],
    // Omens and Scars are never generated: a player enables and fills each by
    // hand. Set unconditionally so regenerating in place resets both.
    omenEnabled: false,
    omen: "",
    scarEnabled: false,
    scars: [],
    // A fresh (or regenerated) character is never critically wounded (STR-only).
    critical: false,
    // Armor is auto-derived from equipped gear; no manual override on (re)generate.
    armorOverride: null,
    gold: characterData.gold,
  },
  items: characterData.items,
  prototypeToken: {
    name: characterData.name,
    disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
    actorLink: true,
    // No `vision` key: it is not in PrototypeToken's schema and was pruned
    // silently, so every PC generated before 2026-08-02 arrived blind. Sight is
    // stamped in CairnActor#_preCreate, which every creation route reaches.
  },
  type: "character",
});

/**
 * @param {Object} characterData
 * @returns {Promise<CairnActor|null>}
 */
export const createActorWithCharacter = async (characterData, { folder = null, ownership = null } = {}) => {
  if (!characterData) return null;
  const data = characterToActorData(characterData);
  // A random portrait + its paired token, assigned ONLY here on creation.
  // characterToActorData deliberately omits img/texture.src, so Regenerate (which
  // goes through updateActorWithCharacter with the same data) cannot disturb a
  // portrait the player picked -- the persistence is by omission.
  const pair = await randomPortraitPair("pc");
  if (pair) {
    data.img = pair.img;
    data.prototypeToken.texture = { src: pair.token };
  }
  // The createDialog switchboard threads the folder "+"'s destination through
  // here (2026-08-02); the directory button passes nothing and lands at root.
  if (folder) data.folder = folder;
  // The generatePC relay mints on the Warden's client FOR a player, so the
  // requester's OWNER must be in the CREATE data, not patched on after:
  // grantContainers below derives each granted mule's connected-ownership
  // shape from the keeper's ownership, and a late patch would hand the player
  // a character whose own mount they cannot open.
  if (ownership) data.ownership = ownership;
  const actor = await CairnActor.create(data);
  await grantContainers(actor, characterData.containers);
  return actor;
};

/**
 * @param {CairnActor} actor
 * @param {Object} characterData
 * @returns {Promise<CairnActor>}
 */
export const updateActorWithCharacter = async (actor, characterData) => {
  if (!characterData) return actor;
  const data = characterToActorData(characterData);
  // Items go through createEmbeddedDocuments, never through `actor.update({items})`:
  // the update route creates the embedded documents server-side without firing a
  // single createItem hook, so anything listening — a module, a world script —
  // sees a regenerate as an actor whose inventory changed with no item ever
  // created. changeBackground above has used the hook-firing route all along.
  // `render: false` + data-update last mirrors it: one render, inventory present.
  const items = data.items ?? [];
  delete data.items;
  // abNoStatusCard on both embedded writes: regenerating is machinery, and the
  // change log must not report a rebuild as a player emptying and refilling
  // their own pack. The data update below already carries the flag.
  await actor.deleteEmbeddedDocuments("Item", [], { deleteAll: true, render: false, abNoStatusCard: true });
  // Containers are Actors, so re-rolling the inventory has to clear them by hand.
  // Only GENERATION-granted ones (they carry a grantSource flag) are deleted —
  // a bought mule or a hand-made chest survives a regenerate.
  await clearGrantedContainers(actor);
  if (items.length) await actor.createEmbeddedDocuments("Item", items, { render: false, abNoStatusCard: true });
  // `characterToActorData` clears `critical` unconditionally, and regenerating is
  // REPLACING this person, not healing them -- without this the rebuild announces a
  // stabilization that never happened. Same argument and same flag as regenerateHireling
  // and rerollHirelingCareer; this path and regenerateMonster were the two that
  // missed it. See CairnActor#_onUpdate.
  await actor.update(data, { abNoStatusCard: true });
  await grantContainers(actor, characterData.containers);
  // The tokens follow through CairnActor's rename rule (every scene, only the
  // ones still wearing the old name) — this used to rename the ACTIVE scene's
  // tokens by hand, unconditionally.
  return actor;
};

/** Message flag (under FLAG_SCOPE) carrying a generation card's numbers. */
export const GENERATION_ROLLS_FLAG = "generationRolls";

/**
 * The generation-rolls card body, built in THIS client's language from the
 * numbers alone. Used at composition (the stored content, in the composer's
 * language) and again on every render by `localizeGenerationCard` below — the
 * stored card is the composer's, and on the player-request relay the composer
 * is the Warden's client, so a player in another language read the Warden's
 * labels (review #18; the GLOG cast card's precedent from #16). A plain string
 * build rather than the Handlebars template it replaces, so the render-time
 * rebuild is synchronous: the name is escaped, the numbers are numbers.
 * @param {{name: string, hp: number, str: number, dex: number, wil: number, gold: number}} r
 * @returns {string}
 */
export const generationRollsCard = ({ name, hp, str, dex, wil, gold }) => {
  const L = (k) => game.i18n.localize(k);
  const row = (label, value) =>
    `<div class="gen-roll-row"><span class="gen-roll-label">${label}:</span> <span class="gen-roll-value">${Number(value)}</span></div>`;
  const line = game.i18n.format("CAIRN.GenerationRolls", { name: foundry.utils.escapeHTML(String(name ?? "")) });
  return `<div class="cairn-generation-rolls">
    <div class="gen-rolls-title">${line}</div>
    <div class="gen-rolls-grid">
        ${row(L("CAIRN.HitProtection"), hp)}
        ${row(L("STR"), str)}
        ${row(L("DEX"), dex)}
        ${row(L("WIL"), wil)}
        ${row(L("CAIRN.Gold"), gold)}
    </div>
</div>`;
};

/**
 * Rebuild a generation-rolls card in the VIEWER's language from its flag.
 * Called from the renderChatMessageHTML hook (cairn.js), beside the GLOG cast
 * card it copies. Display-only: the message is never written, so this runs on
 * a player's client with no permission at all, and re-runs idempotently on
 * every re-render because it rebuilds from the flag, not from what is shown.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export const localizeGenerationCard = (message, html) => {
  const r = message.getFlag(FLAG_SCOPE, GENERATION_ROLLS_FLAG);
  if (!r) return;
  const card = html.querySelector(".cairn-generation-rolls");
  if (card) card.outerHTML = generationRollsCard(r);
};

/**
 * Post the five generation rolls -- HP, STR, DEX, WIL, Gold -- as ONE chat message.
 *
 * The Rolls ride in `rolls:`, which is what earns the dice: Dice So Nice animates
 * every roll on a created ChatMessage with no integration code on our side, and
 * core's _preCreate supplies CONFIG.sounds.dice when rolls are present and no
 * sound is given. So this needs no `game.dice3d` call, and a world without DSN
 * still gets a card and a dice sound.
 *
 * That also settles the relay: a player without ACTOR_CREATE has their character
 * generated on the Warden's client (the generatePC socket branch in cairn.js), and
 * a chat message BROADCASTS -- so the player sees their own dice. A bare
 * dice3d.showForRoll() would have animated on the Warden's screen alone, which a
 * Warden testing solo cannot tell apart from working.
 *
 * Called ONLY from createCharacter and regenerateActor, never from
 * createActorWithCharacter/updateActorWithCharacter: about fourteen dev probes
 * build characters through those directly, and they must stay chat-silent. Name,
 * background and portrait re-rolls never reach here at all -- none of them is a
 * Roll (two are Math.random picks, one is a table roll() with displayChat false).
 *
 * The speaker reads "<Character> (<Roller>)" -- the character who was rolled, and
 * the person who rolled them. `roller` is passed explicitly rather than taken from
 * `game.user` because of the same relay: on that path this code runs on the
 * Warden's client, so `game.user` is the Warden and the card would credit them for
 * a character the player made. The relay hands us the requesting user instead.
 *
 * @param {CairnActor|null} actor
 * @param {Object|null} characterData  a generator's return, carrying `.rolls`
 * @param {User|null} [roller]  who rolled; defaults to whoever is running this
 * @param {Object} [options]
 * @param {boolean} [options.waitForDice=true]  hold until Dice So Nice has
 *   finished animating, so the caller's sheet opens AFTER the dice land.
 * @returns {Promise<ChatMessage|null>}  the posted card, for a caller that wants
 *   to wait on it itself.
 */
const postGenerationRolls = async (actor, characterData, roller = null, { waitForDice = true } = {}) => {
  const rolls = characterData?.rolls;
  if (!actor || !rolls) return;
  if (!game.settings.get(SETTINGS_NS, "show-generation-rolls")) return;
  // A chat failure must never cost the actor: it is already created and saved by
  // the time we get here, so this is reported and swallowed, never rethrown.
  try {
    // The numbers the card shows, stored on the message as a FLAG so every
    // viewer's client rebuilds the card in its own language at render
    // (localizeGenerationCard, off the renderChatMessageHTML hook). The
    // content stored beside it is the same card in the composer's language.
    const numbers = {
      name: actor.name,
      hp: rolls.hp.total,
      str: rolls.STR.total,
      dex: rolls.DEX.total,
      wil: rolls.WIL.total,
      // The BARE gold roll, not actor.system.gold -- bond and background-choice
      // gold are added on top of it, and the card must agree with the dice.
      gold: rolls.gold.total,
    };
    const content = generationRollsCard(numbers);
    // The card's header names the PLAYER, not the character: it reads as one
    // sentence down the card -- "Warden" / "rolled a new character!" / "Ada".
    // getSpeaker would otherwise put the actor's name there, which duplicates the
    // name line and loses the only place the roller is identified. Only these
    // generation cards read this way; every other card keeps the plain speaker.
    const speaker = ChatMessage.getSpeaker({ actor });
    const who = (roller ?? game.user)?.name;
    if (who) speaker.alias = who;
    const message = await ChatMessage.create({
      speaker,
      rolls: [rolls.hp, rolls.STR, rolls.DEX, rolls.WIL, rolls.gold],
      content,
      flags: { [FLAG_SCOPE]: { [GENERATION_ROLLS_FLAG]: numbers } },
    });
    if (waitForDice) await awaitDiceAnimation(message?.id);
    return message ?? null;
  } catch (err) {
    console.error("Air Bladder | could not post the generation rolls to chat:", err);
    return null;
  }
};

/**
 * Hold until Dice So Nice has finished throwing a message's dice.
 *
 * The point is ORDERING, not decoration: `ChatMessage.create` resolves as soon as
 * the document is saved, but DSN animates for seconds afterwards, so a caller
 * that opened the new character's sheet on that resolution put the sheet on
 * screen while the dice were still in the air — the sheet spoiled its own roll.
 * Waiting here rather than at each render site fixes all three of them at once
 * (the Create Actor dialog, the directory button, and the player relay).
 *
 * Safe with no DSN and safe with DSN configured away: `game.dice3d` is undefined
 * unless the module is active, and DSN's own API resolves immediately when its
 * visibility is "none", when `immediatelyDisplayChatMessages` is set, or when the
 * message is not animating (main.js, waitFor3DAnimationByMessageID). So the delay
 * happens exactly when there is an animation to wait for and never otherwise —
 * which is why this needs no setting of its own.
 *
 * The timeout is the part that earns its keep. DSN resolves on its
 * `diceSoNiceRollComplete` hook, and a hook that never fires (a failed throw, a
 * module error) would otherwise hang character generation forever with no error
 * anywhere. A cap turns the worst case back into today's behaviour.
 *
 * @param {string|null|undefined} messageId
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=20000]
 * @returns {Promise<boolean>}  true if the animation actually completed
 */
export const awaitDiceAnimation = async (messageId, { timeoutMs = 20000 } = {}) => {
  if (!messageId || typeof game.dice3d?.waitFor3DAnimationByMessageID !== "function") return false;
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(game.dice3d.waitFor3DAnimationByMessageID(messageId)).then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } catch (err) {
    // Never let a dice module's failure cost somebody their character: by the
    // time we are here the actor exists and is saved.
    console.warn("Air Bladder | waiting on the dice animation failed:", err);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * The generation card for an actor, newest first — how a client that did NOT
 * post it (the player, on the relay path) finds the animation to wait for.
 * @param {CairnActor|null} actor
 * @returns {ChatMessage|null}
 */
export const findGenerationRollMessage = (actor) => {
  if (!actor) return null;
  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.rolls?.length && m.speaker?.actor === actor.id) return m;
  }
  return null;
};

/**
 * @param {Object} [options]
 * @param {User|null} [options.roller]  who asked for this character. Only the
 *   generatePC relay passes it: there, this runs on the Warden's client for a
 *   player, and the chat card must credit the player, not whoever executed it.
 * @returns {Promise<CairnActor|null>}
 */
export const createCharacter = async ({ folder = null, ownership = null, source = null, roller = null } = {}) => {
  const characterData = await generateCharacter(null, source);
  const actor = await createActorWithCharacter(characterData, { folder, ownership });
  await postGenerationRolls(actor, characterData, roller);
  return actor;
};

/**
 * Regenerate an existing character: re-roll stats/gear/bond/traits but PERSIST the
 * background (keyed by uuid), so "Regenerate" re-rolls the character within the
 * same background.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export const regenerateActor = async (actor) => {
  if (!canRegenerateContainers(actor)) return actor; // bail before wiping items
  let bg = actor.system.backgroundUuid ? await fromUuid(actor.system.backgroundUuid) : null;
  // A Barebones character made before backgrounds had uuids is keyed by name.
  if (!bg && actor.system.contentSource === "barebones") {
    bg = await getBarebonesBackgroundByName(actor.system.background);
  }
  const characterData = await generateCharacter(bg, actor.system.contentSource);
  const updated = await updateActorWithCharacter(actor, characterData);
  await postGenerationRolls(updated, characterData);
  return updated;
};

/* ==========================================================================
 * NPC careers
 * A GM-created helper drawn from Cairn 2e's twelve example hirelings
 * (resources/hirelings.md, shipped as module/npc-careers-2e.json by
 * tools/import/npc-careers-2e.mjs). Each is a canonical statblock: a Profession, a
 * daily rate, fixed HP + STR/DEX/WIL, and a specific gear loadout (its weapon and
 * armor included). No bonds/omens/scars/traits/questions -- generated NPCs are
 * deliberately simple.
 *
 * Its gear is BY-NAME REFERENCES into the editable pool, exactly like a
 * background's starting gear: resolveGearItem clones the current pool document,
 * so editing an item flows into every NPC generated afterwards.
 * ======================================================================== */

/** The 2e careers catalogue (shipped runtime data), fetched once and cached. */
let _npcCareers2e = null;
export const getNpcCareers2e = async () => {
  if (_npcCareers2e === null) {
    try {
      const resp = await fetch("systems/air-bladder/module/npc-careers-2e.json");
      _npcCareers2e = resp.ok ? await resp.json() : [];
    } catch {
      _npcCareers2e = [];
    }
  }
  return _npcCareers2e;
};

/**
 * A random career entry, optionally avoiding a profession name so a re-roll
 * always changes.
 * @param {String|null} avoidName
 * @returns {Promise<Object|null>}
 */
const randomCareer = async (avoidName = null) => {
  const list = await getNpcCareers2e();
  if (!list.length) return null;
  const pool = avoidName ? list.filter((h) => h.name !== avoidName) : list;
  const from = pool.length ? pool : list;
  return from[Math.floor(Math.random() * from.length)];
};

/**
 * A generated NPC's name. 2e characters take their name from their background's
 * name list, which an NPC has no equivalent of, so this draws from the Warden's
 * 2e NPC name table. roll(), never draw(), so the Warden's table keeps a clean
 * drawn state.
 * @returns {Promise<String>}
 */
const rollNpcName = () =>
  rollNameFromTable(Cairn.npcGenerator.name, game.i18n.localize("CAIRN.Npc"));

/**
 * A generated NPC's canonical loadout, resolved from the pool: weapons and armor
 * equipped (so Armor derives via calcArmor to the book value -- pool items are
 * equipped:false), each tagged grantSource "profession" so a profession re-roll
 * replaces exactly these and leaves GM-added gear alone.
 * @param {Object} entry
 * @returns {Promise<Object[]>}
 */
const buildHirelingItems = async (entry) => {
  const items = await resolveRefs(entry?.gear ?? []);
  return items.map((item) => {
    if (item.type === "weapon" || item.type === "armor") item.system.equipped = true;
    return withGrantSource(item, "profession");
  });
};

/**
 * A generated person's abilities, at full. Shared by BOTH person generators
 * since 2026-08-20 — a hireling's numbers come off its career and an NPC's off
 * 3d6, but a fresh person is a fresh person, and the two must not differ on
 * whether `max` gets written.
 */
const personAbilityData = (abilities) => ({
  STR: { value: abilities.STR, max: abilities.STR },
  DEX: { value: abilities.DEX, max: abilities.DEX },
  WIL: { value: abilities.WIL, max: abilities.WIL },
});

/** Generate a full HIRELING from a random 2e career. @returns {Promise<Object>} */
export const generateHireling = async () => {
  const h = await randomCareer();
  return {
    name: await rollNpcName(),
    profession: h?.name ?? "",
    rate: h?.rate ?? 0,
    abilities: h?.abilities ?? { STR: 10, DEX: 10, WIL: 10 },
    hp: h?.hp ?? 6,
    // A person, not just a statblock (2026-08-01): the biography the PC
    // generator rolls, through the SAME paths — rollAge honours the Warden's
    // minimum-age floor, rollTextItems draws the eight tables-2e trait tables.
    // PRONOUNS ARE NEVER ROLLED (2026-08-20, user ruling). They were a uniform
    // pick of three from 2026-08-01 until now, on the reasoning that a
    // generated stranger needs an answer on arrival. They do not: pronouns are
    // not a trait off a table and there is no table for them, so the dice were
    // deciding something no die should. Stated blank rather than omitted, so a
    // full re-roll — a whole new person — clears the last one's.
    pronouns: "",
    age: String(await rollAge(Cairn.characterGenerator2e.biography.age)),
    traits: await rollTextItems(Cairn.characterGenerator2e.biography.items),
    items: orderGrantedItems(await buildHirelingItems(h)),
  };
};

/** @returns {Object} Foundry create/update data for a generated hireling. */
const hirelingToActorData = (h) => ({
  name: h.name || "NPC",
  // TYPE npc, ROLE hireling. The `hireling` type is a registered alias kept only
  // so existing documents keep their ids (see ACTOR_DATA_MODELS); nothing new is
  // ever minted under it. The role is what says this person is for hire, and
  // `forHire` rides along because it gates the rate row.
  type: "npc",
  system: {
    role: "hireling",
    // Off-by-default, stated rather than inherited — see characterToActorData.
    generationEnabled: false,
    forHire: true,
    profession: h.profession ?? "",
    dayRate: h.rate ?? 0,
    abilities: personAbilityData(h.abilities),
    hp: { value: h.hp, max: h.hp },
    // The rolled biography (generateHireling): identity fields, kept by every
    // partial re-roll and replaced only by a full regenerate.
    pronouns: h.pronouns ?? "",
    age: h.age ?? "",
    traits: h.traits ?? {},
    gold: 0,
    deprived: false,
    panicked: false,
    critical: false,
    armorOverride: null,
  },
  items: h.items,
});

/**
 * Create a fully-generated NPC actor with a random portrait + paired token
 * (assigned on creation only, like a player character; re-rolls preserve it by
 * omission).
 * @returns {Promise<CairnActor>}
 */
export const createHireling = async ({ folder = null } = {}) => {
  const data = hirelingToActorData(await generateHireling());
  const pair = await randomPortraitPair("npc");
  if (pair) {
    data.img = pair.img;
    data.prototypeToken = { ...(data.prototypeToken ?? {}), texture: { src: pair.token } };
  }
  // Folder threaded from the createDialog switchboard (2026-08-02).
  if (folder) data.folder = folder;
  return CairnActor.create(data);
};

/**
 * Full re-roll of an existing NPC: a fresh random statblock (new profession,
 * day-rate, abilities, HP and gear) AND a fresh biography (pronouns, age,
 * traits) — this is a whole new person. Keeps the name, portrait and free-form
 * notes -- the update omits them.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export const regenerateHireling = async (actor) => {
  const h = await generateHireling();
  await actor.deleteEmbeddedDocuments("Item", [], { deleteAll: true, render: false, abNoStatusCard: true });
  // createEmbeddedDocuments, never `items` inside the update: the update route
  // creates embedded documents without firing createItem hooks. Same order as
  // rerollHirelingCareer below — create render:false, then one update renders.
  // abNoStatusCard keeps the rebuild out of the change log, like the update's.
  if (h.items?.length) await actor.createEmbeddedDocuments("Item", h.items, { render: false, abNoStatusCard: true });
  await actor.update({
    system: {
      // Set alongside the rate, never separately: role hireling AND forHire gate
      // the day-rate row between them, so writing a rate without both stores a
      // number the sheet will never render.
      role: "hireling",
      forHire: true,
      profession: h.profession,
      dayRate: h.rate,
      abilities: personAbilityData(h.abilities),
      hp: { value: h.hp, max: h.hp },
      // The biography re-rolls with everything else: a regenerate is a whole
      // new person. The PARTIAL re-rolls below keep all three by OMISSION —
      // profession and name are not identity, so do not add these there.
      pronouns: h.pronouns,
      age: h.age,
      traits: h.traits,
      critical: false,
      // A whole new person resets the same defensive/status/wealth fields the
      // create payload (hirelingToActorData) sets — omitting them left the OLD npc's
      // armorOverride, gold, deprived and panicked on the regenerated one.
      armorOverride: null,
      gold: 0,
      deprived: false,
      panicked: false,
    },
  }, {
    // Regenerating is REPLACING this person, not healing them: clearing
    // `critical` here must not announce a stabilization in chat. See
    // CairnActor#_onUpdate.
    abNoStatusCard: true,
  });
  return actor;
};

/**
 * Profession re-roll: swap to a different example statblock and adopt the whole
 * of it -- Profession, day-rate, abilities, HP and granted gear (a 2e career's
 * stats ARE its profession). Keeps the name, portrait, notes, any GM-added
 * items, and the biography (pronouns/age/traits) — identity fields, kept by
 * OMISSION from the update; a new job is not a new person.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export const rerollHirelingCareer = async (actor) =>
  applyHirelingCareer(actor, await randomCareer(actor.system.profession));

/**
 * The CHOSEN-career half of the pair (2026-08-21, user ask): the magnifying
 * glass beside the Career field, the same deliberate-choice affordance the PC
 * sheet's background picker is. Adopts the WHOLE career exactly as the die
 * does — statblock, rate, gear — because a career's stats ARE its identity;
 * a picker that swapped only the word would leave a Blacksmith with a
 * scholar's arms.
 * @param {CairnActor} actor @param {String} name  the ENGLISH career name
 * @returns {Promise<CairnActor>}
 */
export const pickHirelingCareer = async (actor, name) => {
  const h = (await getNpcCareers2e()).find((c) => c.name === name);
  return h ? applyHirelingCareer(actor, h) : actor;
};

/** Shared by the Career die and the Career picker — one apply, so the two can
 *  never disagree about what adopting a career means. @private */
const applyHirelingCareer = async (actor, h) => {
  const items = await buildHirelingItems(h);
  const stale = actor.items
    .filter((i) => i.getFlag(FLAG_SCOPE, "grantSource") === "profession")
    .map((i) => i.id);
  if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale, { render: false, abNoStatusCard: true });
  if (items.length) await actor.createEmbeddedDocuments("Item", items, { render: false, abNoStatusCard: true });
  // Arrange the RESULT (2026-08-21). A career swap replaces the whole granted
  // loadout, and without this the new items ride the append seam in career-list
  // order — Rations first, the sword last, the arrangement inverted. The same
  // whole-inventory pass regenerateNpc runs, and for the same reason: what a
  // swap leaves behind should read like a freshly generated person.
  await reorderInventory(actor);
  await actor.update({
    system: {
      // See regenerateHireling: the pair travels with the rate it gates.
      role: "hireling",
      forHire: true,
      profession: h?.name ?? "",
      dayRate: h?.rate ?? 0,
      abilities: personAbilityData(h?.abilities ?? { STR: 10, DEX: 10, WIL: 10 }),
      hp: { value: h?.hp ?? 6, max: h?.hp ?? 6 },
      critical: false,
    },
  }, {
    // Same as regenerateHireling: a re-rolled career is a new statblock, not a
    // recovery, so the cleared `critical` stays out of chat.
    abNoStatusCard: true,
  });
  return actor;
};

/**
 * Re-roll only an NPC's NAME, leaving its statblock alone.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export const rerollNpcName = async (actor) => {
  await actor.update({ name: await rollNpcName() });
  // The tokens follow through CairnActor's rename rule (every scene, only the
  // ones still wearing the old name) — this used to rename the ACTIVE scene's
  // tokens by hand, unconditionally.
  return actor;
};

/**
 * Re-roll only an NPC's or Monster's FACTION, leaving everything else alone.
 * The table resolves BY NAME, world first (findTableByName): a Warden's own
 * "Warden: NPC - Faction" beats the shipped warden-npcs copy, so their
 * campaign's faction list survives a system update. roll(), never draw() —
 * the Warden's-tables invariant (module/config.js).
 *
 * The rolled text is baked through t("table.result") — the ratified
 * monster-generation exception: a rolled faction is WORLD content authored
 * in the session's language (identity in an English world, one-way once
 * baked). Safe here because, unlike career, faction is not a match key:
 * nothing re-reads it. A missing or empty table changes nothing — degrade,
 * never blank.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export const rerollNpcFaction = async (actor) => {
  const tableName = CONFIG.Cairn?.npcGenerator?.faction;
  const table = tableName ? await findTableByName(tableName) : null;
  if (!table) return actor;
  const { results } = await table.roll();
  const raw = resultText(results[0]).trim();
  if (raw) await actor.update({ "system.faction": t("table.result", raw) });
  return actor;
};


/* ==========================================================================
 * NPCs — the people the party MEETS (2026-08-20)
 *
 * The other half of the hireling/npc split. A hireling is a statblock with a
 * day rate; an NPC is somebody: a Background off the Warden's Guide table, and
 * four traits — Quirk, Goal, Virtue, Vice — off that book's NPC tables, which
 * have shipped in `warden-npcs` all along with nothing reading them.
 *
 * Two deliberate absences, and both are the point rather than an omission:
 *
 *   - NO GEAR. An NPC arrives with an empty inventory. Slots are NOT written
 *     either, so `calcCurrentMaxSlots` falls through to the Warden's
 *     `max-equip-slots` setting (ten by default) — writing 10 here would
 *     override a Warden who chose eight, to say the thing their setting
 *     already says.
 *   - NO ROLLED STATS. Abilities and HP take the schema defaults (10/10/10,
 *     6 HP). The Warden's Guide gives NPCs no stat line, and a generator that
 *     invented one would be making up rules — the house position everywhere
 *     else in this system. A Warden fills them in if the innkeeper ends up in
 *     a fight.
 *
 * Faction is likewise not rolled, matching hirelings: it stays the sheet's own
 * die, because a campaign's factions are the Warden's to hand out.
 * ======================================================================== */

/**
 * The six APPEARANCE traits of the 2e biography, without virtue and vice.
 *
 * An NPC shows all ten trait rows, but its Virtue and Vice come off the
 * Warden's Guide NPC lists rather than tables-2e — same stored keys, different
 * source. Derived from the 2e config by subtraction rather than written out
 * again, so a table re-pointed there reaches NPCs too and the two lists cannot
 * drift.
 * @returns {Object<String,String>} key -> "pack;Table Name"
 */
const appearanceTables = () => {
  const all = CONFIG.Cairn?.characterGenerator2e?.biography?.items ?? {};
  return Object.fromEntries(Object.entries(all).filter(([k]) => !["virtue", "vice"].includes(k)));
};

/**
 * Roll an NPC's ten traits: the six appearance ones from tables-2e, then the
 * four NPC ones. Order matters — the NPC tables are second, so their virtue and
 * vice WIN over the 2e pair if `appearanceTables` ever stops filtering them out.
 * @returns {Promise<Object<String,String>>}
 */
const rollNpcTraits = async () => ({
  ...(await rollTextItems(appearanceTables())),
  ...(await rollTextItems(CONFIG.Cairn?.npcGenerator?.traits ?? {})),
});

/**
 * The gear an NPC's Background hands them, resolved the same way a Barebones
 * character's and a hireling's are: by-NAME references into the editable gear
 * pool, so a Warden editing an item changes what every NPC generated afterwards
 * carries.
 *
 * The items come from the nearest BAREBONES background
 * (Cairn.npcGenerator.backgroundGear), because that is the only background list
 * in the system whose entries carry gear — an NPC Background is a word off a
 * d20 table and a 2e background grants far more than a stranger should have.
 * Lord and Politician map to nothing and get nothing.
 *
 * Through `resolveStartingGear`, NOT a bare `resolveRefs`. Nine Barebones
 * backgrounds write a row as an INSTRUCTION rather than an item ("Random
 * Additional Gear", "Scroll of Random Spellbook", "Spellbook") and a plain
 * reference lookup drops every one of them without a word. Two of the eighteen
 * targets carry one: a Peddler arrived with a Sack and nothing else. That is
 * the whole reason the shared resolver is exported.
 *
 * What it deliberately does NOT do is grant CONTAINERS. Exactly two Barebones
 * backgrounds declare one — the Merchant's Wagon and the Peddler's Cart — and a
 * container is a second ACTOR, connected, which the Actor Directory always
 * lists. A Warden generating a dozen NPCs would be minting carts faster than
 * they can want them, and the Connections UI they would manage them through is
 * parked. A hireling's career grants no container either, so items-only is also
 * the answer that matches the other person role.
 *
 * Tagged grantSource "background", the whole set and not just the interesting
 * half: `tagBackgroundGear` deliberately leaves rations/torches/lanterns
 * untagged so a PC's sheet shows no source chip on them, and an NPC cannot
 * afford that — a re-rolled Background finds its old gear BY the tag, so an
 * untagged grant would survive every re-roll and pile up. The hireling's
 * buildHirelingItems tags all of its own for the same reason.
 * @param {String} background  the ENGLISH table text stored on the actor
 * @returns {Promise<Object[]>}
 */
const buildNpcItems = async (background, avoid = new Set()) => {
  const target = Cairn.npcGenerator?.backgroundGear?.[String(background ?? "").trim()];
  if (!target) return [];
  const bg = await getBarebonesBackgroundByName(target);
  if (!bg) return [];
  const items = await resolveStartingGear(bg, avoid);
  return items.map((item) => {
    if (item.type === "weapon" || item.type === "armor") item.system.equipped = true;
    return withGrantSource(item, "background");
  });
};

/**
 * The KIT every generated NPC carries whatever their Background: the WHOLE
 * Barebones equipment procedure — rations, a torch, a rolled weapon and armor
 * (equipped), and the Additional Gear roll(s) — via the same
 * rollBarebonesEquipment the Barebones character generator runs (user ruling
 * 2026-08-21, superseding the previous day's rations-torch-and-one-find
 * subset: an NPC's generation grant uses the SAME randomization a Barebones
 * character gets, weapons and armor included). The kit exists because the
 * Background alone left an NPC with two or three items while a hireling
 * arrives with six off its career — user report, 2026-08-20 — and the fix has
 * always been to run the procedure rather than to pad the list.
 *
 * Tagged "npc-kit", and BOTH halves of that matter. Tagged, so a full re-roll
 * can find it — an untagged grant is indistinguishable from a Warden's gift and
 * would pile up one kit per re-roll. Not "background", because grantSourceLabel
 * maps an unknown source to "" and rations wearing a "Background" chip is the
 * very thing tagBackgroundGear exists to avoid on the character sheet.
 * @param {Set<string>} avoid  lower-cased names already granted
 * @returns {Promise<Object[]>}
 */
const buildNpcKit = async (avoid = new Set()) =>
  (await rollBarebonesEquipment(avoid)).map((i) => withGrantSource(i, "npc-kit"));

/**
 * Everything a newly generated NPC carries, in one `avoid` set so the Additional
 * Gear roll cannot hand back something the Background already gave. Rations and
 * Torch seed it up front for the same reason the PC path seeds them.
 * @returns {Promise<Object[]>}
 */
const buildNpcGear = async (background) => {
  // A Background with no Barebones counterpart — Lord and Politician — grants
  // NOTHING AT ALL, kit included (user ruling 2026-08-21, reversing the
  // 2026-08-20 "the kit does not care what you do for a living"). Rank and
  // office arrive empty-handed; the Warden equips them deliberately or not at
  // all. Later the same day the Background die and picker gained the SAME
  // emptiness on an existing NPC — applyNpcBackground wipes the kit when one
  // of these two lands — retiring the "a new station does not unpack the bag"
  // scoping this guard carried for a few hours.
  if (!Cairn.npcGenerator?.backgroundGear?.[String(background ?? "").trim()]) return [];
  const avoid = new Set(["rations", "torch"]);
  const items = await buildNpcItems(background, avoid);
  return [...items, ...(await buildNpcKit(avoid))];
};

/**
 * The NPC items a generator owns, by source. "background" is the Background's
 * own gear, which the Background die replaces; "npc-kit" is the rations, torch
 * and random item, which only a WHOLE new person replaces. Anything untagged is
 * the Warden's and is never touched.
 * @param {CairnActor} actor @param {String[]} sources @returns {String[]} ids
 */
const npcGrantedItemIds = (actor, sources = ["background"]) => actor.items
  .filter((i) => sources.includes(i.getFlag(FLAG_SCOPE, "grantSource")))
  .map((i) => i.id);

/**
 * Re-arrange an EXISTING actor's whole inventory by the granted-loadout rules.
 *
 * Only regenerateNpc needs this, and only because it is the one full
 * regeneration that KEEPS items: it deletes just the tagged grant, so a
 * Warden's own untagged gifts survive at whatever sort they had — 0 for
 * anything never dragged, which renders ABOVE every item the new loadout
 * numbered. Its hireling twin deletes the inventory outright and needs none of
 * this.
 *
 * Ordinary acquisition is deliberately NOT re-arranged: a newly created item
 * appends instead (CairnItem._preCreateOperation), because the arrangement is
 * the state a generated person ARRIVES in, not a rule enforced for life over a
 * list its owner is free to drag.
 *
 * Shims rather than the documents themselves — orderGrantedItems writes `sort`
 * onto whatever it is handed, and writing it onto a live document would be a
 * mutation outside an update.
 *
 * BOUND GRIMOIRE PAGES are skipped, the same exception CairnItem.#appendSort
 * makes on the create side and for the same reason: groupPagesUnderBooks files
 * a page under its book, so its own position never shows and all that would
 * change is the order of a book's pages among themselves — from alphabetical
 * to whatever order actor.items happens to hold. This is an UPDATE, so it does
 * not pass through that seam and has to say so itself.
 * @param {CairnActor} actor
 */
const reorderInventory = async (actor) => {
  const shims = actor.items
    .filter((i) => !i.system?.bound)
    .map((i) => ({ _id: i.id, name: i.name, type: i.type }));
  const updates = orderGrantedItems(shims).map((i) => ({ _id: i._id, sort: i.sort }));
  if (updates.length) {
    await actor.updateEmbeddedDocuments("Item", updates, { render: false, abNoStatusCard: true });
  }
};

/** One Background off the Warden's Guide table, or "" when it is missing. */
const rollNpcBackground = async () => {
  const [packName, tableName] = compendiumInfoFromString(CONFIG.Cairn?.npcGenerator?.background ?? "");
  if (!packName) return "";
  return drawTableText(packName, tableName);
};

/** Generate a full NPC person. @returns {Promise<Object>} */
export const generateNpc = async () => {
  // Rolled, not looked up (2026-08-20, user ask): a hireling's numbers arrive
  // with its career and an NPC has no career, so an NPC is made the way every
  // other person in Cairn is — 3d6 a piece and 1d6 Hit Protection. No `rolls`
  // key beside them: neither person generator posts a generation chat card, so
  // the Roll objects would have no reader (see characterGenerator's `rolls`).
  const abilityRolls = await rollAbilities(Cairn.npcGenerator.ability);
  const hpRoll = await rollHitProtection(Cairn.npcGenerator.hitProtection);
  const background = await rollNpcBackground();
  return {
    name: await rollNpcName(),
    background,
    abilities: {
      STR: abilityRolls.STR.total,
      DEX: abilityRolls.DEX.total,
      WIL: abilityRolls.WIL.total,
    },
    hp: hpRoll.total,
    // Same paths a hireling's biography uses, so the two cannot diverge on
    // anything that is not the point of the split: rollAge honours the Warden's
    // min/max age settings, and pronouns are left BLANK for the Warden to
    // state — see generateHireling for the ruling.
    pronouns: "",
    age: String(await rollAge(Cairn.characterGenerator2e.biography.age)),
    traits: await rollNpcTraits(),
    items: orderGrantedItems(await buildNpcGear(background)),
  };
};

/** @returns {Object} Foundry create/update data for a generated NPC. */
const npcToActorData = (n) => ({
  name: n.name || "NPC",
  type: "npc",
  system: {
    role: "npc",
    // Off-by-default, stated rather than inherited — see characterToActorData.
    generationEnabled: false,
    background: n.background ?? "",
    abilities: personAbilityData(n.abilities),
    hp: { value: n.hp, max: n.hp },
    pronouns: n.pronouns ?? "",
    age: n.age ?? "",
    traits: n.traits ?? {},
    gold: 0,
    deprived: false,
    panicked: false,
    critical: false,
    armorOverride: null,
  },
  // The Background's gear and the kit, or none for a Background with no
  // Barebones counterpart. Still stated rather than omitted, so an empty pack
  // reads as a decision.
  items: n.items ?? [],
  // Players get a LIMITED view of a generated NPC (user ruling 2026-08-21).
  // CairnActor._preCreate has defaulted every unconnected person-npc to
  // LIMITED since 2026-08-01, so this is the generator stating its intent
  // explicitly rather than inheriting it — the same pattern as
  // generationEnabled above — and what the ruling actually ADDED is the
  // sheet's limited RENDERING: LIMITED used to open the full sheet, stats and
  // all, so the level was a label with no wall behind it. Create-time only —
  // regenerateNpc must not reset whatever the Warden has granted since.
  ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
});

/**
 * Create a fully-generated NPC actor with a random portrait + paired token
 * (assigned on creation only, like a player character; re-rolls preserve it by
 * omission).
 * @returns {Promise<CairnActor>}
 */
export const createNpc = async ({ folder = null } = {}) => {
  const data = npcToActorData(await generateNpc());
  const pair = await randomPortraitPair("npc");
  if (pair) {
    data.img = pair.img;
    data.prototypeToken = { ...(data.prototypeToken ?? {}), texture: { src: pair.token } };
  }
  // Folder threaded from the createDialog switchboard (2026-08-02).
  if (folder) data.folder = folder;
  return CairnActor.create(data);
};

/**
 * Full re-roll of an existing NPC: a new Background, a new statblock, a new set
 * of traits and a new pronouns/age — a whole new person. Keeps the name,
 * portrait and free-form notes by OMISSION, exactly as regenerateHireling does.
 *
 * Items: everything GENERATION gave — the Background's gear and the kit alike —
 * is deleted and re-granted, because this is a different person. What survives
 * is whatever a Warden added by hand, which differs from the hireling twin:
 * that one deletes the whole inventory, since a hireling's inventory IS its
 * career. The two are told apart by the grantSource flag and nothing else,
 * which is why both builders tag every item they make.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export const regenerateNpc = async (actor) => {
  const n = await generateNpc();
  const stale = npcGrantedItemIds(actor, ["background", "npc-kit"]);
  if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale, { render: false, abNoStatusCard: true });
  if (n.items?.length) await actor.createEmbeddedDocuments("Item", n.items, { render: false, abNoStatusCard: true });
  // The WHOLE inventory, not only the batch just created — see reorderInventory.
  // render:false here too, so this and the delete and the create above still
  // resolve into the single render the update below performs.
  await reorderInventory(actor);
  await actor.update({
    system: {
      role: "npc",
      background: n.background,
      // A whole new person is a whole new statblock, the same as its hireling
      // twin — and BOTH halves of each ability, so a re-rolled NPC arrives at
      // full rather than carrying the last one's damage on a new maximum.
      abilities: personAbilityData(n.abilities),
      hp: { value: n.hp, max: n.hp },
      pronouns: n.pronouns,
      age: n.age,
      traits: n.traits,
      critical: false,
      // The same defensive/status/wealth reset regenerateHireling does: a whole
      // new person must not inherit the last one's armorOverride or panic.
      armorOverride: null,
      gold: 0,
      deprived: false,
      panicked: false,
    },
  }, {
    // Regenerating is REPLACING this person, not healing them: clearing
    // `critical` here must not announce a stabilization in chat.
    abNoStatusCard: true,
  });
  return actor;
};

/**
 * Re-roll an NPC's BACKGROUND and the gear that Background grants — the
 * Background die, the counterpart of the hireling's Career die. It stops there:
 * a hireling's career carries its statblock TOO, and re-rolling a Background
 * must not re-roll the person.
 *
 * The KIT survives a trade-for-trade swap: changing what someone does for a
 * living does not change whether they packed food. Two exceptions, both
 * 2026-08-21 (user ruling): landing Lord or Politician WIPES it — the NPC ends
 * up holding what generating that Background grants, which for those two is
 * nothing — and a swap that finds NO kit (the NPC was one of those two, or was
 * generated as one) packs a fresh one. A surviving kit seeds `avoid`, so a
 * Background whose gear rolls on the Additional Gear table cannot hand back
 * what they carry.
 *
 * Avoids returning the current value while the table holds anything else, so
 * the die always visibly does something.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export const rerollNpcBackground = async (actor) => {
  const current = String(actor.system.background ?? "").trim();
  let rolled = "";
  for (let i = 0; i < 8; i++) {
    rolled = await rollNpcBackground();
    if (rolled && rolled !== current) break;
  }
  if (!rolled) return actor;
  return applyNpcBackground(actor, rolled);
};

/**
 * The CHOSEN-Background half (2026-08-21, user ask): the magnifying glass
 * beside the Background field. Same apply as the die, so a picked Politician
 * and a rolled one are the same event — the old trade's gear goes, and the kit
 * follows applyNpcBackground's rules: kept trade-for-trade, wiped by a
 * counterpart-less Background, repacked when none survives.
 * @param {CairnActor} actor @param {String} text  the ENGLISH table text
 * @returns {Promise<CairnActor>}
 */
export const pickNpcBackground = async (actor, text) =>
  applyNpcBackground(actor, String(text ?? "").trim());

/** Shared by the Background die and picker — one apply, so the two can never
 *  disagree about what changing a Background means. @private */
const applyNpcBackground = async (actor, rolled) => {
  if (!rolled) return actor;
  // A counterpart-less Background — Lord and Politician — takes EVERYTHING the
  // generators gave, kit included (user ruling 2026-08-21, reversing the same
  // day's "a new station does not unpack the bag"): after any swap the NPC
  // holds what GENERATING the new Background would grant, and for those two
  // that is nothing. The Warden's own items are untagged and stay, as
  // everywhere.
  const geared = !!Cairn.npcGenerator?.backgroundGear?.[String(rolled).trim()];
  // Old grant out, new grant in — the same shape as applyHirelingCareer, and
  // `render: false` on both so one update renders rather than three.
  const stale = npcGrantedItemIds(actor, geared ? ["background"] : ["background", "npc-kit"]);
  if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale, { render: false, abNoStatusCard: true });
  // Seeded from what the actor still carries — the kit and any Warden gift — so
  // an instruction row rolls something they do not already have.
  const avoid = new Set(actor.items
    .filter((i) => !stale.includes(i.id))
    .map((i) => i.name.toLowerCase()));
  const items = geared ? await buildNpcItems(rolled, avoid) : [];
  // A kit only when NONE survives — this NPC was, or was generated as, a Lord
  // or Politician, whose bag is empty by the ruling above. PRESENCE is the
  // test, never the old Background's name: however the kit went missing, a
  // geared Background packs one, exactly as generation would (the reported
  // miss, 2026-08-21: a Politician swapped to Peddler held the Peddler's Sack
  // and nothing else).
  if (geared && npcGrantedItemIds(actor, ["npc-kit"]).length === 0) {
    items.push(...await buildNpcKit(avoid));
  }
  if (items.length) await actor.createEmbeddedDocuments("Item", items, { render: false, abNoStatusCard: true });
  // Same whole-inventory arrangement a career swap gets — see applyHirelingCareer.
  await reorderInventory(actor);
  await actor.update({ "system.background": rolled });
  return actor;
};

/* --------------------------------------------------------------------------
 * The person-sheet pickers (2026-08-21, user ask): the magnifying glass the PC
 * sheet's background row already has, brought to the Career, Background and
 * Faction rows — a Warden picks a specific value instead of rolling one, and
 * the picker is offered whether or not the Randomization toggle is on, because
 * a deliberate choice is not randomization. All three share promptFailedCareer's
 * dialog shape: radio rows, a Random row on top, ENGLISH value stored where the
 * stored string is a match key, translated label shown.
 * ------------------------------------------------------------------------ */

/** One radio-list picker dialog. `rows` are {value, label, tag?}; resolves the
 *  chosen value, BG_RANDOM for the Random row, or false. @private */
const promptFromRows = (titleKey, rows, current = null) => {
  let list = `<label class="bg-pick-row"><input type="radio" name="bg" value="${BG_RANDOM}"${current ? "" : " checked"}>
    <span class="bg-pick-name"><i class="fas fa-dice"></i> ${game.i18n.localize("CAIRN.RandomBackground")}</span></label>`;
  for (const row of rows) {
    list += `<label class="bg-pick-row"><input type="radio" name="bg" value="${bgEsc(row.value)}"${row.value === current ? " checked" : ""}>
      <span class="bg-pick-name">${bgEsc(row.label)}</span>${row.tag ? `<span class="bg-pick-tag">${row.tag}</span>` : ""}</label>`;
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize(titleKey), icon: "fas fa-magnifying-glass" },
      position: { width: 420 },
      content: `<div class="bg-picker single"><div class="bg-pick-list">${list}</div></div>`,
      buttons: [
        {
          action: "choose",
          label: game.i18n.localize("CAIRN.Choose"),
          default: true,
          callback: () => {
            const form = dialog.element.querySelector("form") ?? dialog.element;
            finish(form?.elements?.bg?.value || BG_RANDOM);
          },
        },
        { action: "cancel", label: game.i18n.localize("CAIRN.Cancel"), callback: () => finish(false) },
      ],
    });
    const origClose = dialog.close.bind(dialog);
    dialog.close = (...a) => { finish(false); return origClose(...a); };
    dialog.render(true);
  });
};

/**
 * Pick a hireling's career by name, or Random (which defers to the die's own
 * path so "random" means the same thing both ways). Applies on choice.
 * @param {CairnActor} actor @returns {Promise<CairnActor>}
 */
export const promptHirelingCareer = async (actor) => {
  const careers = await getNpcCareers2e();
  if (!careers.length) return actor;
  const current = String(actor.system.profession ?? "").trim();
  const rows = [...careers]
    .sort((a, b) => t("npc.career", a.name).localeCompare(t("npc.career", b.name), game.i18n.lang))
    .map((c) => ({
      value: c.name,
      label: t("npc.career", c.name),
      // The rate and the loadout are what a Warden picks a career FOR.
      tag: bgEsc(`${c.rate ?? 0} ${game.i18n.localize("CAIRN.DayRateSuffix")} · `
        + (c.gear ?? []).map((g) => t("item.name", g.name ?? g)).join(", ")),
    }));
  const choice = await promptFromRows("CAIRN.PickCareer", rows, current);
  if (!choice) return actor;
  if (choice === BG_RANDOM) return rerollHirelingCareer(actor);
  return pickHirelingCareer(actor, choice);
};

/**
 * Pick an NPC's Background from the Warden's Guide d20 table, or Random via
 * the die's own path. The VALUE is the raw English row text — the stored
 * string is the backgroundGear match key — while the label shows the
 * translation, exactly the read/stored split the sheet input already does.
 * @param {CairnActor} actor @returns {Promise<CairnActor>}
 */
export const promptNpcBackground = async (actor) => {
  const [packName, tableName] = compendiumInfoFromString(CONFIG.Cairn?.npcGenerator?.background ?? "");
  const pack = packName ? game.packs.get(packName) : null;
  const table = pack ? (await pack.getDocuments()).find((d) => d.name === tableName) : null;
  if (!table) return actor;
  const current = String(actor.system.background ?? "").trim();
  const rows = table.results.map((r) => String(resultText(r)).trim()).filter(Boolean)
    .map((text) => ({ value: text, label: t("table.result", text) }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  const choice = await promptFromRows("CAIRN.PickBackground", rows, current);
  if (!choice) return actor;
  if (choice === BG_RANDOM) return rerollNpcBackground(actor);
  return pickNpcBackground(actor, choice);
};

/**
 * Pick a faction off the same world-first table the Faction die rolls. The
 * stored value is the TRANSLATED text, matching rerollNpcFaction's ratified
 * bake — a faction is world content in the session's language, and unlike
 * career it is a match key for nothing. Random defers to the die.
 * @param {CairnActor} actor @returns {Promise<CairnActor>}
 */
export const promptNpcFaction = async (actor) => {
  const tableName = CONFIG.Cairn?.npcGenerator?.faction;
  const table = tableName ? await findTableByName(tableName) : null;
  if (!table) return actor;
  const rows = table.results.map((r) => t("table.result", String(resultText(r)).trim())).filter(Boolean)
    .map((text) => ({ value: text, label: text }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  const current = String(actor.system.faction ?? "").trim();
  const choice = await promptFromRows("CAIRN.PickFaction", rows, current);
  if (!choice) return actor;
  if (choice === BG_RANDOM) return rerollNpcFaction(actor);
  await actor.update({ "system.faction": choice });
  return actor;
};
