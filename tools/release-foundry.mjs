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

/**
 * Die on a thrown fetch, having actually said why.
 *
 * **`fetch` THROWS `TypeError: fetch failed` AND PUTS THE REASON IN `e.cause`**,
 * which is the single most useless error message in Node and the reason this
 * helper exists: the first cut printed `e.message` alone and reported
 * "POST … failed" with nothing after it, on a run where the endpoint was
 * reachable and answering 400 to curl from the same machine a minute later.
 * DNS, TLS, a refused connection and an invalid header value all arrive as that
 * same sentence, and they are not the same problem. `cause` carries a `code`
 * (`ENOTFOUND`, `ECONNREFUSED`, `CERT_HAS_EXPIRED`…) and sometimes nests one
 * more level, so all of it is printed.
 */
const netDie = (what, e) => {
  const c = e?.cause;
  const lines = [`${what} failed`, `  ${e?.name ?? "Error"}: ${e?.message ?? e}`];
  if (c) {
    lines.push(`  cause: ${c.code ? `[${c.code}] ` : ""}${c.message ?? c}`);
    if (c.cause) lines.push(`  cause: ${c.cause.message ?? c.cause}`);
  }
  die(lines.join("\n"));
};

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

// TRIMMED, and that is not cosmetic. A header value carrying a newline, a tab
// or a trailing space makes `fetch` THROW rather than send — and because the
// throw is the opaque `fetch failed` above, it reads exactly like the endpoint
// being unreachable. Copying a token out of a web page and into
// `$env:FOUNDRY_RELEASE_TOKEN = "…"` picks up a trailing newline easily.
/**
 * Ask for the token, muted, when nobody has set the variable.
 *
 * **WHY THIS EXISTS AND IS NOT A CONVENIENCE.** Setting the variable by hand
 * cost four failed attempts across two shells: `$env:X = "…"` pasted into
 * cmd.exe is read as a path, `set X="y"` in cmd keeps the quotes, a token
 * copied off the web page brought a U+2026 placeholder and later a stray
 * space, and finally a whole terminal transcript was pasted back into
 * PowerShell, prompts included, so every line ran as a command. None of that
 * is the operator's error — it is what handing somebody a line to paste
 * invites. Asking removes the entire class: one command, paste the token, done.
 *
 * CI IS UNAFFECTED, and that is what `isTTY` is for: with no terminal the
 * function is never called and the variable remains the only route, so the
 * `marketplace` job fails loudly on a missing secret exactly as before. Never
 * make this prompt when stdin is not a TTY — a release job that stops to ask a
 * question hangs until the runner's timeout.
 *
 * Muted, and read in RAW mode so a paste arrives whole. Backspace is handled
 * because a mis-paste is the common case, and Ctrl-C exits rather than
 * returning a half-typed credential.
 */
const promptForToken = async () => {
  process.stdout.write("  Foundry release token (not shown): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let buf = "";
  for await (const chunk of process.stdin) {
    let done = false;
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") { done = true; break; }
      if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }   // Ctrl-C
      if (ch === "\u007f" || ch === "\b") { buf = buf.slice(0, -1); continue; }
      buf += ch;
    }
    if (done) break;
  }
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\n");
  return buf.trim();
};

let token = (process.env.FOUNDRY_RELEASE_TOKEN ?? "").trim();
if (!token && process.stdin.isTTY) token = await promptForToken();
if (!token) {
  // BOTH SHELLS, because the PowerShell-only form sent somebody round the
  // houses: pasted into cmd.exe, `$env:X = "…"` is read as a path and cmd
  // answers "The filename, directory name, or volume label syntax is
  // incorrect" — which says nothing about the variable not being set. The
  // prompt tells them apart (`PS C:\…>` against `C:\…>`), and the quoting
  // rules are OPPOSITE: cmd's `set` puts any quotes INTO the value.
  die("FOUNDRY_RELEASE_TOKEN is not set.\n\n"
    + "  PowerShell (prompt starts `PS`):  $env:FOUNDRY_RELEASE_TOKEN = \"fvttp_PASTE_YOUR_OWN\"\n"
    + "  cmd.exe:                          set FOUNDRY_RELEASE_TOKEN=fvttp_PASTE_YOUR_OWN\n"
    + "  bash:                             export FOUNDRY_RELEASE_TOKEN=fvttp_PASTE_YOUR_OWN\n\n"
    + "  In cmd.exe use NO quotes and no spaces around `=` — `set X=\"y\"` stores the quotes too.\n"
    + "  Either way it lasts for that shell session only.\n\n"
    + "  In CI:  a repository secret of the same name, read by main.yml.\n\n"
    + "  Get the value from foundryvtt.com/packages/air-bladder/edit/ — the package's RELEASE token.\n"
    + "  Replace the whole placeholder, prefix included.\n"
    + "  Do NOT pass it as an argument — a command line is readable by other processes.");
}
// cmd.exe's `set X="y"` keeps the quotes, and both quote characters are legal
// in a header value, so this would otherwise reach Foundry and come back as an
// opaque 403 about an invalid token. Named here instead.
if (/^["'].*["']$/s.test(token)) {
  die("FOUNDRY_RELEASE_TOKEN is wrapped in quotes, and they are part of the value.\n\n"
    + "  cmd.exe's `set` does not strip them: write `set FOUNDRY_RELEASE_TOKEN=fvttp_…` with no\n"
    + "  quotes at all. (PowerShell's `$env:X = \"…\"` does strip them, so the quotes belong there.)");
}
// THE PLACEHOLDER ITSELF, because this happened on the first real attempt: the
// instructions read `fvttp_…` and that is what got pasted, ellipsis and all.
// The header-character check below did catch it and name U+2026, which is a
// fine diagnosis of the wrong problem — so it is worth saying the true one.
// Any example with a literal placeholder is one somebody will paste verbatim;
// writing it in SHOUTING ASCII does not stop that, it only makes the refusal
// legible.
if (/PASTE|YOUR_OWN|REPLACE|XXXX|…|^fvttp_$/i.test(token)) {
  die("FOUNDRY_RELEASE_TOKEN still holds the PLACEHOLDER from the instructions, not a token.\n\n"
    + "  Copy the real value from foundryvtt.com/packages/air-bladder/edit/ and replace all of it,\n"
    + "  including the `fvttp_` prefix — the prefix is part of the token, not something to type.");
}
// A shape check, not a validity check: the article's header example is
// `fvttp_{token}`, so a value pasted without that prefix is a different string
// (an account API key, say) and would fail with an opaque 401.
if (!token.startsWith("fvttp_")) {
  die("FOUNDRY_RELEASE_TOKEN does not start with \"fvttp_\". The package RELEASE token has "
    + "that prefix; check you have not pasted something else. (Its value is never printed.)");
}
// Every character has to be legal in a header value, or `fetch` throws instead
// of sending — the failure the trim above also guards. Reported by POSITION and
// CODE POINT, never by printing the token: "character 7 is U+2014" is enough to
// find a smart quote or an em dash a copy-paste introduced, and a quoted token
// in a shell assignment can carry the quotes themselves.
const bad = [...token].findIndex((ch) => ch < "\x21" || ch > "\x7e");
if (bad !== -1) {
  const cp = token.codePointAt(bad).toString(16).toUpperCase().padStart(4, "0");
  die(`FOUNDRY_RELEASE_TOKEN holds a character that is not legal in an HTTP header: `
    + `position ${bad + 1} is U+${cp}. \`fetch\` would throw rather than send, which reads as a `
    + `network failure. Re-copy the token — a stray quote, space, newline or typographic dash `
    + `from a web page is the usual cause. (The value itself is never printed.)`);
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

console.log(`\nAir Bladder -> Foundry Marketplace${dry ? "  (DRY RUN)" : ""}`);
console.log(`  package     ${id}`);
console.log(`  version     ${version}`);
console.log(`  manifest    ${manifest}`);
console.log(`  notes       ${notes}`);
console.log("");

/* ------------------- the PUBLISHED ASSET is what describes the release ------ */

// **THE COMPATIBILITY SUBMITTED IS THE ASSET'S, NOT THE WORKING TREE'S**, and
// that distinction cost a red dry run to find. A submission describes a release
// that ALREADY SHIPPED, so the only authority on what it declares is the
// artifact a user downloads. The working tree is a different thing: on `dev` it
// is whatever the NEXT release will say.
//
// The first cut read compatibility from `system.json` and then refused when it
// disagreed with the asset — which is correct in CI, where the job checks out
// the tag and the two coincide, and simply wrong by hand. It fired the first
// time it was run: `0.1.23` shipped `verified: 14.365`, the tree had moved to
// `14.368` for the next release, and the guard's own message said to read it off
// the asset. Taking that advice deletes the guard and the class of bug with it.
//
// Fetching it also catches the commonest mistake this script can make — being
// run before `main.yml` has finished attaching the assets — with a sentence
// instead of an opaque 400 from Foundry, and proves the zip a user will be sent
// actually exists.
const res = await fetch(manifest, { redirect: "follow" }).catch((e) => netDie(`GET ${manifest}`, e));
if (!res.ok) {
  die(`${manifest}\n  returned HTTP ${res.status}. If the tag was just pushed, the "Release Creation" `
    + `workflow may still be running — it attaches system.json and system.zip, and this step comes after it.`);
}
const shipped = await res.json().catch(() => die(`${manifest} is not JSON.`));
// `id` is a closed decision and never moves (CLAUDE.md), so a mismatch here
// means the URL points at something that is not this package at all.
if (shipped.id !== id) die(`the shipped manifest declares id "${shipped.id}", not "${id}".`);
// THE one agreement still worth asserting: that the asset at this URL is the
// version being submitted. GitHub serves `releases/download/<tag>/…`, so a
// mismatch means the release was built from the wrong ref.
if (shipped.version !== version) {
  die(`the shipped manifest at that URL declares version "${shipped.version}", but this submission says `
    + `"${version}". The asset and the submission must name the same release.`);
}
const compatibility = shipped.compatibility ?? {};
for (const k of ["minimum", "verified"]) {
  if (!compatibility[k]) {
    die(`the shipped manifest for ${version} declares no compatibility.${k} — the API requires it. `
      + `It cannot be supplied from here: whatever that release shipped is what it is.`);
  }
}
ok(`the shipped manifest is reachable: ${shipped.id} ${shipped.version}`);
// The asset the Marketplace will hand a user. Checked for the same reason: a
// release whose zip failed to attach is installable from nowhere.
const dl = await fetch(shipped.download, { method: "HEAD", redirect: "follow" })
  .catch((e) => netDie(`HEAD ${shipped.download}`, e));
if (!dl.ok) die(`the manifest's own download URL returned HTTP ${dl.status}:\n  ${shipped.download}`);
ok(`the download URL is reachable: ${shipped.download}`);

/* ------------------------------------------------------------------- submit */

const release = {
  version,
  manifest,
  notes,
  compatibility: {
    minimum: compatibility.minimum,
    verified: compatibility.verified,
    // Only when the asset declares one. Air Bladder does not cap, and sending
    // an empty string would read as "verified to no longer function" at "".
    ...(compatibility.maximum ? { maximum: compatibility.maximum } : {}),
  },
};

console.log(`  submitting  minimum ${release.compatibility.minimum}, verified ${release.compatibility.verified}`
  + (release.compatibility.maximum ? `, maximum ${release.compatibility.maximum}` : "")
  + "  (read from the published asset)");

const body = { id, release, ...(dry ? { "dry-run": true } : {}) };

const sent = await fetch(API, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    // The bare token. Not `Bearer ${token}` — see the docblock.
    Authorization: token,
  },
  body: JSON.stringify(body),
}).catch((e) => netDie(`POST ${API}`, e));

const text = await sent.text();
let json = null;
try { json = JSON.parse(text); } catch { /* a non-JSON body is printed raw below */ }

if (sent.status === 429) {
  const after = sent.headers.get("retry-after");
  die(`429 Too Many Requests — Foundry rate-limits submissions for one package to roughly one per `
    + `60 seconds.${after ? ` Retry-After: ${after}s.` : ""} Wait and run it again; nothing was saved.`);
}

// ALREADY LISTED IS NOT A FAILURE, so this exits 0.
//
// Foundry answers a re-submission with 400 and `code: "unique_together"` —
// "Package Version with this Package and Version Number already exists." That
// is the Marketplace telling us the work is done, and a job that reds for
// having nothing to do is a job somebody learns to ignore. Re-running a
// workflow from the Actions tab, or this script by hand after a transient
// failure, both land here once the version is registered.
//
// It cannot mask a wrong version, which is the only reason this is safe: the
// asset check above has already established that `version` is the version the
// fetched manifest declares, so "already exists" can only mean this release.
const already = json?.errors?.__all__?.some((e) => e.code === "unique_together");
if (already) {
  ok(`${id} ${version} is already listed on the Marketplace — nothing to do.`);
  console.log(`\nFoundry already holds this version. That is the expected answer to a re-run.\n`);
  process.exit(0);
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
