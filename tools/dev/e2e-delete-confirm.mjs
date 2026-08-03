#!/usr/bin/env node
/**
 * A row must not vanish before the Warden has answered "Delete X?".
 *
 *   npm run dev:delete-confirm      (dev world on :30000, which runs the working tree)
 *
 * `deleteOwnedItem` and `deleteOwnedFeature` both AWAIT a confirm dialog before
 * they delete anything, and both sheet handlers used to fire an optimistic
 * `slideUp(row, () => this.render(false))` on the same tick. So the row
 * collapsed to nothing while the question was still on screen, and 200ms later
 * the animation's callback re-rendered the sheet — with the item still there,
 * because nobody had answered yet. Decline, and you had watched a delete that
 * never happened.
 *
 * The connected-actor branch of the same handler dropped its slide in review #5
 * (an Actor delete can also be REFUSED by the server: Assistant+, ungrantable).
 * The decline half of that reasoning covers all three branches, and the other
 * two never got it — review #7 finding 7.
 *
 * THREE INDEPENDENT READINGS while the dialog is open, because any one of them
 * alone could be argued away:
 *
 *   - `Element.prototype.animate` is wrapped in-page and counts calls on
 *     `.cairn-items-list-row`. The slide was the ONLY thing that touched the row
 *     optimistically, so this is the mechanism, measured directly. Pre-fix 1,
 *     post-fix 0.
 *   - the row's `offsetHeight`, sampled every 30ms for ~450ms (twice the 200ms
 *     slide). Pre-fix it reaches 0; post-fix it never leaves its full height.
 *   - `row.isConnected`, which goes false pre-fix when the slide's callback
 *     re-renders the sheet out from under an unanswered question.
 *
 * Then the answer itself: decline leaves the item in place, and a second pass
 * that accepts must really delete it — otherwise "nothing disappeared" would
 * pass on a delete control that does nothing at all.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const NAME = "ZZ DelConfirm";
let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(30)} ${detail}`);
};

const browser = await chromium.launch();
watchdog(240000, "delete-confirm probe");
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const sweep = () => page.evaluate(async (n) => {
  for (const a of game.actors.filter((x) => x.name?.startsWith(n))) await a.delete();
}, NAME);

try {
  await sweep();

  /* Fixture: one item and one feature on one character. -------------------- */
  const ids = await page.evaluate(async (n) => {
    const actor = await CONFIG.Actor.documentClass.create({ name: `${n} Victim`, type: "character" });
    const [item] = await actor.createEmbeddedDocuments("Item", [{ name: `${n} Item`, type: "item" }]);
    await actor.createOwnedFeature({ name: `${n} Feature`, description: "<p>a feature</p>" });
    const feature = actor.system.features.at(-1);
    await actor.sheet.render(true);
    return { actorId: actor.id, itemId: item.id, featureId: feature.id };
  }, NAME);
  await page.waitForSelector(".cairn.sheet.actor", { timeout: 15000 });

  /* Wrap Element.animate so the optimistic slide is counted, not inferred. -- */
  await page.evaluate(() => {
    const orig = Element.prototype.animate;
    globalThis.__abAnimOrig = orig;
    globalThis.__abRowAnims = [];
    Element.prototype.animate = function (...args) {
      if (this.classList?.contains("cairn-items-list-row")) {
        globalThis.__abRowAnims.push(this.dataset.itemId ?? "(no id)");
      }
      return orig.apply(this, args);
    };
  });

  /**
   * Click a row's delete control and watch the row for as long as the question
   * is on screen. Returns the three readings plus proof the dialog appeared —
   * without that, every "nothing happened" reading passes trivially.
   */
  const watchWhileAsking = (rowId, action) => page.evaluate(async ({ rowId, action }) => {
    const sheet = document.querySelector(".cairn.sheet.actor");
    const row = sheet.querySelector(`.cairn-items-list-row[data-item-id="${rowId}"]`);
    if (!row) return { found: false };
    const animsBefore = globalThis.__abRowAnims.length;
    const startHeight = row.offsetHeight;
    row.querySelector(`[data-action="${action}"]`).click();

    let dialogShown = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      if (document.querySelector("dialog.dialog button[data-action='yes']")) { dialogShown = true; break; }
      await new Promise((r) => setTimeout(r, 20));
    }
    // ~450ms of sampling: the slide ran for 200ms and re-rendered on finishing,
    // so a window twice its length cannot miss either half.
    let minHeight = row.offsetHeight;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 30));
      minHeight = Math.min(minHeight, row.offsetHeight);
    }
    return {
      found: true,
      dialogShown,
      startHeight,
      minHeight,
      rowAnimations: globalThis.__abRowAnims.length - animsBefore,
      rowStillInDom: row.isConnected,
    };
  }, { rowId, action });

  const answer = async (which) => {
    await page.locator(`dialog.dialog button[data-action='${which}']`).click();
    await page.waitForSelector("dialog.dialog button[data-action='yes']", { state: "detached", timeout: 10000 });
    await page.waitForTimeout(500);
  };

  const stillThere = (kind) => page.evaluate(({ kind, actorId, itemId, featureId }) => {
    const actor = game.actors.get(actorId);
    return kind === "item"
      ? !!actor.items.get(itemId)
      : !!actor.system.features.find((f) => f.id === featureId);
  }, { kind, ...ids });

  /* 1. An ITEM row, declined ----------------------------------------------- */
  console.log("\nan item row, while the question is on screen");
  const item = await watchWhileAsking(ids.itemId, "itemDelete");
  check("the confirm appeared", item.found && item.dialogShown,
    "no dialog means every reading below passes for the wrong reason");
  check("no slide on the row", item.rowAnimations === 0,
    `animate() calls on the row: ${item.rowAnimations} (the optimistic slide, measured directly)`);
  check("row keeps its height", item.minHeight > 0 && item.minHeight === item.startHeight,
    `height ${item.startHeight} -> min ${item.minHeight} while asking`);
  check("row still in the DOM", item.rowStillInDom,
    "the slide's callback re-rendered the sheet under an unanswered question");
  await answer("no");
  check("declining keeps the item", await stillThere("item"), "answering \"no\" deleted nothing");

  /* 2. ...and accepting really deletes ------------------------------------- */
  const itemAgain = await watchWhileAsking(ids.itemId, "itemDelete");
  check("the confirm appeared again", itemAgain.dialogShown, "the row survived the decline and is clickable");
  await answer("yes");
  check("accepting deletes it", !(await stillThere("item")),
    "otherwise \"nothing vanished\" would pass on a control that does nothing");

  /* 3. A FEATURE row, same two passes -------------------------------------- */
  console.log("\na feature row, while the question is on screen");
  await page.locator('.cairn.sheet.actor nav [data-tab="description"]').click();
  await page.waitForTimeout(400);
  const feat = await watchWhileAsking(ids.featureId, "featureDelete");
  check("the confirm appeared", feat.found && feat.dialogShown, "");
  check("no slide on the row", feat.rowAnimations === 0,
    `animate() calls on the row: ${feat.rowAnimations}`);
  check("row keeps its height", feat.minHeight > 0 && feat.minHeight === feat.startHeight,
    `height ${feat.startHeight} -> min ${feat.minHeight} while asking`);
  check("row still in the DOM", feat.rowStillInDom, "");
  await answer("no");
  check("declining keeps the feature", await stillThere("feature"), "");

  const featAgain = await watchWhileAsking(ids.featureId, "featureDelete");
  check("the confirm appeared again", featAgain.dialogShown, "");
  await answer("yes");
  check("accepting deletes it", !(await stillThere("feature")), "");
} finally {
  // Restore from NODE: an exception inside page.evaluate propagates out of it,
  // so an in-page restore after the throw never runs and the world keeps a
  // patched Element.prototype.animate for the rest of the session.
  await page.evaluate(() => {
    if (globalThis.__abAnimOrig) {
      Element.prototype.animate = globalThis.__abAnimOrig;
      delete globalThis.__abAnimOrig;
      delete globalThis.__abRowAnims;
    }
  }).catch(() => {});
  await sweep().catch(() => {});
  await browser.close();
}

if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }
console.log(bad === 0 ? "\ndelete-confirm e2e passed" : `\ndelete-confirm e2e FAILED — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
