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
 * re-rendered it. The re-render replaces the element under the pointer between
 * mousedown and mouseup, so the browser dispatches no click at all — the
 * pressed control silently does nothing, exactly once for most documents,
 * because the phantom write canonicalises the stored string.
 *
 * "Most", because text containing "&" never converges: Foundry's
 * StringSerializer emits it raw (string-node.mjs escapes only < and >) while
 * the write path stores it back as `&amp;` — so the diff comes back on every
 * click, forever. That was 2026-08-01's "the art picker never opens on
 * Acolyte / Blood Elk / Crypt Thing": the exact set of shipped monsters with
 * an ampersand in their description, each one rewriting itself into the
 * compendium on every portrait click a Warden made.
 *
 * The fix is the dirty guard in `bindEditorClickAwaySave` (module/utils.js):
 * the element's own cancelable "save" event is vetoed for a non-toggled,
 * non-source, NOT-DIRTY editor. This probe asserts the whole disease and the
 * cure, with human click timing (a held 200ms press — the synthetic instant
 * click can never lose the race, which is why headless testing kept calling
 * this bug unreproducible):
 *
 *   1. a slow first click on the portrait opens the art picker, and the
 *      document is NOT written;
 *   2. closing the unedited sheet writes nothing either (the disconnect save,
 *      the second spurious saver the guard covers);
 *   3. control — the guard silenced in-page by swallowing the "save" event at
 *      window capture — must bring the whole disease back: no picker, the
 *      document rewritten yet still holding `&amp;`, and a further click
 *      writing AGAIN (the forever loop). Without this leg, 1 and 2 pass just
 *      as well on a sheet whose editors never activated.
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
// character (the non-convergent class), the <br> inside <li> and the newlines
// are the ordinary non-canonical shape every imported monster carries.
const DESC = "<ul>\n<li>Holy men &amp; women in a quest for their deity.<br></li>\n<li>Normally travel in groups of 4+.<br></li>\n</ul>";
const NAME = "ZZ Phantom Save Monster";

/** The sheet's state, read fresh each time. */
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
    : fail("first slow click opens the art picker", "no gallery dialog — the click was eaten");
  after1.desc === before.desc && after1.mt === before.mt
    ? ok("the click wrote nothing", `modifiedTime still ${String(before.mt)}`)
    : fail("the click wrote nothing", `desc changed: ${after1.desc !== before.desc}, mt ${before.mt} -> ${after1.mt}`);

  /* --- 2. closing the unedited sheet writes nothing ----------------------- */

  await page.evaluate(async (id) => {
    const a = game.actors.get(id);
    for (const app of foundry.applications.instances.values()) {
      if (app.constructor.name === "DialogV2") await app.close();
    }
    await a.sheet.close();
  }, id);
  await page.waitForTimeout(900);
  const after2 = await readState(id);
  after2.desc === before.desc && after2.mt === before.mt
    ? ok("closing the unedited sheet writes nothing", "the disconnect save is vetoed too")
    : fail("closing the unedited sheet writes nothing", `desc changed: ${after2.desc !== before.desc}, mt ${before.mt} -> ${after2.mt}`);

  /* --- 3. control: silence the guard, the disease must come back --------- */

  // The guard listens for "save" in the bubble phase on the sheet frame;
  // swallowing the event at window CAPTURE runs first and silences it without
  // touching a line of source. If the assertions above cannot fail under this,
  // they were never protected by the guard.
  await page.evaluate(async (id) => {
    window.addEventListener("save", (ev) => ev.stopImmediatePropagation(), { capture: true });
    await game.actors.get(id).sheet.render(true);
  }, id);
  await waitForActiveEditor(sheetId);
  await slowClickPortrait(sheetId);
  const after3 = await readState(id);

  !after3.pickerOpen
    ? ok("control: the click is eaten again", "no picker — the pressed img was re-rendered away")
    : fail("control: the click is eaten again", "picker opened — the guard was not what protected leg 1");
  after3.desc !== before.desc && after3.mt !== before.mt
    ? ok("control: the click wrote the document", "the phantom save is back")
    : fail("control: the click wrote the document", "nothing written — the control never re-created the bug");
  after3.desc.includes("&amp;")
    ? ok("control: the write kept &amp;", "the serializer/storage disagreement that makes it eternal")
    : fail("control: the write kept &amp;", `stored: ${JSON.stringify(after3.desc.slice(0, 80))}`);

  // The forever loop: the re-rendered, freshly-canonicalised editor must diff
  // AGAIN on the next click — this is what separated Acolyte from Boar.
  await waitForActiveEditor(sheetId);
  await slowClickPortrait(sheetId);
  const after4 = await readState(id);
  after4.mt !== after3.mt && !after4.pickerOpen
    ? ok("control: the NEXT click writes again", "non-convergent — every click, forever")
    : fail("control: the NEXT click writes again", `mt ${after3.mt} -> ${after4.mt}, picker: ${after4.pickerOpen}`);
} catch (err) {
  fail("probe threw", err.message);
} finally {
  // Node-level cleanup: an in-page throw must not leave the actor behind.
  await page.evaluate(async () => {
    for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Phantom"))) await a.delete();
  }).catch(() => {});
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nphantom-save probe FAILED (${failures})\n` : "\nphantom-save probe passed\n");
process.exit(failures ? 1 : 0);
