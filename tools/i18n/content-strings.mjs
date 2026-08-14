#!/usr/bin/env node
/**
 * The authoritative enumeration of "what is translatable content" in a pack
 * document. Lives in its own side-effect-free module so BOTH consumers can
 * import it: `extract-content.mjs`, which turns it into the translator's
 * spreadsheets, and `check.mjs`, which uses it to prove no shipped translation
 * is keyed to a string that no longer exists.
 *
 * It used to live inside extract-content.mjs, where nothing but the extractor
 * could reach it -- so the one tool that knew which overlay keys were orphaned
 * was also the only tool that could tell you, and it told you by writing a
 * gitignored TSV that a release gate never read. Thirty of Malecho's finished
 * Spanish strings sat dead for two days behind exactly that arrangement.
 *
 * The taxonomy IS the contract with the overlay engine (module/i18n-content.js)
 * -- keep the two in step.
 */

import { parse as parseHTML } from "node-html-parser";
import { domSourceKey } from "./lib.mjs";

const ACTOR_TYPES = new Set(["character", "npc", "container", "hireling"]);

/**
 * Journal packs whose text is translatable. Ruled 2026-08-14: the PLAYER-FACING
 * journals only. `journals-docs` is deliberately absent — every page in it is
 * REGENERATED from `docs/*.md` by tools/import/system-docs.mjs, so a translation
 * keyed to its English would be silently orphaned the next time a guide is
 * edited and the importer re-run, which is the routine maintenance step
 * CLAUDE.md tells a contributor to take. Offering a translator ~2,000 words
 * whose keys evaporate on someone else's ordinary workflow is worse than
 * offering nothing.
 */
const TRANSLATABLE_JOURNAL_PACKS = new Set(["journals-2e", "journals-glog"]);

/**
 * Block-level tags a journal page is split at, one overlay entry per element.
 *
 * PARAGRAPH-level rather than page-level, ruled 2026-08-14. A page here is a
 * single `text.content` string of up to 14,000 characters; keying the overlay on
 * the whole thing would hand a translator one spreadsheet cell holding an entire
 * rulebook page — tags and all — and would orphan that page's whole translation
 * the moment one English word changed. Split this way the four player journals
 * come to ~400 sentence-sized entries, the same size as the item and table rows
 * the overlay already carries, and an English edit costs exactly the sentences
 * it touched.
 *
 * `<td>`/`<th>` are in the list because the Scars and Reaction tables are real
 * prose. Container tags (`ul`, `table`, `tbody`, `tr`, `div`) are NOT: they hold
 * no text of their own, and emitting them would key a parent on a string that
 * also exists as its children, so translating the child would leave the parent's
 * copy of it English and the two would fight at render time.
 */
const BLOCK_TAGS = "p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption";

/**
 * A block carrying Foundry ENRICHMENT — `@UUID[…]{…}`, `@Actor[…]`, `[[/roll]]`,
 * `@Embed[…]` — cannot be translated by this overlay, and must not be offered.
 *
 * `TextEditor.enrichHTML` runs before the page reaches the DOM and expands the
 * stored `@UUID[Compendium.…]{GLOG Magic — Spells}` into a full
 * `<a class="content-link" data-uuid=… ><i …></i>GLOG Magic — Spells</a>`. The
 * key the browser then asks for is that expansion; the key the extractor could
 * emit is the source. They can never be equal, so a translation of such a block
 * is a row a translator fills in and which then does nothing, for ever, with
 * nothing anywhere reporting it — the exact dead promise the folder and macro
 * skips above exist to prevent. Two of the four player journals' 378 blocks are
 * in this class today; both are cross-reference sentences.
 *
 * The block therefore stays English by DESIGN rather than by accident, which is
 * the same call `swapResultNode` in module/cairn.js already makes for an
 * enriched table row. `dev:journal-i18n` asserts the DOM's unmatched keys are
 * exactly the enriched ones, so this boundary is measured rather than assumed —
 * and the day it grows, the probe says so instead of the translation silently
 * thinning.
 */
const ENRICHED = /@[A-Za-z]+\[|\[\[/;

/**
 * Yield every block-level chunk of one page's HTML, in document order.
 *
 * PARSED, never regexed. The keys have to be byte-identical to what the browser
 * hands back from `node.innerHTML` at display time — that is the whole contract
 * with the overlay — and a pattern that merely looks right on today's content is
 * how a key silently stops matching. `dev:journal-i18n` proves the two agree by
 * collecting the real DOM's keys in a real page render and checking every one is
 * a string this extractor emitted.
 *
 * Nested blocks are skipped: only the INNERMOST block owns its text, so a
 * `<li>` holding a nested `<ul><li>` yields the inner items and not the outer's
 * concatenation of them. Empty and whitespace-only blocks yield nothing.
 */
function* blocksOf(html) {
  const root = parseHTML(String(html ?? ""));
  for (const node of root.querySelectorAll(BLOCK_TAGS)) {
    if (node.querySelector(BLOCK_TAGS)) continue; // an outer block; its children carry the text
    const inner = node.innerHTML.trim();
    if (!inner || ENRICHED.test(inner)) continue;
    yield inner;
  }
}

/**
 * Yield { ns, en, context } for every translatable string in one document.
 * The taxonomy IS the contract with the overlay engine — keep the two in step.
 * A pure generator: no side effects, so the caller owns dedup/collection.
 *
 * Every yield goes through `emit`, which drops anything that is not a non-empty
 * STRING. YAML types a bare `1` as a number, and the Faction Advantage Count
 * table's rows are exactly that — so the raw generator handed the extractor a
 * row whose `en` was `1`, and `rows.sort(… a.en.localeCompare …)` threw. That
 * killed `i18n:extract` outright for every pack and every language from the day
 * the faction tables landed, which is how the orphan report below went unread
 * long enough for thirty finished translations to die quietly. A field of the
 * wrong type is not prose and is not a crash; it is nothing.
 */
export function* stringsFromDoc(doc, pack) {
  const emit = function* (row) {
    if (typeof row.en !== "string" || !row.en.length) return;
    // Key on what the RUNTIME will ask for, not on the YAML bytes. The overlay
    // is looked up with `node.innerHTML`, so the browser has already turned
    // `&mdash;` into `—`; an extractor keying on the raw source emits a key
    // nothing ever asks for and the translation ships dead. See domSourceKey.
    yield { ...row, en: domSourceKey(row.en) };
  };
  // Pack-internal FOLDER documents (mounts-transports ships two, the repo's
  // first). They fell through every branch here to the Item fallthrough and
  // reached the translator as `item.name` rows — but no overlay surface reads
  // a folder's name, so the row promised a translation nothing would ever
  // display (review #5). Recognised by `_key`, the one field that says what a
  // record IS regardless of shape; if folder names ever get an overlay
  // surface, give them their own ns rather than un-skipping this.
  if (String(doc._key ?? "").startsWith("!folders!")) return;
  // Macro documents (the macros pack's four Toggle_* scripts, 2026-08-08).
  // Same shape as the folder skip above: their `name` fell through to the Item
  // fallthrough and reached the translator as `item.name` rows, but
  // module/i18n-content.js has no macro surface — the Macros compendium
  // directory and the hotbar both render `macro.name` raw — so the row
  // promised a translation nothing would ever display. The `command` is
  // client-executed JS: its user-visible strings are i18n:source's beat (it
  // scans the macro YAML for hardcoded prose), not the content overlay's. If
  // macro names ever get an overlay surface, give them their own ns rather
  // than un-skipping this.
  if (String(doc._key ?? "").startsWith("!macros!")) return;
  const name = doc.name ?? "(unnamed)";

  // JournalEntry (2026-08-14, review #14 finding 13). Until now a journal fell
  // through every branch to the Item fallthrough and reached the translator as a
  // lone `item.name` row — so the entire Cairn 2e rules reference, the document a
  // Spanish PLAYER is handed and told to read, could never reach `i18n:handoff`
  // at all. A Spanish game translated its items, backgrounds, spells and tables,
  // and then opened the rules in English.
  //
  // Gated on the PACK, not on the document, because which journals are
  // translatable is a decision about where the text COMES FROM (see
  // TRANSLATABLE_JOURNAL_PACKS) and nothing on the document records that. A
  // journal in any other pack is skipped outright rather than falling through:
  // the Item fallthrough's `item.name` row is exactly the dead promise the
  // folder and macro skips above exist to prevent.
  if (String(doc._key ?? "").startsWith("!journal!")) {
    if (!TRANSLATABLE_JOURNAL_PACKS.has(pack)) return;
    if (doc.name) yield* emit({ ns: "journal.name", en: doc.name, context: "journal" });
    for (const p of doc.pages ?? []) {
      // A page name is only a heading when the page asks to show its title —
      // `title.show: false` (which both 2e rules pages set) renders nothing, so
      // there would be no surface for the translation to appear on.
      if (p.name && p.title?.show !== false) {
        yield* emit({ ns: "journal.pageName", en: p.name, context: `${name} · page` });
      }
      for (const block of blocksOf(p.text?.content)) {
        yield* emit({ ns: "journal.block", en: block, context: `${name} · ${p.name ?? "page"}` });
      }
    }
    return;
  }

  // RollTable — has a top-level results[] array.
  if (Array.isArray(doc.results)) {
    if (doc.name) yield* emit({ ns: "table.name", en: doc.name, context: "table" });
    // A RollTable's `description` was deliberately NOT extracted until
    // 2026-08-06, reasoned "shown only on Foundry's EDITABLE config sheet, so
    // translating it risks a save writing Spanish back". That reason EXPIRED
    // in v14: the DRAW CARD renders the description above every roll
    // (templates/dice/table-result.hbs), and that card consults `table.desc`
    // display-only (module/cairn.js). The sheet's read-only view mode is NOT
    // a surface for it — core drops a root part's loose text nodes
    // (handlebars-application.mjs:213), so a plain-text description never
    // renders there at all. Edit mode is never translated, so the old worry
    // cannot arise.
    if (doc.description) yield* emit({ ns: "table.desc", en: doc.description, context: `${name} · description` });
    for (const r of doc.results) {
      const range = Array.isArray(r.range) ? r.range.join("-") : "";
      // v13 split `TableResult#text` in two and the halves went to DIFFERENT
      // fields: a text row's value is `description`, a document row's is `name`.
      // This read `r.text`, so after the migration it extracted NOTHING for any
      // table — silently, because a row with no string is indistinguishable here
      // from a row that had none to begin with. Every rolled trait, bond, event,
      // weather and shop line was therefore missing from the translator's
      // spreadsheets. Same rule as `resultText` in module/compendium.js, which is
      // what the runtime overlay looks these up by; the two MUST agree or a
      // translated string is stored under a key nothing ever queries.
      const en = (r.type === "text" ? r.description : r.name) ?? "";
      if (en) yield* emit({ ns: "table.result", en, context: `${name} · ${range}`.trim() });
      // Our OWN per-row annotation, under our own flag scope. Today only the Scars
      // table carries one (12 rows), and the character sheet prints it beside every
      // scar — player-facing prose that reached no spreadsheet at all, so it read
      // English however complete the overlay was. Its own namespace rather than
      // table.result because the taxonomy mirrors the FIELD, not the document: this
      // is not the row's rolled text and must not key against it.
      const rowDesc = r.flags?.["air-bladder"]?.description ?? "";
      if (rowDesc) yield* emit({ ns: "table.resultDesc", en: rowDesc, context: `${name} · ${range} · detail`.trim() });
    }
    return;
  }

  // background Item — name/description plus the two d6 choice tables' prose.
  if (doc.type === "background") {
    if (doc.name) yield* emit({ ns: "bg.name", en: doc.name, context: "background" });
    if (doc.system?.description) yield* emit({ ns: "bg.desc", en: doc.system.description, context: `${name} · description` });
    const tables = doc.system?.tables ?? [];
    for (let ti = 0; ti < tables.length; ti++) {
      const t = tables[ti];
      if (t.question) yield* emit({ ns: "bg.question", en: t.question, context: `${name} · question ${ti + 1}` });
      const options = t.options ?? [];
      for (let oi = 0; oi < options.length; oi++) {
        if (options[oi].description) {
          yield* emit({ ns: "bg.optionDesc", en: options[oi].description, context: `${name} · Q${ti + 1} opt ${oi + 1}` });
        }
      }
    }
    // system.names[] are in-world proper names — deliberately NOT translated.
    return;
  }

  // Actor (monsters / npc) — name, description, and embedded item name/desc.
  if (ACTOR_TYPES.has(doc.type) || doc.system?.abilities) {
    if (doc.name) yield* emit({ ns: "monster.name", en: doc.name, context: "monster" });
    if (doc.system?.description) yield* emit({ ns: "monster.desc", en: doc.system.description, context: `${name} · description` });
    for (const it of doc.items ?? []) {
      if (it.name) yield* emit({ ns: "monster.itemName", en: it.name, context: `${name} · ${it.name}` });
      if (it.system?.description) yield* emit({ ns: "monster.itemDesc", en: it.system.description, context: `${name} · ${it.name} desc` });
    }
    return;
  }

  // Item (gear, weapons, armor, spellbooks, transports, market-goods, background-items).
  if (doc.name) yield* emit({ ns: "item.name", en: doc.name, context: doc.type ?? "item" });
  if (doc.system?.description) yield* emit({ ns: "item.desc", en: doc.system.description, context: `${name} · description` });
}
