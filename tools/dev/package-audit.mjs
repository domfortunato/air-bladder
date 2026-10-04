#!/usr/bin/env node
/**
 * What the RELEASE ARTIFACT has to be, checked offline.
 *
 * Written 2026-09-19 after a user reported that "Update All" in Game Systems
 * broke their install and left two quarantined copies behind:
 *
 *   Invalid system "air-bladder" detected in directory
 *     "air-bladder (# Name clash 2026-09-13 w5v86oC #)"
 *
 * That message is Foundry's own (`Package.fromManifestPath`, minified in
 * `dist/packages/package.mjs`): it compares `path.basename(path.dirname(...))`
 * against the manifest's `id` and REFUSES the package when they differ. So a
 * package's install directory name is not cosmetic — it is identity, and
 * anything that makes Foundry unable to write the folder it wants, or unable to
 * name it after the id, takes the system out of the world entirely.
 *
 * NOTHING HERE REPRODUCES THAT REPORT, and this gate does not claim to: the
 * published 0.1.23 zip passes every check below, which is precisely why it was
 * worth writing them down. What this holds is the class — a malformed artifact
 * that installs once and cannot be replaced cleanly afterwards. The live half,
 * the one that presses Update over an existing install on the build users
 * actually run, is `npm run dev:upgrade`; neither replaces the other.
 *
 * Checks, all offline, all over the files that ACTUALLY SHIP:
 *
 *   1. The shipped list here matches the `zip -r ./system.zip …` line in
 *      `.github/workflows/main.yml`. The list existed in exactly one place —
 *      that line — and a gate reading a second copy would be one more thing to
 *      drift, so this reads the workflow and compares. `template.json` was in
 *      that line for releases after the file stopped existing and `zip` skipped
 *      it in silence; that is the failure this check is shaped by.
 *
 *   2. `id` is a directory name every filesystem can hold, since Foundry names
 *      the install folder after it and then demands the two match: lowercase
 *      letters, digits and hyphens. An id carrying an uppercase letter survives
 *      Windows and macOS and breaks on Linux the moment anything compares them;
 *      one carrying a space or a colon cannot be written on Windows at all.
 *
 *   3. Every shipped path is one Windows can extract and, more to the point,
 *      DELETE on the next update. Foundry's installer removes the whole
 *      directory before extracting (`fs.promises.rm(target, {force, recursive})`
 *      in `dist/packages/installer.mjs`) with no retries, so a single entry that
 *      Windows will not delete fails the update rather than the install: no
 *      illegal characters, no reserved device names (CON, NUL, COM1 …), no
 *      trailing space or dot, no symlink, and NOTHING READ-ONLY — a file without
 *      the owner write bit extracts fine and then refuses to be unlinked on
 *      Windows, which is the shape of the reported failure even though our own
 *      artifact does not have it.
 *
 *   4. No two shipped paths differ only in case. Windows and macOS cannot keep
 *      both, so one silently overwrites the other at extract time and the
 *      installed system is missing a file that every developer machine has.
 *
 *   5. No extracted path reaches Windows' 260-character limit under a typical
 *      data directory. The prefix below is representative rather than exact,
 *      which is why the margin is reported and not just the verdict.
 *
 *   6. `packs/` on disk and `packs` in the manifest name the same set. A pack
 *      built but not declared ships dead weight; a pack declared but not built
 *      is a compendium that 404s in every world.
 *
 *   7. Every file the manifest NAMES is inside the shipped set. `check:manifest`
 *      already asserts those files exist in the tree; this asserts they are in
 *      the ZIP, which is a different question with the same symptom only for the
 *      developer: a stylesheet under a directory the zip line does not carry is
 *      present locally and absent for every installed user.
 *
 * NEGATIVE CONTROL, and it must be run when this file changes:
 *   node tools/dev/package-audit.mjs --self-test
 * plants each fault in a scratch tree and asserts this gate fails on it, which
 * is the house rule that a new test must be confirmed to fail with its fix
 * removed. The checks that cannot be planted portably (a read-only file and a
 * symlink both need privileges or a filesystem that carries them) are marked in
 * the output as unproven rather than quietly claimed.
 *
 * Usage:
 *   npm run check:package                 audit the working tree as it will ship
 *   node tools/dev/package-audit.mjs --zip path/to/system.zip
 *                                         audit a BUILT archive instead, which
 *                                         is how a published release is checked
 *                                         after the fact
 *   node tools/dev/package-audit.mjs --self-test
 */
import { readFileSync, readdirSync, lstatSync, existsSync, openSync, readSync, closeSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/** The representative Windows install path a shipped file lands under. Foundry's
 *  default user data on Windows is %LOCALAPPDATA%\FoundryVTT\Data; the username
 *  is the part that varies, and eight characters is a short one. */
const WIN_PREFIX = "C:/Users/username/AppData/Local/FoundryVTT/Data/systems/air-bladder/";
const WIN_LIMIT = 260;

const ILLEGAL_WIN = /[<>:"|?*\u0000-\u001f]/;
const BACKSLASH = String.fromCharCode(92);
const RESERVED_WIN = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])([.]|$)/i;
/** Foundry names the install directory after `id` and then refuses the package
 *  unless the two match exactly, so the id has to be a portable directory name. */
const LEGAL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ------------------------------------------------------------------ reporting */

const results = [];
const check = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  return ok;
};
const note = (label, detail = "") => console.log(`  note  ${label}${detail ? `  ${detail}` : ""}`);
const show = (list, n = 4) => list.slice(0, n).join(", ") + (list.length > n ? ` (+${list.length - n} more)` : "");

/* ------------------------------------------------------- the shipped file list */

/**
 * The paths the release zip carries, read from the workflow that builds it so
 * this file holds no second copy of the list.
 * @param {string} root
 * @returns {string[]} top-level names, directories without a trailing slash
 */
const shippedListFromWorkflow = (root) => {
  const yml = readFileSync(join(root, ".github/workflows/main.yml"), "utf8");
  const line = yml.split("\n").find((l) => l.includes("zip -r ./system.zip"));
  if (!line) throw new Error("no `zip -r ./system.zip` line in .github/workflows/main.yml");
  return line
    .slice(line.indexOf("system.zip") + "system.zip".length)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/\/$/, ""));
};

/* ------------------------------------------------------------- tree collection */

/**
 * Every file the zip will carry, as forward-slash paths relative to the root,
 * with the facts each check needs. Symlinks are NOT followed: a symlink in the
 * tree is itself the finding.
 * @param {string} root
 * @param {string[]} shipped
 */
const collectTree = (root, shipped) => {
  const out = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) { out.push({ path: rel, symlink: true, mode: st.mode, size: 0 }); return; }
    if (st.isDirectory()) { for (const name of readdirSync(abs).sort()) walk(posix.join(rel, name)); return; }
    out.push({ path: rel, symlink: false, mode: st.mode, size: st.size });
  };
  for (const top of shipped) {
    if (!existsSync(join(root, top))) { out.push({ path: top, missing: true }); continue; }
    walk(top);
  }
  return out;
};

/* -------------------------------------------------------------- zip collection */

/**
 * The same shape, read from a built archive's central directory. Written out
 * rather than pulled from a library so a published release can be audited with
 * no install step: the gate that checks what shipped should not itself need
 * anything to be installed.
 * @param {string} file
 */
const collectZip = (file) => {
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  try {
    // End of central directory: scan the last 64KB backwards for its signature.
    const tailLen = Math.min(size, 66560);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOff = tail.readUInt32LE(eocd + 16);
    // Zip64: the 32-bit fields saturate and the real values live in the zip64 record.
    if (cdOff === 0xffffffff || count === 0xffff) {
      let loc = -1;
      for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === 0x07064b50) { loc = i; break; }
      if (loc < 0) throw new Error("zip64 archive with no locator");
      const z64Off = Number(tail.readBigUInt64LE(loc + 8));
      const z64 = Buffer.alloc(56);
      readSync(fd, z64, 0, 56, z64Off);
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOff = Number(z64.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`central directory entry ${i} has no signature`);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const external = cd.readUInt32LE(p + 38);
      const size = cd.readUInt32LE(p + 24);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      // The high 16 bits carry the Unix mode when the archive was made on Unix.
      const mode = external >>> 16;
      if (!name.endsWith("/")) {
        out.push({
          path: name, symlink: (mode & 0o170000) === 0o120000, mode, size,
          // Enough to read the entry back (readZipEntry): where its local header
          // sits, how it was stored, and how many bytes that took.
          offset: cd.readUInt32LE(p + 42), method: cd.readUInt16LE(p + 10), csize: cd.readUInt32LE(p + 20),
        });
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally { closeSync(fd); }
};

/**
 * One entry's bytes, out of the archive. Stored (0) or deflated (8) — the two
 * methods `zip` writes — through the local header, whose name and extra fields
 * can differ in length from the central directory's.
 * @param {string} file
 * @param {{offset: number, method: number, csize: number, path: string}} entry
 * @returns {Buffer}
 */
const readZipEntry = (file, entry) => {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(30);
    readSync(fd, head, 0, 30, entry.offset);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`${entry.path}: no local file header at ${entry.offset}`);
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = Buffer.alloc(entry.csize);
    readSync(fd, raw, 0, entry.csize, start);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRawSync(raw);
    throw new Error(`${entry.path}: compression method ${entry.method} is not one this reader handles`);
  } finally { closeSync(fd); }
};

/**
 * THE ARCHIVE'S OWN MANIFEST (review #33). `--zip` used to audit a built
 * archive against the WORKING TREE's `system.json`, which is harmless in CI —
 * the tree was just zipped — and wrong everywhere the usage text sends it: a
 * published release checked after the fact. An older zip reported a pack it
 * legitimately shipped as "built but undeclared", and an archive whose own
 * manifest declared a pack it lacked, or a different id, was never examined,
 * because its manifest was never read. The id, the pack set and the file
 * references are claims the archive makes about itself.
 * @param {string} file
 * @param {object[]} entries   from collectZip
 * @returns {object}
 */
const manifestFromZip = (file, entries) => {
  const entry = entries.find((e) => e.path === "system.json");
  if (!entry) throw new Error("the archive carries no system.json at its root");
  return JSON.parse(readZipEntry(file, entry).toString("utf8"));
};

/* --------------------------------------------------------------- the checks */

/**
 * @param {{root: string, entries: object[], shipped: string[], manifest: object, mode: "tree"|"zip"}} ctx
 */
const audit = ({ root, entries, shipped, manifest, mode }) => {
  const paths = entries.filter((e) => !e.missing).map((e) => e.path);
  note(`auditing the ${mode === "zip" ? "built archive" : "working tree"}`, `${paths.length} files`);

  /* 1. the shipped list against the workflow (tree mode only: a zip cannot say
        which list built it, and its top level is checked instead) */
  if (mode === "tree") {
    const missing = entries.filter((e) => e.missing).map((e) => e.path);
    check(missing.length === 0, "every path the workflow zips exists in the tree",
      missing.length ? `missing: ${show(missing)}` : `${shipped.length} entries`);
  } else {
    const tops = [...new Set(paths.map((p) => p.split("/")[0]))].sort();
    const want = [...shipped].sort();
    check(JSON.stringify(tops) === JSON.stringify(want), "the archive's top level is exactly what the workflow zips",
      tops.join(" "));
  }

  /* 2. the id is a directory name Foundry can create and then match */
  check(LEGAL_ID.test(manifest.id ?? ""), "`id` is a portable directory name (lowercase, digits, hyphens)",
    `id "${manifest.id}"`);
  check(!!manifest.id && !RESERVED_WIN.test(manifest.id), "`id` is not a reserved Windows device name");

  /* 3. names Windows can write, and can DELETE on the next update */
  const illegal = paths.filter((p) => p.split("/").some((s) => ILLEGAL_WIN.test(s) || s.includes(BACKSLASH)));
  check(illegal.length === 0, "no path carries a character Windows forbids", illegal.length ? show(illegal) : "");
  const reserved = paths.filter((p) => p.split("/").some((s) => RESERVED_WIN.test(s)));
  check(reserved.length === 0, "no path segment is a reserved Windows device name", reserved.length ? show(reserved) : "");
  const trailing = paths.filter((p) => p.split("/").some((s) => /[ .]$/.test(s)));
  check(trailing.length === 0, "no path segment ends in a space or a dot", trailing.length ? show(trailing) : "");
  const links = entries.filter((e) => e.symlink).map((e) => e.path);
  check(links.length === 0, "nothing shipped is a symlink", links.length ? show(links) : "");
  // Read-only is the one that bites on the UPDATE rather than the install:
  // Windows refuses to unlink a file without the write bit, and the installer
  // deletes the whole directory before extracting, with no retries.
  const readOnly = entries.filter((e) => !e.missing && !e.symlink && e.mode && !(e.mode & 0o200)).map((e) => e.path);
  check(readOnly.length === 0, "no shipped file is read-only (Windows cannot delete one on the next update)",
    readOnly.length ? show(readOnly) : "");
  const traversal = paths.filter((p) => p.startsWith("/") || p.startsWith(BACKSLASH) || p.split("/").includes("..") || /^[a-zA-Z]:/.test(p));
  check(traversal.length === 0, "no absolute path and no `..` segment", traversal.length ? show(traversal) : "");

  /* 4. case collisions */
  const byLower = new Map();
  for (const p of paths) {
    const k = p.toLowerCase();
    if (!byLower.has(k)) byLower.set(k, new Set());
    byLower.get(k).add(p);
  }
  const collisions = [...byLower.values()].filter((s) => s.size > 1).map((s) => [...s].join(" vs "));
  check(collisions.length === 0, "no two shipped paths differ only in case", collisions.length ? show(collisions, 3) : "");

  /* 5. Windows path length */
  const longest = paths.reduce((a, p) => Math.max(a, WIN_PREFIX.length + p.length), 0);
  const over = paths.filter((p) => WIN_PREFIX.length + p.length >= WIN_LIMIT);
  check(over.length === 0, `no extracted path reaches Windows' ${WIN_LIMIT}-character limit`,
    over.length ? show(over, 2) : `longest ${longest}, ${WIN_LIMIT - longest} to spare`);

  /* 6. packs on disk against packs declared */
  const onDisk = [...new Set(paths.filter((p) => p.startsWith("packs/")).map((p) => p.split("/")[1]))].filter(Boolean).sort();
  const declared = (manifest.packs ?? []).map((p) => p.name).sort();
  const undeclared = onDisk.filter((p) => !declared.includes(p));
  const unbuilt = declared.filter((p) => !onDisk.includes(p));
  check(undeclared.length === 0 && unbuilt.length === 0,
    "`packs/` and the manifest name the same compendiums",
    undeclared.length || unbuilt.length
      ? `built but undeclared: ${show(undeclared)} | declared but unbuilt: ${show(unbuilt)}`
      : `${declared.length} packs`);

  /* 7. everything the manifest names is inside the shipped set */
  const has = new Set(paths);
  const referenced = [
    ...(manifest.esmodules ?? []),
    ...(manifest.scripts ?? []),
    ...(manifest.styles ?? []).map((s) => (typeof s === "string" ? s : s?.src)),
    ...(manifest.languages ?? []).map((l) => l?.path),
    ...(manifest.packs ?? []).map((p) => p?.path),
    manifest.license,
  ].filter(Boolean).map((p) => String(p).replace(/^\.\//, ""));
  // A pack's `path` names its DIRECTORY, so it counts as shipped when any file
  // sits under it; everything else has to be a file in its own right.
  const absent = referenced.filter((p) => !has.has(p) && ![...has].some((f) => f.startsWith(`${p}/`)));
  check(absent.length === 0, "every file the manifest names is inside the zip", absent.length ? show(absent) : `${referenced.length} references`);

  /* notes, not verdicts */
  const runtime = paths.filter((p) => /\/(LOCK|LOG|LOG\.old)$/.test(p));
  if (runtime.length) note("LevelDB runtime artifacts shipped", `${runtime.length} files (LOCK, LOG, LOG.old) — harmless, and noise`);
  const bytes = entries.reduce((a, e) => a + (e.size ?? 0), 0);
  note("uncompressed payload", `${(bytes / 1048576).toFixed(1)} MB across ${paths.length} files`);

  return results.every((r) => r.ok);
};

/* ------------------------------------------------------------------ self test */

/**
 * The negative control, and it is in TWO halves because the faults live at two
 * different boundaries.
 *
 * The path-shape checks read a list of entries, so they are controlled by
 * handing `audit` a synthetic list. That is not a shortcut around the
 * filesystem, it is the only honest way to do it: a case collision CANNOT be
 * planted on Windows or macOS, which is the entire reason the check exists, and
 * a read-only file and a symlink both need privileges the gate must not
 * assume. Planting them in a real tree would have left three checks claiming a
 * control they never had — the first draft of this file did exactly that and
 * reported "a case collision fails" as passing on a filesystem that had
 * silently overwritten one file with the other.
 *
 * The tree-shape checks genuinely need files, so those are planted in a scratch
 * copy of a minimal tree. The real tree is never mutated by a gate.
 *
 * Every case names the check it must trip, so a fault that fails the audit for
 * some unrelated reason still counts as uncontrolled.
 */
const selfTest = () => {
  let bad = 0;
  const runOn = (ctx) => {
    results.length = 0;
    const log = console.log;
    console.log = () => {};
    try { audit(ctx); } finally { console.log = log; }
    return results.filter((r) => !r.ok).map((r) => r.label);
  };
  const report = (label, failed, wants) => {
    const ok = wants === null ? failed.length === 0 : failed.some((f) => f.includes(wants));
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
    if (!ok) console.log(`        wanted ${wants === null ? "no failures" : `a failure of "${wants}"`}, got ${failed.length ? failed.join(" | ") : "none"}`);
  };

  /* ---- half one: the path-shape checks, over a synthetic entry list ---- */
  console.log("  the path checks, over a synthetic entry list:");
  const baseEntries = () => [
    { path: "system.json", mode: 0o644, size: 10, symlink: false },
    { path: "module/cairn.js", mode: 0o644, size: 10, symlink: false },
    { path: "packs/armor/000001.ldb", mode: 0o644, size: 10, symlink: false },
  ];
  const baseManifest = () => ({ id: "air-bladder", packs: [{ name: "armor", path: "packs/armor" }], esmodules: ["module/cairn.js"] });
  const SHIPPED = ["system.json", "module", "packs"];
  const synthetic = (label, mutate, wants) => {
    const entries = baseEntries();
    const manifest = baseManifest();
    mutate(entries, manifest);
    report(label, runOn({ root: ROOT, entries, shipped: SHIPPED, manifest, mode: "zip" }), wants);
  };

  synthetic("a clean list passes", () => {}, null);
  synthetic("a case collision fails", (e) => e.push({ path: "module/Cairn.js", mode: 0o644, size: 1, symlink: false }), "differ only in case");
  synthetic("a symlink fails", (e) => e.push({ path: "module/link.js", mode: 0o120777, size: 1, symlink: true }), "symlink");
  synthetic("a read-only file fails", (e) => e.push({ path: "module/ro.js", mode: 0o444, size: 1, symlink: false }), "read-only");
  synthetic("a character Windows forbids fails", (e) => e.push({ path: "module/a:b.js", mode: 0o644, size: 1, symlink: false }), "Windows forbids");
  synthetic("a reserved device name fails", (e) => e.push({ path: "module/NUL.js", mode: 0o644, size: 1, symlink: false }), "reserved Windows device");
  synthetic("a name ending in a dot fails", (e) => e.push({ path: "module/trailing.", mode: 0o644, size: 1, symlink: false }), "space or a dot");
  synthetic("a `..` segment fails", (e) => e.push({ path: "module/../../evil.js", mode: 0o644, size: 1, symlink: false }), "`..` segment");
  synthetic("an over-long path fails", (e) => e.push({ path: `module/${"x".repeat(200)}.js`, mode: 0o644, size: 1, symlink: false }), "character limit");
  synthetic("an id with an uppercase letter fails", (e, m) => { m.id = "Air-Bladder"; }, "portable directory name");
  synthetic("a pack built but not declared fails", (e) => e.push({ path: "packs/ghost/000001.ldb", mode: 0o644, size: 1, symlink: false }), "same compendiums");
  synthetic("a pack declared but not built fails", (e, m) => m.packs.push({ name: "ghost", path: "packs/ghost" }), "same compendiums");
  synthetic("a manifest naming a file the zip does not carry fails", (e, m) => { m.styles = [{ src: "css/cairn.css" }]; }, "inside the zip");

  /* ---- half two: the tree-shape checks, over a planted scratch tree ---- */
  console.log("  the tree checks, over a planted scratch tree:");
  const base = join(tmpdir(), `ab-package-audit-${Date.now()}`);
  const plantTree = (extra = () => {}) => {
    const root = join(base, `case-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(root, "module"), { recursive: true });
    mkdirSync(join(root, "packs", "armor"), { recursive: true });
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/main.yml"), "      - run: zip -r ./system.zip system.json module/ packs/\n");
    writeFileSync(join(root, "module", "cairn.js"), "// x\n");
    writeFileSync(join(root, "packs", "armor", "000001.ldb"), "x");
    writeFileSync(join(root, "system.json"), JSON.stringify(baseManifest(), null, 2));
    extra(root);
    return root;
  };
  const tree = (label, extra, wants) => {
    let root;
    try { root = plantTree(extra); } catch (e) { bad++; console.log(`  FAIL  ${label}  (could not plant: ${e.message})`); return; }
    const shipped = shippedListFromWorkflow(root);
    const manifest = JSON.parse(readFileSync(join(root, "system.json"), "utf8"));
    report(label, runOn({ root, entries: collectTree(root, shipped), shipped, manifest, mode: "tree" }), wants);
  };

  tree("a clean minimal tree passes", () => {}, null);
  tree("a workflow line that stopped zipping a declared directory fails",
    (r) => writeFileSync(join(r, ".github/workflows/main.yml"), "      - run: zip -r ./system.zip system.json module/\n"),
    "same compendiums");
  tree("a directory the workflow zips but the tree does not have fails",
    (r) => writeFileSync(join(r, ".github/workflows/main.yml"), "      - run: zip -r ./system.zip system.json module/ packs/ css/\n"),
    "exists in the tree");

  try { rmSync(base, { recursive: true, force: true }); } catch { /* scratch */ }
  return bad === 0;
};

/* ----------------------------------------------------------------------- main */

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) {
  console.log("package-audit self test: every fault below must be caught\n");
  const ok = selfTest();
  console.log(`\n${ok ? "self test passed" : "SELF TEST FAILED"}`);
  process.exit(ok ? 0 : 1);
}

const zipAt = argv.includes("--zip") ? argv[argv.indexOf("--zip") + 1] : null;
console.log(zipAt ? `package-audit: ${zipAt}\n` : "package-audit: the working tree as it will ship\n");
const shipped = shippedListFromWorkflow(ROOT);
const entries = zipAt ? collectZip(resolve(zipAt)) : collectTree(ROOT, shipped);
// The archive is audited against ITS OWN manifest, the tree against the tree's.
const manifest = zipAt
  ? manifestFromZip(resolve(zipAt), entries)
  : JSON.parse(readFileSync(join(ROOT, "system.json"), "utf8"));
const ok = audit({ root: ROOT, entries, shipped, manifest, mode: zipAt ? "zip" : "tree" });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${ok ? "package-audit passed" : `package-audit FAILED (${failed} of ${results.length})`}`);
process.exit(ok ? 0 : 1);
