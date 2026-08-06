#!/usr/bin/env node
/**
 * The manifest keys that fail SILENTLY, and so need a gate rather than a reader.
 *
 * `styles` is the one that motivated this. Until 2026-07-30 it was declared as
 * `["css/cairn.css"]`, the pre-v13 string form; at 14.365 the schema is
 * `ArrayField(SchemaField({layer, src}))` (common/packages/base-package.mjs:353-356)
 * and the string form survives only through `BasePackage._migrateStyles`
 * (:642-654), which is marked `@deprecated` since v13 and emits **no**
 * `logCompatibilityWarning`. So nothing anywhere — console, Setup, `dev:smoke` —
 * reports it, and the day the shim is retired every sheet renders unstyled for
 * anyone who installed the zip. There is no symptom to notice in advance, which
 * is exactly what makes it a gate's job.
 *
 * The declared form also exposes `layer`, the manifest-level control over where
 * system CSS sits among core's cascade layers — worth knowing about in a repo
 * that records `!important` as load-bearing because of `@layer system`
 * (docs/theming.md).
 *
 * Checks, all offline:
 *   1. `styles` and `esmodules` use the current declared shape, and every file
 *      they name exists.
 *   2. `readme`, `bugs` and `changelog` are present and absolute. Where each one
 *      actually surfaces in the shipped 14.365 client is narrower than it looks —
 *      see the note below — but they are free, and they are what a package
 *      listing and third-party installers read.
 *   3. Nothing in `packs` points at a `path` that is missing from `src/packs/`,
 *      which is the source of truth (`packs/` is generated and gitignored).
 *
 * WHERE THESE KEYS ACTUALLY RENDER, measured against the shipped client rather
 * than assumed — because the obvious claim ("Setup's system card shows them") is
 * wrong for a SYSTEM:
 *   - `changelog` → the compatibility checker, for any package
 *     (templates/setup/compatibility-checker/category.hbs:10-14). Real, and it is
 *     the surface a GM sees when upgrading Foundry.
 *   - `readme`/`bugs` → in-client, ONLY Module Management
 *     (templates/sidebar/apps/module-management.hbs:45-49), which does not list
 *     systems. Their value here is the website listing and external tooling.
 *   - `media` → not read by the client at all; it supplies cover art and
 *     screenshots for a package-directory listing. Deliberately NOT declared:
 *     this system is installed by manifest URL and has no directory listing, and
 *     the obvious cover image is the all-rights-reserved logo, whose bespoke
 *     grant is not mine to extend. Add it with the listing, not before.
 *
 * Usage: npm run check:manifest [path/to/system.json]
 *   The optional path is how this gets negative-controlled: run it against
 *   `git show <ref>:system.json` and it must fail.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "system.json");

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

console.log(`\nsystem.json shape (${MANIFEST === join(ROOT, "system.json") ? "system.json" : MANIFEST})`);

/* 1. Declared shapes, and the files they name ------------------------------- */

const styles = manifest.styles ?? [];
const stringForm = styles.filter((s) => typeof s === "string");
if (stringForm.length) {
  fail(`styles uses the v13-deprecated STRING form (${JSON.stringify(stringForm)}). `
    + `Write it as [{"src": "..."}] — the shim that accepts strings emits no warning, `
    + `so when it is retired the CSS is simply never injected.`);
} else if (!styles.length) {
  fail("no styles declared — css/cairn.css would never be injected");
} else if (styles.some((s) => typeof s?.src !== "string" || !s.src)) {
  fail(`every styles entry needs a non-empty "src": ${JSON.stringify(styles)}`);
} else {
  ok(`styles uses the declared form (${styles.map((s) => s.src).join(", ")})`);
}

for (const src of styles.map((s) => (typeof s === "string" ? s : s?.src)).filter(Boolean)) {
  if (existsSync(join(ROOT, src))) ok(`styles: ${src} exists`);
  else fail(`styles names "${src}", which does not exist`);
}

for (const src of manifest.esmodules ?? []) {
  if (existsSync(join(ROOT, src))) ok(`esmodules: ${src} exists`);
  else fail(`esmodules names "${src}", which does not exist`);
}

/* 2. The optional link keys ------------------------------------------------- */

for (const key of ["readme", "bugs", "changelog"]) {
  const v = manifest[key];
  if (!v) fail(`no "${key}" declared — see the note in this file for where each one surfaces`);
  else if (!/^https:\/\/\S+$/.test(v)) fail(`"${key}" is not an absolute https URL: ${JSON.stringify(v)}`);
  else ok(`${key}: ${v}`);
}

/* 3. Pack declarations vs the source of truth ------------------------------- */

// `packs/` is generated LevelDB and gitignored, so a declaration is only real if
// the YAML it is built from is there.
let packsChecked = 0;
for (const pack of manifest.packs ?? []) {
  const yaml = join(ROOT, "src", "packs", pack.name);
  if (existsSync(yaml)) packsChecked++;
  else fail(`pack "${pack.name}" is declared but src/packs/${pack.name}/ does not exist`);
}
// 24 → 26 on 2026-08-05: tables-glog (Mishaps) + journals-glog (the player
// handout, the system's first JournalEntry pack).
const EXPECTED_PACKS = 26;
if (packsChecked < EXPECTED_PACKS) {
  fail(`only ${packsChecked} pack source dirs found, expected at least ${EXPECTED_PACKS} — `
    + "this check is matching nothing rather than passing");
} else {
  ok(`all ${packsChecked} declared packs have sources in src/packs/`);
}

console.log(`\n${failed ? "MANIFEST CHECK FAILED" : "Manifest check passed."}`);
process.exit(failed ? 1 : 0);
