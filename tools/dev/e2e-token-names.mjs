#!/usr/bin/env node
/**
 * Token names follow the actor's name on rename — only where they still matched it.
 *
 * Core copies an actor's name onto a token exactly once, at placement, and never
 * again (common/documents/actor.mjs:96,155 seed only an EMPTY prototype name), so
 * a player who renamed their character on the sheet found every token of theirs
 * still wearing the old name, on every map (reported 2026-08-23). The rule
 * (user ruling, same day): a token still wearing the OLD name follows the actor;
 * a token someone named on purpose keeps its name — core's own convention for
 * the prototype token, applied to placed tokens on every scene. Everything
 * rides CairnActor._preUpdate/_onUpdate — an unlinked token renamed through
 * its own sheet included: the backend runs the pre-update phase on the
 * synthetic Actor FIRST and only then rewrites the request into an ActorDelta
 * operation (client-backend.mjs `_updateDocuments` → `#adjustActorDeltaRequest`),
 * so the stash travels and the synthetic actor's _onUpdate renames its one
 * token. A `preUpdateActorDelta` hook never fires for it — that was the first
 * attempt, and leg 4 is the leg that caught it.
 *
 * Legs:
 *   1. GM renames a PC through the REAL sheet name input: its linked tokens on
 *      TWO scenes take the new name; a linked token wearing a custom name keeps
 *      it; the prototype token follows (it matched).
 *   2. A prototype token named on purpose is left alone by the next rename,
 *      while the placed tokens (which matched) still follow.
 *   3. GM renames a MONSTER base actor: unlinked tokens still wearing the old
 *      name follow on both scenes; "ZZ Goblin 3" keeps its name.
 *   4. An unlinked token renamed through its OWN sheet's actor (the delta):
 *      that one token follows; its sibling on the other scene and the base
 *      actor do not.
 *   5. As PLAYER Alice, owner of the PC: the rename through her sheet renames
 *      her tokens on both scenes — a token's permission is its actor's, so no
 *      GM relay is needed.
 *   6. ART follows the same rule (review #22): the sheet's _setPortrait —
 *      the seam every picker path converges on — carries every placed token
 *      still wearing the OLD art on BOTH scenes, leaves a token whose picture
 *      was set on purpose alone, and never touches another actor's tokens.
 *      The loop it replaced was getActiveTokens(): current scene only,
 *      unconditional overwrite — with the canvas elsewhere it updated NOTHING,
 *      which is this leg's red with the fix removed.
 *   7. A direct prototype-art update on the unlinked monster's base actor
 *      carries its tokens the same way (there was NO placed-token art pass on
 *      this path at all before the rule).
 *   8. Art picked on an unlinked token's OWN sheet (_setPortrait on the
 *      synthetic actor): that one token is written DIRECTLY — ActorDelta
 *      declares no prototypeToken field, so the linked-actor write shape
 *      cannot carry it — and the sibling and base actor keep theirs.
 *
 * Two throwaway scenes and two throwaway actors, swept first and deleted in a
 * Node finally, so an aborted run leaves nothing for the next one to pass on.
 * Needs the seeded player "Alice" (npm run dev:players).
 *
 * Usage: npm run dev:token-names
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const stage = (m) => console.log(`  stage  ${m}`);

const PREFIX = "ZZ TokenName";
const NAMES = {
  pc: `${PREFIX} PC`, monster: `${PREFIX} Monster`,
  sceneA: `${PREFIX} Scene A`, sceneB: `${PREFIX} Scene B`,
  alias: `${PREFIX} Alias`, goblin: "ZZ Goblin 3", proto: `${PREFIX} Proto Custom`,
};

const dog = watchdog(240000, "token-names");
const browser = await chromium.launch();
const gmCtx = await browser.newContext({ viewport: VIEWPORT });
const page = await gmCtx.newPage();
const errors = watchErrors(page);
let alicePage = null;
let aliceErrors = null;

/** Poll the page until `fn` returns truthy or the deadline passes. */
const until = async (pg, fn, arg, ms = 6000) => {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await pg.evaluate(fn, arg);
    if (last) return last;
    await pg.waitForTimeout(150);
  }
  return last;
};

/** Every probe token, by scene, as {name, linked, actorName}. */
const readTokens = (pg) => pg.evaluate((P) => {
  const out = {};
  for (const scene of game.scenes.filter((s) => s.name.startsWith(P))) {
    out[scene.name.endsWith("A") ? "A" : "B"] = scene.tokens.contents
      .map((t) => ({ id: t.id, name: t.name, linked: t.actorLink, actorName: t.actor?.name ?? null, src: t.texture?.src ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}, PREFIX);

try {
  await joinAsGM(page);
  await dismissChrome(page);

  const sweep = async (pg) => pg.evaluate(async (P) => {
    const gone = [];
    for (const s of game.scenes.filter((s) => s.name.startsWith(P))) { await s.delete(); gone.push(`Scene ${s.name}`); }
    for (const a of game.actors.filter((a) => a.name.startsWith(P))) { await a.delete(); gone.push(`Actor ${a.name}`); }
    return gone;
  }, PREFIX);
  const prior = await sweep(page);
  if (prior.length) console.log(`  note  swept ${prior.length} leftover probe document(s) from an earlier run`);

  /* ---- setup: two actors, two scenes, six tokens ------------------------- */
  stage("setup");
  const setup = await page.evaluate(async (N) => {
    const aliceId = game.users.getName("Alice")?.id ?? null;
    const Actor = getDocumentClass("Actor");
    const pc = await Actor.create({
      name: N.pc, type: "character",
      ownership: { default: 0, ...(aliceId ? { [aliceId]: 3 } : {}) },
    });
    const monster = await Actor.create({
      name: N.monster, type: "npc", system: { role: "monster" }, prototypeToken: { actorLink: false },
    });
    const [sceneA, sceneB] = await getDocumentClass("Scene").createDocuments([
      { name: N.sceneA, width: 1000, height: 1000, grid: { size: 100 } },
      { name: N.sceneB, width: 1000, height: 1000, grid: { size: 100 } },
    ]);
    const td = async (actor, x, overrides = {}) =>
      ({ ...(await actor.getTokenDocument({ x, y: 100 })).toObject(), ...overrides });
    await sceneA.createEmbeddedDocuments("Token", [
      await td(pc, 100),
      await td(pc, 300, { name: N.alias }),
      await td(monster, 500),
      await td(monster, 700, { name: N.goblin }),
    ]);
    await sceneB.createEmbeddedDocuments("Token", [await td(pc, 100), await td(monster, 300)]);
    return {
      aliceId, pcId: pc.id, monsterId: monster.id,
      pcProto: pc.prototypeToken.name, monsterProto: monster.prototypeToken.name,
      linkedFlags: [...sceneA.tokens.contents, ...sceneB.tokens.contents].map((t) => `${t.name}:${t.actorLink}`),
    };
  }, NAMES);
  const t0 = await readTokens(page);
  const namesA0 = t0.A?.map((t) => t.name) ?? [];
  const namesB0 = t0.B?.map((t) => t.name) ?? [];
  namesA0.length === 4 && namesB0.length === 2 && setup.pcProto === NAMES.pc
    ? ok(`planted: 4 tokens on Scene A, 2 on Scene B; prototype token named "${setup.pcProto}"`)
    : fail(`setup: A=${JSON.stringify(namesA0)} B=${JSON.stringify(namesB0)} proto=${setup.pcProto}`);
  if (!setup.aliceId) fail("no user named Alice — run `npm run dev:players` first (leg 5 will fail)");

  /* ---- 1. GM renames the PC through the REAL sheet input ---------------- */
  stage("1. rename the PC on its sheet (GM)");
  const NEW1 = `${PREFIX} PC Renamed`;
  const r1 = await page.evaluate(async ({ pcId, NEW1 }) => {
    const pc = game.actors.get(pcId);
    const sheet = pc.sheet;
    await sheet.render(true);
    for (let i = 0; i < 40 && !sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    const input = sheet.element?.querySelector('input[name="name"]');
    if (!input) { await sheet.close(); return { noInput: true }; }
    input.value = NEW1;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 40 && pc.name !== NEW1; i++) await new Promise((r) => setTimeout(r, 100));
    await sheet.close();
    return { actorName: pc.name, proto: pc.prototypeToken.name };
  }, { pcId: setup.pcId, NEW1 });
  if (r1.noInput) fail("no input[name=\"name\"] on the character sheet — the leg proves nothing");
  const t1 = await until(page, (arg) => {
    const [A, B] = game.scenes.filter((s) => s.name.startsWith(arg.P)).sort((a, b) => a.name.localeCompare(b.name));
    const linkedA = A.tokens.filter((t) => t.actorLink && t.name !== arg.alias);
    const linkedB = B.tokens.filter((t) => t.actorLink);
    return linkedA.every((t) => t.name === arg.NEW1) && linkedB.every((t) => t.name === arg.NEW1) ? true : null;
  }, { P: PREFIX, alias: NAMES.alias, NEW1 });
  const tokens1 = await readTokens(page);
  const linked1 = [...tokens1.A, ...tokens1.B].filter((t) => t.linked);
  r1.actorName === NEW1
    ? ok(`the sheet's name input renamed the actor ("${NEW1}")`)
    : fail(`actor name after the sheet edit: "${r1.actorName}"`);
  t1 && linked1.filter((t) => t.name === NEW1).length === 2
    ? ok("both linked tokens that wore the old name follow — on Scene A AND Scene B")
    : fail(`linked tokens after rename: ${JSON.stringify(linked1.map((t) => t.name))}`);
  linked1.some((t) => t.name === NAMES.alias)
    ? ok(`the linked token named on purpose keeps its name ("${NAMES.alias}")`)
    : fail(`the alias token was renamed: ${JSON.stringify(linked1.map((t) => t.name))}`);
  r1.proto === NEW1
    ? ok("the prototype token followed (it matched the old name)")
    : fail(`prototype token after rename: "${r1.proto}"`);

  /* ---- 2. a prototype named on purpose is left alone -------------------- */
  stage("2. a custom prototype name survives the next rename");
  const NEW2 = `${PREFIX} PC Third`;
  const r2 = await page.evaluate(async ({ pcId, proto, NEW2 }) => {
    const pc = game.actors.get(pcId);
    await pc.update({ "prototypeToken.name": proto });
    await pc.update({ name: NEW2 });
    return { proto: pc.prototypeToken.name, name: pc.name };
  }, { pcId: setup.pcId, proto: NAMES.proto, NEW2 });
  const t2 = await until(page, (arg) => {
    const scenes = game.scenes.filter((s) => s.name.startsWith(arg.P));
    const linked = scenes.flatMap((s) => s.tokens.filter((t) => t.actorLink && t.name !== arg.alias));
    return linked.length === 2 && linked.every((t) => t.name === arg.NEW2) ? true : null;
  }, { P: PREFIX, alias: NAMES.alias, NEW2 });
  r2.proto === NAMES.proto && r2.name === NEW2
    ? ok(`a prototype named on purpose is left alone ("${NAMES.proto}") while the actor renames`)
    : fail(`prototype "${r2.proto}", actor "${r2.name}"`);
  t2 ? ok("...and the placed tokens (which matched) still follow") : fail("placed tokens did not follow the second rename");

  /* ---- 3. GM renames the MONSTER base actor ----------------------------- */
  stage("3. rename an unlinked monster's base actor");
  const NEW3 = `${PREFIX} Monster Renamed`;
  await page.evaluate(async ({ id, NEW3 }) => { await game.actors.get(id).update({ name: NEW3 }); }, { id: setup.monsterId, NEW3 });
  const t3 = await until(page, (arg) => {
    const scenes = game.scenes.filter((s) => s.name.startsWith(arg.P));
    const un = scenes.flatMap((s) => s.tokens.filter((t) => !t.actorLink && t.name !== arg.goblin));
    return un.length === 2 && un.every((t) => t.name === arg.NEW3) ? true : null;
  }, { P: PREFIX, goblin: NAMES.goblin, NEW3 });
  const tokens3 = await readTokens(page);
  const un3 = [...tokens3.A, ...tokens3.B].filter((t) => !t.linked);
  t3 ? ok("both unlinked tokens that wore the old name follow the base actor — both scenes")
    : fail(`unlinked tokens after base rename: ${JSON.stringify(un3.map((t) => t.name))}`);
  un3.some((t) => t.name === NAMES.goblin)
    ? ok(`the unlinked token named on purpose keeps its name ("${NAMES.goblin}")`)
    : fail(`"${NAMES.goblin}" was renamed: ${JSON.stringify(un3.map((t) => t.name))}`);

  /* ---- 4. an unlinked token renamed through ITS OWN actor (the delta) --- */
  stage("4. rename one unlinked token through its own sheet's actor");
  const NEW4 = `${PREFIX} Solo`;
  const r4 = await page.evaluate(async ({ P, NEW3, NEW4 }) => {
    const A = game.scenes.filter((s) => s.name.startsWith(P)).sort((a, b) => a.name.localeCompare(b.name))[0];
    const token = A.tokens.find((t) => !t.actorLink && t.name === NEW3);
    if (!token) return { noToken: true };
    await token.actor.update({ name: NEW4 });
    return { tokenId: token.id, baseName: game.actors.get(token.actorId).name };
  }, { P: PREFIX, NEW3, NEW4 });
  const t4 = r4.noToken ? null : await until(page, (arg) => {
    const A = game.scenes.filter((s) => s.name.startsWith(arg.P)).sort((a, b) => a.name.localeCompare(b.name))[0];
    return A.tokens.get(arg.tokenId)?.name === arg.NEW4 ? true : null;
  }, { P: PREFIX, tokenId: r4.tokenId, NEW4 });
  const tokens4 = await readTokens(page);
  t4 ? ok(`the token renamed through its own actor follows ("${NEW4}")`)
    : fail(`token after a delta rename: ${JSON.stringify(tokens4.A?.map((t) => t.name))}`);
  tokens4.B?.some((t) => !t.linked && t.name === NEW3) && r4.baseName === NEW3
    ? ok("its sibling on Scene B and the base actor are untouched")
    : fail(`sibling/base after a delta rename: B=${JSON.stringify(tokens4.B?.map((t) => t.name))}, base="${r4.baseName}"`);

  /* ---- 5. as PLAYER Alice: her rename renames her tokens ---------------- */
  stage("5. the player's own rename (Alice)");
  if (setup.aliceId) {
    const aliceCtx = await browser.newContext({ viewport: VIEWPORT });
    alicePage = await aliceCtx.newPage();
    aliceErrors = watchErrors(alicePage);
    await joinAs(alicePage, "Alice");
    const NEW5 = `${PREFIX} PC Alice`;
    const r5 = await alicePage.evaluate(async ({ pcId, NEW5 }) => {
      const pc = game.actors.get(pcId);
      if (!pc) return { noActor: true };
      const sheet = pc.sheet;
      await sheet.render(true);
      for (let i = 0; i < 40 && !sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      const input = sheet.element?.querySelector('input[name="name"]');
      if (!input) { await sheet.close(); return { noInput: true }; }
      input.value = NEW5;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 40 && pc.name !== NEW5; i++) await new Promise((r) => setTimeout(r, 100));
      await sheet.close();
      return { actorName: pc.name, isGM: game.user.isGM, owner: pc.isOwner };
    }, { pcId: setup.pcId, NEW5 });
    const t5 = await until(page, (arg) => {
      const scenes = game.scenes.filter((s) => s.name.startsWith(arg.P));
      const linked = scenes.flatMap((s) => s.tokens.filter((t) => t.actorLink && t.name !== arg.alias));
      return linked.length === 2 && linked.every((t) => t.name === arg.NEW5) ? true : null;
    }, { P: PREFIX, alias: NAMES.alias, NEW5 });
    r5.isGM === false && r5.owner === true && r5.actorName === NEW5
      ? ok(`Alice (not GM, owner) renamed her character on her sheet ("${NEW5}")`)
      : fail(`Alice's rename: ${JSON.stringify(r5)}`);
    t5 ? ok("her linked tokens on both scenes followed — written from HER client, no GM relay")
      : fail(`tokens after Alice's rename: ${JSON.stringify(await readTokens(page))}`);
  }

  /* ---- 6. ART follows the rule — the sheet's _setPortrait ---------------- */
  stage("6. portrait picked on the sheet: token art follows, both scenes");
  const ART = {
    pc: "icons/svg/cowled.svg", custom: "icons/svg/target.svg",
    monster: "icons/svg/eye.svg", monsterCustom: "icons/svg/skull.svg",
    delta: "icons/svg/pawprint.svg",
  };
  const r6 = await page.evaluate(async ({ pcId, N, ART }) => {
    const pc = game.actors.get(pcId);
    const before = pc.prototypeToken.texture.src;
    // A linked token whose picture someone set ON PURPOSE (the alias token):
    // it must keep its art through the portrait change.
    const A = game.scenes.filter((s) => s.name.startsWith(N.pc.split(" PC")[0])).sort((a, b) => a.name.localeCompare(b.name))[0];
    const alias = A.tokens.find((t) => t.name === N.alias);
    await alias.update({ "texture.src": ART.custom });
    // The REAL seam: every picker path (gallery, URL, browse) lands in
    // _setPortrait. The canvas is on another scene, so the old
    // getActiveTokens() loop would update zero tokens here.
    const sheet = pc.sheet;
    await sheet._setPortrait(ART.pc);
    return { before, img: pc.img, proto: pc.prototypeToken.texture.src, canvasScene: canvas.scene?.name ?? null };
  }, { pcId: setup.pcId, N: NAMES, ART });
  const t6 = await until(page, (arg) => {
    const scenes = game.scenes.filter((s) => s.name.startsWith(arg.P));
    const linked = scenes.flatMap((s) => s.tokens.filter((t) => t.actorLink && t.name !== arg.alias));
    return linked.length === 2 && linked.every((t) => t.texture?.src === arg.art) ? true : null;
  }, { P: PREFIX, alias: NAMES.alias, art: ART.pc });
  const tokens6 = await readTokens(page);
  r6.img === ART.pc && r6.proto === ART.pc
    ? ok(`_setPortrait set the actor and prototype art ("${ART.pc}")`)
    : fail(`after _setPortrait: img="${r6.img}" proto="${r6.proto}"`);
  t6 ? ok("both linked tokens wearing the old art follow — Scene A AND Scene B, canvas elsewhere")
    : fail(`linked token art: ${JSON.stringify([...tokens6.A, ...tokens6.B].filter((t) => t.linked).map((t) => t.src))}`);
  [...tokens6.A, ...tokens6.B].find((t) => t.name === NAMES.alias)?.src === ART.custom
    ? ok(`the token whose picture was set on purpose keeps it ("${ART.custom}")`)
    : fail("the hand-set token art was clobbered by the portrait change");
  [...tokens6.A, ...tokens6.B].filter((t) => !t.linked).every((t) => t.src === r6.before)
    ? ok("the monster's tokens — same old art, different actor — are untouched")
    : fail(`monster token art moved: ${JSON.stringify([...tokens6.A, ...tokens6.B].filter((t) => !t.linked).map((t) => t.src))}`);

  /* ---- 7. a direct prototype-art update on the unlinked base actor ------- */
  stage("7. prototype art on the monster's base actor: unlinked tokens follow");
  await page.evaluate(async ({ id, P, ART, goblin }) => {
    // The unlinked token whose art was set on purpose keeps it (the goblin
    // wears the custom NAME already — give it custom ART too).
    const A = game.scenes.filter((s) => s.name.startsWith(P)).sort((a, b) => a.name.localeCompare(b.name))[0];
    await A.tokens.find((t) => t.name === goblin).update({ "texture.src": ART.monsterCustom });
    await game.actors.get(id).update({ "prototypeToken.texture.src": ART.monster });
  }, { id: setup.monsterId, P: PREFIX, ART, goblin: NAMES.goblin });
  const t7 = await until(page, (arg) => {
    const scenes = game.scenes.filter((s) => s.name.startsWith(arg.P));
    const un = scenes.flatMap((s) => s.tokens.filter((t) => !t.actorLink && t.name !== arg.goblin));
    return un.length === 2 && un.every((t) => t.texture?.src === arg.art) ? true : null;
  }, { P: PREFIX, goblin: NAMES.goblin, art: ART.monster });
  const tokens7 = await readTokens(page);
  t7 ? ok("both unlinked tokens wearing the old art follow the base actor — both scenes")
    : fail(`unlinked token art: ${JSON.stringify([...tokens7.A, ...tokens7.B].filter((t) => !t.linked).map((t) => t.src))}`);
  [...tokens7.A, ...tokens7.B].find((t) => t.name === NAMES.goblin)?.src === ART.monsterCustom
    ? ok(`the hand-set unlinked token keeps its art ("${ART.monsterCustom}")`)
    : fail("the goblin's hand-set art was clobbered");

  /* ---- 8. art picked on an unlinked token's OWN sheet -------------------- */
  stage("8. art picked on one unlinked token's own sheet");
  const r8 = await page.evaluate(async ({ P, ART, NEW4 }) => {
    const A = game.scenes.filter((s) => s.name.startsWith(P)).sort((a, b) => a.name.localeCompare(b.name))[0];
    const token = A.tokens.find((t) => !t.actorLink && t.name === NEW4);
    if (!token) return { noToken: true };
    // The synthetic actor's sheet, the way a Warden reaches it from the
    // canvas. _setPortrait must write THIS token directly — the delta has no
    // prototypeToken field to carry it, and the canvas is on another scene so
    // the old rendered-token loop finds nothing.
    await token.actor.sheet._setPortrait(ART.delta);
    return {
      tokenId: token.id,
      baseProto: game.actors.get(token.actorId).prototypeToken.texture.src,
      baseImg: game.actors.get(token.actorId).img,
    };
  }, { P: PREFIX, ART, NEW4 });
  const t8 = r8.noToken ? null : await until(page, (arg) => {
    const A = game.scenes.filter((s) => s.name.startsWith(arg.P)).sort((a, b) => a.name.localeCompare(b.name))[0];
    return A.tokens.get(arg.tokenId)?.texture?.src === arg.art ? true : null;
  }, { P: PREFIX, tokenId: r8.tokenId, art: ART.delta });
  const tokens8 = await readTokens(page);
  t8 ? ok(`the token whose own sheet picked art follows ("${ART.delta}")`)
    : fail(`token art after a token-sheet pick: ${JSON.stringify(tokens8.A?.map((t) => t.src))}`);
  tokens8.B?.some((t) => !t.linked && t.src === ART.monster) && r8.baseProto === ART.monster && r8.baseImg !== ART.delta
    ? ok("its sibling on Scene B and the base actor keep theirs")
    : fail(`sibling/base after a token-sheet pick: B=${JSON.stringify(tokens8.B?.map((t) => t.src))}, baseProto="${r8.baseProto}", baseImg="${r8.baseImg}"`);

  /* ---- console errors ---------------------------------------------------- */
  const errs = [...errors, ...(aliceErrors ?? [])];
  errs.length === 0 ? ok("console errors: 0") : errs.forEach((e) => fail(`console error: ${e}`));

  const left = await sweep(page);
  console.log(`  note  cleaned up ${left.length} probe document(s)`);
} catch (e) {
  fail(`threw: ${e.message}`);
  try { await page.evaluate(async (P) => {
    for (const s of game.scenes.filter((s) => s.name.startsWith(P))) await s.delete();
    for (const a of game.actors.filter((a) => a.name.startsWith(P))) await a.delete();
  }, PREFIX); } catch {}
} finally {
  clearTimeout(dog);
  console.log(`\n${failed ? "TOKEN NAMES PROBE FAILED" : "Token names probe passed."}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
