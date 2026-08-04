#!/usr/bin/env node
/**
 * The class icons: SVG everywhere, nothing left on .png, and they actually load.
 *
 * The icons shipped as 512x512 PNGs up to 0.1.6 and became SVGs in 0.1.7 (492 KB
 * -> 25 KB, and crisp at token size). An image path is COPIED onto a document
 * when it is created, so every world made before that update still pointed at
 * files the update deleted. module/cairn.js migrates them on ready.
 *
 * Asserts:
 *   1. no document anywhere still holds an icons/*.png path,
 *   2. every distinct icon path in use returns 200,
 *   3. the files really are SVG, and a browser renders them (naturalWidth > 0) —
 *      a 200 on a broken file would still fail a sheet,
 *   4. the migration still WORKS: it plants a document holding an old .png path,
 *      reloads, and watches it get rewritten. Without this the first three pass
 *      trivially on any already-migrated world, so a broken migration would sail
 *      through — and every check here would be measuring nothing.
 *   5. the GALLERY — all 1,539 game-icons/ glyphs — declares an intrinsic size
 *      too. Read off DISK rather than fetched: 1,539 browser round trips to
 *      assert a regex is not worth the wall clock, and the property is a fact
 *      about the file. A three-glyph sample is then rasterised in the browser
 *      to prove the disk reading corresponds to something real. `icons/` had
 *      this gate from the day `stack.svg` shipped soft; the gallery importer
 *      never inherited the stamp and 42 pack documents use its glyphs as TOKEN
 *      art (review #7 finding 6).
 *
 * Usage: npm run dev:icons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

// Every icon the system SHIPS, read off disk — NOT only the ones some document
// happens to reference. That distinction is the whole point: this probe used to
// derive its list from documents alone, so it checked 15 of 17 files and a newly
// added icon was invisible to it until content pointed at one. `stack.svg` was
// added, passed a green run the same day, and shipped rasterising at 150x150.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHIPPED = fs
  .readdirSync(path.join(ROOT, "icons"))
  .filter((f) => f.endsWith(".svg"))
  .map((f) => `systems/air-bladder/icons/${f}`);

/** Every glyph in the picker gallery, as absolute paths. */
const galleryDir = path.join(ROOT, "art", "game-icons");
const gallery = fs.readdirSync(galleryDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => fs.readdirSync(path.join(galleryDir, d.name))
    .filter((f) => f.endsWith(".svg"))
    .map((f) => `${d.name}/${f}`));

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const r = await page.evaluate(async (SHIPPED) => {
  const PNG = /^systems\/air-bladder\/icons\/[a-z-]+\.png$/;
  const ICON = /^systems\/air-bladder\/icons\/[a-z-]+\.(png|svg)$/;
  const stale = [];
  const used = new Set(SHIPPED);
  const referenced = new Set();
  const note = (src, where) => {
    if (!ICON.test(src ?? "")) return;
    used.add(src);
    referenced.add(src);
    if (PNG.test(src)) stale.push(`${where}: ${src}`);
  };

  for (const i of game.items) note(i.img, `Item ${i.name}`);
  for (const a of game.actors) {
    note(a.img, `Actor ${a.name}`);
    note(a.prototypeToken?.texture?.src, `Actor ${a.name} (token)`);
    for (const i of a.items) note(i.img, `${a.name} > ${i.name}`);
  }
  for (const s of game.scenes) for (const t of s.tokens) note(t.texture?.src, `Token ${t.name}`);

  // Pack contents too — those are shipped data, not migrated at runtime.
  for (const pack of game.packs) {
    if (!pack.metadata.id.startsWith("air-bladder.")) continue;
    for (const d of await pack.getDocuments()) {
      note(d.img, `${pack.metadata.name} > ${d.name}`);
      for (const i of d.items ?? []) note(i.img, `${pack.metadata.name} > ${d.name} > ${i.name}`);
      for (const res of d.results ?? []) note(res.img, `${pack.metadata.name} > ${d.name} (result)`);
    }
  }

  // Every distinct path must fetch AND decode.
  const checked = [];
  for (const src of used) {
    const res = await fetch(`/${src}`).catch(() => null);
    const body = res?.ok ? await res.text() : "";
    const renders = await new Promise((done) => {
      const img = new Image();
      img.onload = () => done(img.naturalWidth > 0);
      img.onerror = () => done(false);
      img.src = `/${src}`;
    });
    // An SVG with only a viewBox has NO intrinsic size, so it rasterises at the
    // browser's 300x150 fallback — a token drew at 150x150 where its PNG had been
    // 512x512. naturalWidth is how that shows up: it reports the RASTER size, so
    // it is the one number that catches a soft token before a player does.
    const natural = await new Promise((done) => {
      const img = new Image();
      img.onload = () => done(img.naturalWidth);
      img.onerror = () => done(0);
      img.src = `/${src}`;
    });
    checked.push({
      src, status: res?.status ?? 0, svg: body.trimStart().startsWith("<svg"), renders, natural,
      sized: /<svg[^>]*\swidth="\d+"/.test(body),
    });
  }
  return { stale, checked, shipped: SHIPPED.length, referenced: referenced.size };
}, SHIPPED);

r.stale.length === 0
  ? ok(`no document is still on a .png class icon (${r.checked.length} checked: ${r.shipped} shipped, ${r.referenced} referenced)`)
  : fail(`${r.stale.length} still on .png, e.g.\n        ${r.stale.slice(0, 5).join("\n        ")}`);

const bad = r.checked.filter((c) => c.status !== 200);
bad.length === 0
  ? ok(`all ${r.checked.length} icon paths return 200`)
  : fail(`${bad.length} icon path(s) failed: ${bad.map((b) => `${b.src} (${b.status})`).join(", ")}`);

const notSvg = r.checked.filter((c) => c.status === 200 && !c.svg);
notSvg.length === 0
  ? ok("every icon served is really an SVG")
  : fail(`not SVG: ${notSvg.map((n) => n.src).join(", ")}`);

const notRendered = r.checked.filter((c) => !c.renders);
notRendered.length === 0
  ? ok("every icon decodes and renders in the browser")
  : fail(`did not render: ${notRendered.map((n) => n.src).join(", ")}`);

const unsized = r.checked.filter((c) => c.status === 200 && !c.sized);
unsized.length === 0
  ? ok("every icon declares an intrinsic width/height")
  : fail(`no width/height (will rasterise at the 300x150 fallback): ${unsized.map((n) => n.src).join(", ")}`);

const small = r.checked.filter((c) => c.renders && c.natural < 512);
small.length === 0
  ? ok(`every icon rasterises at full size (${r.checked[0]?.natural}px)`)
  : fail(`rasterised below 512px: ${small.map((n) => `${n.src} (${n.natural}px)`).join(", ")}`);

/* --- 3b. the picker gallery, off disk -------------------------------------- */

const galleryUnsized = gallery.filter((rel) =>
  !/<svg[^>]*\swidth="\d+"/.test(fs.readFileSync(path.join(galleryDir, rel), "utf8")));
galleryUnsized.length === 0
  ? ok(`all ${gallery.length} gallery glyphs declare an intrinsic width/height`)
  : fail(`${galleryUnsized.length} of ${gallery.length} gallery glyphs have no width/height `
       + `(they rasterise at the 300x150 fallback; 42 pack documents use these as TOKEN art), `
       + `e.g. ${galleryUnsized.slice(0, 5).join(", ")}`);

// The disk reading is a regex over a file; this is the browser agreeing with it.
// Three, spread across categories, because the property is uniform by
// construction — the importer stamps every file the same way — and 1,539 round
// trips to re-confirm that costs minutes.
const sample = [gallery[0], gallery[Math.floor(gallery.length / 2)], gallery.at(-1)];
const sampled = await page.evaluate(async (rels) => Promise.all(rels.map((rel) =>
  new Promise((done) => {
    const img = new Image();
    img.onload = () => done({ rel, natural: img.naturalWidth });
    img.onerror = () => done({ rel, natural: 0 });
    img.src = `/systems/air-bladder/art/game-icons/${rel}`;
  }))), sample);
const softSample = sampled.filter((s) => s.natural < 512);
softSample.length === 0
  ? ok(`gallery sample rasterises at full size (${sampled.map((s) => s.natural).join(", ")}px)`)
  : fail(`gallery sample rasterised small: ${softSample.map((s) => `${s.rel} (${s.natural}px)`).join(", ")}`);

/* --- 4. the migration itself, on a document planted with the OLD path ------- */

const OLD = "systems/air-bladder/icons/generic-item.png";
const planted = await page.evaluate(async (OLD) => {
  const it = await Item.create({ name: "zz-icon-migration-probe", type: "item", img: OLD });
  return { id: it.id, img: it.img };
}, OLD);

planted.img === OLD
  ? ok("planted an item still carrying the old .png path")
  : fail(`could not plant the probe item (img is "${planted.img}")`);

await page.reload({ waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });

// POLL for the rewrite; do NOT sleep a fixed interval. `game.ready === true` does
// not mean the migration has finished: Hooks.callAll does not await an async
// callback, so the ready hook is still in flight after the flag is set — and this
// one runs two other phases, each a server round trip, before the icon pass. An
// 800ms sleep passed on most runs and failed on some, which read as a flaky probe
// and was really a race against work nobody can await from outside.
let waited = 0;
for (; waited < 30000; waited += 250) {
  const img = await page.evaluate((id) => game.items.get(id)?.img ?? null, planted.id);
  if (img?.endsWith(".svg")) break;
  await page.waitForTimeout(250);
}

const after = await page.evaluate(async (id) => {
  const it = game.items.get(id);
  const img = it?.img ?? null;
  try { await it?.delete(); } catch { /* leave it */ }
  return img;
}, planted.id);

after === "systems/air-bladder/icons/generic-item.svg"
  ? ok(`the ready migration rewrote it after ${waited}ms (${after})`)
  : fail(`migration did not rewrite the planted item after ${waited}ms: "${after}"`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
if (errors.length) failed = true;
await browser.close();
console.log(failed ? "\nICONS PROBE FAILED" : "\nicons probe passed");
process.exit(failed ? 1 : 0);
