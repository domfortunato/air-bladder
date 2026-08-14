#!/usr/bin/env node
/**
 * The player-facing journals under the content overlay (2026-08-14, review #14
 * finding 13 — user ruling: player journals translatable, Warden guides not).
 *
 *   npm run dev:journal-i18n        (dev world on :30000)
 *
 * The whole design rests on ONE contract: the offline extractor
 * (tools/i18n/content-strings.mjs) emits a key for each block-level element of a
 * page, and the browser looks that key up as `node.innerHTML` at render. Those
 * two strings are produced by completely different machines — node-html-parser
 * offline, the real HTML parser in Chromium — and a translation keyed to a
 * string nobody ever asks for is INVISIBLE: it ships, it is 100% "complete", and
 * the page renders English. Nothing but this probe can see that.
 *
 * So leg 1 is the contract itself, run in both directions, and it is why this
 * file exists at all:
 *   1. KEY AGREEMENT — render every page of both player journal packs, collect
 *      every block key the DOM would ask for, and assert the extractor emits
 *      each one. Run from Node so the extractor is the REAL one, imported, not a
 *      re-implementation that could drift into agreeing with itself.
 *   2. DISPLAY — a synthetic overlay carrying a sentinel for one real block, one
 *      real heading and the entry name; render and read all three back.
 *   3. EDIT MODE IS UNTOUCHED — the same page opened for editing shows the
 *      stored ENGLISH, because that editor's save writes what it shows.
 *   4. NEGATIVE CONTROL — with the render hook off, the sentinel does not
 *      appear, so leg 2 is measuring the hook and not some other kindness.
 *   5. THE WARDEN GUIDES ARE OUT — journals-docs emits nothing, because its
 *      pages are regenerated from docs/*.md and any translation keyed to them
 *      would be orphaned by the routine importer re-run.
 *
 * Read-only against the world: it renders COMPENDIUM documents and installs the
 * overlay in-page via _setOverlay, restoring it in a finally. Nothing is
 * created, updated or deleted.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, watchdog } from "./lib.mjs";
import { readPack } from "../i18n/lib.mjs";
import { stringsFromDoc } from "../i18n/content-strings.mjs";

const PLAYER_PACKS = ["journals-2e", "journals-glog"];

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(50)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(50)} ${d}`); failures++; };

/* ------------------------------------------- the extractor's side, offline -- */

const emitted = { block: new Set(), name: new Set(), pageName: new Set() };
for (const pack of PLAYER_PACKS) {
  for (const { doc } of readPack(pack)) {
    for (const s of stringsFromDoc(doc, pack)) {
      if (s.ns === "journal.block") emitted.block.add(s.en);
      if (s.ns === "journal.name") emitted.name.add(s.en);
      if (s.ns === "journal.pageName") emitted.pageName.add(s.en);
    }
  }
}
const docsEmitted = readPack("journals-docs")
  .flatMap(({ doc }) => [...stringsFromDoc(doc, "journals-docs")]);

console.log(`\nthe extractor emits ${emitted.block.size} block(s), ${emitted.name.size} entry name(s)`);
emitted.block.size > 200
  ? ok("the player journals reach the translator at all", `${emitted.block.size} paragraph-sized entries`)
  : fail("the player journals reach the translator at all", `only ${emitted.block.size} blocks — this was 0 before the fix`);
docsEmitted.length === 0
  ? ok("the Warden guides emit nothing", "regenerated from docs/*.md; a key there would be orphaned")
  : fail("the Warden guides emit nothing", `${docsEmitted.length} row(s): ${docsEmitted.slice(0, 3).map((r) => r.ns).join(", ")}`);

/* -------------------------------------------------------- the browser side -- */

watchdog(300000, "journal i18n probe");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/* --- 1. key agreement: what the DOM will ask for, from a real render ------- */

const domKeys = await page.evaluate(async (packs) => {
  const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption";
  const out = { blocks: [], entries: [], rendered: 0 };
  for (const short of packs) {
    const pack = game.packs.get(`air-bladder.${short}`);
    if (!pack) continue;
    for (const id of pack.index.keys()) {
      const doc = await pack.getDocument(id);
      out.entries.push(doc.name);
      await doc.sheet.render(true);
      for (let n = 0; n < 50 && !doc.sheet.element?.querySelector(".journal-page-content"); n++) {
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 400));
      for (const content of doc.sheet.element?.querySelectorAll(".journal-page-content") ?? []) {
        for (const node of content.querySelectorAll(BLOCKS)) {
          if (node.querySelector(BLOCKS)) continue;
          const en = node.innerHTML.trim();
          if (en) out.blocks.push(en);
        }
      }
      out.rendered++;
      await doc.sheet.close();
    }
  }
  return out;
}, PLAYER_PACKS);

// A block Foundry ENRICHED (an @UUID cross-reference becomes a full <a
// class="content-link">) is deliberately not emitted — see ENRICHED in
// content-strings.mjs. So the DOM asking for a key the extractor never emitted
// is only acceptable when that key is an enrichment; anything else is the silent
// mismatch this probe exists for, and the two must not be lumped together.
const ENRICHED_DOM = /class="(content-link|inline-roll|entity-link)"/;
const unmatched = [...new Set(domKeys.blocks)].filter((k) => !emitted.block.has(k));
const [enriched, broken] = [unmatched.filter((k) => ENRICHED_DOM.test(k)),
  unmatched.filter((k) => !ENRICHED_DOM.test(k))];

domKeys.rendered === 4
  ? ok("all four player journals rendered", `${domKeys.blocks.length} block(s) read from the live DOM`)
  : fail("all four player journals rendered", `${domKeys.rendered} of 4`);
broken.length === 0
  ? ok("every key the DOM asks for is one the extractor emits", "offline parser and Chromium agree")
  : fail("every key the DOM asks for is one the extractor emits",
      `${broken.length} unaskable key(s):\n${broken.map((m) => `        DOM: ${JSON.stringify(m)}`).join("\n")}`);
// Named and counted rather than waved through: if a content edit puts an @UUID
// into a paragraph, this number moves and somebody gets told, instead of that
// paragraph quietly dropping out of the translation.
enriched.length === 2
  ? ok("and the untranslatable ones are exactly the enriched blocks", `${enriched.length} cross-reference sentence(s), by design`)
  : fail("and the untranslatable ones are exactly the enriched blocks",
      `${enriched.length} enriched block(s), expected 2 — a content edit changed which paragraphs carry links`);
domKeys.entries.every((n) => emitted.name.has(n))
  ? ok("and every entry name is emitted", domKeys.entries.join(" | "))
  : fail("and every entry name is emitted", domKeys.entries.filter((n) => !emitted.name.has(n)).join(", "));

/* --- 2/3/4. display, edit mode, and the control ---------------------------- */

// Sentinels, not "is it not English": a check that only tests for absence passes
// when nothing renders at all.
const BLOCK_ES = "ZZ-BLOQUE-TRADUCIDO";
const NAME_ES = "ZZ-DIARIO-TRADUCIDO";
const HEADING_EN = "Attributes";
const HEADING_ES = "ZZ-ENCABEZADO-TRADUCIDO";

const subjectBlock = [...emitted.block].find((b) => b.startsWith("<em>These rules are the same"));
subjectBlock
  ? ok("found a real block to stand the display legs on", `${subjectBlock.slice(0, 46)}…`)
  : fail("found a real block to stand the display legs on", "the Core Rules opening paragraph is gone — fixture is stale");

const shown = await page.evaluate(async (fx) => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption";
  const out = {};
  const pack = game.packs.get("air-bladder.journals-2e");
  const id = [...pack.index.keys()].find((k) => pack.index.get(k).name === "Core Rules for Players");
  const doc = await pack.getDocument(id);
  const open = async () => {
    await doc.sheet.render(true);
    for (let n = 0; n < 50 && !doc.sheet.element?.querySelector(".journal-page-content"); n++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 500));
    return doc.sheet.element;
  };
  const readBack = (el) => ({
    block: [...(el?.querySelectorAll(`.journal-page-content ${BLOCKS.split(", ").join(", .journal-page-content ")}`) ?? [])]
      .some((n) => n.innerHTML.trim() === fx.BLOCK_ES),
    heading: [...(el?.querySelectorAll(".journal-page-content h2") ?? [])]
      .some((n) => n.innerHTML.trim() === fx.HEADING_ES),
    toc: [...(el?.querySelectorAll("nav.toc a") ?? [])].some((n) => n.textContent.trim() === fx.HEADING_ES),
    title: el?.querySelector(".window-title")?.textContent?.trim() ?? null,
  });
  try {
    i18n._setOverlay({
      "journal.block": { [fx.subjectBlock]: fx.BLOCK_ES, [fx.HEADING_EN]: fx.HEADING_ES },
      "journal.name": { "Core Rules for Players": fx.NAME_ES },
    });
    if (!i18n.contentLocalized()) return { error: "overlay did not install" };

    out.on = readBack(await open());
    await doc.sheet.close();

    // EDIT mode: the editor's save writes what it shows, so it must show stored
    // English. Reached through the page sheet directly with mode "edit" — the
    // same route core's Edit button takes.
    const pageDoc = doc.pages.contents[0];
    const editSheet = pageDoc.sheet;
    let editHTML = null;
    try {
      await editSheet.render({ force: true, mode: "edit" });
      await new Promise((r) => setTimeout(r, 800));
      editHTML = editSheet.element?.textContent ?? "";
      out.editShowsEnglish = !editHTML.includes(fx.BLOCK_ES);
      out.editIsEditMode = editSheet.isView === false;
    } finally {
      await editSheet.close().catch(() => {});
    }

    // THE CONTROL: take the render hook off and the sentinel must vanish. The
    // overlay stays installed, so this isolates the hook rather than the data.
    const hooks = Hooks.events?.renderJournalEntryPageSheet ?? [];
    const saved = hooks.map((h) => h);
    for (const h of saved) Hooks.off("renderJournalEntryPageSheet", h.fn ?? h);
    try {
      out.off = readBack(await open());
      await doc.sheet.close();
    } finally {
      for (const h of saved) Hooks.on("renderJournalEntryPageSheet", h.fn ?? h);
    }
    out.hooksRestored = (Hooks.events?.renderJournalEntryPageSheet ?? []).length === saved.length;
    return out;
  } finally {
    i18n._setOverlay(null);
    await doc.sheet.close().catch(() => {});
  }
}, { subjectBlock, BLOCK_ES, NAME_ES, HEADING_EN, HEADING_ES });

if (shown.error) fail("the overlay installed", shown.error);
else {
  console.log("\nunder a synthetic overlay");
  shown.on?.block ? ok("a page paragraph reads the translation", BLOCK_ES)
    : fail("a page paragraph reads the translation", "the block stayed English");
  shown.on?.heading ? ok("a heading does too", HEADING_ES)
    : fail("a heading does too", "the h2 stayed English");
  shown.on?.toc ? ok("and the contents list beside it agrees", "no English index over Spanish prose")
    : fail("and the contents list beside it agrees", "the TOC stayed English");
  shown.on?.title === NAME_ES ? ok("the window title carries the entry name", NAME_ES)
    : fail("the window title carries the entry name", `title read "${shown.on?.title}"`);

  console.log("\nedit mode is left alone — its save writes what it shows");
  shown.editIsEditMode
    ? ok("precondition: the page really opened for editing", "isView false")
    : fail("precondition: the page really opened for editing", "still in view mode — the leg below proves nothing");
  shown.editShowsEnglish
    ? ok("the editor shows the stored English", "no Spanish can be saved over the source")
    : fail("the editor shows the stored English", "the editor was translated — a save would store Spanish");

  console.log("\nthe control");
  shown.off?.block === false && shown.off?.heading === false
    ? ok("with the hook off, nothing translates", "so the legs above measure the hook")
    : fail("with the hook off, nothing translates", JSON.stringify(shown.off));
  shown.hooksRestored
    ? ok("and the hook came back", "later runs are not testing a disabled system")
    : fail("and the hook came back", "the hook was left off");
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
if (errors.length) failures++;
await browser.close();
console.log(failures ? `\nJOURNAL I18N PROBE FAILED (${failures})` : "\njournal i18n probe passed");
process.exit(failures ? 1 : 0);
