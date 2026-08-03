#!/usr/bin/env node
/**
 * The phantom save, in the ALL-TOGGLED era: an interaction nobody edited
 * through must not write — and the one write that IS contractual happens
 * exactly once.
 *
 * The original defect (2026-08-01): `HTMLProseMirrorElement.save()` fires
 * `change` whenever ProseMirror's canonical serialization differs from the
 * STORED string — not whenever the user edited something. With the NPC
 * sheet's editors ALWAYS-ACTIVE and click-away-saved, merely clicking the
 * sheet of a non-canonical document wrote it and re-rendered it, eating the
 * click under the pointer — 23 shipped monsters rewritten in one evening by
 * clicks and closes alone. The fix was the dirty guard in
 * `bindEditorClickAwaySave` (module/utils.js): the element's cancelable
 * "save" event vetoed for a non-toggled, non-source, NOT-DIRTY editor.
 *
 * THAT CLASS IS EMPTY NOW, in two steps: 8c67e8e (review #6) made the npc
 * description and notes editors toggled, and c873bd6 (2026-08-02) took the
 * character Notes editor — the last always-active `<prose-mirror>` shipped —
 * to the same shape. A toggled editor's click-away save is its CONTRACT
 * (click away = commit), so the old "an active editor nobody edited writes
 * nothing" scenario stopped describing any shipped surface; this probe sat
 * stale-red from 8c67e8e until tonight, having been absent from that batch's
 * run list (the directory-buttons failure class). The utils.js guard still
 * ships, vetoing a class with no members; leg 0 below is what KEEPS the
 * class empty — re-ship an always-active editor and it goes red, forcing
 * this question to be re-asked.
 *
 * What is pinned now:
 *   0. every <prose-mirror> on the npc sheet is toggled, and none is active
 *      at rest;
 *   1. a slow press on the RESTING sheet (no editor active) opens the art
 *      picker and writes nothing;
 *   2. closing the resting, unedited sheet writes nothing;
 *   3. activating the editor and clicking away CONVERGES the document to the
 *      PM-canonical shape ONCE — the write is real, `&` stays escaped in
 *      storage (`&amp;`), `<li><p>` replaces the imported `<li>…<br>` shape.
 *      This is the corrected convergence claim: the serializer emits `&` raw
 *      but the server sanitizes before storing, so storage never holds it;
 *   4. convergence is STABLE: a fresh activate-and-click-away on the now-
 *      canonical document writes NOTHING — the write of leg 3 happens once
 *      per document ever, not once per click.
 *
 * Typing-still-saves is dev:notes-editor's standing coverage; this probe's
 * subject is what writes when nobody typed.
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
// character (the convergence legs' subject), the <br> inside <li> and the
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

/**
 * Hold a real 200ms press on the sheet portrait — the timing a human supplies.
 *
 * Then POLL for the picker; do NOT sleep a fixed interval. This waited 700ms,
 * and the FIRST picker open of a session fetches three manifests cold
 * (portraits, game-icons, tlomdev): measured at **677ms**, a 23ms margin. So it
 * passed on a warm run and failed on a cold one, and the failure reads as
 * "pressing the portrait does not open the art picker" — a product bug that
 * isn't there. Same shape as the icon-migration race `dev:icons` records.
 *
 * Bounded and swallowed, so a picker that genuinely never opens still fails the
 * ASSERTION rather than hanging here or passing silently.
 */
const slowClickPortrait = async (sheetId) => {
  const img = page.locator(`#${sheetId} img.portrait`);
  const box = await img.boundingBox();
  if (!box) throw new Error("portrait not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForSelector(".cairn-portrait-gallery", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);   // let a click-away save commit behind it
};

/** Activate the TOGGLED description editor the way dev:notes-editor does (the
 *  pencil is hover-hidden, so a synthetic click on the element's button is the
 *  reliable route), then wait for genuine activation — it is async
 *  (fromUuid + TextEditor.create), and interacting before it completes is how
 *  this bug was once called unreproducible. */
const activateDescription = async (sheetId) => {
  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} prose-mirror[name="system.description"]`)
      ?.querySelector("button")?.click();
  }, sheetId);
  await page.waitForFunction(
    (sel) => !!document.querySelector(sel),
    `#${sheetId} prose-mirror[name="system.description"].active`,
    { timeout: 15000 }
  );
};

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
  await page.waitForTimeout(600);

  /* --- 0. the always-active class stays empty ----------------------------- */

  const shape = await page.evaluate((sheetId) => {
    const pms = [...document.querySelectorAll(`#${sheetId} prose-mirror`)];
    return {
      count: pms.length,
      allToggled: pms.every((pm) => pm.hasAttribute("toggled")),
      anyActive: pms.some((pm) => pm.classList.contains("active")),
    };
  }, sheetId);
  shape.count >= 2 && shape.allToggled && !shape.anyActive
    ? ok("every editor is toggled, none active at rest", `${shape.count} editors — the phantom class stays empty`)
    : fail("every editor is toggled, none active at rest", JSON.stringify(shape));

  const before = await readState(id);

  /* --- 1. a slow press on the RESTING sheet opens the picker, writes nothing */

  await slowClickPortrait(sheetId);
  const after1 = await readState(id);
  after1.pickerOpen
    ? ok("a slow press on the resting sheet opens the art picker", "held 200ms, like a hand")
    : fail("a slow press on the resting sheet opens the art picker", "no gallery dialog");
  after1.desc === before.desc && after1.mt === before.mt
    ? ok("and it wrote nothing", `modifiedTime still ${String(before.mt)}`)
    : fail("and it wrote nothing", `desc changed: ${after1.desc !== before.desc}, mt ${before.mt} -> ${after1.mt}`);

  /* --- 2. closing the resting, unedited sheet writes nothing -------------- */

  await closeAllDialogs();
  await page.evaluate(async (id) => { await game.actors.get(id).sheet.close(); }, id);
  await page.waitForTimeout(900);
  const after2 = await readState(id);
  after2.desc === before.desc && after2.mt === before.mt
    ? ok("closing the unedited sheet writes nothing", "no disconnect save on dormant editors")
    : fail("closing the unedited sheet writes nothing", `desc changed: ${after2.desc !== before.desc}, mt ${before.mt} -> ${after2.mt}`);

  /* --- 3. the activated click-away converges the document, ONCE ----------- */

  await page.evaluate(async (id) => { await game.actors.get(id).sheet.render(true); }, id);
  await page.waitForTimeout(600);
  await activateDescription(sheetId);
  await slowClickPortrait(sheetId);
  const after3 = await readState(id);
  after3.desc !== before.desc && after3.mt !== before.mt
    ? ok("an ACTIVE editor's click-away commits", "the toggled contract: click away = save")
    : fail("an ACTIVE editor's click-away commits", "nothing written — activation never took, legs below are vacuous");
  after3.desc.includes("&amp;") && after3.desc.includes("<li><p>")
    ? ok("the write canonicalised, & stayed escaped", "storage never holds the serializer's raw &")
    : fail("the write canonicalised, & stayed escaped", `stored: ${JSON.stringify(after3.desc.slice(0, 90))}`);

  /* --- 4. convergence is STABLE: the same gesture writes nothing again ---- */

  // If this leg ever fails with mt moving, the serializer and the sanitized
  // store have stopped agreeing on a fixed point, and the once-per-document
  // write has become a write-per-click loop — the world where the phantom
  // save is real again for every sheet a Warden merely opens and closes.
  await closeAllDialogs();
  await page.evaluate(async (id) => {
    await game.actors.get(id).sheet.close();
    await game.actors.get(id).sheet.render(true);
  }, id);
  await page.waitForTimeout(600);
  await activateDescription(sheetId);
  await slowClickPortrait(sheetId);
  const after4 = await readState(id);
  after4.mt === after3.mt && after4.desc === after3.desc
    ? ok("the same gesture on the canonical doc writes NOTHING", "convergence is a fixed point")
    : fail("the same gesture on the canonical doc writes NOTHING", `mt ${after3.mt} -> ${after4.mt} — the eternal rewrite is REAL now`);
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
