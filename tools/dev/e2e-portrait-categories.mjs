#!/usr/bin/env node
/**
 * Reserved per-category custom portrait folders (issue #18, fsmalecho) — e2e.
 *
 *   npm run dev:portrait-categories   (dev world on :30000, which runs the working tree)
 *
 * A folder named `pc`, `npc`, `monster` or `companion` at the top level of the
 * Warden's custom portrait folder becomes that category's auto-assignment pool.
 * The rule lives in one helper (`customPoolFor`), but the CATEGORY is a literal
 * at each call site, so a probe that only exercised the helper would pass while
 * every generated NPC drew from `pc/`. Every leg below therefore goes through
 * the real creation path — Actor.create for a hand-made npc, createMonster for
 * a monster, grantContainers for a beast — and only the pool-shape assertions
 * read the helper directly.
 *
 * Three planted roots, because the interesting cases are about what is ABSENT:
 *
 *   zz-pcat-full   pc/ npc/ monster/ companion/ + one loose image
 *   zz-pcat-mon    monster/ + one loose image     (the exclusion ruling)
 *   zz-pcat-flat   faces/ + one loose image       (no reserved names at all)
 *
 * The two negative ones matter most. `zz-pcat-mon` proves the general pool
 * EXCLUDES the reserved folders: without that, a Warden who had sorted only
 * their monster art would find every player character generated wearing it —
 * the feature making things worse for the one category they had bothered to
 * file. And `zz-pcat-flat` proves monsters and companions do NOT inherit the
 * general pool: they have never drawn from it, and a Warden with an unsorted
 * folder of faces must not wake up to monsters wearing them.
 *
 * FilePicker has no delete API, so the planted folders survive the run by
 * design; the uploads overwrite, so a re-run is idempotent. The setting and
 * every actor this creates ARE restored, and the restore is asserted.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, withSettings } from "./lib.mjs";

let failures = 0;
const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(44)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(44)} ${detail}`); failures++; };
const check = (cond, label, detail) => (cond ? ok(label, detail) : fail(label, detail));
/** Every entry sits under `dir`, and there is at least one. */
const allUnder = (list, dir) => Array.isArray(list) && list.length > 0
  && list.every((p) => String(p).startsWith(`${dir}/`));

const FULL = "zz-pcat-full";
const MON = "zz-pcat-mon";
const FLAT = "zz-pcat-flat";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

// Sweep by the id DIFFERENCE, never by name: a leftover from an aborted run
// would otherwise be deleted, or worse, satisfy an assertion this run never
// earned.
const idsBefore = await page.evaluate(() => game.actors.map((a) => a.id));

let R = {};
await withSettings(page, async () => {
  R = await page.evaluate(async ({ FULL, MON, FLAT }) => {
    const NS = "air-bladder";
    const FP = foundry.applications.apps.FilePicker.implementation;
    const cg = game.cairn.characterGenerator;
    const mg = game.cairn.monsterGenerator;
    const Cls = CONFIG.Actor.documentClass;
    const out = { prior: game.settings.get(NS, "custom-portrait-folder"), errors: [] };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, ms = 12000) => {
      const deadline = Date.now() + ms;
      for (;;) {
        if (test()) return true;
        if (Date.now() > deadline) return false;
        await sleep(120);
      }
    };
    const mkdir = async (p) => {
      try { await FP.browse("data", p); } catch { await FP.createDirectory("data", p).catch(() => {}); }
    };
    // A 1x1 transparent PNG — enough for the extension filter, and small enough
    // that nine uploads cost nothing.
    const B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const put = async (dir, name) => {
      const bin = Uint8Array.from(atob(B64), (c) => c.charCodeAt(0));
      await FP.upload("data", dir, new File([bin], name, { type: "image/png" }), {}, { notify: false });
    };
    /* Point the setting at a root and WAIT for the scan its onChange runs.
     * Not a fixed sleep: the scan is one HTTP round trip per folder plus the
     * list write's own server round trip, and a fixed sleep sat exactly on that
     * edge in this probe's older sibling — every read saw the PREVIOUS
     * transition.
     *
     * And not a COUNT either, which is how this first went red. Two of the three
     * planted roots hold two files each, so "wait until the list is 2 long" was
     * ALREADY TRUE of the outgoing root: the wait returned instantly and the
     * first draws ran against the previous folder. Settling on the PATHS is
     * unambiguous — every entry has to name the root being switched to. */
    const useFolder = async (dir, expect) => {
      await game.settings.set(NS, "custom-portrait-folder", dir);
      const deadline = Date.now() + 20000;
      for (;;) {
        const l = game.settings.get(NS, "custom-portrait-list");
        const settled = l.length === expect && l.every((p) => p.startsWith(`${dir}/`));
        if (settled || Date.now() > deadline) return l;
        await sleep(150);
      }
    };
    /* createMonster opens the tier picker and waits on it, so the click has to
     * happen while the promise is still in flight. "random" rather than a named
     * tier: the tier decides nothing about art, and naming one would make this
     * leg quietly depend on which buttons exist. */
    const makeMonster = async (name) => {
      const p = mg.createMonster();
      const shown = await until(() => !!document.querySelector('dialog button[data-action="random"]'));
      if (!shown) { out.errors.push("the tier dialog never opened"); return null; }
      document.querySelector('dialog button[data-action="random"]').click();
      const a = await p;
      if (a) await a.update({ name });
      return a;
    };
    const draws = async (n, fn) => {
      const seen = [];
      for (let i = 0; i < n; i++) seen.push(await fn());
      return seen;
    };

    try {
      /* --- plant ---------------------------------------------------------- */
      for (const d of [
        FULL, `${FULL}/pc`, `${FULL}/npc`, `${FULL}/monster`, `${FULL}/companion`,
        MON, `${MON}/monster`, FLAT, `${FLAT}/faces`,
      ]) await mkdir(d);
      await put(FULL, "loose-face.png");
      await put(`${FULL}/pc`, "pc-face.png");
      await put(`${FULL}/npc`, "npc-face.png");
      await put(`${FULL}/monster`, "monster-face.png");
      await put(`${FULL}/companion`, "companion-face.png");
      // A SECOND image in two of them, purely so the portrait die has somewhere
      // to go. With one image in the folder, "the die stayed in monster/" is an
      // unfailable leg — the die avoids the current image only while the pool
      // holds anything else, so a one-image pool returns what it already had
      // and the assertion passes on a fix that is not there.
      await put(`${FULL}/pc`, "pc-face-2.png");
      await put(`${FULL}/monster`, "monster-face-2.png");
      await put(MON, "mon-loose.png");
      await put(`${MON}/monster`, "mon-only.png");
      await put(FLAT, "flat-loose.png");
      await put(`${FLAT}/faces`, "flat-face.png");

      /* --- 1. all four folders present ------------------------------------ */
      out.fullList = await useFolder(FULL, 7);
      out.poolGeneral = cg.customPoolFor(null);
      out.poolPc = cg.customPoolFor("pc");
      out.poolNpc = cg.customPoolFor("npc");
      out.poolMonster = cg.customPoolFor("monster");
      out.poolCompanion = cg.customPoolFor("companion");

      out.pairPc = (await draws(12, () => cg.randomPortraitPair("pc"))).map((p) => p?.img);
      out.pairNpc = (await draws(12, () => cg.randomPortraitPair("npc"))).map((p) => p?.img);

      // The npc _preCreate call site, through a real Actor.create.
      const npcActor = await Cls.create({ name: "ZZ Cat Npc", type: "npc", system: { role: "npc" } });
      out.npcImg = npcActor?.img ?? "";
      out.npcToken = npcActor?.prototypeToken?.texture?.src ?? "";

      // The monster call site, through the directory button's own function.
      const monster = await makeMonster("ZZ Cat Monster");
      out.monsterImg = monster?.img ?? "";
      out.monsterToken = monster?.prototypeToken?.texture?.src ?? "";

      // The companion grant call site. A name the Mounts & Transports pack does
      // NOT carry, because a resolved document's own art always wins and this
      // leg is about the one-off beast that has none.
      const keeper = await Cls.create({ name: "ZZ Cat Keeper", type: "character" });
      const granted = await cg.grantContainers(keeper, [{ name: "ZZ Mangy Wolfdog", slots: 2, grantSource: "probe" }]);
      out.companionImg = granted?.[0]?.img ?? "";
      out.companionRole = granted?.[0]?.system?.role ?? "";

      // The die stays inside the folder its current art came from.
      out.dieMonster = await draws(12, () => cg.randomPortraitInSameFolder(`${FULL}/monster/monster-face.png`, "monster"));
      out.diePc = await draws(12, () => cg.randomPortraitInSameFolder(`${FULL}/pc/pc-face.png`, "pc"));

      // THE SHEET'S OWN DIE, through the real button. The two draws above pass
      // the category themselves, so neither can catch actor-sheet.js threading
      // the wrong one — or none at all, which is what it did before this change
      // and what would send a monster to a shopkeeper's face.
      if (monster) {
        // A generated monster ships `generationEnabled: false`, and the die is
        // rendered behind that flag — so without this the button does not exist
        // and the leg fails on a missing element rather than on the rule. A
        // Warden reaches the same state through the sheet's own generation
        // toggle; nothing here is a state a person could not produce.
        await monster.update({ "system.generationEnabled": true });
        const ms = monster.sheet;
        await ms.render(true);
        const armed = await until(() => !!ms.element?.querySelector('[data-action="rollPortrait"]'));
        if (!armed) {
          out.errors.push("the portrait die never rendered on the monster sheet");
        } else {
          const was = monster.img;
          ms.element.querySelector('[data-action="rollPortrait"]').click();
          await until(() => monster.img !== was);
          out.dieViaSheet = { was, now: monster.img };
        }
        await ms.close();
      }

      // The picker still offers the WHOLE tree, with the reserved tiles named.
      const sheet = keeper.sheet;
      await sheet.render(true);
      await until(() => !!sheet.element);
      await sheet._pickPortrait(new Event("click"));
      const opened = await until(() => [...foundry.applications.instances.values()]
        .some((x) => x.element?.querySelector(".cairn-portrait-gallery")));
      const dlg = opened
        ? [...foundry.applications.instances.values()].find((x) => x.element?.querySelector(".cairn-portrait-gallery"))
        : null;
      if (dlg) {
        const pane = dlg.element.querySelector('[data-pane="custom"]');
        out.tileLabels = [...(pane?.querySelectorAll(".cairn-icon-folder span") ?? [])].map((s) => s.textContent.trim());
        out.tileKeys = [...(pane?.querySelectorAll(".cairn-icon-folder") ?? [])].map((f) => f.dataset.category);
        await dlg.close();
      } else {
        out.errors.push("the portrait picker never opened");
      }
      await sheet.close();

      /* --- 2. only `monster/` filled: the exclusion ruling ----------------- */
      out.monList = await useFolder(MON, 2);
      out.monGeneral = cg.customPoolFor(null);
      out.monPcPair = (await draws(16, () => cg.randomPortraitPair("pc"))).map((p) => p?.img);

      /* --- 3. no reserved names: nothing changes for this Warden ----------- */
      out.flatList = await useFolder(FLAT, 2);
      out.flatPcPool = cg.customPoolFor("pc");
      out.flatMonsterPool = cg.customPoolFor("monster");
      out.flatCompanionPool = cg.customPoolFor("companion");
      out.flatPcPair = (await draws(16, () => cg.randomPortraitPair("pc"))).map((p) => p?.img);

      const flatMonster = await makeMonster("ZZ Flat Monster");
      out.flatMonsterImg = flatMonster?.img ?? "";

      const flatKeeper = await Cls.create({ name: "ZZ Flat Keeper", type: "character" });
      const flatGranted = await cg.grantContainers(flatKeeper, [{ name: "ZZ Mangy Wolfdog", slots: 2, grantSource: "probe" }]);
      out.flatCompanionImg = flatGranted?.[0]?.img ?? "";

      // A monster wearing the Warden's art in a world with no `monster/` folder
      // still re-rolls inside the custom folder — it must not fall through to
      // the generator's default pool and come back a tlomdev human.
      out.flatDieMonster = await draws(12, () => cg.randomPortraitInSameFolder(`${FLAT}/faces/flat-face.png`, "monster"));
    } catch (e) {
      out.errors.push(`threw: ${e.message}`);
    } finally {
      // Put the folder back HERE, and wait for its own rescan to land: a late
      // write from the restore would otherwise clobber whatever the next probe
      // seeds into the list. withSettings is the net, not the plan.
      await game.settings.set(NS, "custom-portrait-folder", out.prior);
      const deadline = Date.now() + 20000;
      for (;;) {
        const l = game.settings.get(NS, "custom-portrait-list");
        if (!l.some((f) => f.startsWith("zz-pcat-")) || Date.now() > deadline) break;
        await sleep(150);
      }
      out.folderAfter = game.settings.get(NS, "custom-portrait-folder");
      out.listAfter = game.settings.get(NS, "custom-portrait-list").length;
    }
    return out;
  }, { FULL, MON, FLAT });
});

/* --- clean up the actors this run made ------------------------------------ */
const sweep = await page.evaluate(async (before) => {
  const known = new Set(before);
  const mine = game.actors.filter((a) => !known.has(a.id));
  const names = mine.map((a) => a.name);
  for (const a of mine) await a.delete();
  return { deleted: names, left: game.actors.filter((a) => !known.has(a.id)).length };
}, idsBefore);

await browser.close();

/* -------------------------------------------------------------------------- */

console.log("\nall four reserved folders present");
check(R.fullList?.length === 7, "seven images cached", `${R.fullList?.length} file(s)`);
check(R.poolGeneral?.length === 1 && R.poolGeneral[0].endsWith("loose-face.png"),
  "the general pool is the loose image ALONE", JSON.stringify(R.poolGeneral));
check(allUnder(R.poolPc, `${FULL}/pc`), "pc pool is pc/", JSON.stringify(R.poolPc));
check(allUnder(R.poolNpc, `${FULL}/npc`), "npc pool is npc/", JSON.stringify(R.poolNpc));
check(allUnder(R.poolMonster, `${FULL}/monster`), "monster pool is monster/", JSON.stringify(R.poolMonster));
check(allUnder(R.poolCompanion, `${FULL}/companion`), "companion pool is companion/", JSON.stringify(R.poolCompanion));

console.log("\nwhat each creation path assigns");
check(allUnder(R.pairPc, `${FULL}/pc`), "12 pc draws all from pc/", JSON.stringify([...new Set(R.pairPc ?? [])]));
check(allUnder(R.pairNpc, `${FULL}/npc`), "12 npc draws all from npc/", JSON.stringify([...new Set(R.pairNpc ?? [])]));
// Each call site passes a LITERAL category, so these are what catch a wrong one.
check(R.npcImg?.startsWith(`${FULL}/npc/`) && R.npcToken === R.npcImg,
  "a hand-made npc takes npc/", JSON.stringify(R.npcImg));
check(R.monsterImg?.startsWith(`${FULL}/monster/`) && R.monsterToken === R.monsterImg,
  "a generated monster takes monster/", JSON.stringify(R.monsterImg));
check(R.companionImg?.startsWith(`${FULL}/companion/`) && R.companionRole === "companion",
  "a granted one-off beast takes companion/", JSON.stringify(R.companionImg));

console.log("\nthe die stays in the folder it came from");
check(allUnder(R.dieMonster, `${FULL}/monster`), "a monster re-rolls inside monster/", `${R.dieMonster?.length} draws`);
check(allUnder(R.diePc, `${FULL}/pc`), "a character re-rolls inside pc/", `${R.diePc?.length} draws`);
// The sheet's real button, which is the only leg that exercises the actor ->
// category mapping. It must MOVE as well as stay: a die that returned what it
// already had would satisfy "still in monster/" without doing anything.
check(R.dieViaSheet?.now?.startsWith(`${FULL}/monster/`) && R.dieViaSheet.now !== R.dieViaSheet.was,
  "the sheet die moves, and stays in monster/", JSON.stringify(R.dieViaSheet));

console.log("\nthe picker still offers the whole tree");
// Auto-assignment is scoped; BROWSING is not. Hiding a folder from the gallery
// would take art away from a Warden who came looking for it by hand.
check(new Set(R.tileKeys ?? []).size === 4, "all four folders are still tiles", JSON.stringify(R.tileKeys));
check(["Player Characters", "NPCs", "Monsters", "Companions"].every((l) => (R.tileLabels ?? []).includes(l)),
  "reserved tiles wear their own names", JSON.stringify(R.tileLabels));

console.log("\nonly monster/ filled — the general pool EXCLUDES it");
check(R.monGeneral?.length === 1 && R.monGeneral[0].endsWith("mon-loose.png"),
  "general is the loose image, not the monster", JSON.stringify(R.monGeneral));
// THE ruling leg. Without the exclusion every one of these is mon-only.png.
check(allUnder(R.monPcPair, MON) && !R.monPcPair?.some((p) => p.includes("/monster/")),
  "16 pc draws never touch monster/", JSON.stringify([...new Set(R.monPcPair ?? [])]));

console.log("\nno reserved names — nothing changes for this Warden");
check(R.flatPcPool?.length === 2, "pc inherits the whole custom folder", `${R.flatPcPool?.length} file(s)`);
check(allUnder(R.flatPcPair, FLAT), "16 pc draws are the Warden's art", JSON.stringify([...new Set(R.flatPcPair ?? [])]));
// monster and companion have never drawn from the general pool and must not start.
check(R.flatMonsterPool?.length === 0, "monster inherits NOTHING", JSON.stringify(R.flatMonsterPool));
check(R.flatCompanionPool?.length === 0, "companion inherits NOTHING", JSON.stringify(R.flatCompanionPool));
check(!!R.flatMonsterImg?.includes("/art/game-icons/"),
  "a monster still takes a creature glyph", JSON.stringify(R.flatMonsterImg));
check(!!R.flatCompanionImg?.includes("/icons/"),
  "a granted beast still takes its class icon", JSON.stringify(R.flatCompanionImg));
check(allUnder(R.flatDieMonster, FLAT),
  "a monster's die stays in custom art", `${R.flatDieMonster?.length} draws`);

console.log("\nrestored");
check(R.folderAfter === R.prior, "the folder setting is back", JSON.stringify(R.folderAfter));
check(sweep.left === 0, "every actor this run made is gone",
  `deleted ${sweep.deleted.length}: ${sweep.deleted.join(", ")}`);

if (R.errors?.length) { failures += R.errors.length; console.log("\nIn-page errors:\n  " + R.errors.join("\n  ")); }
if (errors.length) { failures++; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(failures === 0 ? "\nportrait categories e2e passed" : `\nportrait categories e2e FAILED — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
