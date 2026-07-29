/**
 * Server-side HTML sanitization e2e — the manifest gate that stops a player XSSing
 * the Warden.
 *
 * Declaring an `HTMLField` in `module/data-models.js` does nothing for security.
 * The Foundry SERVER never loads the data models; the only channel telling it which
 * `system.*` paths hold HTML is `system.json` ->
 * `documentTypes.<Document>.<subtype>.htmlFields`. With that omitted the server's
 * per-type sanitization schema is empty, `cleanHTML` is never reached, and the
 * field is stored byte-for-byte as written — then injected unescaped into every
 * viewer's sheet. That was true of this system until 2026-07-29.
 *
 * `npm run check:fields` guards the DECLARATION offline and is the cheap gate. This
 * one proves the declaration actually takes effect, which the manifest alone cannot
 * tell you: the server reads `system.json` only at STARTUP, so an edit that has not
 * been followed by a restart looks identical to no edit at all.
 *
 * MUST run as a real PLAYER. Not because a GM's writes escape sanitization — they
 * do not — but because the finding is a privilege escalation, and a probe that only
 * ever proves "a GM cannot inject into their own sheet" is not testing the threat.
 *
 * Covers one Actor sub-type and one Item sub-type, since they are separate manifest
 * entries and declaring one while forgetting the other is the obvious half-fix.
 *
 * Usage: npm run dev:sanitize   (needs Alice — npm run dev:players)
 */

import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(38)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(38)} ${detail}`); failures++; };
let failures = 0;

// The benign tail is load-bearing: it distinguishes "the server cleaned it" from
// "the write never landed" and from "the field was blanked", both of which would
// otherwise satisfy a purely negative assertion.
const PAYLOAD =
  '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>' +
  '<a href="javascript:alert(1)">j</a><em>keep me</em>';

const browser = await chromium.launch();

const gmPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
const gmErrors = watchErrors(gmPage);
await joinAsGM(gmPage);
await dismissChrome(gmPage);

/* ---- GM sets the scene ---------------------- */

const scene = await gmPage.evaluate(async () => {
  const alice = game.users.getName("Alice");
  if (!alice) return { error: "no Alice — run npm run dev:players" };

  const pc = await CONFIG.Actor.documentClass.create({ name: "ZZ Sanitize PC", type: "character" });
  await pc.update({ ownership: { default: 0, [alice.id]: 3 } });
  const [weapon] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Sanitize Blade", type: "weapon" }]);

  return { pcId: pc.id, pcUuid: pc.uuid, weaponId: weapon.id };
});

if (scene.error) {
  console.log(`  FAIL  setup: ${scene.error}`);
  await browser.close();
  process.exit(1);
}

/* ---- Alice writes the payload as herself ---- */

const alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
const aliceErrors = watchErrors(alicePage);
await joinAs(alicePage, "Alice");
await dismissChrome(alicePage);

const written = await alicePage.evaluate(async ({ pcId, weaponId, payload }) => {
  const pc = game.actors.get(pcId);
  const out = { isGM: game.user.isGM, role: game.user.role, owns: pc?.isOwner ?? false };
  try {
    await pc.update({ "system.notes": payload });
    out.actorNotes = pc.system.notes;
  } catch (e) { out.actorError = e.message; }
  try {
    await pc.items.get(weaponId).update({ "system.description": payload });
    out.itemDescription = pc.items.get(weaponId).system.description;
  } catch (e) { out.itemError = e.message; }
  return out;
}, { pcId: scene.pcId, weaponId: scene.weaponId, payload: PAYLOAD });

console.log(`\nWriter: role ${written.role}, isGM ${written.isGM}, owns the actor: ${written.owns}\n`);
if (written.isGM) fail("writer is a player", "joined as a GM — the probe proves nothing");
else ok("writer is a real player", `role ${written.role}`);

/* ---- Assert the server cleaned both --------- */

const check = (label, stored, err) => {
  if (err) return fail(label, `write threw: ${err}`);
  if (stored === undefined || stored === null) return fail(label, "field is missing");
  const dirty = [
    [/onerror/i, "onerror="],
    [/<script/i, "<script>"],
    [/javascript:/i, "javascript:"],
  ].filter(([re]) => re.test(stored)).map(([, n]) => n);
  if (dirty.length) return fail(label, `stored VERBATIM — ${dirty.join(", ")} survived`);
  if (!/keep me/.test(stored)) return fail(label, `benign content lost — got ${JSON.stringify(stored)}`);
  ok(label, JSON.stringify(stored));
};

check("Actor.character system.notes", written.actorNotes, written.actorError);
check("Item.weapon system.description", written.itemDescription, written.itemError);

/* ---- Re-read from the server, not the cache -- */
// The client applies the server's response, so the values above are already what
// was stored. Re-reading in the GM's session confirms it independently, and is the
// form a viewer actually sees.

const asGm = await gmPage.evaluate(({ pcId, weaponId }) => {
  const pc = game.actors.get(pcId);
  return { notes: pc?.system.notes, desc: pc?.items.get(weaponId)?.system.description };
}, { pcId: scene.pcId, weaponId: scene.weaponId });

check("as seen by the GM: notes", asGm.notes);
check("as seen by the GM: description", asGm.desc);

/* ---- Clean up ------------------------------- */

await gmPage.evaluate(async ({ pcId }) => { await game.actors.get(pcId)?.delete(); }, { pcId: scene.pcId });

// watchErrors returns the accumulating ARRAY, not a getter.
const errs = [...gmErrors, ...aliceErrors];
if (errs.length) { console.log(""); for (const e of errs) fail("console error", e); }

console.log(`\n${failures ? `SANITIZE PROBE FAILED — ${failures} problem(s)` : "Sanitize probe passed."}`);
await browser.close();
process.exit(failures ? 1 : 0);
