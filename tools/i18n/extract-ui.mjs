#!/usr/bin/env node
/**
 * Extract the UI strings from lang/en.json into a single translator TSV
 * (tools/i18n/tsv/ui.tsv), pre-filling the es column from the current
 * lang/es.json where a key already has Spanish. Column 1 is the dotted i18n key
 * (CAIRN.Deprived, CAIRN.Settings.MaxEquipSlots.label). Offline.
 *
 *   node tools/i18n/extract-ui.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, writeTSV } from "./lib.mjs";
import { flattenLang } from "./validate.mjs";

const load = (f) => {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? flattenLang(JSON.parse(fs.readFileSync(p, "utf8"))) : {};
};

const en = load("lang/en.json");
const es = load("lang/es.json");

const rows = Object.entries(en).map(([key, enVal]) => {
  const esVal = es[key];
  // "done" only when Spanish exists AND differs from English; es==en means untranslated.
  const status = esVal == null ? "todo" : esVal === enVal ? "todo" : "done";
  return { key, context: "ui", en: enVal, es: esVal ?? "", notes: "", status };
});

const out = path.join(ROOT, "tools", "i18n", "tsv", "ui.tsv");
writeTSV(out, rows);
const done = rows.filter((r) => r.status === "done").length;
console.log(`UI: ${rows.length} keys → ${path.relative(ROOT, out)}  (${done} pre-filled from es.json, ${rows.length - done} todo)`);
