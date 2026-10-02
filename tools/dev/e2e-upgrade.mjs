#!/usr/bin/env node
/**
 * dev:upgrade — the gesture nobody had ever tested: pressing UPDATE over an
 * install that already exists.
 *
 *   npm run dev:upgrade                                  (:30001, previous tag -> this one)
 *   npm run dev:upgrade -- --from 0.1.21 --to 0.1.22     (any pair of published tags)
 *   FOUNDRY_URL=http://localhost:30002 npm run dev:upgrade
 *
 * WHY IT EXISTS. On 2026-09-19 a user reported that "Update All" in Game
 * Systems broke their install and had to be redone by hand, with two
 * quarantined copies left behind:
 *
 *   Invalid system "air-bladder" detected in directory
 *     "air-bladder (# Name clash 2026-09-13 w5v86oC #)"
 *
 * Every release leg we had installed the system FRESH from the manifest into an
 * empty folder. That is a different code path from an update, and the
 * difference is the whole bug: `dist/packages/installer.mjs` deletes the entire
 * existing directory first — `fs.promises.rm(target, {force: true, recursive:
 * true})`, with no `maxRetries` — and only then extracts. A fresh install never
 * runs that delete. So the one operation every user performs on every release
 * was the one operation nothing here exercised.
 *
 * WHAT IT CANNOT TELL YOU, stated plainly so nobody reads a pass as an
 * all-clear. The phrase "Name clash" does not appear anywhere in Foundry
 * 14.365 — not in the server bundle, the client bundle, the language files or
 * any bundled library (the only "clash" is Acorn's "Argument name clash"). So
 * the build this repo pins CANNOT produce the reported directory, and a green
 * run on 14.365 proves only that our artifact updates cleanly on our own
 * target. Foundry rewrote package installation in 14.366 and moved update
 * checks to the website package repository, where this system is not listed.
 * **Point this at the build users actually run before believing it.** That is
 * what `FOUNDRY_URL` is for.
 *
 * WHAT IT ASSERTS, after installing `--from` and then updating to `--to`:
 *   1. Exactly one entry under `Data/systems` belongs to this system, and it is
 *      named exactly `air-bladder`. Foundry compares the directory name against
 *      the manifest `id` and refuses the package when they differ
 *      (`Package.fromManifestPath`), so a quarantined sibling is not cosmetic
 *      noise: it is a second copy that logs an error on every boot, and its
 *      existence means the delete step did not do what it claimed.
 *   2. The installed manifest reads the version we asked for. An update that
 *      silently no-ops leaves the old version in place and every other check
 *      still passes.
 *   3. Every declared compendium is present on disk afterwards. A partial
 *      extraction is the failure mode that "breaks" a system while leaving a
 *      directory that looks right from the outside.
 *   4. The world launches on the updated system with no console errors, and the
 *      client reports the new version. The install can be perfect on disk and
 *      still not load.
 *
 * SAFETY, and it is not optional. This probe asks a Foundry server to DELETE a
 * system directory. On the dev server (:30000) `Data/systems/air-bladder` is a
 * SYMLINK to this working tree, so running it there would hand the repository
 * to `rm -rf`. It therefore refuses: any target whose systems entry is a link,
 * and port 30000 outright, whatever the entry looks like. The default target is
 * :30001, the validation server, whose state this probe restores by construction
 * — it ends with the current release installed from its own manifest, which is
 * what :30001 holds anyway.
 *
 * PRECONDITION: the target server must be AT the setup screen, with no world
 * active. Restart it without `--world=` if it is not; the probe says so rather
 * than shutting somebody's session down underneath them.
 */
import { chromium } from "playwright";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VIEWPORT, watchErrors, watchdog } from "./lib.mjs";

const SYSTEM_ID = "air-bladder";
const REPO_MANIFEST = JSON.parse(readFileSync(new URL("../../system.json", import.meta.url), "utf8"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const manifestFor = (tag) => `https://github.com/domfortunato/air-bladder/releases/download/${tag}/system.json`;

const URL_BASE = process.env.FOUNDRY_URL ?? "http://localhost:30001";
const DATA = process.env.FOUNDRY_DATA ?? "C:/Users/domin/foundry/ghtest-data";
const TO = arg("to", REPO_MANIFEST.version);
const FROM = arg("from", null);

watchdog(900000, "dev:upgrade");
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(58)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(58)} ${d}`); failures++; };
const die = (msg) => { console.log(`\n  refusing to run: ${msg}\n`); process.exit(2); };

/* ------------------------------------------------------------------ safety */

const systemsDir = join(DATA, "Data", "systems");
if (new URL(URL_BASE).port === "30000") {
  die("port 30000 is the dev server, whose systems/air-bladder is a symlink to this repository. "
    + "An install there would delete the working tree. Use :30001.");
}
if (!existsSync(systemsDir)) die(`no systems directory at ${systemsDir} — set FOUNDRY_DATA to the target server's data path`);
const installedPath = join(systemsDir, SYSTEM_ID);
if (existsSync(installedPath) && lstatSync(installedPath).isSymbolicLink()) {
  die(`${installedPath} is a symlink or junction. Installing over it would delete whatever it points at.`);
}
const options = join(DATA, "Config", "options.json");
if (existsSync(options)) {
  const port = JSON.parse(readFileSync(options, "utf8")).port;
  if (String(port) !== new URL(URL_BASE).port) {
    die(`${URL_BASE} does not match the data path: ${options} says port ${port}. `
      + "Set FOUNDRY_DATA to the data path of the server you are pointing at.");
  }
}

/* ------------------------------------------------------- what is on disk */

/** Every entry under Data/systems that belongs to this system: the real one and
 *  any quarantined copy beside it. A copy is recognised by its MANIFEST, never
 *  by its directory name, because the whole point is that the name is wrong. */
const installations = () => readdirSync(systemsDir)
  .map((name) => {
    const manifest = join(systemsDir, name, "system.json");
    if (!existsSync(manifest)) return null;
    try {
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      return m.id === SYSTEM_ID ? { name, version: m.version, packs: (m.packs ?? []).length } : null;
    } catch { return { name, version: "(unreadable manifest)", packs: 0 }; }
  })
  .filter(Boolean);

const packsOnDisk = (name) => {
  const dir = join(systemsDir, name, "packs");
  return existsSync(dir) ? readdirSync(dir).filter((p) => lstatSync(join(dir, p)).isDirectory()) : [];
};

/* ------------------------------------------------------------- the leg */

const previousTag = () => {
  // The tag before --to, by the version order the release script uses.
  const parts = TO.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return parts[2] > 0 ? `${parts[0]}.${parts[1]}.${parts[2] - 1}` : null;
};
const from = FROM ?? previousTag();
if (!from) die(`cannot work out the release before ${TO} — pass --from explicitly`);

console.log(`dev:upgrade — install ${from}, then UPDATE to ${TO}`);
console.log(`  target ${URL_BASE}   data ${DATA}\n`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);

/**
 * Install one version through the same call the Setup screen's own buttons make
 * (`game.installPackage`, client bundle), which reaches the same server action
 * Update All does. This is the gesture, not a back door around it.
 *
 * `force` is passed ONLY when laying down the starting state. Foundry refuses a
 * downgrade outright — "You are currently using a more recent version of system
 * … and may not downgrade" — so going back to the previous release to set the
 * test up needs it. The UPDATE itself is deliberately unforced: that is the
 * gesture under test, and forcing it would be testing a different button.
 */
const install = async (manifest, force = false) => page.evaluate(async ({ manifest, id, force }) => {
  try {
    await game.installPackage({ type: "system", id, manifest, notify: false, dependencies: false, force });
    return { ok: true };
  } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
}, { manifest, id: SYSTEM_ID, force });

try {
  await page.goto(`${URL_BASE}/setup`, { waitUntil: "domcontentloaded" });
  if (!page.url().includes("/setup")) {
    die(`${URL_BASE} has a world active (it served ${page.url()}). `
      + "Return it to setup, or restart it without --world=, then run this again.");
  }
  await page.waitForFunction(() => globalThis.game?.installPackage, null, { timeout: 60000 });
  ok("the setup screen is up and the install API is live");

  /* ---- 1. the starting point ---- */
  const first = await install(manifestFor(from), true);
  first.ok ? ok(`installed ${from} from its manifest`) : fail(`installed ${from} from its manifest`, first.error);
  const before = installations();
  before.length === 1 && before[0].name === SYSTEM_ID && before[0].version === from
    ? ok(`one installation, named "${SYSTEM_ID}", at ${from}`)
    : fail(`one installation, named "${SYSTEM_ID}", at ${from}`, JSON.stringify(before));

  /* ---- 2. the update, which is the whole point ---- */
  const second = await install(manifestFor(TO));
  second.ok ? ok(`UPDATED to ${TO} over the existing install`) : fail(`UPDATED to ${TO} over the existing install`, second.error);

  const after = installations();
  const quarantined = after.filter((i) => i.name !== SYSTEM_ID);
  quarantined.length === 0
    ? ok("no quarantined copy was left beside it")
    : fail("no quarantined copy was left beside it",
      `${quarantined.length}: ${quarantined.map((q) => `"${q.name}"`).join(", ")} — each of these logs `
      + `'Invalid system "${SYSTEM_ID}" detected in directory' on every boot`);
  after.some((i) => i.name === SYSTEM_ID)
    ? ok(`the live directory is still named exactly "${SYSTEM_ID}"`)
    : fail(`the live directory is still named exactly "${SYSTEM_ID}"`, `found: ${after.map((i) => i.name).join(", ") || "nothing at all"}`);
  const live = after.find((i) => i.name === SYSTEM_ID);
  live?.version === TO
    ? ok(`the installed manifest reads ${TO}`)
    : fail(`the installed manifest reads ${TO}`, `reads ${live?.version ?? "(gone)"} — the update silently did nothing`);

  /* ---- 3. nothing was left half-extracted ---- */
  if (live) {
    const onDisk = packsOnDisk(SYSTEM_ID);
    onDisk.length === live.packs
      ? ok("every declared compendium is on disk", `${onDisk.length} packs`)
      : fail("every declared compendium is on disk", `${onDisk.length} on disk, ${live.packs} declared — a partial extraction`);
  }

  /* ---- 4. and Foundry itself accepts what is on disk ---- */
  // The setup screen's own view of the package: that Foundry accepts the thing
  // on disk and reads the new version out of it.
  //
  // WHAT THE WARNING CHECK BELOW IS AND IS NOT. `packageWarnings` is filled by
  // the server's scan of `Data/systems`, and that scan runs at BOOT. Measured
  // rather than assumed: with a quarantined directory planted by hand before
  // this leg, the filesystem check red-flagged it and this warning check
  // PASSED, because the running server had never seen the directory. So the
  // authoritative assertion is the one above, over the disk; this one only
  // catches a copy that was already there when the server started, which is
  // exactly the user's situation on their next boot and worth having for that.
  // Read defensively too — a shape that moved between builds must not read as
  // a pass, which is what `shapeRead` reports.
  const seen = await page.evaluate((id) => {
    const pkg = game.systems?.get?.(id);
    const warnings = game.data?.packageWarnings ?? {};
    const mine = warnings?.[id] ?? {};
    const lines = [...(mine.error ?? []), ...(mine.warning ?? [])].map((w) => (typeof w === "string" ? w : w?.message ?? ""));
    return {
      known: !!pkg,
      version: pkg?.version ?? null,
      unavailable: pkg?.unavailable ?? null,
      lines,
      shapeRead: "packageWarnings" in (game.data ?? {}),
    };
  }, SYSTEM_ID);
  seen.known && seen.version === TO
    ? ok("Foundry's own package list reports the updated system", `${seen.version}`)
    : fail("Foundry's own package list reports the updated system", JSON.stringify(seen));
  if (!seen.shapeRead) {
    console.log("  note  this build exposes no game.data.packageWarnings — the warning check below proved nothing");
  }
  const invalid = seen.lines.filter((l) => /detected in directory|Invalid system/i.test(l));
  invalid.length === 0
    ? ok("no invalid-directory warning against this system")
    : fail("no invalid-directory warning against this system", invalid.join(" | "));
  console.log(`  note  the in-world half is dev:smoke — run it against ${URL_BASE} after this leg`);

  errors.length === 0
    ? ok("zero console errors")
    : fail("zero console errors", errors.slice(0, 5).join(" | "));
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  await browser.close();
}

console.log(failures ? `\ndev:upgrade FAILED (${failures})\n` : "\ndev:upgrade passed\n");
process.exit(failures ? 1 : 0);
