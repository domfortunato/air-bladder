#!/usr/bin/env node
/**
 * Announce a published release to Foundry's package Marketplace.
 *
 *     npm run publish:foundry 0.1.24 -- --dry-run    # validates, saves nothing
 *     npm run publish:foundry 0.1.24                 # the real submission
 *
 * Air Bladder was accepted into the Marketplace on 2026-10-01
 * (foundryvtt.com/packages/air-bladder), which is what makes this possible at
 * all: until then the package was unlisted and Foundry's own in-app update
 * check could not see it — the loose end the "Update All" investigation left
 * open (CLAUDE.md, Testing).
 *
 * **IT RUNS AFTER THE GITHUB RELEASE EXISTS, NOT AT TAG TIME, AND THAT ORDER IS
 * NOT NEGOTIABLE.** Foundry FETCHES the manifest URL to validate the
 * submission, so the release asset has to be downloadable before this is
 * called. `npm run release` only pushes the tag; `main.yml` then builds, zips,
 * and attaches `system.json` + `system.zip`. This is the step after that.
 *
 * The API (foundryvtt.com/article/package-release-api/):
 *   POST https://foundryvtt.com/_api/packages/release_version/
 *   Authorization: fvttp_…          <- the WHOLE header value, no "Bearer"
 *   {"id", "dry-run"?, "release": {"version", "manifest", "notes"?,
 *                                  "compatibility": {"minimum", "verified", "maximum"?}}}
 *
 * Two spellings worth stating because both are easy to get wrong: the header
 * carries the bare token (a `Bearer ` prefix is NOT what the article shows),
 * and the dry-run key is `dry-run`, HYPHENATED — not `dryRun`, not `dry_run`.
 * A misspelt key is simply ignored by the server, which would make a "dry run"
 * a real publish.
 *
 * THE MANIFEST URL IS THE VERSIONED ONE, AND IT IS NOT THE FIELD INSIDE
 * system.json. Those are two different URLs doing two different jobs:
 *   - `system.json`'s own `manifest` points at `releases/latest/download/…`,
 *     because that is what Foundry's in-app update check follows to find the
 *     NEWEST release. `main.yml` writes it that way on purpose.
 *   - What this submits is `releases/download/<version>/system.json`, because
 *     the article says a submitted manifest must point at a SPECIFIC release
 *     rather than a latest branch — a Marketplace row is a fixed version, so a
 *     moving URL would make every historical row say whatever shipped last.
 * `main.yml` attaches the per-version `system.json` as a release asset, so that
 * URL exists. The `latest` form is REFUSED below rather than quietly accepted.
 *
 * The token is read from `FOUNDRY_RELEASE_TOKEN` and is never printed, never
 * written to a file, and never passed on the command line (a command line is
 * visible to every process on the machine). In CI it is a repository secret of
 * the same name.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://foundryvtt.com/_api/packages/release_version/";

const die = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };
const ok = (msg) => console.log(`  ok    ${msg}`);

/* ------------------------------------------------------------------ arguments */

const args = process.argv.slice(2);
// Both spellings are dry, the `npm run release` lesson (review #32): npm keeps
// an unescaped `--dry-run` as its own config and forwards nothing, so the
// documented form needs `--`, and the config spelling is honoured too. Getting
// this wrong on THIS script would publish a release while reporting a dry run.
const dry = args.includes("--dry-run") || process.env.npm_config_dry_run === "true";
const version = args.find((a) => !a.startsWith("-")) ?? process.env.RELEASE_TAG ?? "";

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  die(`version "${version}" is not X.Y.Z. Pass it as the first argument `
    + `(npm run publish:foundry 0.1.24) or set RELEASE_TAG, as main.yml does.`);
}

const token = process.env.FOUNDRY_RELEASE_TOKEN ?? "";
if (!token) {
  die("FOUNDRY_RELEASE_TOKEN is not set.\n\n"
    + "  Locally:  $env:FOUNDRY_RELEASE_TOKEN = \"fvttp_…\"   (PowerShell, this session only)\n"
    + "  In CI:    a repository secret of the same name, read by main.yml\n\n"
    + "  The token is the package's release token from foundryvtt.com/packages/air-bladder/edit/.\n"
    + "  Do NOT pass it as an argument — a command line is readable by other processes.");
}
// A shape check, not a validity check: the article's header example is
// `fvttp_{token}`, so a value pasted without that prefix is a different string
// (an account API key, say) and would fail with an opaque 401.
if (!token.startsWith("fvttp_")) {
  die("FOUNDRY_RELEASE_TOKEN does not start with \"fvttp_\". The package RELEASE token has "
    + "that prefix; check you have not pasted something else. (Its value is never printed.)");
}

/* ----------------------------------------------------- what we are submitting */

const manifestJson = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const id = manifestJson.id;
if (!id) die("system.json declares no `id`.");

// The repository slug, for building the versioned URLs. GITHUB_REPOSITORY in
// CI; otherwise read off `bugs`, which is a committed, stable field — NOT off
// `download`, which on `dev` still carries the `latest` form that main.yml
// rewrites at build time.
const repo = process.env.GITHUB_REPOSITORY
  ?? (manifestJson.bugs ?? "").match(/github\.com\/([^/]+\/[^/]+)/)?.[1]
  ?? "";
if (!repo) die("could not determine the GitHub repository. Set GITHUB_REPOSITORY, or fix `bugs` in system.json.");

const manifest = `https://github.com/${repo}/releases/download/${version}/system.json`;
const notes = `https://github.com/${repo}/releases/tag/${version}`;

// Refused rather than silently accepted: a `latest` URL would make every
// Marketplace row resolve to whatever shipped most recently.
if (/\/releases\/latest\//.test(manifest)) {
  die("the submitted manifest must name a specific version, never `releases/latest/`.");
}

const compatibility = manifestJson.compatibility ?? {};
for (const k of ["minimum", "verified"]) {
  if (!compatibility[k]) die(`system.json compatibility.${k} is missing — the API requires it.`);
}
const release = {
  version,
  manifest,
  notes,
  compatibility: {
    minimum: compatibility.minimum,
    verified: compatibility.verified,
    // Only when declared. Air Bladder does not cap, and sending an empty
    // string would read as "verified to no longer function" at version "".
    ...(compatibility.maximum ? { maximum: compatibility.maximum } : {}),
  },
};

console.log(`\nAir Bladder -> Foundry Marketplace${dry ? "  (DRY RUN)" : ""}`);
console.log(`  package     ${id}`);
console.log(`  version     ${version}`);
console.log(`  manifest    ${manifest}`);
console.log(`  notes       ${notes}`);
console.log(`  compat      minimum ${release.compatibility.minimum}, verified ${release.compatibility.verified}`
  + (release.compatibility.maximum ? `, maximum ${release.compatibility.maximum}` : ""));
console.log("");

/* ------------------------------------- the asset has to be there, and agree */

// Checked HERE rather than left to Foundry, for two reasons. A 400 reading
// "manifest could not be retrieved" is indistinguishable from a dozen other
// causes, and the commonest mistake this script can make is being run before
// `main.yml` has finished attaching the assets. And a manifest that IS
// reachable can still disagree with what we are submitting — a rebuilt release,
// a mis-typed version — which Foundry has no reason to catch and which would
// list a version whose own package says something else.
const res = await fetch(manifest, { redirect: "follow" }).catch((e) => die(`could not fetch ${manifest}\n  ${e.message}`));
if (!res.ok) {
  die(`${manifest}\n  returned HTTP ${res.status}. If the tag was just pushed, the "Release Creation" `
    + `workflow may still be running — it attaches system.json and system.zip, and this step comes after it.`);
}
const shipped = await res.json().catch(() => die(`${manifest} is not JSON.`));
if (shipped.id !== id) die(`the shipped manifest declares id "${shipped.id}", not "${id}".`);
if (shipped.version !== version) {
  die(`the shipped manifest at that URL declares version "${shipped.version}", but this submission says `
    + `"${version}". Submitting would list a release whose own package disagrees.`);
}
for (const k of ["minimum", "verified"]) {
  if (shipped.compatibility?.[k] !== release.compatibility[k]) {
    die(`compatibility.${k}: the shipped manifest says "${shipped.compatibility?.[k]}", this submission `
      + `says "${release.compatibility[k]}". They must agree — read it off the asset, not the working tree.`);
  }
}
ok(`the shipped manifest is reachable and agrees: ${shipped.id} ${shipped.version}`);
// The asset the Marketplace will hand a user. Checked for the same reason: a
// release whose zip failed to attach is installable from nowhere.
const dl = await fetch(shipped.download, { method: "HEAD", redirect: "follow" })
  .catch((e) => die(`could not reach the download URL ${shipped.download}\n  ${e.message}`));
if (!dl.ok) die(`the manifest's own download URL returned HTTP ${dl.status}:\n  ${shipped.download}`);
ok(`the download URL is reachable: ${shipped.download}`);

/* ------------------------------------------------------------------- submit */

const body = { id, release, ...(dry ? { "dry-run": true } : {}) };

const sent = await fetch(API, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    // The bare token. Not `Bearer ${token}` — see the docblock.
    Authorization: token,
  },
  body: JSON.stringify(body),
}).catch((e) => die(`POST ${API} failed\n  ${e.message}`));

const text = await sent.text();
let json = null;
try { json = JSON.parse(text); } catch { /* a non-JSON body is printed raw below */ }

if (sent.status === 429) {
  const after = sent.headers.get("retry-after");
  die(`429 Too Many Requests — Foundry rate-limits submissions for one package to roughly one per `
    + `60 seconds.${after ? ` Retry-After: ${after}s.` : ""} Wait and run it again; nothing was saved.`);
}

if (!sent.ok || json?.status !== "success") {
  // The response body carries per-field messages, with non-field errors under
  // "__all__". Printed whole: it is the server's own diagnosis and nothing in
  // it is secret (the request, which carries the token, is never printed).
  console.error(`\n✖ HTTP ${sent.status} from ${API}\n`);
  console.error(json ? JSON.stringify(json, null, 2) : text);
  console.error("");
  process.exit(1);
}

ok(json.message ? `${json.status} — ${json.message}` : json.status);
if (json.page) ok(`package page: ${json.page}`);
console.log(dry
  ? "\nDry run only — nothing was saved. Re-run without --dry-run to publish.\n"
  : `\nPublished ${id} ${version} to the Foundry Marketplace.\n`);
