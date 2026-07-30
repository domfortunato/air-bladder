#!/usr/bin/env node
/**
 * Feature descriptions are injected as HTML into the GM's sheet, and the SERVER
 * cannot sanitize them. This proves the client does.
 *
 * `npm run dev:sanitize` covers the other half of the same threat and cannot cover
 * this one. That probe proves `system.json`'s `htmlFields` declaration reaches the
 * server; but `htmlFields` addresses TOP-LEVEL SCHEMA PATHS, and `system.features`
 * is an `ArrayField(ObjectField)` (data-models.js:171,205). The server has no schema
 * for the interior of an ObjectField, so no manifest edit can ever make it clean
 * what is stored in there. `check:fields` is blind for the same reason and says so
 * (field-audit.mjs:70-80, ArrayField elements are leaves BY DESIGN).
 *
 * So the defence is the sink, and this asserts the sink: a player writes a payload
 * to a feature on their OWN character, the GM expands that feature, and nothing
 * executes.
 *
 * MUST run as a real PLAYER for the write. The finding is a privilege escalation —
 * a probe that only shows a GM cannot inject into their own sheet tests nothing.
 *
 * Two positive controls, both load-bearing, both learned the hard way when the
 * first version of this probe reported a clean pass against the UNFIXED code:
 *
 *   1. the payload must reach storage VERBATIM. If the server ever started
 *      cleaning it, every assertion below would pass without exercising the sink.
 *   2. the panel must actually render, and its benign tail must survive. A feature
 *      written without an `id` renders a row whose `data-item-id` is empty;
 *      `getOwnedFeature` looks up by that id (actor.js:259), returns undefined, the
 *      callback bails and NOTHING is injected — indistinguishable from "the sink is
 *      safe" unless you check that something got injected.
 *
 * Usage: npm run dev:feature-xss   (needs Alice — npm run dev:players)
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog, withSettings } from "./lib.mjs";

const ACTOR_NAME = "ZZ Feature XSS PC";

// The benign tail separates "cleaned" from "blanked" or "never written".
const PAYLOAD =
  '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>' +
  '<a href="javascript:alert(1)">j</a><em>keep me</em>';

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(180000, "feature-xss probe");

const gmPage = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const gmErrors = watchErrors(gmPage);
await joinAsGM(gmPage);
await dismissChrome(gmPage);

let pcId = null;

try {
  await withSettings(gmPage, async () => {
    /* --- GM seeds a character Alice owns -------------------------------- */

    const scene = await gmPage.evaluate(async (name) => {
      const alice = game.users.getName("Alice");
      if (!alice) return { error: "no Alice — run npm run dev:players" };
      // Delete leftovers FIRST: a stale actor from an aborted run could satisfy
      // this probe's precondition without the current code ever writing anything.
      for (const stale of game.actors.filter((a) => a.name === name)) await stale.delete();
      await game.settings.set("air-bladder", "show-features-section", true);
      const pc = await CONFIG.Actor.documentClass.create({ name, type: "character" });
      await pc.update({ ownership: { default: 0, [alice.id]: 3 } });
      return { pcId: pc.id };
    }, ACTOR_NAME);

    if (scene.error) { fail(`setup: ${scene.error}`); return; }
    pcId = scene.pcId;

    /* --- Alice writes the payload as herself ---------------------------- */

    console.log("\nthe write, as a player");
    const alicePage = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
    watchErrors(alicePage);
    await joinAs(alicePage, "Alice");
    await dismissChrome(alicePage);

    const written = await alicePage.evaluate(async ({ id, payload }) => {
      const pc = game.actors.get(id);
      const out = { isGM: game.user.isGM, role: game.user.role, owns: pc?.isOwner ?? false };
      // randomID is not decoration — see the header. Without it the sheet row
      // carries no item id and the description callback never reaches innerHTML.
      const featureId = foundry.utils.randomID();
      try {
        await pc.update({ "system.features": [{ id: featureId, name: "ZZ XSS Feature", description: payload }] });
        out.stored = pc.system.features?.[0]?.description;
      } catch (e) { out.error = e.message; }
      return out;
    }, { id: pcId, payload: PAYLOAD });

    if (written.isGM) fail("writer is a player — joined as a GM, the probe proves nothing");
    else ok(`writer is a real player (role ${written.role}, owns the actor: ${written.owns})`);

    if (written.error) { fail(`the write threw: ${written.error}`); return; }

    // Positive control 1. If this ever goes green the threat model changed and the
    // rest of this probe is vacuous, so it is a FAILURE of the probe, not a pass.
    if (!/onerror/i.test(written.stored ?? "")) {
      fail("payload reached storage verbatim — the server appears to have cleaned it, "
        + "so this probe can no longer exercise the sink");
      return;
    }
    ok("payload stored verbatim by the server (the hole the sink must cover)");

    /* --- The GM expands the feature ------------------------------------- */

    console.log("\nthe sink, as the GM");
    const sheetId = await gmPage.evaluate(async (id) => {
      window.__xss = 0;
      const pc = game.actors.get(id);
      await pc.sheet.render(true);
      pc.sheet.changeTab("description", "primary");
      return pc.sheet.id;
    }, pcId);

    await gmPage.click(`#${sheetId} .cairn-feature-title`);
    // Long enough for the slideDown AND for a failed image load to fire onerror.
    await gmPage.waitForTimeout(2000);

    const seen = await gmPage.evaluate((sid) => {
      const panel = document.querySelector(`#${sid} .cairn-items-list-row.expanded .item-description`);
      return {
        xss: window.__xss ?? 0,
        html: panel ? panel.innerHTML : null,
        onerrorAttrs: panel ? [...panel.querySelectorAll("*")].filter((el) => el.hasAttribute("onerror")).length : null,
      };
    }, sheetId);

    // Positive control 2 — before any negative assertion means anything.
    if (seen.html === null) {
      fail("the description panel rendered — nothing was injected at all, so the "
        + "negative assertions below would pass against vulnerable code");
      return;
    }
    ok("the description panel rendered");

    if (/keep me/.test(seen.html)) ok("benign content survived cleaning (<em>keep me</em>)");
    else fail(`benign content lost — the panel holds ${JSON.stringify(seen.html)}`);

    const dirty = [
      [/onerror/i, "onerror="],
      [/<script/i, "<script>"],
      [/javascript:/i, "javascript:"],
    ].filter(([re]) => re.test(seen.html)).map(([, n]) => n);

    if (dirty.length) fail(`injected HTML still carries ${dirty.join(", ")} — ${JSON.stringify(seen.html)}`);
    else ok(`injected HTML is clean — ${JSON.stringify(seen.html)}`);

    if (seen.onerrorAttrs) fail(`${seen.onerrorAttrs} element(s) in the panel still carry an onerror attribute`);
    else ok("no element in the panel carries an event-handler attribute");

    if (seen.xss) fail(`the payload EXECUTED in the GM's client (window.__xss = ${seen.xss})`);
    else ok("nothing executed in the GM's client");

    // Positive control 3. The planted <img src=x> cannot resolve, so the browser
    // logs a 404 — and that 404 is the PROOF the image was live in the document
    // and fetched. It is the exact moment `onerror` would have fired; that it did
    // not is the finding fixed. No 404 would mean the img never made it into the
    // DOM, which would make "nothing executed" meaningless.
    const notFound = gmErrors.filter((e) => /Failed to load resource/i.test(e) && /404/.test(e));
    if (notFound.length) ok("the sanitized <img> was fetched and 404'd, with no handler to fire");
    else fail("no 404 for the planted <img> — it never reached the DOM, so 'nothing executed' proves nothing");
    // Consumed, so the generic console-error sweep below does not re-report them.
    for (const e of notFound) gmErrors.splice(gmErrors.indexOf(e), 1);
  });
} finally {
  // From Node, not from an in-page finally: an exception inside page.evaluate
  // propagates out here, where a cleanup step still runs.
  if (pcId) {
    await gmPage.evaluate(async (id) => { await game.actors.get(id)?.delete(); }, pcId).catch(() => {});
  }
}

if (gmErrors.length) { console.log(""); for (const e of gmErrors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "FEATURE XSS PROBE FAILED" : "Feature XSS probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);
