#!/usr/bin/env node
/**
 * Extract the UI strings from lang/en.json into a single translator TSV
 * (tools/i18n/tsv/ui.tsv), pre-filling the translation column from the current
 * lang/<lang>.json where a key already has one. Column 1 is the dotted i18n key
 * (CAIRN.Deprived, CAIRN.Settings.MaxEquipSlots.label). Offline.
 *
 * Refuses to run if the existing ui.tsv holds translations that aren't in the JSON
 * yet (they would be destroyed) — import them first, or pass --force to discard.
 *
 *   node tools/i18n/extract-ui.mjs [--lang es] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, writeTSV, guardOverwrite } from "./lib.mjs";
import { flattenLang } from "./validate.mjs";

const langArg = process.argv.indexOf("--lang");
const LANG = langArg === -1 ? "es" : process.argv[langArg + 1];
const FORCE = process.argv.includes("--force");
// Mirrors extract-content.mjs, so `--out` can hold a second locale's sheets in
// their own folder instead of fighting over tools/i18n/tsv/.
const outArg = process.argv.indexOf("--out");
const OUT = outArg === -1 ? path.join(ROOT, "tools", "i18n", "tsv") : process.argv[outArg + 1];

const load = (f) => {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? flattenLang(JSON.parse(fs.readFileSync(p, "utf8"))) : {};
};

const en = load("lang/en.json");
const target = load(`lang/${LANG}.json`);

const rows = Object.entries(en).map(([key, enVal]) => {
  const trVal = target[key];
  // "done" only when a translation exists AND differs from English; tr==en means untranslated.
  const status = trVal == null ? "todo" : trVal === enVal ? "todo" : "done";
  return { key, context: "ui", en: enVal, tr: trVal ?? "", notes: "", status };
});

// Stale rows: keys in the translation the current en.json no longer has (the key was
// renamed or removed). Carry the orphan forward so a resuming translator can port
// or discard it rather than lose it; import skips status=stale rows so they never
// re-enter the shipped JSON. en is blank because the source key is gone.
const stale = Object.keys(target)
  .filter((key) => !(key in en))
  .map((key) => ({ key, context: "stale — key removed from en.json", en: "", tr: target[key], notes: "", status: "stale" }));
rows.push(...stale);

const out = path.join(OUT, "ui.tsv");
guardOverwrite([{ file: out, rows }], LANG, FORCE);
writeTSV(out, rows, LANG);
const done = rows.filter((r) => r.status === "done").length;
console.log(`UI → ${LANG}: ${rows.length} keys → ${path.relative(ROOT, out)}  (${done} pre-filled from lang/${LANG}.json, ${rows.length - done - stale.length} todo, ${stale.length} stale)`);
