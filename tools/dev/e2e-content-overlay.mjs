/**
 * Content-overlay display-only e2e.
 *
 * `i18n-content.js` states one load-bearing invariant: translate at DISPLAY time,
 * NEVER mutate a stored document. The table-draw chat path violated it — it
 * translated in `preCreateChatMessage` via `updateSource`, which is the documented
 * way to change what gets STORED, so the roller's language was baked permanently
 * into the ChatMessage (including messages other packages authored).
 *
 * The bug was invisible while `lang/content/*.json` was empty: every lookup missed,
 * so no write ever fired. This test installs an overlay explicitly, so it fails
 * whether or not a real translation ships.
 *
 * Asserts, for a table draw:
 *   1. the RENDERED card shows the translation, and
 *   2. the STORED message content is still English.
 *
 * Usage: npm run dev:content-overlay
 */

import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(28)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(28)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/* -------------------------------------------- */

console.log("\ntable draw under a content overlay");

const res = await page.evaluate(async () => {
  // The ESM graph is cached, so this is the SAME module instance the system runs —
  // _setOverlay writes the live OVERLAY the render hook reads.
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");

  const EN = "Probe result — canonical English";
  const ES = "Probe result — OVERLAY APPLIED";
  const created = [];
  try {
    // A world table, not a pack one: exact control of the string, no locked pack,
    // and 1d1 over a single result means the draw is deterministic.
    const table = await RollTable.create({
      name: "Content Overlay Probe",
      formula: "1d1",
      replacement: true,
      results: [{ type: CONST.TABLE_RESULT_TYPES.TEXT, text: EN, range: [1, 1] }],
    });
    created.push(table);

    i18n._setOverlay({ "table.result": { [EN]: ES } });
    if (!i18n.contentLocalized()) return { error: "overlay did not install" };

    const { results } = await table.draw();
    if (!results?.length) return { error: "draw produced no results" };

    // Give the chat card a frame to render.
    await new Promise((r) => setTimeout(r, 600));

    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: "no chat message" };

    const node = document.querySelector(`[data-message-id="${msg.id}"]`);
    const renderedText = node?.textContent ?? "";
    // _source is the stored document, untouched by any derived/render-time work.
    const storedContent = msg._source.content ?? "";

    return {
      EN, ES,
      renderedHasES: renderedText.includes(ES),
      renderedHasEN: renderedText.includes(EN),
      storedHasES: storedContent.includes(ES),
      storedHasEN: storedContent.includes(EN),
      foundNode: !!node,
      msgId: msg.id,
    };
  } finally {
    i18n._setOverlay(null);
    for (const d of created) await d.delete().catch(() => {});
  }
});

if (res.error) {
  fail("probe setup", res.error);
} else {
  if (!res.foundNode) fail("rendered card found", "no [data-message-id] node");
  else ok("rendered card found", res.msgId);

  if (res.renderedHasES) ok("rendered shows translation", `"${res.ES}"`);
  else fail("rendered shows translation", `card text lacks "${res.ES}"`);

  if (!res.renderedHasEN) ok("rendered replaced English", "");
  else fail("rendered replaced English", "English still visible in the card");

  // The two that matter — the actual regression.
  if (res.storedHasEN) ok("STORED stays English", "");
  else fail("STORED stays English", "English missing from the stored content");

  if (!res.storedHasES) ok("STORED not translated", "no overlay text persisted");
  else fail("STORED not translated", "TRANSLATION WAS BAKED INTO THE DOCUMENT");
}

/* -------------------------------------------- */

console.log("\nno overlay installed (English world)");

const off = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const EN = "Probe result — no overlay";
  const created = [];
  try {
    const table = await RollTable.create({
      name: "Content Overlay Probe (off)",
      formula: "1d1",
      replacement: true,
      results: [{ type: CONST.TABLE_RESULT_TYPES.TEXT, text: EN, range: [1, 1] }],
    });
    created.push(table);
    i18n._setOverlay(null);
    await table.draw();
    await new Promise((r) => setTimeout(r, 600));
    const msg = game.messages.contents.at(-1);
    const node = document.querySelector(`[data-message-id="${msg?.id}"]`);
    return { renderedHasEN: (node?.textContent ?? "").includes(EN), storedHasEN: (msg?._source.content ?? "").includes(EN) };
  } finally {
    for (const d of created) await d.delete().catch(() => {});
  }
});

if (off.renderedHasEN && off.storedHasEN) ok("English world untouched", "");
else fail("English world untouched", JSON.stringify(off));

/* -------------------------------------------- */

// A marketplace heading renders the RollTable's name with "Market: " stripped, but
// the overlay only ever emits the FULL name as a key — so the string shown and the
// string a translator can fill must not be allowed to drift apart again. `name`
// stays English because opts.only/opts.exclude and three probes match on it.
console.log("\nmarketplace category headings");

const mkt = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const m = await import("/systems/air-bladder/module/marketplace.js");
  try {
    i18n._setOverlay({ "table.name": { "Market: Weapons": "Mercado: Armas" } });
    const cat = (await m.getMarketplaceCatalog()).categories.find((c) => c.name === "Weapons");
    if (!cat) return { error: "no Weapons category" };
    return { name: cat.name, label: cat.label };
  } finally {
    i18n._setOverlay(null);
  }
});

if (mkt.error) fail("marketplace catalog", mkt.error);
else {
  mkt.label === "Armas"
    ? ok("heading translated", `"${mkt.label}" (prefix stripped after translating)`)
    : fail("heading translated", `label is "${mkt.label}", expected "Armas"`);
  mkt.name === "Weapons"
    ? ok("identity stays English", "opts.only / probes still match")
    : fail("identity stays English", `name is "${mkt.name}"`);
}

/* -------------------------------------------- */

// The picker rendered background names/descriptions raw while the sheet rendered
// the same two fields through the overlay, so the two surfaces disagreed about the
// same document. Radio VALUES must stay English/uuid — only labels translate.
console.log("\nbackground picker");

const pick = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const gen = game.cairn.characterGenerator;
  const bg = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())[0];
  const EN_DESC = bg.system.description ?? "";
  try {
    i18n._setOverlay({
      "bg.name": { [bg.name]: "NOMBRE-PROBE" },
      "bg.desc": { [EN_DESC]: "Descripción de prueba. Segunda frase ignorada." },
    });

    const tagline = gen.backgroundTagline(bg);

    // Open the picker, read the rendered rows, then dismiss it.
    //
    // POLL for the dialog; do not sleep at it. This waited a flat 700ms, and
    // promptBackground now spends ~1.1s in getBackgroundsByArchetype before it
    // renders at all. At 700ms there is no .bg-picker and no Cancel button, the
    // `?.click()` below swallowed the miss, and the promise never settled — so
    // this probe HUNG rather than failed, which is strictly worse: a release
    // checklist stalls on it instead of reporting anything.
    const p = gen.promptBackground("2e", null);
    p.catch(() => {});                       // never let the dismissal path go unhandled
    let root = null;
    for (let i = 0; i < 60 && !root; i++) {
      await new Promise((r) => setTimeout(r, 100));
      root = document.querySelector(".bg-picker");
    }
    try {
      const row = [...(root?.querySelectorAll(".bg-pick-row") ?? [])]
        .find((l) => l.querySelector("input")?.value === bg.uuid);
      const groups = [...(root?.querySelectorAll(".bg-pick-group") ?? [])].map((g) => g.textContent.trim());
      return {
        rendered: !!root,
        tagline,
        rowName: row?.querySelector(".bg-pick-name")?.textContent.trim(),
        rowValue: row?.querySelector("input")?.value,
        uuid: bg.uuid,
        groups,
      };
    } finally {
      // Close it whatever happened above. The button is the real user path, but a
      // dialog left open blocks every probe that joins after this one.
      const cancel = [...document.querySelectorAll("button")].find((b) => b.dataset.action === "cancel");
      if (cancel) cancel.click();
      else for (const d of document.querySelectorAll("dialog[open]")) d.close();
      await p.catch(() => {});
    }
  } finally {
    i18n._setOverlay(null);
  }
});

pick.rendered
  ? ok("picker rendered", `${pick.groups.length} archetype group(s)`)
  : fail("picker rendered", "no .bg-picker after 6s — every assertion below is vacuous");
pick.rowName === "NOMBRE-PROBE"
  ? ok("picker name translated", `"${pick.rowName}"`)
  : fail("picker name translated", `row shows "${pick.rowName}"`);
pick.rowValue === pick.uuid
  ? ok("picker value is the uuid", "choice unaffected by language")
  : fail("picker value is the uuid", `value is "${pick.rowValue}"`);
pick.tagline === "Descripción de prueba."
  ? ok("tagline from translation", `"${pick.tagline}"`)
  : fail("tagline from translation", `tagline is "${pick.tagline}"`);
pick.groups.length && pick.groups.every((g) => g && !/^\s*$/.test(g))
  ? ok("archetype headings render", pick.groups.join(", "))
  : fail("archetype headings render", JSON.stringify(pick.groups));

/* -------------------------------------------- */

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
if (errors.length) failures++;

await browser.close();
console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);
