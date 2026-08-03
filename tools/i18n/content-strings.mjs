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

const ACTOR_TYPES = new Set(["character", "npc", "container", "hireling"]);

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
export function* stringsFromDoc(doc) {
  const emit = function* (row) {
    if (typeof row.en === "string" && row.en.length) yield row;
  };
  // Pack-internal FOLDER documents (mounts-transports ships two, the repo's
  // first). They fell through every branch here to the Item fallthrough and
  // reached the translator as `item.name` rows — but no overlay surface reads
  // a folder's name, so the row promised a translation nothing would ever
  // display (review #5). Recognised by `_key`, the one field that says what a
  // record IS regardless of shape; if folder names ever get an overlay
  // surface, give them their own ns rather than un-skipping this.
  if (String(doc._key ?? "").startsWith("!folders!")) return;
  const name = doc.name ?? "(unnamed)";

  // RollTable — has a top-level results[] array.
  if (Array.isArray(doc.results)) {
    if (doc.name) yield* emit({ ns: "table.name", en: doc.name, context: "table" });
    // A RollTable's `description` is authoring / GM-procedure metadata (marketplace
    // stocking notes, "roll each dungeon cycle", one-line trait-table labels) shown
    // only on Foundry's EDITABLE RollTable config sheet — there is no read-only
    // surface to translate it on without risking a save writing the Spanish back
    // over the English source, and no player ever sees it. Deliberately NOT
    // extracted. Table RESULTS (what players/Wardens read when rolling) ARE, below.
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
