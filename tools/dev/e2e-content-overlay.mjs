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
  const DESC_EN = "Probe table description — canonical English";
  const DESC_ES = "Probe table description — OVERLAY APPLIED";
  const NAME_ES = "ZZ-TABLA-TRADUCIDA";
  const created = [];
  try {
    // A world table, not a pack one: exact control of the string, no locked pack,
    // and 1d1 over a single result means the draw is deterministic.
    const table = await RollTable.create({
      name: "Content Overlay Probe",
      description: DESC_EN,
      formula: "1d1",
      replacement: true,
      results: [{ type: CONST.TABLE_RESULT_TYPES.TEXT, description: EN, range: [1, 1] }],
    });
    created.push(table);

    i18n._setOverlay({
      "table.result": { [EN]: ES },
      "table.desc": { [DESC_EN]: DESC_ES },
      "table.name": { "Content Overlay Probe": NAME_ES },
    });
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

    // ---- the table SHEET: VIEW mode translates, EDIT mode shows the source ----
    // 14.365's RollTableSheet renders a read-only "view" mode (the sticky
    // default for any table with rows, and the only mode a locked pack table
    // can reach). It is not a form, so display-only translation is safe there;
    // edit mode must keep the stored English, same read/edit split as every
    // other overlay surface.
    table.sheet.mode = "view";
    await table.sheet.render(true);
    for (let i = 0; i < 40 && !table.sheet.element?.querySelector("td.details"); i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const sroot = table.sheet.element;
    const view = {
      rows: [...(sroot?.querySelectorAll("td.details") ?? [])].map((e) => e.textContent).join(" "),
      h1: sroot?.querySelector(".sheet-header h1")?.textContent.trim() ?? null,
      title: sroot?.querySelector(".window-title")?.textContent.trim() ?? null,
      text: sroot?.textContent ?? "",
    };
    // The stored document must be untouched by a translated render.
    const storedTable = {
      name: table._source.name,
      desc: table._source.description ?? "",
      row: table.results.contents[0]._source.description,
    };
    // The mode setter is STICKY session-wide (#DEFAULT_MODE), so it is put back
    // to "view" in the finally — a probe must not leave every later sheet
    // opening in edit mode.
    table.sheet.mode = "edit";
    await table.sheet.render(true);
    for (let i = 0; i < 40 && !table.sheet.element?.querySelector('input[name="results.0.weight"]'); i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const edit = {
      rows: [...(table.sheet.element?.querySelectorAll("td.details") ?? [])].map((e) => e.textContent).join(" "),
    };
    await table.sheet.close();

    return {
      EN, ES, DESC_EN, DESC_ES, NAME_ES,
      renderedHasES: renderedText.includes(ES),
      renderedHasEN: renderedText.includes(EN),
      renderedDescES: renderedText.includes(DESC_ES),
      renderedDescEN: renderedText.includes(DESC_EN),
      storedHasES: storedContent.includes(ES),
      storedHasEN: storedContent.includes(EN),
      view, edit, storedTable,
      foundNode: !!node,
      msgId: msg.id,
    };
  } finally {
    for (const d of created) {
      try { if (d.sheet?.mode === "edit") d.sheet.mode = "view"; } catch {}
      await d.delete().catch(() => {});
    }
    i18n._setOverlay(null);
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

  // The card's table-description header (table.desc, 2026-08-06).
  if (res.renderedDescES && !res.renderedDescEN) ok("card table-description translated", `"${res.DESC_ES}"`);
  else fail("card table-description translated", `ES ${res.renderedDescES}, EN still ${res.renderedDescEN}`);

  // The RollTable sheet, view mode — rows, name (body + window title), description.
  const v = res.view ?? {};
  if (v.rows?.includes(res.ES) && !v.rows.includes(res.EN)) ok("sheet VIEW rows translated", `"${res.ES}"`);
  else fail("sheet VIEW rows translated", `details read ${JSON.stringify(v.rows)}`);
  if (v.h1 === res.NAME_ES) ok("sheet VIEW name translated", `"${v.h1}"`);
  else fail("sheet VIEW name translated", `h1 reads ${JSON.stringify(v.h1)}`);
  if (v.title === res.NAME_ES) ok("…and the window title agrees", `"${v.title}"`);
  else fail("…and the window title agrees", `title reads ${JSON.stringify(v.title)}`);
  // No sheet-description leg on purpose: 14.365 drops a root part's loose text
  // nodes (handlebars-application.mjs:213), so a plain-text table description
  // never renders in view mode — the DRAW CARD above is that string's surface.

  // The stored table after a translated render — the invariant half.
  const st = res.storedTable ?? {};
  if (st.name === "Content Overlay Probe" && st.desc === res.DESC_EN && st.row === res.EN)
    ok("stored table untouched by VIEW render", "");
  else fail("stored table untouched by VIEW render", JSON.stringify(st));

  // Edit mode is the author's view of the SOURCE — never translated.
  const e = res.edit ?? {};
  if (e.rows?.includes(res.EN) && !e.rows.includes(res.ES)) ok("sheet EDIT mode shows the English source", "");
  else fail("sheet EDIT mode shows the English source", `details read ${JSON.stringify(e.rows)}`);
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
    const EN_RECHARGE = "ZZ leave the rope coiled under a new moon.";
    const ES_NAME = "ZZ-CUERDA-SONDA";
    const ES_DESC = "ZZ-DESCRIPCION-TRADUCIDA";
    const ES_RECHARGE = "ZZ-RECARGA-TRADUCIDA";
    const ES_SCAR = "ZZ-CICATRIZ";
    const ES_SCAR_DESC = "ZZ-DETALLE-DE-CICATRIZ";

    const actor = await CONFIG.Actor.documentClass.create({
      name: "ZZ Overlay Sheet Probe", type: "character",
      system: { contentSource: "2e", scarEnabled: true },
    });
    const out = { actorId: actor.id, EN_NAME, EN_DESC, EN_RECHARGE, ES_NAME, ES_DESC, ES_RECHARGE, ES_SCAR, ES_SCAR_DESC };
    let sheetOpen = null;
    try {
      // `relic: true` so the item sheet grows its Recharge tab — the panel line
      // itself keys on the recharge TEXT, like the Charges relabel does.
      const [item] = await actor.createEmbeddedDocuments("Item", [
        { name: EN_NAME, type: "item", system: { description: EN_DESC, relic: true, recharge: EN_RECHARGE } },
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
        "item.recharge": { [norm(EN_RECHARGE)]: ES_RECHARGE },
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
      const panel = row?.querySelector(".item-description");
      out.panelText = panel?.textContent.trim() ?? null;
      // The recharge line (issue #22), anchored by its icon — the whole-panel
      // text above now carries description AND recharge, so the desc leg below
      // asserts membership plus the English's absence rather than equality.
      out.panelRecharge = panel?.querySelector(".fa-arrows-rotate")
        ?.closest("div")?.textContent.trim() ?? null;

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
      // The Recharge tab's editor, same display/value split as the description
      // (issue #22: the field joined the overlay, so the tab must read Spanish
      // while a submit still sends the stored English).
      const pmR = item.sheet.element?.querySelector('prose-mirror[name="system.recharge"]');
      out.pmRechargeFound = !!pmR;
      out.pmRechargeDisplay = pmR?.querySelector(".editor-content")?.textContent.trim() ?? null;
      out.pmRechargeValue = pmR?.value ?? null;
      out.sheetTitle = item.sheet.title;
      await item.sheet.close();
      await settle(400);
      // Read the source AFTER closing: disconnectedCallback saves an ACTIVE editor,
      // so this is where a leaked translation would land if the split ever broke.
      out.storedDesc = item._source.system.description;
      out.storedRecharge = item._source.system.recharge;
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
  inv.panelText?.includes(inv.ES_DESC) && !inv.panelText?.includes(inv.EN_DESC)
    ? ok("expanded panel translated", `"${inv.panelText}"`)
    : fail("expanded panel translated", `panel reads ${JSON.stringify(inv.panelText)}, want "${inv.ES_DESC}" and no English`);
  inv.panelRecharge === inv.ES_RECHARGE && !inv.panelText?.includes(inv.EN_RECHARGE)
    ? ok("panel recharge line translated (issue #22)", `"${inv.panelRecharge}"`)
    : fail("panel recharge line translated (issue #22)",
      `line reads ${JSON.stringify(inv.panelRecharge)}, want "${inv.ES_RECHARGE}" and no English`);

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
  inv.pmRechargeFound
    ? ok("recharge editor found", "system.relic grew the tab")
    : fail("recharge editor found", "no prose-mirror[name=system.recharge]");
  inv.pmRechargeDisplay === inv.ES_RECHARGE
    ? ok("recharge DISPLAY translated (issue #22)", `"${inv.pmRechargeDisplay}"`)
    : fail("recharge DISPLAY translated (issue #22)", `shows ${JSON.stringify(inv.pmRechargeDisplay)}`);
  inv.pmRechargeValue === inv.EN_RECHARGE
    ? ok("recharge VALUE English", "the same display/value split as the description")
    : fail("recharge VALUE English", `value is ${JSON.stringify(inv.pmRechargeValue)}`);
  inv.sheetTitle?.includes(inv.ES_NAME)
    ? ok("window title translated", `"${inv.sheetTitle}"`)
    : fail("window title translated", `title is ${JSON.stringify(inv.sheetTitle)}`);
  inv.storedDesc === inv.EN_DESC && inv.storedName === inv.EN_NAME && inv.storedRecharge === inv.EN_RECHARGE
    ? ok("STORED item untouched", "name, description and recharge still English after close")
    : fail("STORED item untouched", `name=${JSON.stringify(inv.storedName)} desc=${JSON.stringify(inv.storedDesc)} recharge=${JSON.stringify(inv.storedRecharge)}`);
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

// Round 2 of "surfaces that never asked" — the 2026-08-02 review's localization
// batch. Same discipline as the section above: every read surface gets a
// sentinel through _setOverlay, and every display/value split is asserted from
// BOTH ends — the visible copy shows the sentinel, the stored copy stays the
// English source. All documents are throwaway, created and deleted from Node.
console.log("\nreview batch: bg details, npc sheet, shop rows+toasts, monster-gen bake");

const cleanupIds = [];
try {
  const r2 = await page.evaluate(async () => {
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    const { sourceLabel } = await import("/systems/air-bladder/module/utils.js");
    const norm = (s) => String(s).replace(/\s+/g, " ").trim();
    const settle = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = { ids: [] };

    try {
      // ---- the locked background sheet's Details tab -----------------------
      const bg = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())[0];
      const q0 = bg.system.tables?.[0]?.question ?? "";
      const o0 = bg.system.tables?.[0]?.options?.[0]?.description ?? "";
      out.bgHasStrings = !!(q0 && o0);

      i18n._setOverlay({
        "bg.question": { [norm(q0)]: "ZZ-PREGUNTA" },
        "bg.optionDesc": { [norm(o0)]: "ZZ-OPCION" },
      });
      await bg.sheet.render(true);
      for (let i = 0; i < 60 && !bg.sheet.element; i++) await settle(100);
      await settle(400);
      const bgRoot = bg.sheet.element;
      out.bgEditable = bg.sheet.isEditable; // must be FALSE — the branch under test
      out.bgQuestion = [...(bgRoot?.querySelectorAll(".background-table h3") ?? [])]
        .map((h) => h.textContent.trim()).find((s) => s.includes("ZZ-")) ?? null;
      out.bgOption = [...(bgRoot?.querySelectorAll(".background-table li") ?? [])]
        .map((li) => li.textContent.trim()).find((s) => s.includes("ZZ-")) ?? null;
      out.bgSource = bgRoot?.querySelector(".background-source")?.textContent ?? "";
      out.bgSourceWant = sourceLabel(bg.system.source || "2e");
      await bg.sheet.close();

      // ---- a PERSON npc: title, description display+value, career round-trip -
      const EN_DESC = "<p>A probe person of no fixed abode.</p>";
      const person = await CONFIG.Actor.documentClass.create({
        name: "ZZ Overlay Person", type: "npc",
        system: { role: "npc", profession: "Blacksmith", description: EN_DESC },
      });
      out.ids.push(person.id);

      i18n._setOverlay({
        "monster.name": { "ZZ Overlay Person": "ZZ-PERSONA" },
        "monster.desc": { [norm(EN_DESC)]: "<p>ZZ-DESCRIPCION-PNJ</p>" },
        "npc.career": { Blacksmith: "ZZ-HERRERO", "Animal Handler": "ZZ-CAZADOR" },
      });

      await person.sheet.render(true);
      for (let i = 0; i < 60 && !person.sheet.element; i++) await settle(100);
      await settle(500);
      const pRoot = person.sheet.element;
      out.personTitle = person.sheet.title;
      const pm = pRoot?.querySelector('.npc-description-section prose-mirror[name="system.description"]');
      out.pmFound = !!pm;
      out.pmToggled = pm?.hasAttribute("toggled") ?? false;
      // The description content reads 2px larger than core's 14 (2026-08-02).
      out.pmFontSize = pm ? parseFloat(getComputedStyle(pm).fontSize) : null;
      out.pmDisplay = pm?.querySelector(".editor-content")?.textContent.trim() ?? null;
      out.pmValue = pm?.value ?? null; // inactive → the submitted _value

      await person.sheet.close();

      // The CAREER input belongs to the HIRELING since the 2026-08-20 split —
      // the npc sheet shows Background, not Career, so this pass's original
      // role-npc fixture stopped rendering the input the day the split landed
      // (its two legs sat red until 2026-08-21, when this probe ran as an
      // issue-#22 neighbor). Same overlay, its own fixture.
      const hire = await CONFIG.Actor.documentClass.create({
        name: "ZZ Overlay Hireling", type: "npc",
        system: { role: "hireling", profession: "Blacksmith" },
      });
      out.ids.push(hire.id);
      await hire.sheet.render(true);
      for (let i = 0; i < 60 && !hire.sheet.element; i++) await settle(100);
      await settle(500);
      const careerInput = hire.sheet.element?.querySelector('input[name="system.profession"]');
      out.careerShown = careerInput?.value ?? null;
      // The submit half: leave a DIFFERENT translated label in the box, commit,
      // and the document must store that career's ENGLISH source.
      if (careerInput) {
        careerInput.value = "ZZ-CAZADOR";
        careerInput.dispatchEvent(new Event("change", { bubbles: true }));
        await settle(700);
      }
      out.careerStored = hire.system.profession;
      await hire.sheet.close();

      // ---- a CONTAINER npc: the Type select shows the label, stores the key.
      // The control is a strict select since 2026-08-02, with free text behind
      // its "Other…" row — so the display half is the selected OPTION's text,
      // and the label→key round-trip runs through the Other input, which is
      // the field's only free-text writer. Seeded "crate" (funeralwagon is
      // retired; migrateData would rewrite it under the probe).
      const crate = await CONFIG.Actor.documentClass.create({
        name: "ZZ Overlay Crate", type: "npc",
        system: { role: "container", containerClass: "crate" },
      });
      out.ids.push(crate.id);
      await crate.sheet.render(true);
      for (let i = 0; i < 60 && !crate.sheet.element; i++) await settle(100);
      await settle(400);
      const kindSelect = crate.sheet.element?.querySelector(".kind-select");
      out.kindShown = kindSelect?.selectedOptions?.[0]?.textContent?.trim() ?? null;
      out.kindLabelWant = game.i18n.localize("CAIRN.ClassCrate");
      // Committing a LABEL through the Other input must store the KEY back…
      out.kindOtherLabel = game.i18n.localize("CAIRN.ClassBarrel");
      if (kindSelect) {
        kindSelect.value = "__other__";
        kindSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await settle(300);
        const kindInput = crate.sheet.element?.querySelector(".kind-input");
        if (kindInput) {
          kindInput.value = out.kindOtherLabel;
          kindInput.dispatchEvent(new Event("change", { bubbles: true }));
          await settle(700);
        }
      }
      out.kindStoredAfterLabel = crate.system.containerClass;
      // …and a Warden's own word must pass through verbatim, same path.
      const kindSelect2 = crate.sheet.element?.querySelector(".kind-select");
      if (kindSelect2) {
        kindSelect2.value = "__other__";
        kindSelect2.dispatchEvent(new Event("change", { bubbles: true }));
        await settle(300);
        const kindInput2 = crate.sheet.element?.querySelector(".kind-input");
        if (kindInput2) {
          kindInput2.value = "ZZ Weird Basket";
          kindInput2.dispatchEvent(new Event("change", { bubbles: true }));
          await settle(700);
        }
      }
      out.kindStoredCustom = crate.system.containerClass;
      // The English-in-a-translated-world half (review #13 #9). The matcher's
      // comment always promised "any language" while the compare ran
      // localize() alone — active language only. Reproduce a Spanish client's
      // exact shape in-page: the ACTIVE translation for one class label made
      // non-English, English stuffed into game.i18n._fallback (empty on an
      // English client, populated on every translated one — the same object
      // core's own fallback path reads, helpers/localization.mjs:394). Typing
      // the ENGLISH label must still land the KEY with the class's art and
      // capacity behind it; the old compare fell through to verbatim-custom
      // and stored "Sack" as a Warden's own word.
      const priorActive = foundry.utils.getProperty(game.i18n.translations, "CAIRN.ClassSack");
      const priorFallback = foundry.utils.getProperty(game.i18n._fallback, "CAIRN.ClassSack");
      foundry.utils.setProperty(game.i18n.translations, "CAIRN.ClassSack", "ZZ-SACO");
      foundry.utils.setProperty(game.i18n._fallback, "CAIRN.ClassSack", "Sack");
      try {
        const kindSelect3 = crate.sheet.element?.querySelector(".kind-select");
        if (kindSelect3) {
          kindSelect3.value = "__other__";
          kindSelect3.dispatchEvent(new Event("change", { bubbles: true }));
          await settle(300);
          const kindInput3 = crate.sheet.element?.querySelector(".kind-input");
          if (kindInput3) {
            kindInput3.value = "Sack";
            kindInput3.dispatchEvent(new Event("change", { bubbles: true }));
            await settle(700);
          }
        }
        out.kindStoredEnglish = crate.system.containerClass;
      } finally {
        foundry.utils.setProperty(game.i18n.translations, "CAIRN.ClassSack", priorActive);
        if (priorFallback === undefined) delete game.i18n._fallback?.CAIRN?.ClassSack;
        else foundry.utils.setProperty(game.i18n._fallback, "CAIRN.ClassSack", priorFallback);
      }
      await crate.sheet.close();
      // Restore a known key so the connections-row leg below shows a Kinded crate.
      await crate.update({ "system.containerClass": "crate" });

      // ---- connections row + omen + failed career on a character ------------
      const pc = await CONFIG.Actor.documentClass.create({
        name: "ZZ Overlay Keeper", type: "character",
        system: {
          contentSource: "2e", omenEnabled: false, omen: "Probe omen of the ZZ moon.",
          failedCareer: "Gravedigger",
        },
      });
      out.ids.push(pc.id);
      await pc.createEmbeddedDocuments("Item", [
        { name: "ZZ Muddy Shovel", type: "item", flags: { "air-bladder": { grantSource: "failed-career" } } },
      ]);
      await crate.update({ "system.connectedTo": pc.uuid });

      i18n._setOverlay({
        "monster.name": { "ZZ Overlay Crate": "ZZ-CAJA" },
        "table.result": { "Probe omen of the ZZ moon.": "ZZ-PRESAGIO" },
        "bg.name": { Gravedigger: "ZZ-ENTERRADOR" },
        "item.name": { "ZZ Muddy Shovel": "ZZ-PALA" },
      });

      // Parked Connections UI (2026-08-09): the row the connRow leg reads
      // renders only under the in-page settings shadow. It stays on through
      // the omen legs (same rendered sheet) and comes off before the
      // marketplace section, which needs nothing from the tab.
      const origSettingsGet = game.settings.get;
      game.settings.get = function (ns2, key) {
        if (key === "connections-ui-enabled") return true;
        return origSettingsGet.call(this, ns2, key);
      };
      pc.prepareData();
      await pc.sheet.render(true);
      for (let i = 0; i < 60 && !pc.sheet.element; i++) await settle(100);
      await settle(500);
      const pcRoot = pc.sheet.element;
      out.connRow = [...(pcRoot?.querySelectorAll('[data-is-container="true"] .cairn-item-title') ?? [])]
        .map((a) => a.textContent.trim()).find((s) => s.includes("ZZ-")) ?? null;
      out.omenShown = pcRoot?.querySelector(".omen-display")?.textContent.trim() ?? null;
      out.omenStored = pc.system.omen;
      const ctx = await pc.sheet._prepareContext({});
      out.failedCareerCtx = ctx.failedCareer;
      out.failedCareerItemCtx = ctx.failedCareerItem;

      // ---- the omen TEXTAREA — the state a real character is in --------------
      // Rolling an omen requires the checkbox ON and unticking CLEARS the omen,
      // so the enabled textarea is the ONLY surface a character holding an omen
      // ever shows. The span leg above kept this gate green for two rounds while
      // every real player saw English — it asserts a state no UI path reaches.
      await pc.update({ "system.omenEnabled": true });
      let ta = null;
      for (let i = 0; i < 40 && !ta; i++) {
        await settle(150);
        ta = pc.sheet.element?.querySelector(".omen-input");
      }
      out.omenTextareaShown = ta?.value ?? null;
      // Untouched submit: a change event serializes the form at its DISPLAYED
      // values, textarea included; the anchor must land the stored English back.
      // Its positive witness that the dispatch actually submits is the edit leg
      // below — same event, same machinery, polled until the write lands.
      if (ta) {
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        await settle(800);
      }
      out.omenStoredAfterSubmit = pc.system.omen;
      // A player's own words pass verbatim — the anchor must not touch a real edit.
      const ta2 = pc.sheet.element?.querySelector(".omen-input");
      if (ta2) {
        ta2.value = "ZZ presagio del jugador.";
        ta2.dispatchEvent(new Event("change", { bubbles: true }));
        for (let i = 0; i < 40 && pc.system.omen !== "ZZ presagio del jugador."; i++) await settle(150);
      }
      out.omenStoredAfterEdit = pc.system.omen;
      await pc.sheet.close();
      game.settings.get = origSettingsGet;

      // ---- marketplace: gear row, TRANSPORT row, and the purchase toast ------
      const market = await import("/systems/air-bladder/module/marketplace.js");
      const catalog = await market.getMarketplaceCatalog();
      const carrierCat = catalog.categories.find((c) => c.items.some((d) => d.documentName === "Actor"));
      const carrierEn = carrierCat?.items.find((d) => d.documentName === "Actor")?.name ?? null;
      out.carrierEn = carrierEn;
      const gearCat = catalog.categories.find((c) => c.items.some((d) => d.name === "Rope"));
      out.gearFound = !!gearCat;

      i18n._setOverlay({
        "item.name": { Rope: "ZZ-CUERDA" },
        "monster.name": carrierEn ? { [carrierEn]: "ZZ-MULA" } : {},
      });

      const toasts = [];
      const origInfo = ui.notifications.info.bind(ui.notifications);
      ui.notifications.info = (msg, ...rest) => { toasts.push(String(msg)); return origInfo(msg, ...rest); };
      try {
        await market.openMarketplace(pc);
        for (let i = 0; i < 40 && !document.querySelector(".marketplace"); i++) await settle(150);
        await settle(500);
        const shop = document.querySelector(".marketplace");
        const names = [...(shop?.querySelectorAll(".mkt-name") ?? [])].map((e) => e.textContent.trim());
        out.shopGearRow = names.includes("ZZ-CUERDA");
        out.shopCarrierRow = carrierEn ? names.includes("ZZ-MULA") : null;
        const row = [...(shop?.querySelectorAll(".mkt-row") ?? [])]
          .find((rw) => rw.querySelector(".mkt-name")?.textContent.trim() === "ZZ-CUERDA");
        row?.querySelector(".mkt-take")?.click();
        await settle(800);
        out.toast = toasts.find((m) => m.includes("ZZ-CUERDA")) ?? toasts.at(-1) ?? null;
        out.storedBought = pc.items.find((i2) => i2.name === "Rope")?.name ?? null;
        shop?.closest(".application")?.querySelector('[data-action="close"]')?.click();
        await settle(300);
      } finally {
        ui.notifications.info = origInfo;
      }

      // ---- monster generation bakes the DISPLAY language --------------------
      // Overlay every row of the two appearance tables, so whatever the dice do,
      // a translated fragment must reach the name and the description.
      const gen = await import("/systems/air-bladder/module/monster-generator.js");
      const wm = await game.packs.get("air-bladder.warden-monsters").getDocuments();
      const rows = {};
      for (const tbl of wm) {
        if (!/Physique|Feature/.test(tbl.name)) continue;
        for (const r of tbl.results) {
          const en = r.type === "text" ? r.description : r.name;
          if (en) rows[norm(en)] = `ZZ-${en}`;
        }
      }
      out.appearanceRows = Object.keys(rows).length;
      i18n._setOverlay({ "table.result": rows });
      const monster = await gen.generateMonster("standard");
      out.monsterName = monster.name;
      // Case-INSENSITIVE since 2026-08-02: the description bullets lowercase
      // every inserted result in the display language (sentence-style caps,
      // ruled), so the sentinel arrives as "zz-…". This leg asserts the
      // translation ARRIVED; the casing rules are dev:monster-gen's to own.
      out.monsterDescHasZZ = /zz-/i.test(monster.description ?? "");
    } finally {
      i18n._setOverlay(null);
    }
    return out;
  });

  cleanupIds.push(...(r2.ids ?? []));

  r2.bgHasStrings
    ? ok("bg fixture has strings", "")
    : fail("bg fixture has strings", "first background carries no question/option — legs below vacuous");
  r2.bgEditable === false
    ? ok("bg sheet is read-only", "the locked-pack branch under test")
    : fail("bg sheet is read-only", "sheet was editable — probe tested the WRONG branch");
  r2.bgQuestion === "ZZ-PREGUNTA"
    ? ok("bg question translated", `"${r2.bgQuestion}"`)
    : fail("bg question translated", `reads ${JSON.stringify(r2.bgQuestion)}`);
  r2.bgOption === "ZZ-OPCION"
    ? ok("bg option translated", `"${r2.bgOption}"`)
    : fail("bg option translated", `reads ${JSON.stringify(r2.bgOption)}`);
  r2.bgSource.includes(r2.bgSourceWant)
    ? ok("bg source is the derived label", `"${r2.bgSourceWant}"`)
    : fail("bg source is the derived label", `header reads ${JSON.stringify(r2.bgSource)}`);

  // ROLE-prefixed since 2026-08-02: "NPC: <display name>", not core's
  // "Non-Player Character: <name>" — the prefix says what the Role select
  // says, and the translated name still rides in it.
  r2.personTitle?.includes("ZZ-PERSONA") && r2.personTitle?.startsWith("NPC:")
    ? ok("npc window title: role prefix + translated name", `"${r2.personTitle}"`)
    : fail("npc window title: role prefix + translated name", `title is ${JSON.stringify(r2.personTitle)}`);
  r2.pmFound && r2.pmToggled
    ? ok("npc description editor is toggled", "the two-input split exists")
    : fail("npc description editor is toggled", `found=${r2.pmFound} toggled=${r2.pmToggled}`);
  r2.pmFontSize >= 16
    ? ok("description content reads at 16px", `${r2.pmFontSize}px`)
    : fail("description content reads at 16px", `${r2.pmFontSize}px — the bump rule is not landing`);
  r2.pmDisplay?.includes("ZZ-DESCRIPCION-PNJ")
    ? ok("npc description DISPLAY translated", `"${r2.pmDisplay}"`)
    : fail("npc description DISPLAY translated", `shows ${JSON.stringify(r2.pmDisplay)}`);
  r2.pmValue?.includes("no fixed abode")
    ? ok("npc description VALUE English", "what activation loads and a submit sends")
    : fail("npc description VALUE English", `value is ${JSON.stringify(r2.pmValue)}`);
  r2.careerShown === "ZZ-HERRERO"
    ? ok("career input shows the label", `"${r2.careerShown}"`)
    : fail("career input shows the label", `shows ${JSON.stringify(r2.careerShown)}`);
  r2.careerStored === "Animal Handler"
    ? ok("career stores the English source", `committed "ZZ-CAZADOR" → "${r2.careerStored}"`)
    : fail("career stores the English source", `stored ${JSON.stringify(r2.careerStored)} — the match key is broken`);

  r2.kindShown === r2.kindLabelWant && r2.kindShown !== "crate"
    ? ok("the Type select shows the label", `"${r2.kindShown}"`)
    : fail("the Type select shows the label", `shows ${JSON.stringify(r2.kindShown)}, want ${JSON.stringify(r2.kindLabelWant)}`);
  r2.kindStoredAfterLabel === "barrel"
    ? ok("a label typed behind Other round-trips to the key", `"${r2.kindOtherLabel}" → "barrel"`)
    : fail("a label typed behind Other round-trips to the key", `stored ${JSON.stringify(r2.kindStoredAfterLabel)}`);
  r2.kindStoredCustom === "ZZ Weird Basket"
    ? ok("a Warden's own Kind passes verbatim", "through the Other input")
    : fail("a Warden's own Kind passes verbatim", `stored ${JSON.stringify(r2.kindStoredCustom)}`);
  r2.kindStoredEnglish === "sack"
    ? ok("the ENGLISH label lands the key in a translated world", '"Sack" → "sack" with the active label ZZ-SACO')
    : fail("the ENGLISH label lands the key in a translated world",
      `stored ${JSON.stringify(r2.kindStoredEnglish)} — the matcher compared the active language alone (review #13 #9)`);

  r2.connRow?.includes("ZZ-CAJA")
    ? ok("connections row translated", `"${r2.connRow}"`)
    : fail("connections row translated", `row reads ${JSON.stringify(r2.connRow)}`);
  r2.omenShown === "ZZ-PRESAGIO"
    ? ok("omen display translated", `"${r2.omenShown}"`)
    : fail("omen display translated", `reads ${JSON.stringify(r2.omenShown)}`);
  r2.omenStored === "Probe omen of the ZZ moon."
    ? ok("omen STORED stays English", "")
    : fail("omen STORED stays English", `stored ${JSON.stringify(r2.omenStored)}`);
  r2.omenTextareaShown === "ZZ-PRESAGIO"
    ? ok("omen TEXTAREA shows the translation", `"${r2.omenTextareaShown}"`)
    : fail("omen TEXTAREA shows the translation", `value ${JSON.stringify(r2.omenTextareaShown)}`);
  r2.omenStoredAfterSubmit === "Probe omen of the ZZ moon."
    ? ok("omen untouched submit round-trips to English", "")
    : fail("omen untouched submit round-trips to English", `stored ${JSON.stringify(r2.omenStoredAfterSubmit)}`);
  r2.omenStoredAfterEdit === "ZZ presagio del jugador."
    ? ok("omen player edit stores verbatim", "")
    : fail("omen player edit stores verbatim", `stored ${JSON.stringify(r2.omenStoredAfterEdit)}`);
  r2.failedCareerCtx === "ZZ-ENTERRADOR" && r2.failedCareerItemCtx === "ZZ-PALA"
    ? ok("failed career + keepsake translated", `"${r2.failedCareerCtx}", "${r2.failedCareerItemCtx}"`)
    : fail("failed career + keepsake translated", `${JSON.stringify(r2.failedCareerCtx)} / ${JSON.stringify(r2.failedCareerItemCtx)}`);

  r2.gearFound
    ? ok("shop stocks Rope", "")
    : fail("shop stocks Rope", "no Rope in the catalog — the two shop legs below are vacuous");
  r2.shopGearRow
    ? ok("shop gear row translated", '"ZZ-CUERDA"')
    : fail("shop gear row translated", "no row named ZZ-CUERDA");
  r2.carrierEn === null
    ? fail("shop carrier row translated", "no Actor row in the catalog — transport leg vacuous")
    : r2.shopCarrierRow
      ? ok("shop TRANSPORT row translated", `"${r2.carrierEn}" → "ZZ-MULA"`)
      : fail("shop TRANSPORT row translated", `no row named ZZ-MULA for "${r2.carrierEn}"`);
  r2.toast?.includes("ZZ-CUERDA")
    ? ok("purchase toast translated", `"${r2.toast}"`)
    : fail("purchase toast translated", `toast was ${JSON.stringify(r2.toast)}`);
  r2.storedBought === "Rope"
    ? ok("bought item STORED English", "the payload never translated")
    : fail("bought item STORED English", `stored ${JSON.stringify(r2.storedBought)}`);

  r2.appearanceRows > 0
    ? ok("appearance tables overlaid", `${r2.appearanceRows} rows`)
    : fail("appearance tables overlaid", "0 rows — monster-gen leg vacuous");
  r2.monsterName?.includes("ZZ-")
    ? ok("generated monster name in display language", `"${r2.monsterName}"`)
    : fail("generated monster name in display language", `name is ${JSON.stringify(r2.monsterName)}`);
  r2.monsterDescHasZZ
    ? ok("generated description in display language", "")
    : fail("generated description in display language", "no translated fragment reached the bullets");
} catch (e) {
  fail("review batch", `${e.name}: ${e.message}`);
} finally {
  // From NODE, unconditionally — a throw above must not leave probe actors for
  // the next run's preconditions to silently feed on.
  if (cleanupIds.length) {
    await page.evaluate(async (ids) => {
      for (const id of ids) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
    }, cleanupIds).catch(() => {});
  }
}

/* -------------------------------------------- */

console.log("\nthe Create Mount clone group");

// The six named horses sat in raw English inside a TRANSLATED group heading,
// between TRANSLATED kind labels — the one list on that select that never asked
// the overlay (review #7 finding 8). They moved to `monster.name` when mounts
// stopped being Items, so the strings exist; nothing looked them up.
const mountLeg = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (test()) return true; await sleep(150); }
    return test();
  };
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const ES = "ZZ Destrero Traducido";
  i18n._setOverlay({ "monster.name": { "Heavy Destrier": ES } });

  // Not awaited: createThing resolves only when the dialog is answered.
  const pending = CONFIG.Actor.documentClass.createThing("companion");
  let form = null;
  await until(() => {
    form = [...document.querySelectorAll("dialog form")].find((f) => f.elements?.thingName);
    return !!form;
  });
  const out = { ES, opened: !!form };
  if (form) {
    const select = form.elements.kindChoice;
    const opts = [...select.querySelectorAll("optgroup option")];
    out.optionTexts = opts.map((o) => o.textContent);
    out.translatedShown = opts.some((o) => o.textContent === ES);
    out.englishShown = opts.some((o) => o.textContent === "Heavy Destrier");
    // The VALUE is the sentinel and must not move with the language — it is
    // what the clone branch resolves the document from.
    const opt = opts.find((o) => o.textContent === ES);
    out.sentinelStable = String(opt?.value ?? "").startsWith("doc:");
    // The prefill follows what the Warden read, not the English behind it.
    if (opt) {
      select.value = opt.value;
      select.dispatchEvent(new Event("change"));
      out.namePrefilled = form.elements.thingName.value;
    }
    form.closest("dialog")?.querySelector('[data-action="close"]')?.click();
    await until(() => ![...document.querySelectorAll("dialog form")].some((f) => f.elements?.thingName));
  }
  await pending.catch(() => {});
  i18n._setOverlay(null);
  return out;
});

mountLeg.opened && mountLeg.translatedShown && !mountLeg.englishShown
  ? ok("named mounts render through the overlay", `“${mountLeg.ES}”`)
  : fail("named mounts render through the overlay", JSON.stringify(mountLeg));
mountLeg.sentinelStable
  ? ok("the option VALUE stays the doc: sentinel", "display only; the clone still resolves")
  : fail("the option VALUE stays the doc: sentinel", JSON.stringify(mountLeg.optionTexts));
mountLeg.namePrefilled === mountLeg.ES
  ? ok("the name prefills with what was READ", mountLeg.namePrefilled)
  : fail("the name prefills with what was READ", `"${mountLeg.namePrefilled}"`);

/* -------------------------------------------- */

console.log("\nround 5: the NAME INPUT, and the PC exclusion");

// Malecho, 2026-08-04: "item titles are still not changing". The window title
// localized and the name field under it did not — one sheet, two answers, the
// same tell as round 1. Round 1 had recorded that the name input deliberately
// stayed English for want of a display/value split; round 2 built that split
// (sourceOf), so the reason had expired without the entry being revisited.
//
// Every leg here asserts BOTH ends, because the failure this fix can introduce
// is worse than the one it removes: a name silently rewritten breaks
// resolveGearItem, background grants and check:refs' 394-name assertion.
//
// THE OVERLAY HERE IS DELIBERATELY MANY-TO-ONE, because the shipped one is
// (review 2026-08-04: Lute and Lure are both "Señuelo"; Stylus shows "Punzón",
// which is also Awl's translation — seven collisions in the real es.json). A
// DECOY entry sharing each sentinel translation sits FIRST in its namespace,
// which is exactly the entry a reverse SEARCH returns. The submit must be
// ANCHORED on "does the value equal what the sheet displays for the stored
// name" — under the reverse-search code these legs go red with the item
// renamed to the decoy, which is the bug as shipped for one commit.
//
// The PC legs are the CONTROL, and they are the ruling: a character's name is
// player-authored and is never localized. They share the probe's sentinel with
// the monster legs — the same overlay is live for both — so "the PC was left
// alone" cannot pass merely because no overlay was installed.
const nameLeg = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const out = { ids: { items: [], actors: [] } };

  const EN_ITEM = "ZZ Overlay Dagger";
  const EN_MONSTER = "ZZ Overlay Beast";
  // A PC named EXACTLY what the overlay translates. Nothing else proves the
  // exclusion: a PC whose name is absent from the namespace is left alone by
  // t() anyway, so the leg would pass with the gate deleted.
  const ES_ITEM = "ZZ-DAGA";
  const ES_MONSTER = "ZZ-BESTIA";
  // A monster whose STORED name is a baked display-language string (the Create
  // Mount clone writes these on purpose — actor.js's recorded exception). It
  // has no overlay entry of its own, but ANOTHER English name translates to
  // it — the shape under which the reverse search un-baked "Destrero pesado"
  // to "Heavy Destrier" on the first HP edit.
  const BAKED = "ZZ-BESTIA-HORNEADA";

  const item = await CONFIG.Item.documentClass.create({ name: EN_ITEM, type: "weapon" });
  const monster = await CONFIG.Actor.documentClass.create({
    name: EN_MONSTER, type: "npc", system: { role: "monster" },
  });
  const baked = await CONFIG.Actor.documentClass.create({
    name: BAKED, type: "npc", system: { role: "mount" },
  });
  const pc = await CONFIG.Actor.documentClass.create({ name: EN_MONSTER, type: "character" });
  out.ids.items.push(item.id);
  out.ids.actors.push(monster.id, baked.id, pc.id);

  i18n._setOverlay({
    // Decoys FIRST: Object.entries iterates insertion order, so a reverse
    // search hits the decoy before the real entry every time.
    "item.name": { "ZZ Decoy Item": ES_ITEM, [EN_ITEM]: ES_ITEM, "ZZ Other Thing": "ZZ-OTRA" },
    "monster.name": { "ZZ Decoy Beast": ES_MONSTER, [EN_MONSTER]: ES_MONSTER, "ZZ Beast EN": BAKED },
  });

  const open = async (doc) => {
    await doc.sheet.render(true);
    for (let i = 0; i < 60 && !doc.sheet.element; i++) await sleep(100);
    await sleep(400);
    return doc.sheet.element;
  };

  // ---- the item sheet: display, then the round trip ------------------------
  const iRoot = await open(item);
  out.itemShown = iRoot?.querySelector('input[name="name"]')?.value ?? null;
  out.itemTitle = item.sheet.title;
  // Commit an UNRELATED field. The name was never touched, so a correct submit
  // maps the displayed Spanish back to English and the document does not move.
  // This is the exact path submitOnChange takes on every keystroke elsewhere.
  const bulky = iRoot?.querySelector('input[name="system.bulky"]');
  if (bulky) { bulky.checked = true; bulky.dispatchEvent(new Event("change", { bubbles: true })); await sleep(700); }
  out.itemStoredAfterUnrelatedEdit = item.name;
  // TYPING a string that happens to be some OTHER entry's translation must
  // store VERBATIM — a rename is the Warden's, in whatever language they typed
  // it. The reverse-search code silently swapped "ZZ-OTRA" for "ZZ Other
  // Thing" here, which is the "typed Escudo, got Shield" case.
  const nameInput = item.sheet.element?.querySelector('input[name="name"]');
  if (nameInput) {
    nameInput.value = "ZZ-OTRA";
    nameInput.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(700);
  }
  out.itemStoredAfterTypedTranslation = item.name;
  // A plain rename must survive verbatim too.
  const nameInput2 = item.sheet.element?.querySelector('input[name="name"]');
  if (nameInput2) {
    nameInput2.value = "ZZ Warden Renamed This";
    nameInput2.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(700);
  }
  out.itemStoredAfterRename = item.name;
  await item.sheet.close();

  // ---- a monster: same split, monster.name ---------------------------------
  const mRoot = await open(monster);
  out.monsterShown = mRoot?.querySelector('input[name="name"]')?.value ?? null;
  out.monsterTitle = monster.sheet.title;
  const str = mRoot?.querySelector('input[name="system.abilities.STR.value"]');
  if (str) { str.value = "9"; str.dispatchEvent(new Event("change", { bubbles: true })); await sleep(700); }
  out.monsterStoredAfterUnrelatedEdit = monster.name;
  await monster.sheet.close();

  // ---- a BAKED display-language name must not be un-baked ------------------
  const bRoot = await open(baked);
  out.bakedShown = bRoot?.querySelector('input[name="name"]')?.value ?? null;
  const bStr = bRoot?.querySelector('input[name="system.abilities.STR.value"]');
  if (bStr) { bStr.value = "9"; bStr.dispatchEvent(new Event("change", { bubbles: true })); await sleep(700); }
  out.bakedStoredAfterUnrelatedEdit = baked.name;
  await baked.sheet.close();

  // ---- the PC control: same live overlay, same English name ----------------
  const pRoot = await open(pc);
  out.pcShown = pRoot?.querySelector('input[name="name"]')?.value ?? null;
  out.pcTitle = pc.sheet.title;
  const pcStr = pRoot?.querySelector('input[name="system.abilities.STR.value"]');
  if (pcStr) { pcStr.value = "9"; pcStr.dispatchEvent(new Event("change", { bubbles: true })); await sleep(700); }
  out.pcStoredAfterUnrelatedEdit = pc.name;
  await pc.sheet.close();

  i18n._setOverlay(null);
  Object.assign(out, { EN_ITEM, EN_MONSTER, ES_ITEM, ES_MONSTER, BAKED });
  return out;
});

try {
  nameLeg.itemShown === nameLeg.ES_ITEM
    ? ok("the item name field localizes", nameLeg.itemShown)
    : fail("the item name field localizes", `got "${nameLeg.itemShown}"`);
  nameLeg.itemTitle?.includes(nameLeg.ES_ITEM)
    ? ok("…and its window title agrees", nameLeg.itemTitle)
    : fail("…and its window title agrees", `got "${nameLeg.itemTitle}"`);
  nameLeg.itemStoredAfterUnrelatedEdit === nameLeg.EN_ITEM
    ? ok("unrelated edit keeps ENGLISH despite decoy", nameLeg.itemStoredAfterUnrelatedEdit)
    : fail("unrelated edit keeps ENGLISH despite decoy", `got "${nameLeg.itemStoredAfterUnrelatedEdit}"`);
  nameLeg.itemStoredAfterTypedTranslation === "ZZ-OTRA"
    ? ok("typing another entry's translation stores VERBATIM", nameLeg.itemStoredAfterTypedTranslation)
    : fail("typing another entry's translation stores VERBATIM", `got "${nameLeg.itemStoredAfterTypedTranslation}"`);
  nameLeg.itemStoredAfterRename === "ZZ Warden Renamed This"
    ? ok("a real rename still lands verbatim", nameLeg.itemStoredAfterRename)
    : fail("a real rename still lands verbatim", `got "${nameLeg.itemStoredAfterRename}"`);

  nameLeg.monsterShown === nameLeg.ES_MONSTER
    ? ok("the monster name field localizes", nameLeg.monsterShown)
    : fail("the monster name field localizes", `got "${nameLeg.monsterShown}"`);
  nameLeg.monsterStoredAfterUnrelatedEdit === nameLeg.EN_MONSTER
    ? ok("…and keeps ENGLISH despite decoy", nameLeg.monsterStoredAfterUnrelatedEdit)
    : fail("…and keeps ENGLISH despite decoy", `got "${nameLeg.monsterStoredAfterUnrelatedEdit}"`);
  nameLeg.bakedShown === nameLeg.BAKED
    ? ok("a baked display-language name displays as itself", nameLeg.bakedShown)
    : fail("a baked display-language name displays as itself", `got "${nameLeg.bakedShown}"`);
  nameLeg.bakedStoredAfterUnrelatedEdit === nameLeg.BAKED
    ? ok("…and is NOT un-baked to English on submit", nameLeg.bakedStoredAfterUnrelatedEdit)
    : fail("…and is NOT un-baked to English on submit", `got "${nameLeg.bakedStoredAfterUnrelatedEdit}"`);

  nameLeg.pcShown === nameLeg.EN_MONSTER
    ? ok("CONTROL: a PC name is NOT localized", `${nameLeg.pcShown} (overlay had ${nameLeg.ES_MONSTER})`)
    : fail("CONTROL: a PC name is NOT localized", `got "${nameLeg.pcShown}"`);
  !nameLeg.pcTitle?.includes(nameLeg.ES_MONSTER)
    ? ok("CONTROL: nor is its window title", nameLeg.pcTitle)
    : fail("CONTROL: nor is its window title", `got "${nameLeg.pcTitle}"`);
  nameLeg.pcStoredAfterUnrelatedEdit === nameLeg.EN_MONSTER
    ? ok("CONTROL: the PC name survives a submit", nameLeg.pcStoredAfterUnrelatedEdit)
    : fail("CONTROL: the PC name survives a submit", `got "${nameLeg.pcStoredAfterUnrelatedEdit}"`);
} finally {
  // From NODE, off the returned ids, so a failed assertion still tidies.
  await page.evaluate(async (ids) => {
    for (const id of ids.items) await game.items.get(id)?.delete().catch(() => {});
    for (const id of ids.actors) await game.actors.get(id)?.delete().catch(() => {});
  }, nameLeg.ids);
}

/* -------------------------------------------- */

// Search must match what the eye reads (review #9 finding 4): the render hook
// rewrites .entry-name to the translation, but core's _matchSearchEntries tests
// the query against collection.index names — never the DOM — so typing the
// Spanish emptied the list while the English string was no longer on screen.
// The control removes the per-instance wrap (delete falls back to the prototype,
// i.e. core's matcher) and requires the Spanish query to STOP matching — the
// in-page equivalent of running with the fix removed, every run.
console.log("\ncompendium search under a translated index");

const searchLeg = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pack = game.packs.get("air-bladder.weapons");
  await pack.getIndex();
  const dagger = pack.index.find((e) => e.name === "Dagger");
  const other = pack.index.find((e) => e.name !== "Dagger");
  const out = { indexed: !!dagger && !!other };
  if (!out.indexed) return out;
  const app = pack.apps[0];
  try {
    i18n._setOverlay({ "item.name": { Dagger: "ZZ-DAGA" } });
    await app.render(true);
    for (let i = 0; i < 60 && !app.element?.querySelector(`[data-entry-id="${dagger._id}"]`); i++) await sleep(100);
    const row = () => app.element?.querySelector(`[data-entry-id="${dagger._id}"]`);
    const otherRow = () => app.element?.querySelector(`[data-entry-id="${other._id}"]`);
    out.rowText = row()?.querySelector(".entry-name")?.textContent.trim() ?? null;

    const search = async (q) => {
      const input = app.element?.querySelector("search input, input[type=search]");
      if (!input) return "no search input";
      input.value = q;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(600); // SearchFilter debounces; a settle beats polling a moving target
      return { dagger: row()?.style.display, other: otherRow()?.style.display };
    };

    out.spanish = await search("ZZ-DAGA");
    out.english = await search("Dagger");
    // Control: core's matcher alone. The wrap is an instance own-property, so
    // deleting it exposes the prototype method; restored right after.
    const wrapped = app._matchSearchEntries;
    try {
      delete app._matchSearchEntries;
      out.control = await search("ZZ-DAGA");
    } finally {
      app._matchSearchEntries = wrapped;
    }
    await search("");
  } finally {
    i18n._setOverlay(null);
    await app.close().catch(() => {});
  }
  return out;
});

if (!searchLeg.indexed) fail("weapons pack indexed", "no Dagger + second weapon — search legs vacuous");
else {
  searchLeg.rowText === "ZZ-DAGA"
    ? ok("compendium row translated", `"${searchLeg.rowText}"`)
    : fail("compendium row translated", `row reads ${JSON.stringify(searchLeg.rowText)}`);
  searchLeg.spanish?.dagger === "flex" && searchLeg.spanish?.other === "none"
    ? ok("the Spanish query finds the row", "and actually filters the rest")
    : fail("the Spanish query finds the row", JSON.stringify(searchLeg.spanish));
  searchLeg.english?.dagger === "flex"
    ? ok("the English query still matches", "additive — no route lost")
    : fail("the English query still matches", JSON.stringify(searchLeg.english));
  searchLeg.control?.dagger === "none"
    ? ok("control: core's matcher alone loses the row", "the wrap is what makes Spanish findable")
    : fail("control: core's matcher alone loses the row", `${JSON.stringify(searchLeg.control)} — the leg is not measuring the wrap`);
}

/* -------------------------------------------- */

// The connect picker labels AND sorts by the DISPLAYED name (review #9
// findings 5+7). The two containers' English and Spanish orders REVERSE
// (Alpha→ZZ-ZULU, Beta→ZZ-ANTES), so a picker sorting on stored English then
// translating renders them shuffled — the exact shipped bug — and this leg
// reads their relative order in the rendered <select>.
console.log("\nconnect picker: translated, display-sorted");

const pickerLeg = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const Impl = CONFIG.Actor.documentClass;
  const out = { ids: [] };
  // The Connections UI is parked (2026-08-09): the tab this picker lives on
  // renders only under the in-page settings shadow. What the leg measures —
  // display-name labels and sort — is unchanged by the parking.
  const origGet = game.settings.get;
  game.settings.get = function (ns, key) {
    if (key === "connections-ui-enabled") return true;
    return origGet.call(this, ns, key);
  };
  try {
    const keeper = await Impl.create({ name: "ZZ Picker Keeper", type: "character" });
    const alpha = await Impl.create({ name: "ZZ Alpha Crate", type: "npc", system: { role: "container" } });
    const beta = await Impl.create({ name: "ZZ Beta Sack", type: "npc", system: { role: "container" } });
    out.ids.push(keeper.id, alpha.id, beta.id);
    i18n._setOverlay({ "monster.name": {
      "ZZ Alpha Crate": "ZZ-ZULU",
      "ZZ Beta Sack": "ZZ-ANTES",
    } });
    await keeper.sheet.render(true);
    for (let i = 0; i < 60 && !keeper.sheet.element; i++) await sleep(100);
    await sleep(400);
    keeper.sheet.element?.querySelector('[data-action="connectionAdd"]')?.click();
    let dlg = null, select = null;
    for (let i = 0; i < 60 && !select; i++) {
      await sleep(100);
      dlg = [...foundry.applications.instances.values()]
        .find((a) => a.element?.querySelector?.('select[name="connectionTarget"]'));
      select = dlg?.element?.querySelector('select[name="connectionTarget"]');
    }
    out.opened = !!select;
    out.options = select
      ? [...select.options].map((o) => ({ text: o.textContent.trim(), value: o.value }))
      : [];
    await dlg?.close().catch(() => {});
    await keeper.sheet.close().catch(() => {});
    out.alphaUuid = alpha.uuid;
    out.betaUuid = beta.uuid;
  } finally {
    game.settings.get = origGet;
    i18n._setOverlay(null);
    for (const id of out.ids) await game.actors.get(id)?.delete().catch(() => {});
  }
  return out;
});

if (!pickerLeg.opened) fail("connect picker opened", "no connectionTarget select — legs vacuous");
else {
  const zulu = pickerLeg.options.findIndex((o) => o.text === "ZZ-ZULU");
  const antes = pickerLeg.options.findIndex((o) => o.text === "ZZ-ANTES");
  zulu >= 0 && antes >= 0
    ? ok("picker options translated", `"ZZ-ANTES", "ZZ-ZULU"`)
    : fail("picker options translated", JSON.stringify(pickerLeg.options.map((o) => o.text)));
  antes >= 0 && zulu >= 0 && antes < zulu
    ? ok("ordered by the DISPLAYED name", "ZZ-ANTES before ZZ-ZULU (stored order is the reverse)")
    : fail("ordered by the DISPLAYED name", `indexes antes=${antes} zulu=${zulu}`);
  pickerLeg.options.find((o) => o.text === "ZZ-ZULU")?.value === pickerLeg.alphaUuid
    ? ok("option VALUE stays the uuid", "choice unaffected by language")
    : fail("option VALUE stays the uuid", JSON.stringify(pickerLeg.options));
}

/* -------------------------------------------- */

// A destructive confirm must not name a document the user cannot see (review
// #9 finding 6): the inventory row renders the translation, so the "Delete X?"
// ask must show the same X. Dismissing must also leave the item alone —
// rejectClose:false resolves null on close, and null must read as "no".
console.log("\ndelete confirm names the translation");

const confirmLeg = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const Impl = CONFIG.Actor.documentClass;
  const out = {};
  let holder = null;
  try {
    holder = await Impl.create({ name: "ZZ Confirm Holder", type: "character" });
    const [cord] = await holder.createEmbeddedDocuments("Item", [
      { name: "ZZ Probe Cord", type: "item" },
    ]);
    i18n._setOverlay({ "item.name": { "ZZ Probe Cord": "ZZ-CORDEL" } });
    const p = holder.deleteOwnedItem(cord.id);
    p.catch(() => {});
    let dlg = null;
    for (let i = 0; i < 60 && !dlg; i++) {
      await sleep(100);
      dlg = [...foundry.applications.instances.values()]
        .find((a) => a.constructor.name === "DialogV2" && a.element?.querySelector(".dialog-content"));
    }
    out.text = dlg?.element?.querySelector(".dialog-content")?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    await dlg?.close().catch(() => {});
    await p.catch(() => {});
    await sleep(300);
    out.survived = !!holder.items.get(cord.id);
  } finally {
    i18n._setOverlay(null);
    await holder?.delete().catch(() => {});
  }
  return out;
});

if (!confirmLeg.text) fail("delete confirm rendered", "no DialogV2 — legs vacuous");
else {
  confirmLeg.text.includes("ZZ-CORDEL")
    ? ok("confirm shows the translated name", `"${confirmLeg.text.slice(0, 50)}"`)
    : fail("confirm shows the translated name", `text was "${confirmLeg.text}"`);
  !confirmLeg.text.includes("ZZ Probe Cord")
    ? ok("…and not the stored English", "")
    : fail("…and not the stored English", `"${confirmLeg.text}"`);
  confirmLeg.survived
    ? ok("dismissing the confirm deletes nothing", "null reads as no")
    : fail("dismissing the confirm deletes nothing", "the item is gone");
}

/* -------------------------------------------- */

// The DETACH confirm, on the same footing as the delete confirm above (review
// #16). Parked UI -- the header line it lives on renders only under the
// connections shadow -- and that is exactly why it is covered: one flag flip
// restores this dialog, and it must not come back naming a cart the sheet
// behind it calls something else. `DialogV2.confirm` is stubbed and answered
// NO, so the leg reads the ask and writes nothing.
//
// The link is planted DANGLING, and that is load-bearing rather than
// convenient. `#onConnectionDetach` has two exits: a live keeper routes
// through `keeper.unlinkOwnedContainer`, whose confirm has read
// `actorDisplayName` all along, and a dangling one raises its OWN dialog --
// which is the copy that named the child in stored English. A leg pointed at
// the live-keeper case passes with the fix reverted, because it is measuring
// the other file. It did, before this comment existed.
//
// Dangling by a made-up uuid, not by deleting the keeper: the keeper-delete
// hook (cairn.js) clears `connectedTo` and stamps `formerlyBelongedTo`, so a
// deleted keeper leaves no link to detach at all.
console.log("\ndetach confirm names the translation (dangling keeper)");

const detachLeg = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const Actor = CONFIG.Actor.documentClass;
  const DialogV2 = foundry.applications.api.DialogV2;
  const out = { ids: [] };
  const origConfirm = DialogV2.confirm;
  const origGet = game.settings.get;
  let asked = null;
  DialogV2.confirm = async (args) => { asked = args; return false; };
  game.settings.get = function (ns, key) {
    if (key === "connections-ui-enabled") return true;
    return origGet.call(this, ns, key);
  };
  let cart = null;
  try {
    const DEAD = "Actor.zzzzzzzzzzzzzzzz"; // resolves to nothing, forever
    cart = await Actor.create({
      name: "ZZ Detach Cart", type: "npc",
      system: { role: "transport", slots: 4, connectedTo: DEAD },
    });
    out.ids.push(cart.id);
    out.dangling = !game.actors.find((a) => a.uuid === cart.system.connectedTo);
    i18n._setOverlay({ "monster.name": { "ZZ Detach Cart": "ZZ-CARRO" } });
    await cart.sheet.render(true);
    for (let i = 0; i < 60 && !cart.sheet.element; i++) await sleep(100);
    await sleep(300);
    const control = cart.sheet.element?.querySelector('[data-action="connectionDetach"]');
    out.control = !!control;
    control?.click();
    for (let i = 0; i < 40 && asked === null; i++) await sleep(100);
    out.ask = String(asked?.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    await cart.sheet.close().catch(() => {});
    out.stillConnected = cart.system.connectedTo === DEAD;
  } finally {
    DialogV2.confirm = origConfirm;
    game.settings.get = origGet;
    i18n._setOverlay(null);
    for (const id of out.ids) await game.actors.get(id)?.delete().catch(() => {});
    out.swept = out.ids.every((id) => !game.actors.get(id));
  }
  return out;
});

if (!detachLeg.dangling) fail("precondition: the planted keeper really is unresolvable", "a live keeper routes past the dialog under test");
else if (!detachLeg.control) fail("the connected child offers a detach control", "leg vacuous — the shadow did not restore the header line");
else {
  detachLeg.ask.includes("ZZ-CARRO") && !detachLeg.ask.includes("ZZ Detach Cart")
    ? ok("detach confirm names the translation", `"${detachLeg.ask}"`)
    : fail("detach confirm names the translation", `asked "${detachLeg.ask}"`);
  detachLeg.stillConnected
    ? ok("answering no detaches nothing", "")
    : fail("answering no detaches nothing", "the link was broken anyway");
  detachLeg.swept
    ? ok("detach fixtures swept", "")
    : fail("detach fixtures swept", "documents left behind");
}

/* -------------------------------------------- */

// A REFUSAL names a document too, and it is the same rule (review #16). The row
// a player just dragged shows the translation; a toast answering it in stored
// English makes one thing wear two names in a single gesture -- the failure the
// directory sweep was built to end, arriving through a surface nobody had swept.
//
// Two refusals, because they take their name from opposite sides of the naming
// ruling: the capacity refusal names an ITEM (always through the overlay), the
// permission refusal names an ACTOR (through it unless the actor is a player
// character, whose name is never localized). The PC leg is the one that would
// pass vacuously if `actorDisplayName` were replaced by a bare `t()`, so its
// overlay entry is PLANTED -- a name the gate must refuse to use, not a miss.
console.log("\nrefusals name the translation");

const refusalLeg = await page.evaluate(async () => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const Actor = CONFIG.Actor.documentClass;
  const Item = CONFIG.Item.documentClass;
  const out = { actorIds: [], itemIds: [] };
  const warns = [];
  const origWarn = ui.notifications.warn;
  ui.notifications.warn = (m) => { warns.push(String(m)); return null; };
  try {
    i18n._setOverlay({
      "item.name": { "ZZ Probe Lantern": "ZZ-FAROL" },
      "monster.name": { "ZZ Probe Ghoul": "ZZ-DEMONIO", "ZZ Probe Hero": "ZZ-NUNCA" },
    });

    /* capacity: a BULKY item (2 slots) onto a one-slot crate */
    const crate = await Actor.create({
      name: "ZZ Probe Crate", type: "npc", system: { role: "container", slots: 1 },
    });
    const lantern = await Item.create({
      name: "ZZ Probe Lantern", type: "item", system: { bulky: true },
    });
    out.actorIds.push(crate.id);
    out.itemIds.push(lantern.id);
    out.slotsMax = crate.system.slotsMax;
    warns.length = 0;
    out.createdAnyway = !!(await crate.sheet._onDropItem({ preventDefault: () => {} }, lantern));
    out.full = warns.join(" | ");

    /* permission: the `owned` wrapper's toast, on a rendered sheet whose
       isEditable is shadowed on the INSTANCE (never a permission write -- this
       harness is the GM, and demoting the GM is not something a probe may do).
       The control is clicked for real; it renders either way, which is the whole
       reason the wrapper has to say something. */
    const shadowUneditable = (sheet) =>
      Object.defineProperty(sheet, "isEditable", { value: false, configurable: true });
    const clickPortrait = async (actor) => {
      await actor.sheet.render(true);
      for (let i = 0; i < 60 && !actor.sheet.element; i++) await sleep(100);
      await sleep(200);
      const img = actor.sheet.element?.querySelector('.portrait[data-action="editPortrait"]');
      if (!img) return { clicked: false, warns: [] };
      shadowUneditable(actor.sheet);
      warns.length = 0;
      img.click();
      await sleep(300);
      delete actor.sheet.isEditable;
      const said = warns.join(" | ");
      await actor.sheet.close().catch(() => {});
      return { clicked: true, said };
    };

    const ghoul = await Actor.create({
      name: "ZZ Probe Ghoul", type: "npc", system: { role: "monster" },
    });
    out.actorIds.push(ghoul.id);
    out.monster = await clickPortrait(ghoul);

    const hero = await Actor.create({ name: "ZZ Probe Hero", type: "character" });
    out.actorIds.push(hero.id);
    out.pc = await clickPortrait(hero);
  } finally {
    ui.notifications.warn = origWarn;
    i18n._setOverlay(null);
    for (const id of out.actorIds) await game.actors.get(id)?.delete().catch(() => {});
    for (const id of out.itemIds) await game.items.get(id)?.delete().catch(() => {});
    out.swept = out.actorIds.every((id) => !game.actors.get(id))
      && out.itemIds.every((id) => !game.items.get(id));
  }
  return out;
});

if (refusalLeg.slotsMax !== 1 || refusalLeg.createdAnyway) {
  fail("the crate refuses a bulky item", `slotsMax=${refusalLeg.slotsMax}, created=${refusalLeg.createdAnyway} — the leg is measuring nothing`);
} else {
  refusalLeg.full.includes("ZZ-FAROL")
    ? ok("the capacity refusal names the translation", `"${refusalLeg.full}"`)
    : fail("the capacity refusal names the translation", `said "${refusalLeg.full}"`);
  !refusalLeg.full.includes("ZZ Probe Lantern")
    ? ok("…and not the stored English", "")
    : fail("…and not the stored English", `said "${refusalLeg.full}"`);
}

if (!refusalLeg.monster?.clicked) fail("the monster sheet offered a portrait control", "leg vacuous");
else {
  refusalLeg.monster.said.includes("ZZ-DEMONIO")
    ? ok("the permission refusal names the translation", `"${refusalLeg.monster.said}"`)
    : fail("the permission refusal names the translation", `said "${refusalLeg.monster.said}"`);
}
if (!refusalLeg.pc?.clicked) fail("the character sheet offered a portrait control", "control leg vacuous");
else {
  refusalLeg.pc.said.includes("ZZ Probe Hero") && !refusalLeg.pc.said.includes("ZZ-NUNCA")
    ? ok("control: a PC keeps its player-authored name", "the overlay entry is planted and unused")
    : fail("control: a PC keeps its player-authored name", `said "${refusalLeg.pc.said}"`);
}
refusalLeg.swept
  ? ok("refusal fixtures swept", "")
  : fail("refusal fixtures swept", "documents left behind");

/* -------------------------------------------- */

// The four generic class names stay scoped under .cairn (review #9 finding 14).
// Foundry's layer order (`system` after `applications`, foundry2.css:5) makes
// an unscoped system rule beat core's own regardless of specificity — bare
// `.description` stacked every placeables-sidebar row vertically and restyled
// every table-draw card. Each pair asserts BOTH ends: outside .cairn the rule
// must not land (the fix), inside it must (the control — if the rule itself
// were deleted, the inside half goes red instead of the outside half passing
// vacuously).
console.log("\nsystem CSS stays scoped to .cairn");

const cssLeg = await page.evaluate(() => {
  const nodes = [];
  const mk = (cls, parent) => {
    const d = document.createElement("div");
    d.className = cls;
    (parent ?? document.body).appendChild(d);
    nodes.push(d);
    return d;
  };
  const wrap = mk("cairn");
  const read = (cls) => {
    const o = getComputedStyle(mk(cls));
    const i = getComputedStyle(mk(cls, wrap));
    return {
      outside: { display: o.display, dir: o.flexDirection, height: o.height, maxHeight: o.maxHeight },
      inside: { display: i.display, dir: i.flexDirection, height: i.height, maxHeight: i.maxHeight },
    };
  };
  // (.features was a third name read here until its rule went with the
  // Features UI, 2026-08-09.)
  const out = { description: read("description"), portrait: read("portrait") };
  for (const n of nodes) n.remove();
  return out;
});

cssLeg.description.outside.display !== "flex"
  ? ok("bare .description is core's", cssLeg.description.outside.display)
  : fail("bare .description is core's", "still flex outside .cairn — the scope is off");
cssLeg.description.inside.display === "flex" && cssLeg.description.inside.dir === "column"
  ? ok("control: .cairn .description is still flex-column", "the rule exists; the leg measures the scope")
  : fail("control: .cairn .description is still flex-column", JSON.stringify(cssLeg.description.inside));
cssLeg.portrait.outside.height !== "140px" && cssLeg.portrait.inside.height === "140px"
  ? ok(".portrait scoped", "140px only inside .cairn")
  : fail(".portrait scoped", JSON.stringify(cssLeg.portrait));

/* -------------------------------------------- */

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
if (errors.length) failures++;

await browser.close();
console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);
