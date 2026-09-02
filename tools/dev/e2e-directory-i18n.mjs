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
 *   6. The compendium SIDEBAR's DOCUMENT search (2026-08-19, review #16), which
 *      is a different application from the browser and a different code path
 *      from everything above: its rows are built inside `_onSearchFilter` on
 *      every keystroke, so no render hook can reach them. Both halves, plus a
 *      control — before the fix, typing the translation listed NOTHING and
 *      typing the English listed a row reading the English.
 *   7. A LATE overlay load repairs what it finds already drawn (review #16).
 *      `refreshLocalizedApps` re-rendered only `app.document` applications, and
 *      not one localized surface in this system is one of those — the four world
 *      directories carry `.collection`, the compendium sidebar carries neither.
 *      Its own comment named the case it was excluding.
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

// Section 6 reads a SHIPPED entry rather than planting one, because the
// compendium sidebar searches pack INDEXES and a world document is invisible to
// it. One word, so the query is a single term either way.
const SIDEBAR_PACK = "air-bladder.monsters";
const SIDEBAR_EN = "Gorilla";
const SIDEBAR_ES = "ZZ-BICHO-TRADUCIDO";

// Section 7 plants one npc and reads one shipped pack entry. Its sentinels are
// distinct from section 6's on purpose: a shared one could not tell "the
// refresh worked" from "section 6 left the row translated".
const LATE_EN = "ZZ Late Ghoul";
const LATE_ES = "ZZ-DEMONIO-TARDE";
const LATE_PACK_ES = "ZZ-BICHO-TARDE";

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
    // Looked up BY actorId, never destructured by position:
    // createEmbeddedDocuments does NOT promise request order on 14.365
    // (measured — dev:bg-drop-order's recorded lesson), and a reversed return
    // here mispaired tokenId/actorId on the combatants below, which read as
    // the tracker localizing exactly the wrong row (2026-09-02 gate run).
    const madeToks = await scene.createEmbeddedDocuments("Token", [
      { name: fx.MONSTER_EN, actorId: wolf.id, actorLink: true, x: 300, y: 300, texture: { src: wolf.img } },
      { name: fx.MONSTER_EN, actorId: pc.id, actorLink: true, x: 400, y: 300, texture: { src: pc.img } },
    ]);
    // Recorded from the raw result FIRST, so the guard's early return cannot
    // leak a planted token past the Node-side sweep.
    res.planted.tokenIds = madeToks.map((t) => t.id);
    const wolfTok = madeToks.find((t) => t.actorId === wolf.id);
    const pcTok = madeToks.find((t) => t.actorId === pc.id);
    if (!wolfTok || !pcTok) {
      res.error = "token create returned an unexpected pair — combatants cannot be paired honestly";
      return res;
    }
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

/* --- 6. the compendium SIDEBAR's document search ------------------------- */
// Plants NOTHING: it reads a SHIPPED pack entry, so there is no world write and
// nothing to sweep. The entry is looked up by name and its absence FAILS rather
// than skipping — a leg whose fixture has quietly gone is a leg that passes for
// the wrong reason.
//
// The directory must be rendered AFTER the overlay is installed. The hook that
// installs the wrap returns early when nothing is localized, which is the right
// behaviour in an English world and exactly what makes the ordering load-bearing
// here.
console.log("\nthe compendium sidebar's document search");
const sidebar = await page.evaluate(async (fx) => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const res = {};
  const dir = ui.compendium;
  try {
    const pack = game.packs.get(fx.PACK);
    res.fixture = !!pack?.index?.find((e) => e.name === fx.EN);
    if (!res.fixture) return res;

    const rows = async (q) => {
      const input = dir.element.querySelector('input[type="search"]');
      if (!input) return null;
      input.value = q;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(600);
      const names = [...dir.element.querySelectorAll("li[data-document-match]")]
        .map((li) => li.querySelector("a[data-name]")?.textContent?.trim());
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(300);
      return names;
    };

    i18n._setOverlay({ "monster.name": { [fx.EN]: fx.ES } });
    await dir.render(true);
    await sleep(500);
    res.wrapped = !!dir._abDocSearchWrapped;
    res.es = await rows(fx.ES);
    res.en = await rows(fx.EN);

    // CONTROL, and note what it does NOT do: the wrap stays installed. It reads
    // `contentLocalized()` on every call, so an English world gets core's
    // behaviour back without a re-render — which is the property being asserted.
    i18n._setOverlay(null);
    res.controlEs = await rows(fx.ES);
    res.controlEn = await rows(fx.EN);
  } catch (e) {
    res.error = `${e.name}: ${e.message}`;
  } finally {
    i18n._setOverlay(null);
  }
  return res;
}, { PACK: SIDEBAR_PACK, EN: SIDEBAR_EN, ES: SIDEBAR_ES });

if (sidebar.error) fail("the sidebar legs ran", sidebar.error);
else if (!sidebar.fixture) fail(`precondition: ${SIDEBAR_PACK} still ships "${SIDEBAR_EN}"`, "the fixture is gone — pick another shipped entry");
else if (!sidebar.wrapped) fail("the directory wrapped its document search", "renderCompendiumDirectory fired with nothing localized");
else {
  sidebar.es?.includes(SIDEBAR_ES)
    ? ok("typing the translation lists the document", `${sidebar.es.length} row(s): ${sidebar.es.join(", ")}`)
    : fail("typing the translation lists the document", JSON.stringify(sidebar.es));
  sidebar.en?.includes(SIDEBAR_ES) && !sidebar.en?.includes(SIDEBAR_EN)
    ? ok("typing the English still lists it, reading the translation", "additive match, translated row")
    : fail("typing the English still lists it, reading the translation", JSON.stringify(sidebar.en));
  sidebar.controlEs?.length === 0
    ? ok("control: overlay off, the translation matches nothing", "core's word tree is English-only")
    : fail("control: overlay off, the translation matches nothing", JSON.stringify(sidebar.controlEs));
  sidebar.controlEn?.includes(SIDEBAR_EN)
    ? ok("control: overlay off, the English row reads English", SIDEBAR_EN)
    : fail("control: overlay off, the English row reads English", JSON.stringify(sidebar.controlEn));
}

/* --- 7. a late overlay load repairs what is already on screen ----------- */
// The fetch behind the overlay resolves on its own schedule: `i18nInit` is
// fired with `Hooks.callAll`, which discards the promise, so a slow read lands
// AFTER the sidebar has drawn. `refreshLocalizedApps` exists for exactly that,
// and it was passing over every surface that needed it.
//
// Staged in three steps because the middle one is the precondition that makes
// the third mean anything: English on screen, overlay installed with NO
// re-render (still English — nothing else is quietly redrawing these), then the
// refresh alone.
console.log("\na late overlay load repairs what is already drawn");

const late = await page.evaluate(async (fx) => {
  const i18n = await import("/systems/air-bladder/module/i18n-content.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const Actor = CONFIG.Actor.documentClass;
  const out = { ids: [] };
  let browser = null;
  try {
    i18n._setOverlay(null);
    const ghoul = await Actor.create({ name: fx.EN, type: "npc" });
    out.ids.push(ghoul.id);

    const pack = game.packs.get(fx.PACK);
    out.fixture = !!pack?.index?.find((e) => e.name === fx.PACK_EN);
    if (!out.fixture) return out;
    browser = await pack.render(true);
    await ui.actors.render(true);

    const dirRow = () => document
      .querySelector(`#actors [data-entry-id="${ghoul.id}"] .entry-name`)?.textContent.trim() ?? null;
    const packRow = () => {
      const el = pack.apps?.find((a) => a.rendered)?.element;
      const id = pack.index.find((e) => e.name === fx.PACK_EN || e.name === fx.PACK_ES)?._id;
      return el?.querySelector(`[data-entry-id="${id}"] .entry-name`)?.textContent.trim() ?? null;
    };

    // POLLED, not slept. A fixed wait for a compendium window to draw is a race,
    // and its failure shape is a matched PAIR — the baseline reads null and so
    // does the repair — which is indistinguishable from the fix not working. One
    // such pair was seen on 2026-08-19 and never reproduced in nine reruns; this
    // is the mechanism that could produce it, so the wait is gone rather than
    // lengthened.
    for (let i = 0; i < 60 && (dirRow() === null || packRow() === null); i++) await sleep(100);
    out.before = { dir: dirRow(), pack: packRow() };
    out.drew = out.before.dir !== null && out.before.pack !== null;

    // Installed, but nothing asks for a redraw. Anything that moves here is
    // something else re-rendering, and the leg below would be measuring it.
    i18n._setOverlay({ "monster.name": { [fx.EN]: fx.ES, [fx.PACK_EN]: fx.PACK_ES } });
    await sleep(500);
    out.installed = { dir: dirRow(), pack: packRow() };

    i18n.refreshLocalizedApps();
    await sleep(1200);
    out.after = { dir: dirRow(), pack: packRow() };
  } catch (e) {
    out.error = `${e.name}: ${e.message}`;
  } finally {
    i18n._setOverlay(null);
    await browser?.close().catch(() => {});
    for (const id of out.ids) await game.actors.get(id)?.delete().catch(() => {});
    out.swept = out.ids.every((id) => !game.actors.get(id));
  }
  return out;
}, { EN: LATE_EN, ES: LATE_ES, PACK: SIDEBAR_PACK, PACK_EN: SIDEBAR_EN, PACK_ES: LATE_PACK_ES });

if (late.error) fail("the late-load legs ran", late.error);
else if (!late.fixture) fail(`precondition: ${SIDEBAR_PACK} still ships "${SIDEBAR_EN}"`, "the fixture is gone");
else if (!late.drew) fail("precondition: both surfaces drew at all", JSON.stringify(late.before) + " — a null here is a render that never landed, not an English row");
else {
  late.before?.dir === LATE_EN && late.before?.pack === SIDEBAR_EN
    ? ok("baseline: both surfaces read English", `${late.before.dir} | ${late.before.pack}`)
    : fail("baseline: both surfaces read English", JSON.stringify(late.before));
  late.installed?.dir === LATE_EN && late.installed?.pack === SIDEBAR_EN
    ? ok("installing the overlay alone changes nothing", "so the refresh below is what moves them")
    : fail("installing the overlay alone changes nothing", JSON.stringify(late.installed));
  late.after?.dir === LATE_ES
    ? ok("the refresh repairs a world DIRECTORY row", LATE_ES)
    : fail("the refresh repairs a world DIRECTORY row", `read "${late.after?.dir}"`);
  late.after?.pack === LATE_PACK_ES
    ? ok("and an open compendium BROWSER row", LATE_PACK_ES)
    : fail("and an open compendium BROWSER row", `read "${late.after?.pack}"`);
  late.swept
    ? ok("late-load fixtures swept", "")
    : fail("late-load fixtures swept", "documents left behind");
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
