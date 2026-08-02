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
 * Then, for the surfaces that name a background: the marketplace headings, the
 * picker rows, and the drop confirm — each of which has at some point rendered raw
 * English beside a sheet showing the same field translated.
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
      results: [{ type: CONST.TABLE_RESULT_TYPES.TEXT, description: EN, range: [1, 1] }],
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
      results: [{ type: CONST.TABLE_RESULT_TYPES.TEXT, description: EN, range: [1, 1] }],
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

// The drop confirm names the background, and it was the ONE background-name surface
// still formatting the raw English while the sheet header, the picker and the
// failed-career list all went through t("bg.name", …). Invisible today because
// lang/content/es.json is empty, and it would NOT have come along when the content
// phase lands — hence a gate now rather than a note.
//
// Driven by calling _onDropBackground directly: what routes a drop there is already
// covered by dev:bg-drop-guard (which arrival routes reach it) and dev:bg-drop-order
// (when it may be offered at all). What is under test here is only the string.
console.log("\nbackground drop confirm");

let dropActorId = null;
try {
  const drop = await page.evaluate(async () => {
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    const bg = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())[0];
    const actor = await CONFIG.Actor.documentClass.create({
      name: "ZZ Drop Confirm Probe", type: "character", system: { contentSource: "2e" },
    });
    const out = { actorId: actor.id, en: bg.name };
    try {
      i18n._setOverlay({ "bg.name": { [bg.name]: "NOMBRE-PROBE" } });
      await actor.sheet.render(true);
      for (let i = 0; i < 60 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));

      const p = actor.sheet._onDropBackground(bg);
      p.catch(() => {});
      // Poll, never sleep: a fixed wait is an assertion about someone else's timing,
      // and when it is wrong this hangs on an unanswered modal instead of failing.
      let dlg = null;
      for (let i = 0; i < 60 && !dlg; i++) {
        await new Promise((r) => setTimeout(r, 100));
        dlg = [...foundry.applications.instances.values()].find((a) => a.constructor.name === "DialogV2");
      }
      // .dialog-content only — the window frame text carries the Yes/No labels, and
      // an English button label in the haystack would break the "no English" half.
      out.text = (dlg?.element?.querySelector(".dialog-content") ?? dlg?.element)?.textContent
        ?.replace(/\s+/g, " ").trim() ?? null;
      // rejectClose is false on this dialog, so closing settles to null rather than
      // throwing — the swap is refused and nothing is changed.
      dlg?.close();
      await p.catch(() => {});
    } finally {
      i18n._setOverlay(null);
      await actor.sheet?.close().catch(() => {});
    }
    return out;
  });

  dropActorId = drop.actorId;
  if (!drop.text) {
    fail("confirm rendered", "no DialogV2 after 6s — the assertions below are vacuous");
  } else {
    ok("confirm rendered", `"${drop.text.slice(0, 60)}…"`);
    drop.text.includes("NOMBRE-PROBE")
      ? ok("confirm name translated", '"NOMBRE-PROBE"')
      : fail("confirm name translated", `confirm text was "${drop.text}"`);
    !drop.text.includes(drop.en)
      ? ok("English name is gone", `not "${drop.en}"`)
      : fail("English name is gone", `confirm still names the English "${drop.en}"`);
  }
} finally {
  // From NODE. A throw inside the evaluate above cannot skip this, and a probe
  // actor left behind is exactly the stale world state the next run's precondition
  // would be quietly satisfied by.
  if (dropActorId) {
    await page.evaluate(async (id) => { await game.actors.get(id)?.delete(); }, dropActorId)
      .catch(() => {});
  }
}

/* -------------------------------------------- */

// Three surfaces a Spanish translator reported as untranslated on 2026-08-02, with
// every cell filled and correctly keyed. All three read the STORED document instead
// of the overlay, so no amount of translating could ever have shown:
//   - the inventory row's expanded DESCRIPTION panel (the name above it translated,
//     which is what made the report look like an orphaned-key problem),
//   - the Scars checklist (names were in the overlay and never looked up; the
//     per-scar detail was never even EXTRACTED — new ns table.resultDesc),
//   - the item sheet, which localized only when NOT editable, i.e. never for the
//     player who owns the item.
// Each assertion is paired with the invariant that made the bug worth having: the
// stored value stays English. A translation that reaches the document is a worse
// failure than a translation that never renders.
console.log("\nsheet surfaces: inventory panel, scars, item sheet");

let invActorId = null;
try {
  const inv = await page.evaluate(async () => {
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    // Same normalization the overlay FILE is written with (i18n-content.js keys by
    // the collapsed form), spelled out here rather than imported: a probe that
    // borrows the implementation's key function agrees with it by construction.
    const norm = (s) => String(s).replace(/\s+/g, " ").trim();

    const EN_NAME = "ZZ Probe Rope";
    const EN_DESC = "Twenty-five ZZ feet of probe rope, for climbing.";
    const ES_NAME = "ZZ-CUERDA-SONDA";
    const ES_DESC = "ZZ-DESCRIPCION-TRADUCIDA";
    const ES_SCAR = "ZZ-CICATRIZ";
    const ES_SCAR_DESC = "ZZ-DETALLE-DE-CICATRIZ";

    const actor = await CONFIG.Actor.documentClass.create({
      name: "ZZ Overlay Sheet Probe", type: "character",
      system: { contentSource: "2e", scarEnabled: true },
    });
    const out = { actorId: actor.id, EN_NAME, EN_DESC, ES_NAME, ES_DESC, ES_SCAR, ES_SCAR_DESC };
    let sheetOpen = null;
    try {
      const [item] = await actor.createEmbeddedDocuments("Item", [
        { name: EN_NAME, type: "item", system: { description: EN_DESC } },
      ]);

      // Key the scar rows off the REAL shipped table — the strings a translator
      // actually fills — with sentinel values. If the Scars table ever loses its
      // per-row flag, scarDescEn goes empty and the assertions below say so rather
      // than passing on a lookup of "".
      const scarTable = (await game.packs.get("air-bladder.tables-2e").getDocuments())
        .find((tbl) => tbl.name === "Scars");
      const r0 = scarTable?.results.contents?.[0] ?? scarTable?.results?.[0];
      const scarEn = (r0?.type === "text" ? r0?.description : r0?.name) ?? "";
      const scarDescEn = r0?.flags?.["air-bladder"]?.description ?? "";
      out.scarEn = scarEn;
      out.scarDescEn = scarDescEn;

      i18n._setOverlay({
        "item.name": { [norm(EN_NAME)]: ES_NAME },
        "item.desc": { [norm(EN_DESC)]: ES_DESC },
        "table.result": { [norm(scarEn)]: ES_SCAR },
        "table.resultDesc": { [norm(scarDescEn)]: ES_SCAR_DESC },
      });

      const settle = (ms) => new Promise((r) => setTimeout(r, ms));
      await actor.sheet.render(true);
      for (let i = 0; i < 60 && !actor.sheet.element; i++) await settle(100);
      sheetOpen = actor.sheet;
      await settle(400);
      const root = actor.sheet.element;

      // ---- inventory row: name (worked) and the expanded panel (did not) ----
      const row = root?.querySelector(`.cairn-items-list-row[data-item-id="${item.id}"]`);
      out.rowName = row?.querySelector(".cairn-item-title")?.textContent.trim() ?? null;
      row?.querySelector('[data-action="itemDescription"]')?.click();
      await settle(300);
      out.panelText = row?.querySelector(".item-description")?.textContent.trim() ?? null;

      // ---- scars: two visible strings localized, the stored value English ----
      const opt = [...(root?.querySelectorAll(".scar-option") ?? [])]
        .find((l) => l.querySelector(".scar-check")?.value === scarEn);
      out.scarName = opt?.querySelector(".scar-name")?.textContent.trim() ?? null;
      out.scarDesc = opt?.querySelector(".scar-desc")?.textContent.trim() ?? null;
      out.scarValue = opt?.querySelector(".scar-check")?.value ?? null;
      out.scarOptionFound = !!opt;

      // ---- item sheet: Spanish to read, English to edit ----------------------
      // isEditable is TRUE here (a GM-owned world item) — the case that used to
      // fall back to English, and the only case a player ever sees.
      out.isEditable = item.sheet.isEditable;
      await item.sheet.render(true);
      for (let i = 0; i < 60 && !item.sheet.element; i++) await settle(100);
      await settle(400);
      const pm = item.sheet.element?.querySelector('prose-mirror[name="system.description"]');
      out.pmFound = !!pm;
      out.pmDisplay = pm?.querySelector(".editor-content")?.textContent.trim() ?? null;
      // The submitted half. Inactive, so `value` reads `_value` — the `value=`
      // attribute the template set from the STORED string (prosemirror-editor.mjs:192).
      out.pmValue = pm?.value ?? null;
      out.sheetTitle = item.sheet.title;
      await item.sheet.close();
      await settle(400);
      // Read the source AFTER closing: disconnectedCallback saves an ACTIVE editor,
      // so this is where a leaked translation would land if the split ever broke.
      out.storedDesc = item._source.system.description;
      out.storedName = item._source.name;
    } finally {
      i18n._setOverlay(null);
      await sheetOpen?.close().catch(() => {});
    }
    return out;
  });

  invActorId = inv.actorId;

  inv.rowName === inv.ES_NAME
    ? ok("row name translated", `"${inv.rowName}"`)
    : fail("row name translated", `row reads "${inv.rowName}"`);
  inv.panelText === inv.ES_DESC
    ? ok("expanded panel translated", `"${inv.panelText}"`)
    : fail("expanded panel translated", `panel reads ${JSON.stringify(inv.panelText)}, want "${inv.ES_DESC}"`);

  inv.scarEn && inv.scarDescEn
    ? ok("scar row has both strings", `"${inv.scarEn}"`)
    : fail("scar row has both strings", `text=${JSON.stringify(inv.scarEn)} detail=${JSON.stringify(inv.scarDescEn)} — assertions below are vacuous`);
  inv.scarOptionFound
    ? ok("scar option rendered", "")
    : fail("scar option rendered", "no .scar-option whose value is the English scar text");
  inv.scarName === inv.ES_SCAR
    ? ok("scar name translated", `"${inv.scarName}"`)
    : fail("scar name translated", `reads ${JSON.stringify(inv.scarName)}`);
  inv.scarDesc === inv.ES_SCAR_DESC
    ? ok("scar detail translated", `"${inv.scarDesc}"`)
    : fail("scar detail translated", `reads ${JSON.stringify(inv.scarDesc)}`);
  inv.scarValue === inv.scarEn
    ? ok("scar checkbox value English", "system.scars stays language-independent")
    : fail("scar checkbox value English", `value is ${JSON.stringify(inv.scarValue)}`);

  inv.isEditable
    ? ok("item sheet is editable", "the case that used to stay English")
    : fail("item sheet is editable", "probe is testing the read-only path, not the reported one");
  inv.pmFound
    ? ok("editor found", "")
    : fail("editor found", "no prose-mirror[name=system.description]");
  inv.pmDisplay === inv.ES_DESC
    ? ok("editor DISPLAY translated", `"${inv.pmDisplay}"`)
    : fail("editor DISPLAY translated", `shows ${JSON.stringify(inv.pmDisplay)}`);
  inv.pmValue === inv.EN_DESC
    ? ok("editor VALUE English", "what activation loads and a submit sends")
    : fail("editor VALUE English", `value is ${JSON.stringify(inv.pmValue)} — the Spanish can reach the document`);
  inv.sheetTitle?.includes(inv.ES_NAME)
    ? ok("window title translated", `"${inv.sheetTitle}"`)
    : fail("window title translated", `title is ${JSON.stringify(inv.sheetTitle)}`);
  inv.storedDesc === inv.EN_DESC && inv.storedName === inv.EN_NAME
    ? ok("STORED item untouched", "name and description still English after close")
    : fail("STORED item untouched", `name=${JSON.stringify(inv.storedName)} desc=${JSON.stringify(inv.storedDesc)}`);
} catch (e) {
  fail("sheet surfaces", `${e.name}: ${e.message}`);
} finally {
  // From NODE, for the reason stated above.
  if (invActorId) {
    await page.evaluate(async (id) => { await game.actors.get(id)?.delete(); }, invActorId)
      .catch(() => {});
  }
}

/* -------------------------------------------- */

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
if (errors.length) failures++;

await browser.close();
console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);
