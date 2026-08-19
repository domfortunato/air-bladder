#!/usr/bin/env node
/**
 * Builds the project landing page into _site/ for GitHub Pages.
 *
 *   node tools/site.mjs        site/ + referenced assets -> _site/
 *
 * The page is hand-authored HTML in site/, and it references assets by the
 * paths they have in the built site (lydia-comer/..., docs/images/...), NOT by
 * their paths relative to site/index.html. That is deliberate: the same markup
 * then works locally and on Pages, and this script's only job is to copy the
 * handful of asset folders the page actually uses to where it expects them.
 *
 * Only the listed folders are copied. Nothing else in the repo is published —
 * which is how the internal design docs (docs/custom-backgrounds-plan.md,
 * docs/i18n-maintainer.md) stay out of the site by construction rather than by
 * an exclude list somebody has to remember to update.
 *
 * _site/ is generated output and is gitignored, exactly like packs/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "_site");

/** Asset folders the page references, copied verbatim into the built site. */
const ASSETS = [
  // The wordmark: light/dark variants plus the no-preference fallback.
  { from: "art/lydia-comer", filter: (f) => /^Airbladder(01|02|06)\.webp$/.test(f) },
  // The "Compatible with Cairn 2e" badge in the footer. Shipped unmodified.
  { from: "logo", filter: (f) => f === "Cairn-2e-Compatible_white.jpg" },
  // Screenshots.
  { from: "docs/images", filter: (f) => f.endsWith(".png") },
  // Alegreya, self-hosted so the page makes no external requests. The OFL
  // notice travels WITH the fonts: clause 2 requires the copyright notice and
  // licence accompany every copy, and a built site is a copy — it served three
  // woff2 files and no notice at all until 2026-08-18. The zip half was fixed
  // and gated in the 2026-07-30 rewrite; nothing had ever looked at the site.
  {
    from: "fonts",
    filter: (f) => f.endsWith(".woff2") || f === "OFL.txt" || f === "license.txt",
    requires: ["OFL.txt", "license.txt"],
  },
];

function copyFiltered(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  const copied = [];
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile() || !filter(entry.name)) continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    copied.push(entry.name);
  }
  return copied;
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

// The page itself.
let pages = 0;
for (const entry of fs.readdirSync(path.join(root, "site"), { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  fs.copyFileSync(path.join(root, "site", entry.name), path.join(outRoot, entry.name));
  pages++;
}
console.log(`site/ -> _site/                  ${pages} file(s)`);

// Jekyll would otherwise try to process the output and skip anything it does
// not like. This site is plain HTML; tell Pages to serve it as-is.
fs.writeFileSync(path.join(outRoot, ".nojekyll"), "");

let total = 0;
for (const { from, filter, requires = [] } of ASSETS) {
  const src = path.join(root, ...from.split("/"));
  if (!fs.existsSync(src)) {
    console.error(`Missing asset folder: ${from}`);
    process.exit(1);
  }
  const copied = copyFiltered(src, path.join(outRoot, ...from.split("/")), filter);
  if (copied.length === 0) {
    console.error(`No files matched in ${from} — the page would render broken.`);
    process.exit(1);
  }
  // A missing NOTICE breaks nothing on screen, which is exactly why it needs
  // saying out loud. The filter is the line anyone edits, and fonts render
  // perfectly well with their licence stripped off — nothing else here would
  // ever have mentioned it.
  const absent = requires.filter((f) => !copied.includes(f));
  if (absent.length) {
    console.error(`${from}/ is missing its required notice: ${absent.join(", ")}. `
      + "The licence has to travel with the files it covers.");
    process.exit(1);
  }
  console.log(`${from}/`.padEnd(32) + `${copied.length} file(s)`);
  total += copied.length;
}

console.log(`\nBuilt _site/ — ${pages} page file(s) + ${total} asset(s).`);
