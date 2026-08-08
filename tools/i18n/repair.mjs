#!/usr/bin/env node
/**
 * Surgical repair of the content overlay — keys the runtime can no longer ask
 * for, and values a spreadsheet mangled on the way in.
 *
 *   node tools/i18n/repair.mjs [--lang es] [--write]
 *
 * Prints what it would do and changes nothing unless `--write` is passed,
 * because `lang/content/<lang>.json` is the translator's file.
 *
 * ## Why this exists rather than "just run extract && import"
 *
 * That was the standing advice, printed by `i18n:check` itself, and it is
 * actively unsafe. The round trip drags all ~1,700 entries through
 * writeTSV/readTSV to fix a couple of dozen keys, and on 2026-08-07 doing so to
 * re-key 24 entries **corrupted three others further**: values that already held
 * embedded tab/CRLF wreckage from an old spreadsheet import were re-split by the
 * cell parser and swallowed even more of the surrounding sheet. One Scars
 * translation grew from 172 to 875 characters of another row's text.
 *
 * The lesson generalises past this file: **a repair that rewrites everything in
 * order to fix a few things can only ever be as safe as the weakest record it
 * passes through.** So this tool touches ONLY the entries it names, preserves key
 * order so the diff shows the repair and nothing else, and never parses a TSV.
 *
 * ## What it repairs
 *
 * Keys (classified by orphans.mjs, the same rules `i18n:check` gates on):
 *   - entity     — keyed with `&mdash;`/`&rsquo;` the DOM never asks for, because
 *                  the runtime looks up `node.innerHTML` where the browser has
 *                  already decoded them. These have never once been displayed.
 *   - entityDup  — the decoded key already exists; the entity key is spent
 *                  residue and is deleted.
 *   - quoted     — a spreadsheet's CSV quoting of a real source string.
 *   - moved      — the same English lives under a different namespace now
 *                  (a rename or a document type change). Only repaired when the
 *                  destination is unambiguous.
 *
 * Values:
 *   - a leading unbalanced `"` and everything from the first TAB onward. Both are
 *     debris from a cell that was split wrongly; the text before the first tab is
 *     the translator's actual sentence, unaltered.
 *
 * Every value this tool keeps is kept BYTE-IDENTICAL. Nothing here retranslates,
 * and nothing here invents a string.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { normalizeKey } from "./lib.mjs";
import { classifyOverlay, liveSources, overlayPath } from "./orphans.mjs";

/** A value carrying spreadsheet debris, and the sentence hiding inside it. */
export const repairValue = (v) => {
  if (typeof v !== "string") return null;
  // A tab can never be part of a translated sentence here, and a value opening
  // with an unmatched double quote is the residue of CSV cell-wrapping.
  const hasDebris = v.includes("\t") || (v.startsWith('"') && !v.endsWith('"'));
  if (!hasDebris) return null;
  const fixed = v.replace(/^"/, "").split("\t")[0].replace(/\r?\n$/, "");
  return fixed && fixed !== v ? fixed : null;
};

/** Rewrite one namespace's keys IN PLACE, so the diff is the repair and nothing else. */
const rekeyPreservingOrder = (group, renames, deletions) => {
  const out = {};
  for (const [k, v] of Object.entries(group)) {
    if (deletions.has(k)) continue;
    out[renames.has(k) ? renames.get(k) : k] = v;
  }
  return out;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--lang");
  const LANG = i === -1 ? "es" : process.argv[i + 1];
  const WRITE = process.argv.includes("--write");

  const live = liveSources();
  const result = classifyOverlay(LANG, live);
  if (!result) {
    console.error(`\nNo lang/content/${LANG}.json — nothing to repair.\n`);
    process.exit(1);
  }
  const { overlay, orphans } = result;

  // ns -> {renames: Map(old→new), deletions: Set}
  const plan = new Map();
  const at = (ns) => {
    if (!plan.has(ns)) plan.set(ns, { renames: new Map(), deletions: new Set() });
    return plan.get(ns);
  };
  const log = [];

  for (const o of orphans.entity) {
    at(o.ns).renames.set(o.key, o.decoded);
    log.push(`  re-key   ${o.ns}  ${o.ents.join(" ")} → decoded   ${o.key.slice(0, 52)}`);
  }
  for (const o of orphans.entityDup) {
    at(o.ns).deletions.add(o.key);
    log.push(`  delete   ${o.ns}  spent entity residue          ${o.key.slice(0, 52)}`);
  }
  for (const o of orphans.quoted) {
    const target = normalizeKey(o.key.slice(1, -1).replace(/""/g, '"'));
    at(o.ns).renames.set(o.key, target);
    log.push(`  re-key   ${o.ns}  un-quote                      ${o.key.slice(0, 52)}`);
  }
  for (const o of orphans.moved) {
    // Ambiguity here is a judgement about content, not about tooling: the same
    // English under two live namespaces cannot be assigned by a script.
    if (o.movedTo.length !== 1) {
      log.push(`  SKIP     ${o.ns}  moved to ${o.movedTo.length} namespaces — decide by hand: ${o.key.slice(0, 40)}`);
      continue;
    }
    const dest = o.movedTo[0];
    if (overlay[dest]?.[o.key] !== undefined) {
      at(o.ns).deletions.add(o.key);
      log.push(`  delete   ${o.ns}  already present in ${dest}`);
    } else {
      (overlay[dest] ??= {})[o.key] = o.tr;
      at(o.ns).deletions.add(o.key);
      log.push(`  move     ${o.ns} → ${dest}                    ${o.key.slice(0, 45)}`);
    }
  }

  // Values, over the whole file: this class is not an orphan — the key is fine
  // and the translation is being displayed, as a wall of somebody else's TSV.
  let valueFixes = 0;
  for (const [ns, group] of Object.entries(overlay)) {
    if (!group || typeof group !== "object") continue;
    for (const [k, v] of Object.entries(group)) {
      const fixed = repairValue(v);
      if (!fixed) continue;
      group[k] = fixed;
      valueFixes++;
      log.push(`  value    ${ns}  ${v.length} → ${fixed.length} chars           ${fixed.slice(0, 45)}`);
    }
  }

  for (const [ns, { renames, deletions }] of plan) {
    if (!renames.size && !deletions.size) continue;
    overlay[ns] = rekeyPreservingOrder(overlay[ns], renames, deletions);
  }

  const keyOps = [...plan.values()].reduce((n, p) => n + p.renames.size + p.deletions.size, 0);
  console.log(`\nrepair lang/content/${LANG}.json`);
  for (const l of log) console.log(l);
  console.log(`\n  ${keyOps} key operation(s), ${valueFixes} value repair(s)`);

  if (!keyOps && !valueFixes) {
    console.log(`  nothing to do\n`);
    process.exit(0);
  }
  if (!WRITE) {
    console.log(`\n  DRY RUN — nothing written. Pass --write to apply.`);
    console.log(`  This edits the translator's file; every kept value stays byte-identical.\n`);
    process.exit(0);
  }

  // Match the file's existing line endings rather than imposing LF: this file is
  // hand-edited and PR'd by someone else, and a wholesale ending flip would bury
  // a 24-line repair in a 1,700-line diff.
  const before = fs.readFileSync(overlayPath(LANG), "utf8");
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const json = JSON.stringify(overlay, null, 2).replace(/\n/g, eol) + eol;
  fs.writeFileSync(overlayPath(LANG), json);
  console.log(`\n  wrote lang/content/${LANG}.json\n`);
}
