#!/usr/bin/env node
/**
 * The English a translation was made against — the one thing no gate compared.
 *
 * `i18n:check` compares KEY PRESENCE, placeholders and HTML structure. None of
 * those move when an English VALUE is rewritten under a translation that already
 * exists. The translation keeps its key, keeps its placeholders, and is now
 * simply WRONG — it answers to the key while promising something the English was
 * deliberately changed to stop saying. Worse, `extract-ui.mjs` computed
 * `status = tr === en ? "todo" : "done"`, so the artefact whose whole job is to
 * show outstanding work marked those rows **done**.
 *
 * Found by review #10 (2026-08-07), and it was not hypothetical: five English
 * values changed between 0.1.11 and `dev` under live Spanish translations, and
 * `CAIRN.Scars` changed under all six locales. Nothing anywhere said so.
 *
 * So: a baseline file per locale recording, per key, the English that its
 * translation was verified against. Drift is `baseline[k] !== en[k]` on a key
 * that HAS a translation. `i18n:import` advances the baseline as translations
 * land, which is the only event that legitimately re-verifies a key.
 *
 * NOT in `lang/`, deliberately, for two reasons: `lang/` ships in the release
 * zip and this is development bookkeeping no player needs, and `check:manifest`
 * asserts every `lang/*.json` is a declared Foundry language — which these are
 * not. `tools/i18n/baseline/<lang>.json` keeps both facts true.
 *
 * Bootstrapping is a git read, not a guess. Every locale's translations shipped
 * as-is at the last release, so the English at that tag is what they were
 * nominally made against:
 *
 *   node tools/i18n/baseline.mjs --lang es [--from 0.1.11] [--force]
 *   npm run i18n:baseline -- --lang es
 *
 * The honest limit, stated because a baseline that overclaims is worse than
 * none: this cannot see drift that happened BEFORE the seed tag. A key
 * translated in 0.1.4 against English that changed in 0.1.7 seeds as verified.
 * The seed establishes a floor from which drift is caught going forward.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";
import { flattenLang } from "./validate.mjs";

export const BASELINE_DIR = path.join(ROOT, "tools", "i18n", "baseline");
export const baselinePath = (lang) => path.join(BASELINE_DIR, `${lang}.json`);

/** The recorded English per key, or {} when this locale has no baseline yet. */
export const loadBaseline = (lang) => {
  const p = baselinePath(lang);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
};

export const saveBaseline = (lang, map) => {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
  fs.writeFileSync(baselinePath(lang), JSON.stringify(sorted, null, 2) + "\n");
};

/**
 * Split translated keys into drifted and unverified.
 *
 * - **drifted**   — a baseline exists and no longer matches English. The
 *                   translation is wrong, not merely old.
 * - **unverified** — translated, but the baseline has no entry, so nothing is
 *                   known about what it was made against. Counted and reported
 *                   rather than folded into either side: a gap that presents as
 *                   a clean result is how the original defect survived.
 *
 * A key whose translation EQUALS its English is untranslated by this project's
 * convention (see extract-ui) and is neither.
 */
export const classifyDrift = (en, tr, baseline) => {
  const drifted = [], unverified = [];
  for (const [k, enVal] of Object.entries(en)) {
    const trVal = tr[k];
    if (trVal == null || trVal === enVal) continue;
    if (!(k in baseline)) unverified.push(k);
    else if (baseline[k] !== enVal) drifted.push(k);
  }
  return { drifted, unverified };
};

/* ---- CLI ------------------------------------------------------------------ */

// pathToFileURL, not a hand-built `file://` + argv[1]: on Windows that yields
// `file://C:/…` against an actual `file:///C:/…`, the guard never matches, and
// the CLI exits silently having done nothing at all.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argVal = (flag, def) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? def : process.argv[i + 1];
  };
  const LANG = argVal("--lang", "es");
  const FORCE = process.argv.includes("--force");
  const FROM = argVal("--from", null)
    ?? execFileSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: ROOT, encoding: "utf8" }).trim();

  const existing = loadBaseline(LANG);
  if (Object.keys(existing).length && !FORCE) {
    // Overwriting destroys the drift signal: every currently-drifted key would
    // be re-recorded as verified against English nobody translated against.
    console.error(
      `\ntools/i18n/baseline/${LANG}.json already exists (${Object.keys(existing).length} keys).\n` +
      `Re-seeding would mark every DRIFTED key as verified and lose exactly what this file is for.\n` +
      `Translations advance it automatically on i18n:import. Pass --force only to rebuild deliberately.\n`
    );
    process.exit(1);
  }

  const seedEn = flattenLang(JSON.parse(
    execFileSync("git", ["show", `${FROM}:lang/en.json`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
  ));
  const nowEn = flattenLang(JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "en.json"), "utf8")));
  const tr = flattenLang(JSON.parse(fs.readFileSync(path.join(ROOT, "lang", `${LANG}.json`), "utf8")));

  // Only keys this locale actually translates: a baseline entry for an
  // untranslated key asserts a verification that never happened.
  const map = {};
  for (const [k, trVal] of Object.entries(tr)) {
    if (!(k in nowEn) || trVal === nowEn[k]) continue;
    if (k in seedEn) map[k] = seedEn[k];
  }
  saveBaseline(LANG, map);

  const { drifted, unverified } = classifyDrift(nowEn, tr, map);
  console.log(`\nbaseline ${LANG} ← lang/en.json @ ${FROM}`);
  console.log(`  recorded    : ${Object.keys(map).length} translated key(s)`);
  console.log(`  drifted     : ${drifted.length}   (English changed since ${FROM} — the translation is now WRONG)`);
  for (const k of drifted) console.log(`     ! ${k}`);
  console.log(`  unverified  : ${unverified.length}   (translated after ${FROM}; nothing known about their source English)`);
  console.log(`\n  wrote ${path.relative(ROOT, baselinePath(LANG))}\n`);
}
