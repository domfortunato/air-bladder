#!/usr/bin/env node
/**
 * The art picker, and which galleries each sheet is offered.
 *
 * There used to be three near-copies of this dialog — the character portrait
 * gallery, the container art gallery, and core's bare FilePicker on item sheets
 * — which is why adding the Game-Icons gallery meant unifying them first
 * (module/art-picker.js). So this protects two different things.
 *
 * WHICH GALLERIES APPEAR is a rule about the sheet, and it is the part a
 * refactor breaks silently: a wrong tab set still renders, still picks, still
 * saves. The rule:
 *
 *   Player Character   Aspeheim + Custom
 *   NPC / Hireling     Aspeheim + Custom + Game-Icons
 *   Monster            Custom + Game-Icons          (no faces on a monster)
 *   Container / mount  Kinds + Custom + Game-Icons
 *   Item / background  Custom + Game-Icons
 *
 * THE START TAB is the trap underneath it. The picker opens on whichever tab
 * holds the current image so re-opening lands where you were — and the old code
 * defaulted to "shipped" by NAME. A Monster has no shipped tab, so that default
 * would open the dialog on a pane that is not there: every tab inactive, the
 * body empty, nothing to click and no error anywhere. The fallback is now "the
 * first pane that exists", and this asserts a Monster lands on a real one.
 *
 * Also covered: the two-step browse (23 category folders in, thumbnails out,
 * back again), that the folder faces actually load (a manifest naming a file
 * that is not there renders a blank tile, not an error), and that picking from
 * Game-Icons commits — on an actor AND on an item, which take different write
 * paths, because only the actor pairs a token with its portrait.
 *
 * Negative control: the Monster exclusion is defeated IN-PAGE by shadowing
 * `npcRole` on the sheet's actor, and the Aspeheim tab must come back. Without
 * it, "no Aspeheim tab on a monster" also passes when the tab set is empty, the
 * dialog failed to open, or the selector rotted.
 *
 *   npm run dev:art-picker
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(46)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(46)} ${d}`); failures++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  await joinAsGM(page);
  await dismissChrome(page);

  /* --- 1. the tab set each sheet is offered ------------------------------ */

  // Every actor is made here rather than found: a probe that reads whatever the
  // world happens to hold asserts nothing repeatable, and a leftover from an
  // aborted run is exactly the kind of state that makes one pass by accident.
  const tabs = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const out = {};
    const made = [];

    const openTabs = async (actor) => {
      const sheet = actor.sheet;
      await sheet.render(true);
      await sheet._pickPortrait(new Event("click"));
      const dlg = [...foundry.applications.instances.values()]
        .find((a) => a.constructor.name === "DialogV2" && a.element?.querySelector(".cairn-portrait-gallery"));
      const root = dlg?.element;
      const labels = [...(root?.querySelectorAll(".cairn-portrait-tab") ?? [])].map((b) => b.textContent.trim());
      const active = root?.querySelector(".cairn-portrait-tab.active")?.dataset.tab ?? null;
      const shownPane = [...(root?.querySelectorAll(".cairn-portrait-pane") ?? [])]
        .find((p) => !p.hidden)?.dataset.pane ?? null;
      await dlg?.close();
      await sheet.close();
      return { labels, active, shownPane };
    };

    for (const [key, data] of [
      ["pc", { name: "ZZ Art PC", type: "character" }],
      ["npc", { name: "ZZ Art NPC", type: "npc", system: { role: "npc" } }],
      ["hireling", { name: "ZZ Art Hireling", type: "npc", system: { role: "hireling" } }],
      ["monster", { name: "ZZ Art Monster", type: "npc", system: { role: "monster" } }],
    ]) {
      const a = await Cls.create(data);
      made.push(a);
      out[key] = await openTabs(a);
    }

    // A thing-role actor routes to the container gallery instead — same dialog,
    // different first tab, and picking a Kind glyph must still set the class.
    const thing = await Cls.create({ name: "ZZ Art Sack", type: "npc", system: { role: "container" } });
    made.push(thing);
    const tSheet = thing.sheet;
    await tSheet.render(true);
    await tSheet._pickContainerArt(new Event("click"));
    const tDlg = [...foundry.applications.instances.values()]
      .find((a) => a.constructor.name === "DialogV2" && a.element?.querySelector(".cairn-portrait-gallery"));
    out.thing = {
      labels: [...tDlg.element.querySelectorAll(".cairn-portrait-tab")].map((b) => b.textContent.trim()),
      hasClassCells: !!tDlg.element.querySelector('.cairn-portrait-choice[data-class]'),
    };
    // Pick the barrel cell through the real click handler.
    const barrel = tDlg.element.querySelector('.cairn-portrait-choice[data-class="barrel"]');
    barrel?.click();
    await new Promise((r) => setTimeout(r, 300));
    out.thing.classAfterPick = thing.system.containerClass;
    out.thing.artAfterPick = thing.img?.split("/").pop();
    await tDlg.close(); await tSheet.close();

    for (const a of made) await a.delete();
    return out;
  });

  eq(tabs.pc.labels, ["Jon Aspeheim", "Custom"])
    ? ok("a PC is offered Aspeheim + Custom", "no Game-Icons")
    : fail("a PC is offered Aspeheim + Custom", JSON.stringify(tabs.pc.labels));
  eq(tabs.npc.labels, ["Jon Aspeheim", "Custom", "Game-Icons"])
    ? ok("an NPC is offered all three")
    : fail("an NPC is offered all three", JSON.stringify(tabs.npc.labels));
  eq(tabs.hireling.labels, ["Jon Aspeheim", "Custom", "Game-Icons"])
    ? ok("a Hireling is offered all three", "the role, not the type")
    : fail("a Hireling is offered all three", JSON.stringify(tabs.hireling.labels));
  eq(tabs.monster.labels, ["Custom", "Game-Icons"])
    ? ok("a Monster is offered no faces", "Aspeheim withheld")
    : fail("a Monster is offered no faces", JSON.stringify(tabs.monster.labels));

  // The trap: a hidden default would leave every tab inactive and the body blank.
  tabs.monster.active === tabs.monster.shownPane && tabs.monster.active === "custom"
    ? ok("a Monster opens on a tab that exists", `active=${tabs.monster.active}`)
    : fail("a Monster opens on a tab that exists", JSON.stringify(tabs.monster));

  eq(tabs.thing.labels, ["Kinds", "Custom", "Game-Icons"]) && tabs.thing.hasClassCells
    ? ok("a container keeps its Kind gallery", "and gains the other two")
    : fail("a container keeps its Kind gallery", JSON.stringify(tabs.thing));
  tabs.thing.classAfterPick === "barrel" && tabs.thing.artAfterPick === "barrel.svg"
    ? ok("picking a Kind glyph still sets the class", "barrel + barrel.svg")
    : fail("picking a Kind glyph still sets the class", JSON.stringify(tabs.thing));

  /* --- 2. the Game-Icons gallery browses in two steps -------------------- */

  const browse = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const a = await Cls.create({ name: "ZZ Art Browser", type: "npc", system: { role: "npc" } });
    const sheet = a.sheet;
    await sheet.render(true);
    await sheet._pickPortrait(new Event("click"));
    const dlg = [...foundry.applications.instances.values()]
      .find((x) => x.constructor.name === "DialogV2" && x.element?.querySelector(".cairn-portrait-gallery"));
    const root = dlg.element;

    root.querySelector('.cairn-portrait-tab[data-tab="gameicons"]').click();
    const folders = [...root.querySelectorAll(".cairn-icon-folder")];
    const out = {
      folderCount: folders.length,
      labels: folders.slice(0, 3).map((f) => f.querySelector("span").textContent),
      // A manifest naming a file that is not on disk renders a blank tile and no
      // error; decoded width is the only thing that tells them apart.
      facesLoaded: 0,
      gridBeforeClick: root.querySelector(".cairn-icon-category").hidden,
    };
    await Promise.all(folders.map((f) => f.querySelector("img").decode().catch(() => {})));
    out.facesLoaded = folders.filter((f) => f.querySelector("img").naturalWidth > 0).length;

    // Into a category, and back out again.
    const weapons = folders.find((f) => f.dataset.category === "weapons");
    weapons.click();
    out.foldersHiddenAfter = root.querySelector(".cairn-icon-folders").hidden;
    out.categoryShown = !root.querySelector(".cairn-icon-category").hidden;
    out.thumbs = root.querySelectorAll(".cairn-icon-category .cairn-portrait-choice").length;
    root.querySelector(".cairn-icon-back").click();
    out.backToFolders = !root.querySelector(".cairn-icon-folders").hidden
      && root.querySelector(".cairn-icon-category").hidden;

    // Pick one for real, through its own click handler.
    weapons.click();
    root.querySelector(".cairn-icon-category .cairn-portrait-choice").click();
    await new Promise((r) => setTimeout(r, 400));
    out.img = a.img;
    out.token = a.prototypeToken?.texture?.src;

    await sheet.close();
    await a.delete();
    return out;
  });

  browse.folderCount === 23 && browse.gridBeforeClick
    ? ok("23 category folders, thumbnails hidden", browse.labels.join(" / "))
    : fail("23 category folders, thumbnails hidden", JSON.stringify(browse));
  browse.facesLoaded === 23
    ? ok("every folder face resolves to a real file", "23/23 decoded")
    : fail("every folder face resolves to a real file", `${browse.facesLoaded}/23 — the manifest names a missing icon`);
  browse.foldersHiddenAfter && browse.categoryShown && browse.thumbs === 84
    ? ok("opening a category swaps to its thumbnails", `weapons = ${browse.thumbs}`)
    : fail("opening a category swaps to its thumbnails", JSON.stringify(browse));
  browse.backToFolders
    ? ok("back returns to the categories")
    : fail("back returns to the categories", JSON.stringify(browse));
  browse.img?.includes("/game-icons/weapons/") && browse.token === browse.img
    ? ok("picking one sets the portrait AND the token", browse.img.split("/").pop())
    : fail("picking one sets the portrait AND the token", JSON.stringify(browse));

  /* --- 3. items and backgrounds ----------------------------------------- */

  const item = await page.evaluate(async () => {
    const Cls = CONFIG.Item.documentClass;
    const it = await Cls.create({ name: "ZZ Art Item", type: "item" });
    const sheet = it.sheet;
    await sheet.render(true);
    // Through the real action map, not the private method — the whole point is
    // that data-action="editImage" no longer reaches core's FilePicker.
    const action = sheet.constructor.DEFAULT_OPTIONS.actions.editImage;
    await action.call(sheet, new Event("click"), null);
    const dlg = [...foundry.applications.instances.values()]
      .find((x) => x.constructor.name === "DialogV2" && x.element?.querySelector(".cairn-portrait-gallery"));
    const root = dlg?.element;
    const out = {
      overridden: !!dlg,
      labels: [...(root?.querySelectorAll(".cairn-portrait-tab") ?? [])].map((b) => b.textContent.trim()),
    };
    root?.querySelector('.cairn-portrait-tab[data-tab="gameicons"]')?.click();
    root?.querySelector('.cairn-icon-folder[data-category="tools"]')?.click();
    root?.querySelector(".cairn-icon-category .cairn-portrait-choice")?.click();
    await new Promise((r) => setTimeout(r, 400));
    out.img = it.img;
    await sheet.close();
    await it.delete();
    return out;
  });

  item.overridden && eq(item.labels, ["Custom", "Game-Icons"])
    ? ok("an item gets Custom + Game-Icons", "core's FilePicker is overridden")
    : fail("an item gets Custom + Game-Icons", JSON.stringify(item));
  item.img?.includes("/game-icons/tools/")
    ? ok("picking sets the item's art", item.img.split("/").pop())
    : fail("picking sets the item's art", JSON.stringify(item.img));

  /* --- 4. negative control ---------------------------------------------- */

  const control = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const a = await Cls.create({ name: "ZZ Art Control", type: "npc", system: { role: "monster" } });
    // Defeat the exclusion at its source — the role the picker reads — without
    // touching a file. If the Aspeheim tab does NOT come back, the assertion
    // above was passing for some other reason.
    Object.defineProperty(a, "npcRole", { value: "npc", configurable: true });
    const sheet = a.sheet;
    await sheet.render(true);
    await sheet._pickPortrait(new Event("click"));
    const dlg = [...foundry.applications.instances.values()]
      .find((x) => x.constructor.name === "DialogV2" && x.element?.querySelector(".cairn-portrait-gallery"));
    const labels = [...dlg.element.querySelectorAll(".cairn-portrait-tab")].map((b) => b.textContent.trim());
    await dlg.close(); await sheet.close(); await a.delete();
    return { labels };
  });

  control.labels.includes("Jon Aspeheim")
    ? ok("control: forcing the role restores Aspeheim", control.labels.join(" / "))
    : fail("control: forcing the role restores Aspeheim", JSON.stringify(control.labels));

  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors) console.log(`  ${e}`);
  if (errors.length) failures++;
} catch (err) {
  fail("probe threw", err.message);
} finally {
  await browser.close();
}

console.log(failures ? `\nart picker probe FAILED (${failures})\n` : "\nart picker probe passed\n");
process.exit(failures ? 1 : 0);
