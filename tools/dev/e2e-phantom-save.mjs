#!/usr/bin/env node
/**
 * The phantom save: a ProseMirror editor nobody edited must not write.
 *
 * `HTMLProseMirrorElement.save()` fires `change` whenever ProseMirror's
 * canonical serialization differs from the STORED string — not whenever the
 * user edited something. Both editors on the NPC sheet are always-active, the
 * sheet saves them on any mousedown outside an editor (click-away), and the
 * sheet is submitOnChange: so on a document whose stored HTML is not
 * serializer-canonical, MERELY CLICKING THE SHEET wrote the document and
 * re-rendered it. In a real browser the re-render replaces the element under
 * the pointer between mousedown and mouseup and no click is ever dispatched —
 * the pressed control silently does nothing. That was 2026-08-01's "the art
 * picker never opens on Acolyte / Blood Elk / Crypt Thing": each failed
 * portrait click was the document's own canonicalising write eating the click,
 * measured live as 23 shipped monsters rewritten in one evening by clicks and
 * closes alone.
 *
 * Two things this probe deliberately does NOT assert, and why:
 *
 *   - the click-death itself. Headless Chromium RE-TARGETS a click whose
 *     mousedown element was re-rendered away (measured here: the picker opens
 *     even mid-write), which is why no headless run ever reproduced the user
 *     report. The probe asserts the WRITE, which is the same defect and the
 *     part a probe can witness.
 *   - an eternal rewrite for "&"-content. The serializer emits `&` raw
 *     (string-node.mjs escapes only < and >) while storage holds `&amp;`, so a
 *     fresh editor re-submits once per sheet-open — but the server sanitizes
 *     BEFORE diffing, so the re-submission no-ops in the database. The
 *     convergence leg pins that: if core ever starts diffing before
 *     sanitizing, that leg fails and the rewrite loop has become real.
 *
 * The fix is the dirty guard in `bindEditorClickAwaySave` (module/utils.js):
 * the element's own cancelable "save" event is vetoed for a non-toggled,
 * non-source, NOT-DIRTY editor. Clicks use a held 200ms press after waiting
 * for `.active` — editor activation is async, and a click that beats it meets
 * no editor at all, which is how earlier diagnostics measured "no write on
 * click" on a sheet that writes on every human click.
 *
 * Typing-still-saves is dev:notes-editor's standing coverage; this probe's
 * subject is the save that should NOT happen.
 *
 *   npm run dev:phantom-save
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
watchdog(180000, "phantom-save probe");
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(52)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(52)} ${d}`); failures++; };

// Acolyte's shipped description, verbatim: the `&amp;` is the load-bearing
// character (the convergence leg's subject), the <br> inside <li> and the
// newlines are the ordinary non-canonical shape every imported monster carries.
const DESC = "<ul>\n<li>Holy men &amp; women in a quest for their deity.<br></li>\n<li>Normally travel in groups of 4+.<br></li>\n</ul>";
const NAME = "ZZ Phantom Save Monster";

/** The document's state, read fresh each time. */
const readState = (id) => page.evaluate((id) => {
  const a = game.actors.get(id);
  return {
    desc: a.system.description,
    mt: a._stats.modifiedTime,
    pickerOpen: [...foundry.applications.instances.values()]
      .some((x) => x.constructor.name === "DialogV2" && x.element?.querySelector(".cairn-portrait-gallery")),
  };
}, id);

/** Hold a real 200ms press on the sheet portrait — the timing a human supplies. */
const slowClickPortrait = async (sheetId) => {
  const img = page.locator(`#${sheetId} img.portrait`);
  const box = await img.boundingBox();
  if (!box) throw new Error("portrait not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(700);
};

/** Wait until the description editor is genuinely ACTIVE — activation is async
 *  (fromUuid + TextEditor.create), and asserting before it completes is how this
 *  bug got called unreproducible: a pre-activation click meets no editor at all. */
const waitForActiveEditor = (sheetId) =>
  page.waitForFunction(
    (sel) => !!document.querySelector(sel),
    `#${sheetId} prose-mirror[name="system.description"].active`,
    { timeout: 15000 }
  );

const closeAllDialogs = () => page.evaluate(async () => {
  for (const app of foundry.applications.instances.values()) {
    if (app.constructor.name === "DialogV2") await app.close();
  }
});

try {
  await joinAsGM(page);

  const { id, sheetId } = await page.evaluate(async ({ NAME, DESC }) => {
    for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Phantom"))) await a.delete();
    const a = await CONFIG.Actor.documentClass.create({
      name: NAME,
      type: "npc",
      system: { role: "monster", generationEnabled: false, description: DESC },
    });
    await a.sheet.render(true);
    for (let i = 0; i < 40 && !a.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    return { id: a.id, sheetId: a.sheet.element.id };
  }, { NAME, DESC });

  await waitForActiveEditor(sheetId);
  ok("description editor is active before any click", "the precondition every assertion hangs on");
  const before = await readState(id);

  /* --- 1. a slow first click opens the picker, and writes nothing -------- */

  await slowClickPortrait(sheetId);
  const after1 = await readState(id);

  after1.pickerOpen
    ? ok("first slow click opens the art picker", "held 200ms, like a hand")
    : fail("first slow click opens the art picker", "no gallery dialog");
  after1.desc === before.desc && after1.mt === before.mt
    ? ok("the click wrote nothing", `modifiedTime still ${String(before.mt)}`)
    : fail("the click wrote nothing", `desc changed: ${after1.desc !== before.desc}, mt ${before.mt} -> ${after1.mt}`);

  /* --- 2. closing the unedited sheet writes nothing ----------------------- */

  await closeAllDialogs();
  await page.evaluate(async (id) => { await game.actors.get(id).sheet.close(); }, id);
  await page.waitForTimeout(900);
  const after2 = await readState(id);
  after2.desc === before.desc && after2.mt === before.mt
    ? ok("closing the unedited sheet writes nothing", "the disconnect save is vetoed too")
    : fail("closing the unedited sheet writes nothing", `desc changed: ${after2.desc !== before.desc}, mt ${before.mt} -> ${after2.mt}`);

  /* --- 3. control: silence the guard, the phantom write must come back --- */

  // The guard listens for "save" in the bubble phase on the sheet frame;
  // swallowing the event at window CAPTURE runs first and silences it without
  // touching a line of source (it stops PROPAGATION, not the default, so
  // save() itself proceeds exactly as unfixed code did). If the "wrote
  // nothing" assertions above cannot fail under this, they were never
  // protected by the guard.
  await page.evaluate(async (id) => {
    window.addEventListener("save", (ev) => ev.stopImmediatePropagation(), { capture: true });
    await game.actors.get(id).sheet.render(true);
  }, id);
  await waitForActiveEditor(sheetId);
  await slowClickPortrait(sheetId);
  const after3 = await readState(id);

  after3.desc !== before.desc && after3.mt !== before.mt
    ? ok("control: the click writes the document", "the phantom save is back — the guard is load-bearing")
    : fail("control: the click writes the document", "nothing written — the control never re-created the bug");
  after3.desc.includes("&amp;") && after3.desc.includes("<li><p>")
    ? ok("control: the write canonicalised, & stayed escaped", "storage never holds the serializer's raw &")
    : fail("control: the write canonicalised, & stayed escaped", `stored: ${JSON.stringify(after3.desc.slice(0, 90))}`);
  // Not asserted, but recorded: in headless Chromium this click SURVIVES the
  // re-render (the picker opens mid-write). A real browser drops it — which is
  // why the user saw "nothing happened" while the document was being written.
  console.log(`  note  picker after the control click: ${after3.pickerOpen} (headless re-targets the click; a real browser does not)`);

  /* --- 4. convergence: the re-submission no-ops in the database ---------- */

  // A FRESH editor on the now-canonical doc still diffs (stored `&amp;` vs the
  // serializer's raw `&`) and still submits — but the server sanitizes before
  // diffing, so nothing is written and nothing re-renders. If this leg ever
  // fails with mt moving, core has started diffing before sanitizing and the
  // once-per-open write has become a write-per-click loop: that is the world
  // where the guard is the only thing between a Warden and a compendium that
  // rewrites itself on every click.
  await closeAllDialogs();
  await page.evaluate(async (id) => {
    await game.actors.get(id).sheet.close();
    await game.actors.get(id).sheet.render(true);
  }, id);
  await waitForActiveEditor(sheetId);
  await slowClickPortrait(sheetId);
  const after4 = await readState(id);
  after4.mt === after3.mt && after4.desc === after3.desc
    ? ok("convergence: the fresh editor's re-submit no-ops", "server sanitizes before diffing")
    : fail("convergence: the fresh editor's re-submit no-ops", `mt ${after3.mt} -> ${after4.mt} — the eternal rewrite is REAL now`);
} catch (err) {
  fail("probe threw", err.message);
} finally {
  // Node-level cleanup: an in-page throw must not leave the actor behind.
  await page.evaluate(async () => {
    for (const app of foundry.applications.instances.values()) {
      if (app.constructor.name === "DialogV2") await app.close();
    }
    for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Phantom"))) await a.delete();
  }).catch(() => {});
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nphantom-save probe FAILED (${failures})\n` : "\nphantom-save probe passed\n");
process.exit(failures ? 1 : 0);
