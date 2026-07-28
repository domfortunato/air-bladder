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
 *
 * Usage: npm run dev:icons
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const r = await page.evaluate(async () => {
  const PNG = /^systems\/air-bladder\/icons\/[a-z-]+\.png$/;
  const ICON = /^systems\/air-bladder\/icons\/[a-z-]+\.(png|svg)$/;
  const stale = [];
  const used = new Set();
  const note = (src, where) => {
    if (!ICON.test(src ?? "")) return;
    used.add(src);
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
    checked.push({ src, status: res?.status ?? 0, svg: body.trimStart().startsWith("<svg"), renders });
  }
  return { stale, checked };
});

r.stale.length === 0
  ? ok(`no document is still on a .png class icon (${r.checked.length} distinct icons in use)`)
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
await page.waitForTimeout(800);

const after = await page.evaluate(async (id) => {
  const it = game.items.get(id);
  const img = it?.img ?? null;
  try { await it?.delete(); } catch { /* leave it */ }
  return img;
}, planted.id);

after === "systems/air-bladder/icons/generic-item.svg"
  ? ok(`the ready migration rewrote it (${after})`)
  : fail(`migration did not rewrite the planted item: "${after}"`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
if (errors.length) failed = true;
await browser.close();
console.log(failed ? "\nICONS PROBE FAILED" : "\nicons probe passed");
process.exit(failed ? 1 : 0);
