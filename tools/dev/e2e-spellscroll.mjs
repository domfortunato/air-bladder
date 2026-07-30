#!/usr/bin/env node
/**
 * Spellscrolls: a spellbook with `system.scroll` ticked, not a type of its own.
 *
 * Every spellscroll is petty and single-use, so those values are pinned by the
 * document (CairnItem._preCreate/_preUpdate) rather than typed in. That means the
 * interesting assertions are about what happens to data a caller supplies, which
 * no render check can see.
 *
 * Asserts:
 *   1. ticking Scroll pins petty + one use, drops `equipped`, swaps the art, and
 *      makes the item un-equippable; unticking restores the book,
 *   2. the invariant survives a hostile write (weightless false, 5 uses) — while a
 *      SPENT scroll stays spent, which is the one value the pin must not touch,
 *   3. a generated scroll is that same shape: type "spellbook", flagged, stored
 *      under the bare spell name,
 *   4. the inventory row reads "Spellscroll — X" for a scroll and "Spellbook — X"
 *      for a book, and never double-prefixes a legacy stored name,
 *   5. the ready migration converts the OLD shape (`type: "item"` named
 *      "Spellscroll — X") in all three places it can hide — a world item, an owned
 *      item, and an unlinked scene token's delta — preserving flags, sort and
 *      spent-ness. Planted and watched, because on an already-converted world
 *      every other check here passes trivially.
 *
 * Usage: npm run dev:spellscroll
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

const BOOK_ICON = "systems/air-bladder/icons/spellbook.svg";
const SCROLL_ICON = "systems/air-bladder/icons/spellscroll.svg";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const eq = (label, got, want) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(`${label} (${JSON.stringify(got)})`)
    : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/* --- 1/2. the flag, its two transitions, and the invariant under attack ----- */

console.log("\nthe scroll flag");
const flag = await page.evaluate(async () => {
  const snap = (i) => ({
    weightless: i.system.weightless,
    uses: { value: i.system.uses.value, max: i.system.uses.max },
    equipped: i.system.equipped,
    img: i.img,
    isEquipable: i.system.isEquipable,
    glyph: i.system.icon,
  });
  const it = await getDocumentClass("Item").create({
    name: "zz-scroll-probe",
    type: "spellbook",
    img: "systems/air-bladder/icons/spellbook.svg",
    system: { description: "<p>Sticky.</p>", equipped: true },
  });
  const out = { book: snap(it) };

  await it.update({ "system.scroll": true });
  out.scroll = snap(it);

  // A hostile write: un-petty it and ask for five uses.
  await it.update({ system: { weightless: false, uses: { max: 5 } } });
  out.attacked = snap(it);

  // Spend it. This value must NOT be re-pinned by a later unrelated edit.
  await it.update({ "system.uses.value": 0 });
  await it.update({ "system.cost": 7 });
  out.spent = snap(it);

  await it.update({ "system.scroll": false });
  out.unticked = snap(it);
  await it.delete();

  // Created straight from the flag rather than switched into it — a Warden
  // duplicating a scroll, or any importer. It must arrive UNSPENT.
  const fresh = await getDocumentClass("Item").create({
    name: "zz-scroll-fresh", type: "spellbook", system: { scroll: true },
  });
  out.freshFromFlag = snap(fresh);
  await fresh.delete();

  // ...but an explicit count is the caller's, not ours: this is how the migration
  // carries a SPENT scroll across without refilling it.
  const spentAtBirth = await getDocumentClass("Item").create({
    name: "zz-scroll-spent", type: "spellbook", system: { scroll: true, uses: { value: 0, max: 1 } },
  });
  out.spentAtBirth = snap(spentAtBirth);
  await spentAtBirth.delete();

  return out;
});

eq("a plain spellbook is not petty and has no uses",
  { weightless: flag.book.weightless, uses: flag.book.uses }, { weightless: false, uses: { value: 0, max: 0 } });
ok(`a book is equippable (${flag.book.isEquipable}) and shows the ${flag.book.glyph} glyph`);
eq("ticking Scroll pins petty + one use and un-equips",
  { weightless: flag.scroll.weightless, uses: flag.scroll.uses, equipped: flag.scroll.equipped },
  { weightless: true, uses: { value: 1, max: 1 }, equipped: false });
flag.scroll.img === SCROLL_ICON ? ok("art swapped to the scroll") : fail(`art is "${flag.scroll.img}", want ${SCROLL_ICON}`);
flag.scroll.isEquipable === false ? ok("a scroll is not equippable") : fail("a scroll reports isEquipable true");
flag.scroll.glyph === "scroll" ? ok("inventory glyph is fa-scroll") : fail(`glyph is "${flag.scroll.glyph}", want "scroll"`);
eq("the invariant survives a hostile write",
  { weightless: flag.attacked.weightless, max: flag.attacked.uses.max }, { weightless: true, max: 1 });
eq("a spent scroll stays spent across an unrelated edit",
  flag.spent.uses, { value: 0, max: 1 });
eq("unticking restores the book",
  { weightless: flag.unticked.weightless, uses: flag.unticked.uses, img: flag.unticked.img },
  { weightless: false, uses: { value: 0, max: 0 }, img: BOOK_ICON });
eq("a scroll created straight from the flag arrives unspent",
  flag.freshFromFlag.uses, { value: 1, max: 1 });
eq("...but an explicit count is the caller's (a migrated spent scroll stays spent)",
  flag.spentAtBirth.uses, { value: 0, max: 1 });

/* --- 3. what generation builds ---------------------------------------------- */

console.log("\ngenerated scrolls");
const gen = await page.evaluate(async () => {
  const { spellScrollItem, spellNameFromGrant, isScrollGrant } = await import("/systems/air-bladder/module/gear.js");
  const pack = game.packs.get("air-bladder.spellbooks");
  const entry = (await pack.getIndex()).contents[0];
  const book = await pack.getDocument(entry._id);
  const built = spellScrollItem(book);
  return {
    bookName: book.name,
    name: built.name,
    type: built.type,
    scroll: built.system.scroll,
    weightless: built.system.weightless,
    uses: built.system.uses,
    img: built.img,
    routing: {
      scrollGrant: [spellNameFromGrant("Scroll (Adhere)"), isScrollGrant("Scroll (Adhere)")],
      bookGrant: [spellNameFromGrant("Spellbook (Adhere)"), isScrollGrant("Spellbook (Adhere)")],
    },
  };
});

gen.type === "spellbook" ? ok(`a generated scroll is a spellbook, not an item`) : fail(`generated scroll type is "${gen.type}"`);
gen.scroll === true ? ok("it carries the flag") : fail("generated scroll is not flagged");
gen.name === gen.bookName
  ? ok(`stored under the bare spell name ("${gen.name}") — the row adds the prefix`)
  : fail(`stored name is "${gen.name}", want the bare "${gen.bookName}"`);
eq("petty, one use", { weightless: gen.weightless, uses: gen.uses }, { weightless: true, uses: { value: 1, max: 1 } });
gen.img === SCROLL_ICON ? ok("scroll art") : fail(`generated art is "${gen.img}"`);
eq("grant routing still distinguishes a scroll from a book",
  gen.routing, { scrollGrant: ["Adhere", true], bookGrant: ["Adhere", false] });

/* --- 4. the display prefix, in the helper AND on a real sheet ---------------- */

console.log("\ninventory row");
const rows = await page.evaluate(async () => {
  const p = (name, scroll) => Handlebars.helpers.spellbookPrefix(name, scroll);
  const actor = await getDocumentClass("Actor").create({ name: "zz-scroll-actor", type: "character" });
  await actor.createEmbeddedDocuments("Item", [
    { name: "Adhere", type: "spellbook", system: { scroll: true } },
    { name: "Bafflement", type: "spellbook" },
  ]);
  await actor.sheet.render(true);
  for (let k = 0; k < 60 && !actor.sheet.element; k++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 400));
  const titles = [...actor.sheet.element.querySelectorAll(".cairn-item-title")].map((a) => a.textContent.trim());
  await actor.sheet.close();
  await actor.delete();
  return {
    helper: {
      scroll: p("Adhere", true),
      book: p("Adhere", false),
      legacyScroll: p("Spellscroll — Adhere", true),
      legacyBook: p("Spellbook (Adhere)", false),
    },
    titles,
  };
});

eq("the helper prefixes each kind and never doubles a stored one", rows.helper, {
  scroll: "Spellscroll — ", book: "Spellbook — ", legacyScroll: "", legacyBook: "",
});
// The helper being right is worthless if the template does not pass the flag.
rows.titles.some((t) => t.startsWith("Spellscroll — Adhere"))
  ? ok("the sheet renders the scroll row as \"Spellscroll — Adhere\"")
  : fail(`sheet rows were ${JSON.stringify(rows.titles)}`);
rows.titles.some((t) => t.startsWith("Spellbook — Bafflement"))
  ? ok("and the book row as \"Spellbook — Bafflement\"")
  : fail(`sheet rows were ${JSON.stringify(rows.titles)}`);

/* --- 5. the migration, on planted OLD-shape scrolls -------------------------- */

console.log("\nthe ready migration");
// The token gets its OWN actor, whose inventory is otherwise empty, so the delta
// branch is isolated: `token.actor.items` unions the delta with the base actor's
// items, so a token hung off the actor above would show that actor's scroll too and
// neither the plant count nor the result could tell the two branches apart.
const planted = await page.evaluate(async () => {
  const legacy = (name) => ({
    name,
    type: "item",                                  // the old shape
    img: "systems/air-bladder/icons/spellscroll.svg",
    sort: 4200,
    flags: { "air-bladder": { grantSource: "bond:zz" } },
    system: { description: "<p>Sticky.</p>", weightless: true, uses: { value: 0, max: 1 }, cost: 3, quantity: 1 },
  });

  const worldItem = await getDocumentClass("Item").create(legacy("Spellscroll — Adhere"));

  const actor = await getDocumentClass("Actor").create({ name: "zz-scroll-migrate", type: "character" });
  await actor.createEmbeddedDocuments("Item", [legacy("Spellscroll — Bafflement")]);

  const tokenActor = await getDocumentClass("Actor").create({ name: "zz-scroll-token-actor", type: "character" });
  const scene = game.scenes.active ?? game.scenes.contents[0];
  const [token] = await scene.createEmbeddedDocuments("Token", [{
    name: "zz-scroll-token",
    actorId: tokenActor.id,
    actorLink: false,
    x: 100, y: 100,
    texture: { src: tokenActor.img },
  }]);
  // Created THROUGH the synthetic actor, so it lives only in the token's delta —
  // the base actor above stays empty and the actor loop cannot reach this one.
  await token.actor.createEmbeddedDocuments("Item", [legacy("Spellscroll — Charm")]);

  return {
    worldItemId: worldItem.id,
    actorId: actor.id,
    tokenActorId: tokenActor.id,
    sceneId: scene.id,
    tokenId: token.id,
    tokenLegacy: [...token.actor.items].filter((i) => i.type === "item" && i.name.startsWith("Spellscroll")).length,
    baseEmpty: tokenActor.items.size === 0,
  };
});

planted.tokenLegacy === 1 && planted.baseEmpty
  ? ok("planted three old-shape scrolls: a world item, an owned item, an unlinked token's delta")
  : fail(`could not plant the token-delta scroll (delta legacy ${planted.tokenLegacy}, base empty ${planted.baseEmpty})`);

await page.reload({ waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });

// Poll: `game.ready` does not mean the ready hook has finished. Hooks.callAll does
// not await an async callback, and this migration runs after two other phases, each
// a server round trip. A fixed sleep here reads as a flaky probe and is really a
// race against work nobody outside can await.
//
// Wait for NO LEGACY LEFT, not for "a converted one exists". The first version of
// this waited on the latter and raced the migration: the migration creates the
// replacement before deleting the old copy, so mid-flight BOTH exist — and worse, a
// token's actor also reports its base actor's items, so an unrelated conversion on
// the base satisfied the token's condition. The poll exited during that window and
// the cleanup below deleted the token from under the migration, which then failed
// on a create against a token that no longer resolved.
let waited = 0;
for (; waited < 30000; waited += 250) {
  const done = await page.evaluate((p) => {
    const isLegacy = (i) => i.type === "item" && i.name.startsWith("Spellscroll");
    const a = game.actors.get(p.actorId);
    const t = game.scenes.get(p.sceneId)?.tokens.get(p.tokenId);
    return !game.items.get(p.worldItemId)
      && ![...game.items].some(isLegacy)
      && ![...(a?.items ?? [])].some(isLegacy)
      && ![...(t?.actor?.items ?? [])].some(isLegacy);
  }, planted);
  if (done) break;
  await page.waitForTimeout(250);
}

const after = await page.evaluate(async (p) => {
  const shape = (i) => i && ({
    name: i.name, type: i.type, scroll: i.system.scroll, weightless: i.system.weightless,
    uses: { value: i.system.uses.value, max: i.system.uses.max },
    sort: i.sort, grantSource: i.getFlag("air-bladder", "grantSource"),
    description: i.system.description,
  });
  const a = game.actors.get(p.actorId);
  const ta = game.actors.get(p.tokenActorId);
  const t = game.scenes.get(p.sceneId)?.tokens.get(p.tokenId);
  const out = {
    world: [...game.items].filter((i) => i.name === "Adhere" || i.name.startsWith("Spellscroll")).map(shape),
    owned: [...(a?.items ?? [])].map(shape),
    token: [...(t?.actor?.items ?? [])].map(shape),
    baseStillEmpty: (ta?.items.size ?? -1) === 0,
  };
  // Clean up whatever the probe planted, converted or not.
  try { await t?.delete(); } catch { /* leave it */ }
  try { await a?.delete(); } catch { /* leave it */ }
  try { await ta?.delete(); } catch { /* leave it */ }
  for (const i of [...game.items].filter((i) => i.name === "Adhere" || i.name.startsWith("Spellscroll"))) {
    try { await i.delete(); } catch { /* leave it */ }
  }
  return out;
}, planted);

const check = (where, list, wantName) => {
  const it = list[0];
  if (!it) return fail(`${where}: nothing left after the migration`);
  if (list.length !== 1) return fail(`${where}: expected 1 item, found ${list.length} (${list.map((i) => i.name).join(", ")})`);
  if (it.type !== "spellbook" || it.scroll !== true) return fail(`${where}: still ${it.type} / scroll=${it.scroll}`);
  if (it.name !== wantName) return fail(`${where}: name is "${it.name}", want the stripped "${wantName}"`);
  if (!it.weightless || it.uses.max !== 1) return fail(`${where}: invariant not applied (${JSON.stringify(it)})`);
  if (it.uses.value !== 0) return fail(`${where}: a spent scroll came back with ${it.uses.value} uses`);
  if (it.sort !== 4200) return fail(`${where}: sort ${it.sort} lost (inventory order would move)`);
  if (it.grantSource !== "bond:zz") return fail(`${where}: grantSource flag lost — a bond re-roll would orphan it`);
  if (!/Sticky/.test(it.description ?? "")) return fail(`${where}: spell text lost`);
  ok(`${where}: converted to a flagged spellbook "${it.name}", flags/sort/spent-ness intact`);
};

check("world item", after.world, "Adhere");
check("owned item", after.owned, "Bafflement");
check("unlinked token delta", after.token, "Charm");
after.baseStillEmpty
  ? ok("the token's base actor is untouched — the conversion stayed in the delta")
  : fail("the delta conversion leaked onto the token's base actor");
console.log(`  note  migration observed after ${waited}ms`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
if (errors.length) failed = true;
await browser.close();
console.log(failed ? "\nSPELLSCROLL PROBE FAILED" : "\nspellscroll probe passed");
process.exit(failed ? 1 : 0);
