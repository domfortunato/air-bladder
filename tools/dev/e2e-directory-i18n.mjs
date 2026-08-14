#!/usr/bin/env node
/**
 * The WORLD sidebar and the combat tracker under the content overlay
 * (2026-08-14, review #14 finding 14 — user ruling: both translate).
 *
 *   npm run dev:directory-i18n      (dev world on :30000)
 *
 * Until this landed there was exactly ONE `.entry-name` sweep in the system, on
 * the compendium browser. So a Spanish Warden dragged a Goblin out of a pack and
 * from then on the sidebar said "Goblin", the sheet header said "Trasgo", the
 * tracker said "Goblin" and the damage card beneath said "ataca a Trasgo" — one
 * creature, one screen, two names.
 *
 * Legs:
 *   1. THE CHARACTER GATE, first, because it is the one that must never break:
 *      a player character named the same as a monster keeps its own name in the
 *      sidebar. The 2026-08-04 ruling, and the round-5 control caught an ungated
 *      lookup renaming a PC that happened to share a creature's name.
 *   2. An Actor row, an Item row and a background Item row each read their
 *      sentinel — the background proves the namespace is chosen PER DOCUMENT,
 *      since a world Item directory mixes backgrounds with gear.
 *   3. SEARCH matches what the eye reads: typing the translated name finds the
 *      row, and typing the English name still does (the pass is additive, so an
 *      English-typing user in a Spanish world keeps both routes).
 *   4. The COMBAT TRACKER row reads the translation, and a PC combatant does not.
 *   5. CONTROL: with the overlay uninstalled every one of those reads English
 *      again — so the legs above measure the overlay and not some other kindness.
 *
 * Everything planted is swept from Node with ids printed, and the combat is
 * deleted before the actors. The overlay is installed in-page via `_setOverlay`
 * and restored in a finally; no world setting is ever written.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, watchdog } from "./lib.mjs";

const MONSTER_EN = "ZZ Dirwolf";
const MONSTER_ES = "ZZ-LOBO-TRADUCIDO";
const GEAR_EN = "ZZ Dirrope";
const GEAR_ES = "ZZ-CUERDA-TRADUCIDA";
const BG_EN = "ZZ Dirbackground";
const BG_ES = "ZZ-TRASFONDO-TRADUCIDO";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(52)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(52)} ${d}`); failures++; };

watchdog(300000, "directory i18n probe");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const planted = { actorIds: [], itemIds: [], combatId: null };

const out = await page.evaluate(async (fx) => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const res = { planted: { actorIds: [], itemIds: [], combatId: null } };
  const nameOf = (id) => document
    .querySelector(`#actors [data-entry-id="${id}"] .entry-name, #items [data-entry-id="${id}"] .entry-name`)
    ?.textContent?.trim() ?? null;

  try {
    // A monster and a PC SHARING A NAME is the fixture the character gate needs:
    // one overlay entry, two rows, and only one of them may move.
    const wolf = await Actor.create({ name: fx.MONSTER_EN, type: "npc", system: { role: "monster" } });
    const pc = await Actor.create({ name: fx.MONSTER_EN, type: "character" });
    const rope = await Item.create({ name: fx.GEAR_EN, type: "item" });
    const bg = await Item.create({ name: fx.BG_EN, type: "background" });
    res.planted.actorIds.push(wolf.id, pc.id);
    res.planted.itemIds.push(rope.id, bg.id);

    const render = async () => {
      await ui.actors.render(true);
      await ui.items.render(true);
      await new Promise((r) => setTimeout(r, 600));
    };

    // --- English baseline, so every leg below has something to move FROM ------
    i18n._setOverlay(null);
    await render();
    res.english = { wolf: nameOf(wolf.id), pc: nameOf(pc.id), rope: nameOf(rope.id), bg: nameOf(bg.id) };

    i18n._setOverlay({
      "monster.name": { [fx.MONSTER_EN]: fx.MONSTER_ES },
      "item.name": { [fx.GEAR_EN]: fx.GEAR_ES },
      "bg.name": { [fx.BG_EN]: fx.BG_ES },
    });
    if (!i18n.contentLocalized()) return { error: "overlay did not install" };
    await render();
    res.translated = { wolf: nameOf(wolf.id), pc: nameOf(pc.id), rope: nameOf(rope.id), bg: nameOf(bg.id) };

    // --- search: type the Spanish, then the English --------------------------
    const search = async (dirId, query) => {
      const app = ui[dirId];
      const input = app.element.querySelector('input[type="search"], search input');
      if (!input) return { error: "no search input" };
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      const visible = [...app.element.querySelectorAll(".directory-item.entry")]
        .filter((li) => li.offsetParent !== null || getComputedStyle(li).display !== "none")
        .map((li) => li.dataset.entryId);
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return visible;
    };
    res.searchEs = await search("actors", fx.MONSTER_ES);
    res.searchEn = await search("actors", fx.MONSTER_EN);
    res.wolfId = wolf.id;
    res.pcId = pc.id;

    // --- the combat tracker --------------------------------------------------
    const scene = game.scenes.active ?? game.scenes.contents[0];
    const [wolfTok, pcTok] = await scene.createEmbeddedDocuments("Token", [
      { name: fx.MONSTER_EN, actorId: wolf.id, actorLink: true, x: 300, y: 300, texture: { src: wolf.img } },
      { name: fx.MONSTER_EN, actorId: pc.id, actorLink: true, x: 400, y: 300, texture: { src: pc.img } },
    ]);
    res.planted.tokenIds = [wolfTok.id, pcTok.id];
    res.planted.sceneId = scene.id;
    const combat = await Combat.create({ scene: scene.id });
    res.planted.combatId = combat.id;
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: wolfTok.id, sceneId: scene.id, actorId: wolf.id },
      { tokenId: pcTok.id, sceneId: scene.id, actorId: pc.id },
    ]);
    await ui.combat.render(true);
    await new Promise((r) => setTimeout(r, 800));
    const rowName = (actorId) => {
      const c = combat.combatants.find((x) => x.actorId === actorId);
      const li = ui.combat.element?.querySelector(`.combatant[data-combatant-id="${c?.id}"]`);
      return li?.querySelector(".token-name, .combatant-name, h4, .name")?.textContent?.trim() ?? null;
    };
    res.trackerTranslated = { monster: rowName(wolf.id), pc: rowName(pc.id) };

    // --- THE CONTROL: overlay off, everything reads English again ------------
    i18n._setOverlay(null);
    await render();
    await ui.combat.render(true);
    await new Promise((r) => setTimeout(r, 800));
    res.control = {
      wolf: nameOf(wolf.id), rope: nameOf(rope.id), bg: nameOf(bg.id),
      tracker: rowName(wolf.id),
    };
    return res;
  } catch (e) {
    res.error = `${e.name}: ${e.message}`;
    return res;
  } finally {
    i18n._setOverlay(null);
  }
}, { MONSTER_EN, MONSTER_ES, GEAR_EN, GEAR_ES, BG_EN, BG_ES });

Object.assign(planted, out?.planted ?? {});

if (out?.error) fail("the probe ran", out.error);
else {
  console.log("\nthe world sidebar");
  const en = out.english ?? {};
  en.wolf === MONSTER_EN && en.rope === GEAR_EN && en.bg === BG_EN
    ? ok("baseline: every planted row reads its English name", `${en.wolf} | ${en.rope} | ${en.bg}`)
    : fail("baseline: every planted row reads its English name", JSON.stringify(en));

  const tr = out.translated ?? {};
  // THE GATE FIRST. One overlay entry, two rows with the same English name, and
  // only the monster may move — a PC's name is player-authored.
  tr.pc === MONSTER_EN
    ? ok("a player character keeps its own name", "the 2026-08-04 gate, on a PC sharing a monster's name")
    : fail("a player character keeps its own name", `the PC row reads "${tr.pc}" — a player's name was localized`);
  tr.wolf === MONSTER_ES
    ? ok("an Actor row reads the translation", MONSTER_ES)
    : fail("an Actor row reads the translation", `read "${tr.wolf}"`);
  tr.rope === GEAR_ES
    ? ok("an Item row does too", GEAR_ES)
    : fail("an Item row does too", `read "${tr.rope}"`);
  // Per-DOCUMENT namespacing: a world Item directory mixes backgrounds with
  // gear, so a pack-level namespace (which is right for the compendium browser)
  // would put this row through item.name and miss.
  tr.bg === BG_ES
    ? ok("and a background row uses bg.name, not item.name", BG_ES)
    : fail("and a background row uses bg.name, not item.name", `read "${tr.bg}"`);

  console.log("\nsearch matches what the eye reads");
  Array.isArray(out.searchEs) && out.searchEs.includes(out.wolfId)
    ? ok("typing the translated name finds the row", `${out.searchEs.length} row(s) shown`)
    : fail("typing the translated name finds the row", JSON.stringify(out.searchEs));
  Array.isArray(out.searchEn) && out.searchEn.includes(out.wolfId)
    ? ok("and typing the English name still does", "the pass is additive, never subtractive")
    : fail("and typing the English name still does", JSON.stringify(out.searchEn));

  console.log("\nthe combat tracker");
  out.trackerTranslated?.monster === MONSTER_ES
    ? ok("a monster's row reads the same name the damage card does", MONSTER_ES)
    : fail("a monster's row reads the same name the damage card does", `read "${out.trackerTranslated?.monster}"`);
  out.trackerTranslated?.pc === MONSTER_EN
    ? ok("and a PC combatant is left alone", "same gate as the sidebar")
    : fail("and a PC combatant is left alone", `read "${out.trackerTranslated?.pc}"`);

  console.log("\nthe control — overlay off");
  const c = out.control ?? {};
  c.wolf === MONSTER_EN && c.rope === GEAR_EN && c.bg === BG_EN && c.tracker === MONSTER_EN
    ? ok("everything reads English again", "so the legs above measure the overlay")
    : fail("everything reads English again", JSON.stringify(c));
}

/* ----------------------------------------------------------- teardown ------ */
// Swept from NODE so a throw inside the evaluate cannot leave the plant, and
// only the ids THIS run created are touched.
const swept = await page.evaluate(async (p) => {
  const lines = [];
  const combat = game.combats.get(p.combatId);
  if (combat) { lines.push(`combat ${p.combatId}`); await combat.delete(); }
  const scene = game.scenes.get(p.sceneId);
  for (const id of p.tokenIds ?? []) {
    if (scene?.tokens.get(id)) { lines.push(`token ${id}`); await scene.deleteEmbeddedDocuments("Token", [id]); }
  }
  for (const id of p.actorIds ?? []) {
    const a = game.actors.get(id);
    if (a) { lines.push(`actor ${a.name} (${id})`); await a.delete(); }
  }
  for (const id of p.itemIds ?? []) {
    const i = game.items.get(id);
    if (i) { lines.push(`item ${i.name} (${id})`); await i.delete(); }
  }
  return { lines, leftovers: [...game.actors, ...game.items].filter((d) => d.name?.startsWith("ZZ Dir")).map((d) => d.name) };
}, planted);
for (const l of swept.lines) console.log(`  swept ${l}`);
swept.leftovers.length === 0
  ? ok("nothing this run planted is left behind", `${swept.lines.length} document(s) swept`)
  : fail("nothing this run planted is left behind", swept.leftovers.join(", "));

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
if (errors.length) failures++;
await browser.close();
console.log(failures ? `\nDIRECTORY I18N PROBE FAILED (${failures})` : "\ndirectory i18n probe passed");
process.exit(failures ? 1 : 0);
