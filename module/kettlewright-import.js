import { resolveGearItem, buildGearItem, warmGearItems } from "./gear.js";
import { resultText } from "./compendium.js";
import { getBackgroundsFor, withGrantSource, randomPortraitPair, kettlewrightPortraitPath, backgroundGearSource, grantContainers, BAREBONES_KIT_SOURCE, FLAG_SCOPE } from "./character-generator.js";
import { CairnActor } from "./actor/actor.js";
import { FATIGUE_NAME } from "./item/item.js";
import { Cairn } from "./config.js";
import { SETTINGS_NS } from "./settings.js";
import { t } from "./i18n-content.js";

/**
 * One-way importer: a Kettlewright (kettlewright.com) character export JSON ->
 * a new Air Bladder `character` Actor — directly for a client that may create
 * Actors, over the importKW relay (cairn.js) for a player who may not.
 * Best-effort and lossy by design:
 * items and the background are matched by name where possible and otherwise built
 * from their raw text/tags, so nothing is lost — it just arrives less structured.
 *
 * Kettlewright's `Character.toJSON()` emits a flat object (abilities as
 * strength/dexterity/willpower with paired _max, hp/hp_max, gold, deprived,
 * panicked, armor, a `background` NAME string, free-text description/traits/notes/
 * bonds/scars/omens, image_url, a flat `items[]` and a `containers[]`). Since
 * 2026-09-22 the background's questions and answers ride their own numbered
 * `background_tableN_question` / `_answer` keys and `notes` is left empty; older
 * exports wrote both into `notes` (readTablePairs, parseQuestionAnswers).
 *
 * Deliberately does NOT route through character-generator's characterToActorData:
 * that helper force-resets omen/scars/critical, which would wipe the very fields we
 * are importing. We build the create payload directly here, using the same paths.
 */

/** Escape text for HTML built by hand (the summary dialog). */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Where Kettlewright serves a portrait a player UPLOADED. */
const KETTLEWRIGHT_ORIGIN = "https://kettlewright.com";

/**
 * The usable URL of a custom portrait, or null. An absolute URL the player
 * typed rides as it is; an upload exports as the site-relative
 * `/portraits/<sha>.webp` and is resolved against kettlewright.com, which
 * serves it without a login. Anything else site-relative names nothing here.
 * @param {{custom_image?: Boolean, image_url?: String}} who  a character or a pet
 * @returns {String|null}
 */
const customPortraitUrl = (who) => {
  const ref = String(who?.image_url ?? "");
  if (!who?.custom_image) return null;
  if (isAbsoluteUrl(ref)) return ref;
  if (/^\/portraits\/[\w.-]+$/.test(ref)) return `${KETTLEWRIGHT_ORIGIN}${ref}`;
  return null;
};

/** A finite Number, or the fallback. */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Kettlewright hosts portraits at an absolute URL; only those can travel across apps. */
const isAbsoluteUrl = (s) => /^https?:\/\//i.test(String(s ?? ""));

/** A single free-text scars blob -> multiple entries (Air Bladder scars is an array). */
const splitScars = (s) => String(s ?? "").split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);

/* -------------------------------------------------------------------------- */
/*  Grant provenance: which source produced which imported item                 */
/* -------------------------------------------------------------------------- */

/** Loose text identity: whitespace collapsed, quotes straightened, case ignored. */
const norm = (s) => String(s ?? "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

/** Jaccard overlap of the two texts' word sets, 0..1. */
const similarity = (a, b) => {
  const words = (s) => new Set(norm(s).split(/[^a-z0-9']+/).filter(Boolean));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
};

const MIN_SIMILARITY = 0.75; // below this, "close" is not close enough to act on
const MIN_MARGIN = 0.2;      // and it must beat the runner-up by this much

/**
 * Find the candidate whose text is the one `text` came from, tolerating small
 * wording drift.
 *
 * Exact identity is tried first and is what almost always fires. The fallback
 * exists because our copy of the game text and Kettlewright's are now maintained
 * separately, so they drift by a word here and there — Tripp's Ghost Violin is a
 * "dark-grey violin" in Kettlewright and a "dark-gray" one here, and that single
 * letter was enough to lose the match, leaving the item untagged and therefore
 * un-re-rollable.
 *
 * Deliberately conservative, because a wrong match re-tags the wrong item and a
 * later re-roll would then delete it: the best candidate must clear
 * MIN_SIMILARITY *and* beat the runner-up by MIN_MARGIN. Options within one table
 * describe entirely different things, so genuine matches score far above their
 * rivals; anything ambiguous is simply left unmatched, which costs nothing but a
 * duplicate the player can delete.
 *
 * Safe on long prose only. Do NOT reuse this for item names — the fork learned
 * that fuzzy matching short strings confidently proposes Pail≈Nails, Bowl≈Bow.
 *
 * @param {String} text
 * @param {Array} candidates
 * @param {(c: any) => String} textOf
 * @returns {any|null}
 */
export const bestTextMatch = (text, candidates, textOf) => {
  const want = norm(text);
  // Array.from, because a RollTable's results are a Collection: it has .find but
  // no .length, so a raw candidates?.length check reads every table as empty.
  const list = Array.from(candidates ?? []);
  if (!want || !list.length) return null;
  const exact = list.find((c) => norm(textOf(c)) === want);
  if (exact) return exact;

  const scored = list
    .map((c) => ({ c, score: similarity(want, textOf(c)) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (best.score < MIN_SIMILARITY) return null;
  if (next && best.score - next.score < MIN_MARGIN) return null;
  return best.c;
};

/**
 * Re-tag imported items with the grant source that actually produced them.
 *
 * Every imported item starts tagged `imported`, which no re-roll targets — so
 * re-rolling a bond or a background question ADDED the new option's items while
 * the originals stayed forever, and the sheet grew a duplicate every time. The
 * inventory could only ever accumulate.
 *
 * We can do better than that, because a Kettlewright answer is the option's own
 * description, verbatim: once the answer is matched back to its option we know
 * exactly which items that option grants, and can hand the matching imported
 * items over to `question:<i>` / `bond:<id>` so a re-roll replaces them properly.
 *
 * Matching is by name, first unclaimed item wins — the same best-effort standard
 * the rest of the importer works to, since Kettlewright's item list carries no
 * provenance of its own. An item that can't be matched keeps `imported` and is
 * simply never auto-removed, which is the safe direction to fail in: a stray
 * duplicate is recoverable by hand, a silently deleted item is not.
 *
 * @param {Object[]} items    the built item payloads, mutated in place
 * @param {Object[]} granted  [{name}] the source is known to grant
 * @param {String|((name: String) => String)} source  the grantSource tag to
 *   apply, or a function of the item's name for a grant whose source varies by
 *   item (background starting gear: `backgroundGearSource`)
 * @returns {Number} how many items were re-tagged
 */
const retagGranted = (items, granted, source) => {
  let n = 0;
  for (const g of granted ?? []) {
    const want = norm(g?.name);
    if (!want) continue;
    const hit = items.find(
      (it) => norm(it.name) === want && it.flags?.[FLAG_SCOPE]?.grantSource === "imported",
    );
    if (!hit) continue;
    hit.flags[FLAG_SCOPE].grantSource = typeof source === "function" ? source(hit.name) : source;
    n++;
  }
  return n;
};

/**
 * Find the Bonds-table entry a Kettlewright bond came from, by matching its text.
 * Returns the entry's mechanical payload — the items it grants — or null.
 * Read-only: never roll()s or draw()s, so the table's state is untouched.
 * DELIBERATELY the SHIPPED table, not the world-first default the generator's
 * drawBond resolves (2026-08-31): this matches official Kettlewright bond TEXT
 * to recover the shipped rows' payload flags, and a Warden's own world "Bonds"
 * table cannot hold those rows — resolving world-first here could only lose
 * the match. Do not "align" it.
 * @param {String} text
 * @returns {Promise<{items: Object[], gold: Number}|null>}
 */
const findBondEntry = async (text) => {
  if (!norm(text)) return null;
  const pack = game.packs.get("air-bladder.tables-2e");
  const table = pack ? (await pack.getDocuments()).find((t) => t.name === "Bonds") : null;
  const hit = bestTextMatch(text, table?.results ?? [], resultText);
  if (!hit) return null;
  return { items: hit.getFlag(FLAG_SCOPE, "items") ?? [], gold: hit.getFlag(FLAG_SCOPE, "gold") ?? 0 };
};

/**
 * Every item name a Barebones character's kit can be dealt from: the Rations
 * and Torch every one starts with, and each row of the shipped
 * `tables-barebones` tables (Creation - Weapon / Armor / Additional Gear and
 * the weapon tiers) — the tables rollBarebonesEquipment rolls. A row that
 * points at another table carries that table's name, which no item has.
 * The SHIPPED pack, not a world-first override, for findBondEntry's reason:
 * Kettlewright dealt from the SRD's tables, not from the Warden's.
 * Read-only; never rolls.
 * @returns {Promise<{name: String}[]>}
 */
const barebonesKitNames = async () => {
  const pack = game.packs.get("air-bladder.tables-barebones");
  const tables = pack ? await pack.getDocuments() : [];
  const names = new Set(["Rations", "Torch"]);
  for (const table of tables) for (const r of table.results) if (r.name) names.add(r.name);
  return [...names].map((name) => ({ name }));
};

/* -------------------------------------------------------------------------- */
/*  Background questions: a notes blob -> structured question/answer pairs      */
/* -------------------------------------------------------------------------- */

/**
 * Kettlewright writes the two background questions and the player's answers into
 * the free-text `notes` field, as the question line followed by the answer:
 *
 *   How was your fraud exposed?
 *   You were cursed by a hedgewitch for fooling some innocent village folk. …
 *
 *   What keepsake could always identify you?
 *   Surgeon's Soap: A lye and ash block that makes skin temporarily transparent. …
 *
 * Once the background has matched, we know exactly what those questions are — they
 * are `system.tables[].question` on the background Item — so the blob can be split
 * back into `system.questions`, which is what the sheet renders and re-rolls,
 * instead of sitting in Notes as undifferentiated prose.
 *
 * Matching is whitespace- and punctuation-spacing-tolerant and case-insensitive
 * but otherwise exact: a question either is the background's question or it
 * isn't. Anything not claimed by a question stays in Notes, so a player's own
 * writing is never eaten.
 *
 * @param {String} notes
 * @param {String[]} questions  the background's prompts, in table order
 * @returns {{ answers: String[], leftover: String, found: Number }}
 *          answers is index-aligned with `questions` ("" where not found).
 */
export const parseQuestionAnswers = (notes, questions) => {
  const text = String(notes ?? "");
  const answers = questions.map(() => "");
  if (!text.trim() || !questions.length) return { answers, leftover: text, found: 0 };

  // Locate each question in the blob. Escape it, then let any run of whitespace
  // match any other, so a rewrap or a stray double space doesn't lose the match.
  //
  // Whitespace BEFORE punctuation is optional in both directions: the SRD's
  // Greenwise heading reads "How has the Wood failed you ?" — space before the
  // mark, an upstream typo our pack mirrors faithfully — while Kettlewright's
  // separately-maintained copy writes "you?", and that one character left the
  // whole Q+A in Notes on a real import. Same lesson bestTextMatch encodes:
  // the two copies of the game text drift, and exact matching keeps losing.
  const hits = [];
  questions.forEach((q, i) => {
    if (!q) return;
    const pattern = q
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+(?=\\[?.]|[!,;:])/g, "")
      .replace(/(\\[?.]|[!,;:])/g, "\\s*$1")
      .replace(/\s+/g, "\\s+");
    const m = text.match(new RegExp(pattern, "i"));
    if (m?.index != null) hits.push({ i, start: m.index, end: m.index + m[0].length });
  });
  if (!hits.length) return { answers, leftover: text, found: 0 };

  // Answers run from the end of one question to the start of the next, in the
  // order they APPEAR — which needn't be the background's table order.
  hits.sort((a, b) => a.start - b.start);
  hits.forEach((h, n) => {
    const stop = n + 1 < hits.length ? hits[n + 1].start : text.length;
    answers[h.i] = text.slice(h.end, stop).trim();
  });

  // Whatever precedes the first question is the player's own note; keep it.
  return { answers, leftover: text.slice(0, hits[0].start).trim(), found: hits.length };
};

/** `background_table<N>_question` / `_answer`, the keys the current export writes. */
const TABLE_PAIR_KEY = /^background_table(\d{1,2})_(question|answer)$/;

/**
 * The background's questions and answers as Kettlewright has written them since
 * 2026-09-22: numbered pairs, `background_table1_question` /
 * `background_table1_answer` and so on (char_utils.py), with `notes` left empty
 * for the player's own writing. An import that read only `notes` landed every
 * new character with no answers at all and nothing re-rollable.
 *
 * Read by key pattern rather than as a fixed 1 and 2, so a background that
 * grows a third table is not silently cut short.
 *
 * @param {Object} json
 * @returns {{n: Number, question: String, answer: String}[]}  in N order;
 *          a pair with neither half filled is dropped
 */
export const readTablePairs = (json) => {
  const byN = new Map();
  for (const [key, value] of Object.entries(json ?? {})) {
    const m = TABLE_PAIR_KEY.exec(key);
    if (!m) continue;
    const n = Number(m[1]);
    const pair = byN.get(n) ?? { n, question: "", answer: "" };
    pair[m[2]] = String(value ?? "").trim();
    byN.set(n, pair);
  }
  return [...byN.values()].filter((p) => p.question || p.answer).sort((a, b) => a.n - b.n);
};

/**
 * Place each exported pair on the matched background's question it answers.
 *
 * By the question's text first, with the same spacing tolerance
 * parseQuestionAnswers gives a notes blob (the two copies of the game text
 * drift: "you ?" against "you?"). Failing that, by its number, table N on
 * question N-1: Kettlewright writes the pairs in table order, and its export
 * passes question and answer through its translation step, so a creator
 * working in Spanish exports a question no English text can match while the
 * number still holds. A pair that fits neither way is returned unplaced, for
 * Notes, so nothing the player chose is dropped.
 *
 * @param {{n: Number, question: String, answer: String}[]} pairs
 * @param {String[]} questions  the background's prompts, in table order
 * @returns {{ answers: String[], found: Number, unplaced: Object[] }}
 */
export const placeTablePairs = (pairs, questions) => {
  const key = (s) => norm(s).replace(/\s+(?=[?.!,;:])/g, "");
  const answers = questions.map(() => "");
  const claimed = questions.map(() => false);
  const unplaced = [];
  for (const p of pairs) {
    // A question with no answer chose nothing; there is nothing to keep.
    if (!p.answer) continue;
    let i = p.question ? questions.findIndex((q, j) => !claimed[j] && key(q) === key(p.question)) : -1;
    if (i < 0 && p.n - 1 < questions.length && !claimed[p.n - 1]) i = p.n - 1;
    if (i < 0) {
      unplaced.push(p);
      continue;
    }
    answers[i] = p.answer;
    claimed[i] = true;
  }
  return { answers, found: claimed.filter(Boolean).length, unplaced };
};

/** Pairs written back into Notes the way older exports carried them: question, then answer. */
const pairsAsNotes = (pairs) => pairs.map((p) => [p.question, p.answer].filter(Boolean).join("\n")).join("\n\n");

/* -------------------------------------------------------------------------- */
/*  Traits: one English sentence -> eight typed slots + age                     */
/* -------------------------------------------------------------------------- */

/**
 * Kettlewright stores the eight 2e traits and the character's age as a single
 * English sentence, built from the same 2e tables Air Bladder ships — and, as it
 * happens, in almost exactly the phrasing our own sheet emits (`CAIRN.Bio.*`):
 *
 *   "You have a Stout Physique, Birthmarked Skin, and Long Hair. Your Face is
 *    Pale, your Speech Precise. You have Rancid Clothing. You are Honorable and
 *    Craven. You are 36 years old."
 *
 * So it parses back into `system.traits.*` and `system.age` instead of landing in
 * Notes as prose, which is what it used to do — the reason an imported character
 * arrived with empty trait dropdowns and no age.
 *
 * Anchored on the capitalised CATEGORY words, not on sentence shape, so a missing
 * trait, a dropped Oxford comma, or extra whitespace doesn't derail the rest. Every
 * shipped trait value is a single word, which is what makes the anchors sufficient.
 * @param {String} text
 * @returns {{ traits: Object, age: String, pair: String[] }}  pair = the raw
 *          "You are X and Y" words, which need the tables to tell virtue from vice.
 */
export const parseTraitSentence = (text) => {
  const s = String(text ?? "");
  const traits = {};
  const grab = (re, key) => {
    const m = s.match(re);
    if (m?.[1]) traits[key] = m[1];
  };

  // "<value> Physique" / "<value> Skin" / … — the word immediately before the label.
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Physique\b/i, "physique");
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Skin\b/i, "skin");
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Hair\b/i, "hair");
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Clothing\b/i, "clothing");
  // "your Face is <value>" / "your Speech <value>" — here the label comes first.
  grab(/\bFace\s+is\s+([A-Za-z][A-Za-z'-]*)/i, "face");
  grab(/\bSpeech\s+(?:is\s+)?([A-Za-z][A-Za-z'-]*)/i, "speech");

  // "You are 36 years old." Digits only, so it can never collide with the
  // virtue/vice clause below, which requires two words.
  const age = s.match(/\b(\d{1,3})\s+years?\s+old\b/i)?.[1] ?? "";

  // "You are Honorable and Craven." Both captures are words, so the age clause
  // cannot match here either. Which is which is decided by the tables, not by
  // position — see resolveVirtueVice.
  const m = s.match(/\bYou\s+are\s+([A-Za-z][A-Za-z'-]*)\s+and\s+([A-Za-z][A-Za-z'-]*)/i);
  const pair = m ? [m[1], m[2]] : [];

  return { traits, age, pair };
};

/**
 * Decide which of the two words is the virtue and which the vice by looking them
 * up in the shipped tables.
 *
 * Position is NOT reliable: Kettlewright writes virtue-then-vice ("Honorable and
 * Craven") while Air Bladder's own sentence writes vice-then-virtue, so trusting
 * the order would silently swap the two on every single import. The table lookup
 * is also self-correcting if either app changes its phrasing later.
 *
 * Falls back to Kettlewright's observed order when the tables can't decide —
 * a custom or translated value that appears in neither list.
 * @param {String[]} pair
 * @returns {Promise<{virtue?: String, vice?: String}>}
 */
export const resolveVirtueVice = async (pair) => {
  if (pair.length !== 2) return {};
  const [a, b] = pair;
  const values = async (key) => {
    const ref = Cairn?.characterGenerator2e?.biography?.items?.[key];
    if (!ref) return new Set();
    const [packName, tableName] = String(ref).split(";");
    const pack = game.packs.get(packName);
    if (!pack) return new Set();
    const table = (await pack.getDocuments()).find((t) => t.name === tableName);
    return new Set(Array.from(table?.results ?? []).map((r) => resultText(r).trim().toLowerCase()));
  };
  const [virtues, vices] = await Promise.all([values("virtue"), values("vice")]);
  const isV = (w) => virtues.has(w.toLowerCase());
  const isX = (w) => vices.has(w.toLowerCase());

  if (isV(a) && isX(b)) return { virtue: a, vice: b };
  if (isX(a) && isV(b)) return { virtue: b, vice: a };
  return { virtue: a, vice: b }; // Kettlewright order
};

/**
 * Map one Kettlewright item record to an owned-item payload, tracking how it
 * resolved for the summary. A name that matches the canonical packs keeps the
 * pack item's art/description (with Kettlewright's charge state overlaid); a miss
 * falls back to buildGearItem, which infers weapon/armor/petty/bulky/uses from the
 * item's tags — the "shove it in" path, so unmatched items still arrive.
 * @returns {{ item: Object, how: "matched"|"fallback" }}
 */
const importItem = async (kw) => {
  const matched = await resolveGearItem(kw.name);
  // `uses` is the CURRENT count and `max_uses` its maximum (Kettlewright since
  // 2026-09-22). Read alone, `uses` stood in for both, so a Torch burned down
  // to 1 of 3 arrived as 1 of 1 and could never be refilled to 3.
  if (matched) {
    if (kw.max_charges != null || kw.charges != null || kw.uses != null || kw.max_uses != null) {
      const max = kw.max_charges ?? kw.max_uses ?? kw.uses ?? matched.system.uses?.max ?? 0;
      const value = kw.charges ?? kw.uses ?? matched.system.uses?.value ?? max;
      matched.system.uses = { value, max };
    }
    return { item: withGrantSource(matched, "imported"), how: "matched" };
  }
  const built = buildGearItem({
    name: kw.name,
    tags: kw.tags ?? [],
    // Kettlewright starting gear uses "-" as a placeholder description; drop it.
    description: kw.description && kw.description !== "-" ? kw.description : "",
    uses: kw.uses,
    charges: kw.charges,
    maxCharges: kw.max_charges,
  });
  // buildGearItem reads one count as both value and max (generation grants
  // full items); a worn one keeps its own maximum.
  if (kw.max_uses != null && kw.max_charges == null) {
    built.system.uses = { value: num(kw.uses, num(kw.max_uses)), max: num(kw.max_uses) };
  }
  return { item: withGrantSource(built, "imported"), how: "fallback" };
};

/**
 * Pure mapping: a parsed Kettlewright character object -> a Foundry Actor create
 * payload plus a `report` of what matched / fell back (for the summary dialog).
 * Async because item and background resolution read compendium packs.
 * @param {Object} json  a parsed Kettlewright character export
 * @param {Object} [options]
 * @param {{defaultName?: string|null, traitsLabel?: string|null}} [options.labels]
 *   the two strings this writes INTO the character, composed by the REQUESTER's
 *   client in its language (review #34 finding 244): on the importKW relay this
 *   runs on the Warden's client, whose `localize` is the Warden's language, and
 *   the player read it on their own character. Absent, this client composes them.
 * @returns {Promise<{ data: Object, report: Object }>}
 */
export const kettlewrightToActorData = async (json, { labels = null } = {}) => {
  const report = { name: json?.name ?? "", matched: [], fallback: [], fatigue: 0, skipped: [], background: null, containers: [] };

  // --- Edition: which of the two generators made this character --------------
  // Kettlewright writes `edition` since 2026-11-11 ("2e" | "barebones"); an
  // older export has none and was 2e, the only kind it made. The content
  // source decides which background pool the name is matched against and what
  // a later re-roll deals, which is character generation's business — the
  // one place the content source may branch.
  const contentSource = json.edition === "barebones" ? "barebones" : "2e";

  // --- Background: match by name, else keep the raw string ------------------
  const bgName = json.custom_background || json.background || "";
  let background = bgName;
  let backgroundUuid = "";
  let bgQuestions = []; // the matched background's question prompts, in table order
  let bgTables = []; // …and the full tables, so an answer can be traced to its option
  let bgGear = []; // …and its own starting gear, so those items can be traced too
  if (bgName) {
    const pool = await getBackgroundsFor(contentSource);
    const hit = pool.find((b) => b.name.toLowerCase() === bgName.toLowerCase());
    if (hit) {
      background = hit.name;
      backgroundUuid = hit.uuid;
      report.background = { name: hit.name, matched: true };
      bgTables = hit.system?.tables ?? [];
      bgQuestions = bgTables.map((t) => String(t?.question ?? "").trim());
      bgGear = hit.system?.startingGear ?? [];
    } else {
      report.background = { name: bgName, matched: false };
    }
  }

  // --- Items: flatten every container's contents onto the character ---------
  const FATIGUE = FATIGUE_NAME;
  const items = [];
  // Every exported name's pack document in one request per pack, so each
  // `importItem` below reads the cache (review #34 finding 207).
  await warmGearItems((json.items ?? []).map((kw) => kw?.name).filter(Boolean));
  for (const kw of json.items ?? []) {
    // "Carrying X" markers are Kettlewright's container-load bookkeeping; with
    // containers flattened they mean nothing here.
    if (kw?.carrying != null || /^carrying\b/i.test(kw?.name ?? "")) {
      report.skipped.push(kw?.name ?? "");
      continue;
    }
    if (!kw?.name) continue;
    // Fatigue is a real 1-slot inventory item in Air Bladder too; recreate it
    // under the localized name so the sheet's fatigue handling recognizes it.
    if (kw.name === "Fatigue") {
      items.push(withGrantSource(buildGearItem({ name: FATIGUE, tags: [] }), "imported"));
      report.fatigue++;
      continue;
    }
    const { item, how } = await importItem(kw);
    items.push(item);
    report[how].push(kw.name);
  }
  // The pack keeps the EXPORT's order (2026-09-01, user ruling): an import is
  // a faithful copy, so the list lands as the player saw it in Kettlewright —
  // the six-band arrangement stays the signature of loadouts this system
  // rolled. Stated explicitly because items nested in Actor.create data never
  // reach Item._preCreateOperation (the grimoire-keys lesson), so nothing
  // downstream assigns a sort: left alone they all land at core's 0, which is
  // ABOVE every numbered row and displays as alphabetical. Spaced by
  // SORT_INTEGER_DENSITY like orderGrantedItems, so the first drag has room
  // to insert rather than renormalising the whole list.
  items.forEach((item, i) => { item.sort = (i + 1) * CONST.SORT_INTEGER_DENSITY; });

  // --- Containers: flattened (dropped), recorded for the summary ------------
  for (const c of json.containers ?? []) {
    if (num(c?.id) === 0) continue; // id 0 is the "Main" body inventory, not a bag
    if (c?.name) report.containers.push(c.name);
  }

  // --- Free-text best-fit ----------------------------------------------------
  const scars = splitScars(json.scars);
  // A Fieldwarden or an Outrider holds two bonds, and Kettlewright writes them
  // as one string with a blank line between (char_utils.py upstream). Read as
  // one, the pair matched no Bonds row, so neither bond's item was re-rollable
  // and the sheet showed one bond where the character has two. A single bond
  // is one paragraph, so the split is a no-op for everyone else.
  const bonds = String(json.bonds ?? "").split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
    .map((description) => ({ id: foundry.utils.randomID(), description, gold: 0 }));
  // Same trick as the questions: a Kettlewright bond is a Bonds-table entry
  // verbatim, so the items it granted can be handed to `bond:<id>` and become
  // re-rollable instead of accumulating.
  for (const bond of bonds) {
    const entry = await findBondEntry(bond.description);
    if (entry) {
      report.regranted = (report.regranted ?? 0) + retagGranted(items, entry.items, `bond:${bond.id}`);
    }
  }
  const omens = String(json.omens ?? "");
  let notes = String(json.notes ?? "");

  // Background questions. A current export carries them as numbered pairs
  // (readTablePairs) and leaves `notes` to the player; an older one wrote both
  // into `notes`, which is then split. Either way they become structured only
  // because the background matched — an unmatched background means we don't
  // know what the questions were, so the pairs are written into Notes as an
  // older export carried them, and an old blob stays there untouched.
  let questions = [];
  // Only an answered pair counts: a Barebones export writes the keys empty,
  // and a question nobody answered must not read as an answer lost to Notes.
  const pairs = readTablePairs(json).filter((p) => p.answer);
  const withNotes = (extra) => [notes.trim(), pairsAsNotes(extra)].filter(Boolean).join("\n\n");
  let qa = null;
  if (bgQuestions.length && pairs.length) {
    const placed = placeTablePairs(pairs, bgQuestions);
    qa = { answers: placed.answers, found: placed.found };
    if (placed.unplaced.length) notes = withNotes(placed.unplaced);
  } else if (pairs.length) {
    notes = withNotes(pairs);
  } else if (bgQuestions.length && notes.trim()) {
    qa = parseQuestionAnswers(notes, bgQuestions);
    if (qa.found) notes = qa.leftover;
  }
  if (qa) {
    // The attempt is recorded whenever there was text to search, found or not:
    // the summary line branches on completeness, and a zero-match run must say
    // so rather than stay silent (user ruling 2026-09-03). Empty notes stay
    // unreported — nothing was kept anywhere.
    report.questions = qa.found;
    report.questionsTotal = bgQuestions.length;
    if (qa.found) {
      // gold stays 0 deliberately. That field exists so a LATER re-roll can reverse
      // the gold this system granted; the import granted none (the character's gold
      // came over as a total), and inventing a figure here would make a re-roll
      // deduct coins the character may never have been given.
      questions = bgQuestions.map((q, i) => ({ question: q, answer: qa.answers[i], gold: 0 }));

      // A Kettlewright answer is the option's own description verbatim, so it can
      // be traced back to the option — and therefore to the items that option
      // grants. Hand those imported items to `question:<i>` so a later re-roll
      // replaces them instead of stacking a second copy beside them.
      bgTables.forEach((table, i) => {
        const opt = bestTextMatch(qa.answers[i], table?.options ?? [], (o) => o?.description ?? "");
        if (!opt) return;
        report.regranted = (report.regranted ?? 0) + retagGranted(items, opt.items, `question:${i}`);
      });
    }
  }
  // The background's own starting gear, and a Barebones character's SRD kit.
  // AFTER the questions and bonds on purpose: those name their item exactly,
  // so they claim first, and this pass takes only what is still `imported`.
  //
  // Starting gear re-tags to the source generation gives it (`background`, or
  // `background-mundane` for Rations and light — backgroundGearSource), so a
  // Background re-roll replaces it instead of adding a second set beside it.
  report.regranted = (report.regranted ?? 0) + retagGranted(items, bgGear, backgroundGearSource);
  // A Barebones character's Rations, Torch, weapon, armor and additional gear
  // are its KIT (BAREBONES_KIT_SOURCE), which a Background or Starting gear
  // re-roll re-deals (redealBarebonesKit) — and which it deals a SECOND copy of
  // when it finds none tagged. Name hits against the tables the kit is dealt
  // from are tagged as that kit (user ruling 2026-11-20). Deliberately unlike
  // the 2026-11-06 rule for characters made here before the tag existed
  // ("nothing guesses"): this one comes fresh from Kettlewright's own Barebones
  // generator, so an item named on those tables IS its kit, not gear the player
  // chose. An item no table names stays `imported` and is never removed.
  if (contentSource === "barebones") {
    report.regranted = (report.regranted ?? 0) + retagGranted(items, await barebonesKitNames(), BAREBONES_KIT_SOURCE);
  }

  // Kettlewright's traits blob is a parseable sentence, not opaque prose: it maps
  // back onto the eight typed slots and system.age. Only if the parse yields
  // nothing at all does it fall back to landing in Notes under a label — better an
  // unstructured record than a silently dropped one.
  const traitText = String(json.traits ?? "").trim();
  let traits = {};
  let age = "";
  if (traitText) {
    const parsed = parseTraitSentence(traitText);
    traits = { ...parsed.traits, ...(await resolveVirtueVice(parsed.pair)) };
    age = parsed.age;
    // An imported age is VERBATIM (2026-08-21). The min/max age bounds this
    // used to apply retired with the `age-formula` setting: the formula
    // governs the DICE, and this age was parsed, not rolled — it joins the
    // hand-typed age under "nobody's business but the player's". An age we
    // could not parse is still left blank rather than invented — unknown is
    // not the same as young.
    report.traits = Object.keys(traits).length;
    report.age = age;
    if (!report.traits && !age) {
      const label = labels?.traitsLabel ?? game.i18n.localize("CAIRN.KWImport.TraitsLabel");
      notes = (notes ? `${notes}\n\n` : "") + `${label} ${traitText}`;
      report.traitsUnparsed = true;
    }
  }

  // Armor is a string column in Kettlewright; a numeric value forces Air Bladder's
  // armorOverride so the sheet shows it without re-equipping imported armor.
  const armorN = parseInt(json.armor, 10);
  const armorOverride = Number.isFinite(armorN) && armorN > 0 ? armorN : null;

  const name = json.name || (labels?.defaultName ?? game.i18n.localize("CAIRN.KWImport.DefaultName"));
  const data = {
    name,
    system: {
      // An imported character lands with the Randomization switch OFF, stated
      // rather than inherited from the schema initial — see characterToActorData.
      generationEnabled: false,
      abilities: {
        STR: { value: num(json.strength, 10), max: num(json.strength_max, num(json.strength, 10)) },
        DEX: { value: num(json.dexterity, 10), max: num(json.dexterity_max, num(json.dexterity, 10)) },
        WIL: { value: num(json.willpower, 10), max: num(json.willpower_max, num(json.willpower, 10)) },
      },
      hp: { value: num(json.hp, 0), max: num(json.hp_max, num(json.hp, 0)) },
      gold: num(json.gold, 0),
      deprived: !!json.deprived,
      panicked: !!json.panicked,
      armorOverride,
      background,
      backgroundUuid,
      contentSource,
      description: String(json.description ?? ""),
      notes,
      traits,
      age,
      questions,
      bonds,
      scarEnabled: scars.length > 0,
      scars,
      omenEnabled: !!omens.trim(),
      omen: omens,
    },
    items,
    prototypeToken: {
      name,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      actorLink: true,
      // No `vision` key — not in PrototypeToken's schema, pruned silently.
      // Sight is stamped in CairnActor#_preCreate.
    },
    type: "character",
  };
  // Background provenance (2026-09-02): a MATCHED background was picked by the
  // player in Kettlewright, so the Roll Character dialog must not offer to
  // re-roll it by default. An unmatched one stores nothing — absent reads as
  // rolled, the legacy default.
  if (backgroundUuid) data.flags = { [FLAG_SCOPE]: { backgroundChosen: true } };
  // Portraits. A STOCK pick stores the bare filename of art we ship ourselves —
  // Kettlewright's portraits are tlomdev's drawings, carried under
  // tlomdev/kettlewright-portraits/ with Kettlewright's exact numbering for this
  // mapping — so the imported character keeps the face its player chose, on
  // portrait AND token (the art is drawn as a circular token; a random Aspeheim
  // token under a tlomdev face would clash).
  //
  // A custom absolute URL is used directly, but only when the Actor schema's own
  // img field accepts it (2026-09-01, user ruling). Core's FilePathField refuses
  // any path that does not END in an image extension (validators.mjs:18-22 —
  // "https://host/myimage", ".../download?format=png"), and such a URL used to
  // ride verbatim into CairnActor.create, which does not reject on a validation
  // error — core logs it and resolves undefined — so the GM got a raw schema
  // dump and no actor. Asking the real field, not a copy of its rule, means
  // this check can never drift from what create() will actually accept.
  //
  // Everything else falls back to a random portrait + paired token exactly as
  // generation does, so an import lands looking like a character rather than a
  // blank silhouette — and when that fallback DISCARDS a face the player
  // actually picked (an unusable URL, a name outside the shipped stock set),
  // `report.portrait` says so and the summary dialog shows it (same ruling: a
  // dropped reference must explain itself). default-portrait.webp is
  // Kettlewright's "no pick" placeholder and an empty value chose nothing:
  // both stay silent, because there is no face to mourn. The player can swap
  // the portrait from the sheet's gallery either way.
  const imageRef = String(json.image_url ?? "");
  const stock = !json.custom_image && /^portrait\d+\.webp$/.test(imageRef)
    ? await kettlewrightPortraitPath(imageRef)
    : null;
  const customUrl = customPortraitUrl(json);
  if (customUrl && !CairnActor.schema.getField("img").validate(customUrl)) {
    data.img = customUrl;
    // An UPLOAD lives on kettlewright.com and is shown from there (user ruling
    // 2026-11-20): it serves publicly but sends no Access-Control-Allow-Origin,
    // so this browser could not have saved a copy. The summary says so, and
    // how to keep it.
    if (customUrl !== imageRef) report.portraitLinked = customUrl;
  } else if (stock) {
    data.img = stock;
    data.prototypeToken.texture = { src: stock };
  } else {
    if (customUrl) report.portrait = { dropped: customUrl, reason: "url" };
    else if (imageRef && imageRef !== "default-portrait.webp") report.portrait = { dropped: imageRef, reason: "unknown" };
    const pair = await randomPortraitPair("pc");
    if (pair) {
      data.img = pair.img;
      data.prototypeToken.texture = { src: pair.token };
    }
  }

  const pets = await placePets(json, data, report);
  return { data, report, pets };
};

/**
 * Where each of the character's Kettlewright pets lands (user rulings
 * 2026-11-20). Kettlewright makes a pet of things Air Bladder ships as ITEMS —
 * a background option's Alchemical Tattoo or Carrion Cat — so:
 *
 *  1. a pet the character already holds as an item adds nothing ("held");
 *  2. a pet whose name resolves to one of our items becomes that item
 *     ("item") — but only if it FITS: a pet takes no slot in Kettlewright,
 *     and a bulky cat on a character at 9 of 10 would leave them encumbered
 *     here, which is HP 0 (Cairn);
 *  3. anything else, or one that did not fit, becomes a companion NPC
 *     ("companion") connected to the character — returned as a spec for
 *     grantContainers, minted once the character exists.
 *
 * "Fits" is asked of a real, unsaved Actor built from the create data, so it
 * is the sheet's own slot rule (calcSlotsUsed, coins included), never a copy.
 * A pet's own `containers` are not read: containers are out of this import's
 * scope (user, 2026-11-20). Mutates `data.items` and `report.pets`.
 *
 * @param {Object} json    the export
 * @param {Object} data    the character's create payload
 * @param {Object} report  the import report
 * @returns {Promise<Object[]>}  companion specs, in the export's order
 */
const placePets = async (json, data, report) => {
  const specs = [];
  const list = Array.isArray(json.pets) ? json.pets : [];
  if (!list.length) return specs;
  report.pets = [];
  const fits = (items) => !new CairnActor({ ...data, items }).system.encumbered;
  for (const pet of list) {
    const name = String(pet?.name ?? "").trim();
    if (!name) continue;
    if (data.items.some((i) => norm(i.name) === norm(name))) {
      report.pets.push({ name, as: "held" });
      continue;
    }
    const item = await resolveGearItem(name);
    if (item) {
      const notes = String(pet.notes ?? "").trim();
      if (notes && !String(item.system?.description ?? "").trim()) item.system.description = notes;
      const candidate = withGrantSource(item, "imported");
      candidate.sort = (data.items.length + 1) * CONST.SORT_INTEGER_DENSITY;
      if (fits([...data.items, candidate])) {
        data.items.push(candidate);
        report.pets.push({ name, as: "item" });
        continue;
      }
    }
    specs.push(petSpec(pet, name));
    report.pets.push({ name, as: "companion" });
  }
  return specs;
};

/**
 * A Kettlewright pet as a grantContainers spec: always a companion (its name
 * must not be read as a vehicle), its notes as the description, and its stat
 * block where Kettlewright recorded one — a pet a background gave it carries
 * every stat null, and those leave the schema's defaults.
 * @param {Object} pet
 * @param {String} name
 * @returns {Object}
 */
const petSpec = (pet, name) => {
  const has = (v) => v != null && Number.isFinite(Number(v));
  const pair = (value, max) => (has(value) || has(max)
    ? { value: num(value, num(max)), max: num(max, num(value)) } : null);
  const hp = pair(pet.hp, pet.hp_max);
  const abilities = {};
  for (const [key, field] of [["STR", "strength"], ["DEX", "dexterity"], ["WIL", "willpower"]]) {
    const p = pair(pet[field], pet[`${field}_max`]);
    if (p) abilities[key] = p;
  }
  const img = customPortraitUrl(pet);
  return {
    name,
    slots: 0,
    role: "companion",
    grantSource: "imported",
    // The attack is Kettlewright's own text ("d6 bite"), kept as prose the
    // way the shipped companions keep theirs; nothing here automates it.
    description: [pet.notes, pet.attack].map((x) => String(x ?? "").trim()).filter(Boolean).join("\n\n"),
    ...(hp ? { hp } : {}),
    ...(Object.keys(abilities).length ? { abilities } : {}),
    ...(num(pet.armor) > 0 ? { armorOverride: Math.min(3, num(pet.armor)) } : {}),
    ...(img && !CairnActor.schema.getField("img").validate(img) ? { img } : {}),
    items: Array.isArray(pet.items) ? pet.items : [],
  };
};

/**
 * Mint the character's companion pets (placePets) once the character exists,
 * through grantContainers — the path a background-granted beast takes, so a
 * pet is connected, owned and clamped to the connection limit exactly as one
 * is. Then each pet's own items onto it. A pet the limit turned away is
 * recorded on the report by name, for the summary.
 * @param {CairnActor} actor
 * @param {Object[]} specs
 * @param {Object} report
 * @returns {Promise<CairnActor[]>}
 */
const mintPets = async (actor, specs, report) => {
  if (!actor || !specs.length) return [];
  const made = await grantContainers(actor, specs.map((spec) => {
    const { items, ...rest } = spec;
    void items;
    return rest;
  }));
  // grantContainers keeps the head of the list when it clamps.
  const turnedAway = specs.slice(made.length).map((s) => s.name);
  if (turnedAway.length) {
    report.petsTurnedAway = turnedAway;
    for (const entry of report.pets ?? []) if (turnedAway.includes(entry.name) && entry.as === "companion") entry.as = "limit";
  }
  for (const [i, npc] of made.entries()) {
    const kwItems = specs[i].items ?? [];
    if (!kwItems.length) continue;
    const built = [];
    for (const kw of kwItems) if (kw?.name && kw?.carrying == null) built.push((await importItem(kw)).item);
    if (built.length) await npc.createEmbeddedDocuments("Item", built);
  }
  return made;
};

/**
 * Prompt for a local .json file and return its text (or null if none was read).
 * No FilePicker: that browses server-side data paths, not the user's machine — so
 * this uses a transient <input type=file> + FileReader, the standard browser path
 * (there is no prior in-repo precedent for reading a user file).
 * @returns {Promise<string|null>}
 */
const pickJsonFileText = () =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onload = () => finish(String(reader.result ?? ""));
      reader.onerror = () => finish(null);
      reader.readAsText(file);
    });
    // Cancelling the OS dialog fires `cancel` on the input (Chromium 113+, which
    // covers every Foundry v14 client). Without it the promise stayed pending
    // forever and the detached input was never collected -- harmless in practice,
    // but it meant "cancel" and "still choosing" were indistinguishable, so a
    // caller could never tell the two apart.
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });

/**
 * Show a post-import review: what matched by name vs. was built from tags, the
 * fatigue count, whether the background matched or was kept as text, and which
 * containers were flattened away — so the GM can fix up the sheet knowingly.
 * @param {CairnActor} actor @param {Object} report
 * @returns {Promise<void>}
 */
export const showImportSummary = async (actor, report) => {
  const L = (k) => game.i18n.localize(k);
  const F = (k, d) => game.i18n.format(k, d);
  const parts = [];

  // An unmatched background always imports (the gate retired 2026-09-01), so
  // this warning is where the cost lands after the options dialog's general
  // one: without the background's question list there is nothing to split the
  // answers against, and nothing to re-roll them from.
  if (report.background) {
    // The MATCHED name is a shipped background's, so it rides the content
    // overlay like every sibling surface (the picker, the sheet header, the
    // change-background confirm). The unmatched branch stays raw on purpose:
    // that string is the export's own, no pack document backs it, and a
    // reverse lookup is forbidden (content-overlay rules).
    parts.push(
      report.background.matched
        ? `<p class="kwi-ok"><i class="fas fa-check"></i> ${F("CAIRN.KWImport.BgMatched", { name: esc(t("bg.name", report.background.name)) })}</p>`
        : `<p class="kwi-warn"><i class="fas fa-circle-exclamation"></i> ${F("CAIRN.KWImport.BgUnmatched", { name: esc(report.background.name) })} ${L("CAIRN.KWImport.BgUnmatchedCost")}</p>`
    );
  }

  parts.push(`<p>${F("CAIRN.KWImport.ItemCounts", { matched: report.matched.length, fallback: report.fallback.length, fatigue: report.fatigue })}</p>`);

  if (report.fallback.length) {
    parts.push(`<p class="kwi-warn">${L("CAIRN.KWImport.FallbackList")}</p><ul>${report.fallback.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  }
  if (report.containers.length) {
    parts.push(`<p>${L("CAIRN.KWImport.ContainersFlattened")}</p><ul>${report.containers.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  }
  // A portrait reference the import had to discard — an unusable URL or a name
  // outside the shipped stock set. The silent fallbacks (no pick, placeholder)
  // never set this; a face the player chose must not vanish without a word.
  if (report.portrait) {
    const line = report.portrait.reason === "url"
      ? F("CAIRN.KWImport.PortraitUrlDropped", { url: esc(report.portrait.dropped) })
      : F("CAIRN.KWImport.PortraitUnknown", { name: esc(report.portrait.dropped) });
    parts.push(`<p class="kwi-warn"><i class="fas fa-circle-exclamation"></i> ${line}</p>`);
  }
  // Traits either became structured fields or stayed prose — say which, because the
  // difference is visible on the sheet (populated dropdowns vs a paragraph in Notes).
  // Background questions: a full match is a clean win and says only that; a
  // shortfall — partial OR zero — points at Notes, where the unclaimed text
  // stayed (the silent zero was ruled out 2026-09-03). The Notes mention
  // used to ride the success line too, which read as if the answers had
  // landed as loose prose.
  if (report.questionsTotal) {
    parts.push(report.questions === report.questionsTotal
      ? `<p class="kwi-ok"><i class="fas fa-check"></i> ${F("CAIRN.KWImport.QuestionsMapped", { count: report.questions })}</p>`
      : `<p class="kwi-warn"><i class="fas fa-circle-exclamation"></i> ${F("CAIRN.KWImport.QuestionsPartial", { count: report.questions, total: report.questionsTotal })}</p>`);
  }
  if (report.traitsUnparsed) {
    parts.push(`<p class="kwi-warn"><i class="fas fa-circle-exclamation"></i> ${L("CAIRN.KWImport.TraitsUnparsed")}</p>`);
  } else if (report.traits) {
    parts.push(`<p class="kwi-ok"><i class="fas fa-check"></i> ${F("CAIRN.KWImport.TraitsMapped", { count: report.traits, age: esc(report.age) || "—" })}</p>`);
  }
  // The age-raised/age-lowered lines that used to render here retired with
  // the min/max bounds (2026-08-21): an imported age lands verbatim, so there
  // is nothing to report.

  const dialog = new foundry.applications.api.DialogV2({
    // The RAW name: ApplicationV2 sets a window title through `innerText`
    // (application.mjs:932), a text sink, so an escaped "&amp;" would render
    // literally (review #19). `esc` is for the HTML built by hand below.
    window: { title: F("CAIRN.KWImport.SummaryTitle", { name: actor.name }), icon: "fas fa-file-import" },
    position: { width: 460 },
    content: `<div class="kwi-summary">${parts.join("")}</div>`,
    buttons: [{ action: "ok", label: L("CAIRN.Close"), default: true }],
  });
  await dialog.render(true);

  // Put the summary in front of the character sheet. It is the only place that says
  // what didn't import cleanly, so it must not open buried.
  //
  // The ordering is the opposite of what it looks like. Creating the actor
  // auto-renders its sheet, but that render is kicked off asynchronously and lands
  // AFTER create() resolves — i.e. after this dialog has already drawn — so the
  // sheet takes the next number from the shared z-index counter and covers us
  // (measured: summary 101, sheet 102). Raising the dialog inline here is useless:
  // it only bumps a counter the sheet is about to out-bid.
  //
  // Worse, the sheet claims its z AFTER its own render hook fires, so the hook
  // alone isn't late enough either — hence the extra macrotask.
  // Guarded on `rendered`: bringToFront dereferences the app's #element
  // unconditionally (application.mjs:1592) and throws once close() has torn
  // it down — and a player can dismiss the summary inside the fallback
  // window below.
  const raise = () => setTimeout(() => { if (dialog.rendered) dialog.bringToFront(); }, 0);
  if (actor.sheet?.rendered) raise();
  else {
    let fallback = null;
    const hookId = Hooks.on("renderCairnActorSheet", (app) => {
      if (app?.actor?.id !== actor.id) return;
      Hooks.off("renderCairnActorSheet", hookId);
      clearTimeout(fallback);
      raise();
    });
    // Safety net: a sheet that never renders must not leave the summary buried.
    fallback = setTimeout(() => {
      Hooks.off("renderCairnActorSheet", hookId);
      raise();
    }, 1000);
  }
};

/**
 * Say what is about to happen before the file dialog opens: what to pick, and
 * that an unmatched background still imports, just less structured. Purely
 * informational — the "Require a matching background" gate that used to live
 * here RETIRED on 2026-09-01 (user ruling): the import always proceeds, and
 * the warning in this dialog plus the summary's kept-as-text line replace the
 * refusal.
 *
 * @returns {Promise<Boolean|null>} truthy to proceed, null if cancelled
 */
const promptImportOptions = async () => {
  const L = (k) => game.i18n.localize(k);
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: L("CAIRN.KWImport.Button"), icon: "fas fa-file-import" },
    position: { width: 460 },
    content: `
      <div class="kwi-options">
        <p>${L("CAIRN.KWImport.OptionsIntro")}</p>
        <p class="kwi-hint">${L("CAIRN.KWImport.OptionsWarning")}</p>
      </div>`,
    buttons: [
      {
        action: "import",
        label: L("CAIRN.KWImport.ChooseFile"),
        icon: "fas fa-file-import",
        default: true,
        callback: () => true,
      },
      // `false`, never `null`: DialogV2 resolves a button as
      // `(await callback(...)) ?? button.action` (dialog.mjs:273), so a
      // callback returning null falls through to the string "cancel" — truthy
      // at the call site, which made the Cancel BUTTON proceed to the file
      // picker anyway (review #9, back when this dialog carried the
      // background gate). Only the header ✕ resolved null and really
      // cancelled. `false` survives the ?? and reads as the refusal it is.
      { action: "cancel", label: L("CAIRN.Cancel"), callback: () => false },
    ],
    rejectClose: false,
  });
  return result || null;
};

/**
 * Rebuild a Kettlewright export that arrived over the socket, field by field.
 *
 * The importKW broker's wall (cairn.js). Anything on that wire was composed
 * by a client we do not control, and the doctrine grantActors set is that
 * such a payload is not trusted, it is REBUILT — only known fields are
 * copied, every scalar is coerced, free text is capped. The caps sit far
 * above anything Kettlewright emits (a real export is a few KB), so a
 * genuine export passes through unchanged in meaning; what cannot pass is a
 * payload smuggling extra keys toward Actor.create, or an items array built
 * to grind the Warden's client (each item is a sequential await against the
 * gear packs: seconds for a normal inventory, so thousands would be minutes).
 *
 * Returns null when the payload is not plausibly a character export — the
 * one refusal that is a judgement rather than a coercion — so the broker can
 * answer `failed` instead of importing nonsense. The direct path does not
 * call this: a GM's own file needs no wall their console doesn't already
 * step over.
 *
 * @param {Object} json  a parsed object off the wire
 * @returns {Object|null}
 */
export const sanitizeKettlewrightExport = (json) => {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const items = Array.isArray(json.items) ? json.items : [];
  const containers = Array.isArray(json.containers) ? json.containers : [];
  // A character owns a few dozen items at the outside; hundreds is not a
  // character, it is a payload aimed at the import loop.
  if (items.length > 500 || containers.length > 100) return null;
  const str = (v, cap) => (typeof v === "string" || typeof v === "number" ? String(v) : "").slice(0, cap);
  const maybeNum = (v) => (v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
  // The background's numbered question/answer pairs (readTablePairs). Only
  // keys of that exact shape pass, two digits at most, so this cannot carry
  // anything else toward Actor.create.
  const tablePairs = Object.fromEntries(
    Object.keys(json).filter((k) => TABLE_PAIR_KEY.test(k)).map((k) => [k, str(json[k], 10_000)]),
  );
  const item = (it) => ({
    name: str(it?.name, 200),
    tags: (Array.isArray(it?.tags) ? it.tags : []).slice(0, 40).map((tag) => str(tag, 100)),
    description: str(it?.description, 5000),
    uses: maybeNum(it?.uses),
    max_uses: maybeNum(it?.max_uses),
    charges: maybeNum(it?.charges),
    max_charges: maybeNum(it?.max_charges),
    // Presence is the signal the skip-check reads (`carrying != null`).
    ...(it?.carrying != null ? { carrying: true } : {}),
  });
  // Pets ride with the character (placePets). A handful at most; each is
  // minted as an Actor on the Warden's client, so the count is capped hard.
  const pets = (Array.isArray(json.pets) ? json.pets : []).slice(0, 20).map((p) => ({
    name: str(p?.name, 100),
    role: str(p?.role, 100),
    notes: str(p?.notes, 10_000),
    attack: str(p?.attack, 200),
    hp: maybeNum(p?.hp), hp_max: maybeNum(p?.hp_max),
    strength: maybeNum(p?.strength), strength_max: maybeNum(p?.strength_max),
    dexterity: maybeNum(p?.dexterity), dexterity_max: maybeNum(p?.dexterity_max),
    willpower: maybeNum(p?.willpower), willpower_max: maybeNum(p?.willpower_max),
    armor: maybeNum(p?.armor),
    image_url: str(p?.image_url, 2000),
    custom_image: !!p?.custom_image,
    items: (Array.isArray(p?.items) ? p.items : []).slice(0, 100).map(item),
  }));
  return {
    ...tablePairs,
    name: str(json.name, 120),
    // One of the two values Kettlewright writes, or nothing (an older, 2e export).
    edition: json.edition === "barebones" ? "barebones" : json.edition === "2e" ? "2e" : undefined,
    background: str(json.background, 200),
    custom_background: str(json.custom_background, 200),
    items: items.map(item),
    pets,
    containers: containers.map((c) => ({ id: maybeNum(c?.id) ?? 0, name: str(c?.name, 200) })),
    description: str(json.description, 50_000),
    notes: str(json.notes, 50_000),
    traits: str(json.traits, 10_000),
    bonds: str(json.bonds, 10_000),
    scars: str(json.scars, 10_000),
    omens: str(json.omens, 10_000),
    strength: maybeNum(json.strength),
    strength_max: maybeNum(json.strength_max),
    dexterity: maybeNum(json.dexterity),
    dexterity_max: maybeNum(json.dexterity_max),
    willpower: maybeNum(json.willpower),
    willpower_max: maybeNum(json.willpower_max),
    hp: maybeNum(json.hp),
    hp_max: maybeNum(json.hp_max),
    gold: maybeNum(json.gold),
    armor: str(json.armor, 10),
    deprived: !!json.deprived,
    panicked: !!json.panicked,
    image_url: str(json.image_url, 2000),
    custom_image: !!json.custom_image,
  };
};

/**
 * The trusted half of an import: convert and create.
 * Runs on whichever client is allowed to WRITE — the importer itself on the
 * direct path (a GM, or a player the Warden trusts with Create New Actors),
 * or the active Warden's client answering a player's relay (the importKW
 * broker in cairn.js). One function for both so the two paths cannot drift.
 *
 * Returns an outcome object rather than toasting, because the right screen
 * for each message differs by caller: the direct flow speaks locally, the
 * broker answers the requester over the socket.
 *
 * An unmatched background is NOT refused (the "Require a matching
 * background" gate RETIRED 2026-09-01, user ruling — it used to be the one
 * refusal here): the character always arrives, background kept as plain
 * text, and the cost — no question list to split the answers against,
 * nothing re-rollable — is stated up front in the options dialog and again
 * by the summary's kept-as-text warning.
 *
 * Throws only on a create() REJECTION — a validation error does not reject
 * (core catches it inside ClientDatabaseBackend#preCreateDocumentArray, logs
 * it, and create RESOLVES undefined), which is why `actor: null` is a
 * first-class outcome, not an impossibility.
 *
 * @param {Object} json  a parsed Kettlewright export
 * @param {Object} [opts]
 * @param {Object|null} [opts.ownership]  extra ownership for the CREATE data.
 *   The relay mints on the Warden's client FOR a player, so the requester's
 *   OWNER must be in the create data, not patched on after — the same rule
 *   the generatePC relay records at createActorWithCharacter.
 * @returns {Promise<{actor: CairnActor|null, report: Object}>}
 */
export const performKettlewrightImport = async (json, { ownership = null, labels = null } = {}) => {
  const { data, report, pets } = await kettlewrightToActorData(json, { labels });
  if (ownership) data.ownership = ownership;
  // THE PARTY FOLDER (review #34 finding 174), where Create PC beside this
  // button files a new character — `createActorInteractive` on the direct
  // path, the generatePC relay on the other (review #33). Both of this
  // import's doors run this function, so they file here, made on demand; a
  // player who may not make the folder gets the root, as Create PC does.
  // Dynamic, as character-generator.js reaches party-pile.js.
  const { partyFolderId } = await import("./party-pile.js");
  data.folder = await partyFolderId();
  const actor = await CairnActor.create(data);
  // After the character, because a companion is connected TO it. On the
  // relay this runs on the Warden's client, so the companions are minted
  // there too, owned like the character the player now holds.
  await mintPets(actor, pets ?? [], report);
  return { actor: actor ?? null, report };
};

/**
 * Pick a Kettlewright export, parse it, and turn it into a new character
 * Actor — directly when this client may create one, through the Warden's
 * client when it may not. Returns the created Actor (direct path) or null.
 *
 * GM-only until 2026-09-01 (no recorded reason — the original design simply
 * predated the player-relay machinery); now open to players under the same
 * switch that gates Generate PC, `allow-player-generate`, relabelled in the
 * UI to cover both routes: one trust decision, "may players mint their own
 * characters". The directory button hides while it is off; the check here is
 * the belt for a directory rendered before the switch flipped.
 * @returns {Promise<CairnActor|null>}
 */
export const importKettlewrightCharacter = async () => {
  if (!game.user.isGM && !game.settings.get(SETTINGS_NS, "allow-player-generate")) {
    ui.notifications.warn(game.i18n.localize("CAIRN.KWImport.NotAllowed"));
    return null;
  }
  // The relay needs a Warden online, and that is knowable NOW — refuse before
  // the player fills the options dialog and picks a file, not after they have
  // done both (requestPcGeneration asks in the same order).
  if (!game.user.can("ACTOR_CREATE") && !game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.KWImport.NoWardenForImport"));
    return null;
  }
  const options = await promptImportOptions();
  if (!options) return null;
  const text = await pickJsonFileText();
  if (text == null) return null;
  let json;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    ui.notifications.error(game.i18n.localize("CAIRN.KWImport.BadJson"));
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    ui.notifications.error(game.i18n.localize("CAIRN.KWImport.BadShape"));
    return null;
  }

  // Direct path: this client may write, so the whole flow stays local.
  if (game.user.can("ACTOR_CREATE")) {
    let outcome;
    try {
      outcome = await performKettlewrightImport(json);
    } catch (e) {
      // A failed create must explain itself (2026-09-01, user ruling).
      console.error(e);
      // The key + {format} form, never a pre-formatted string: notify()
      // escapes each format value and skips cleanHTML for a known key, where
      // a pre-formatted message is cleaned WHOLE — an angle bracket in the
      // value (an error message, a hand-edited name) silently truncates the
      // toast (notifications.mjs:108-122). Same rule at every toast that
      // interpolates a value this file or the broker shows.
      ui.notifications.error("CAIRN.KWImport.CreateFailed", { format: { reason: e.message }, permanent: true });
      return null;
    }
    if (!outcome.actor) {
      // create() resolved undefined: a validation error core caught and logged.
      ui.notifications.error(game.i18n.localize("CAIRN.KWImport.CreateFailedConsole"), { permanent: true });
      return null;
    }
    await showImportSummary(outcome.actor, outcome.report);
    return outcome.actor;
  }

  // Relay path: this player cannot create an Actor (a server wall, not a UI
  // gate), so the PARSED export travels to the active Warden's client, which
  // runs the same trusted half above and answers with kwImported (cairn.js) —
  // the requester's client then opens the sheet and shows the summary. The
  // file itself never leaves this machine; only its parsed content does.
  //
  // Re-read at emit time: the Warden the top-of-function check saw can have
  // dropped during the two dialogs, and the recipients option needs a live id.
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("CAIRN.KWImport.NoWardenForImport"));
    return null;
  }
  // An export is a few KB; the server would relay up to 100 MB
  // (maxHttpBufferSize) and the broker refuses over 1 MB anyway, so a giant
  // file is refused HERE, before it crosses the wire.
  if (text.length > 1_000_000) {
    ui.notifications.error(game.i18n.localize("CAIRN.KWImport.TooLarge"));
    return null;
  }
  ui.notifications.info(game.i18n.localize("CAIRN.KWImport.ImportRequested"));
  // Addressed to the answering Warden alone: a two-argument emit is a
  // BROADCAST (handleCustomSocket takes {recipients} or falls back to
  // broadcast.emit), and this payload is the player's whole parsed export —
  // every other client's JS heap is no place for it.
  game.socket.emit(`system.${game.system.id}`, {
    action: "importKW", json,
    // In THIS client's language, for the text the Warden's client writes into
    // this player's character (review #34 finding 244, kettlewrightToActorData).
    labels: {
      defaultName: game.i18n.localize("CAIRN.KWImport.DefaultName"),
      traitsLabel: game.i18n.localize("CAIRN.KWImport.TraitsLabel"),
    },
  }, { recipients: [gm.id] });
  return null;
};
