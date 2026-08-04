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
 *   Player Character   Aspeheim + Custom + Tlomdev
 *   NPC / Hireling     Aspeheim + Custom + Game-Icons + Tlomdev + Lydia
 *   Monster            Custom + Game-Icons + Tlomdev + Lydia  (no faces here)
 *   Container / mount  Kinds + Custom + Game-Icons + Tlomdev
 *   Item / background  Custom + Game-Icons             (no Tlomdev — actors only)
 *
 * The two withholdings are each other's control and are asserted in the same
 * run: Aspeheim is human faces so a Monster is not offered it, Lydia's is
 * creatures so a PC is not. A pane that failed to render satisfies an absence
 * leg happily; it cannot also satisfy the presence leg one row up.
 *
 * PAIRED GALLERIES ARE THE OTHER RULE. Two of the five ship a portrait and a
 * separate token per image — Aspeheim's, whose halves share one filename across
 * two folders, and Lydia's, whose halves carry DIFFERENT EXTENSIONS (.jpg
 * square, .png circle) because her grant forbids re-encoding the artwork. The
 * other three are their own tokens. So "token === portrait" is correct three
 * times and wrong twice, and it is precisely what the paired lookup produces
 * when it fails (`?? img`) — with no error, on a sheet that looks fine.
 *
 * ALSO THE PORTRAIT DIE's folder rule (2026-08-02): it re-rolls within the
 * folder the current portrait came from — a tlomdev beast rolls another beast,
 * an Aspeheim face another face (with its paired token), a Lydia creature
 * another creature (with its paired token), and only an image from no known
 * gallery folder falls back to the auto-assignment pool. Lydia's is never that
 * fallback: the die on an unrecognised image must not make a hireling a
 * black pudding.
 *
 * THE START TAB is the trap underneath it. The picker opens on whichever tab
 * holds the current image so re-opening lands where you were — and the old code
 * defaulted to "shipped" by NAME. A Monster has no shipped tab, so that default
 * would open the dialog on a pane that is not there: every tab inactive, the
 * body empty, nothing to click and no error anywhere. The fallback is now "the
 * first pane that exists", and this asserts a Monster lands on a real one.
 *
 * Also covered: the two-step browse (category folders in — the count comes
 * from the manifest, not a literal — thumbnails out,
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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors } from "./lib.mjs";

// The gallery's shape comes from the shipped manifest, not from a literal:
// this file said "23" long after Birds became the 24th category (7044e91), and
// a hardcoded count turns every deliberate gallery addition into a probe
// failure that reads like a regression.
const MANIFEST = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../module/game-icons-manifest.json"), "utf8"));
const CATS = MANIFEST.categories.length;
const TL_MANIFEST = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../module/tlomdev-manifest.json"), "utf8"));
const TL_CATS = TL_MANIFEST.categories.length;
const TL_KW_COUNT = TL_MANIFEST.categories.find((c) => c.key === "Kettlewright Portraits").names.length;
const TL_BEAST_FIRST = TL_MANIFEST.categories.find((c) => c.key === "beast").names[0];
const LY_MANIFEST = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../module/lydia-manifest.json"), "utf8"));
const LY_COUNT = LY_MANIFEST.pairs.length;
const LY_FIRST = LY_MANIFEST.pairs[0];

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
      const shown = [...(root?.querySelectorAll(".cairn-portrait-pane") ?? [])].find((p) => !p.hidden);
      const shownPane = shown?.dataset.pane ?? null;
      // What the landing pane actually OFFERS — cells or folder tiles. The
      // start-tab rule is "never land on an empty pane while one with art
      // exists", so emptiness is the thing to measure, not the pane's name.
      const shownCount = shown?.querySelectorAll(".cairn-portrait-choice, .cairn-icon-folder").length ?? 0;
      await dlg?.close();
      await sheet.close();
      return { labels, active, shownPane, shownCount };
    };

    for (const [key, data] of [
      ["pc", { name: "ZZ Art PC", type: "character" }],
      ["npc", { name: "ZZ Art NPC", type: "npc", system: { role: "npc" } }],
      // The retired alias TYPE, which existing worlds still hold: it reads role
      // npc since the collapse, so it must be offered exactly what an npc is.
      ["legacy", { name: "ZZ Art Legacy Hireling", type: "hireling" }],
      ["monster", { name: "ZZ Art Monster", type: "npc", system: { role: "monster" } }],
    ]) {
      const a = await Cls.create(data);
      made.push(a);
      out[key] = await openTabs(a);
    }

    // A thing-role actor routes to the container gallery instead — same
    // dialog, different first tab. Picking a glyph is ART ONLY (2026-08-02,
    // ruled): no cell carries a class claim any more, and the stored Kind
    // must survive the pick untouched.
    const thing = await Cls.create({ name: "ZZ Art Sack", type: "npc", system: { role: "container", containerClass: "sack" } });
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
    // Pick the barrel glyph through the real click handler — found by ART,
    // the only thing a cell says now.
    const barrel = tDlg.element.querySelector('.cairn-portrait-choice[data-src$="barrel.svg"]');
    barrel?.click();
    await new Promise((r) => setTimeout(r, 300));
    out.thing.classAfterPick = thing.system.containerClass;
    out.thing.artAfterPick = thing.img?.split("/").pop();
    await tDlg.close(); await tSheet.close();

    for (const a of made) await a.delete();
    return out;
  });

  // The two exclusions are each other's control, and they are asserted in the
  // same run on purpose: Aspeheim is withheld from a Monster because it is
  // faces, Lydia is withheld from a PC because it is beasts. A pane that failed
  // to render at all would satisfy either "is not offered" leg on its own — it
  // cannot satisfy both an absence and a presence.
  eq(tabs.pc.labels, ["Jon Aspeheim", "Custom", "Tlomdev"])
    ? ok("a PC is offered Aspeheim + Custom + Tlomdev", "no Game-Icons, no Lydia")
    : fail("a PC is offered Aspeheim + Custom + Tlomdev", JSON.stringify(tabs.pc.labels));
  eq(tabs.npc.labels, ["Jon Aspeheim", "Custom", "Game-Icons", "Tlomdev", "Lydia Comer"])
    ? ok("an NPC is offered all five")
    : fail("an NPC is offered all five", JSON.stringify(tabs.npc.labels));
  eq(tabs.legacy.labels, ["Jon Aspeheim", "Custom", "Game-Icons", "Tlomdev", "Lydia Comer"])
    ? ok("a legacy hireling-TYPE doc is offered all five", "the role, not the type")
    : fail("a legacy hireling-TYPE doc is offered all five", JSON.stringify(tabs.legacy.labels));
  eq(tabs.monster.labels, ["Custom", "Game-Icons", "Tlomdev", "Lydia Comer"])
    ? ok("a Monster is offered no faces", "Aspeheim withheld, Tlomdev and Lydia not")
    : fail("a Monster is offered no faces", JSON.stringify(tabs.monster.labels));

  // The trap: a hidden default would leave every tab inactive and the body
  // blank. And since 6466184 the rule is stronger — the first pane WITH
  // CONTENT, not merely the first pane: a GM's empty Custom tab exists (it
  // carries the Refresh button), and landing a Monster on "No custom
  // portraits found" beside an unselected 1,300-glyph gallery looked exactly
  // like a broken dialog to the Warden it happened to. So the assertion is
  // emptiness, not a pane name: whatever tab it lands on must have art in it.
  tabs.monster.active === tabs.monster.shownPane && tabs.monster.shownCount > 0
    ? ok("a Monster opens on a tab with something in it", `active=${tabs.monster.active}, ${tabs.monster.shownCount} tiles`)
    : fail("a Monster opens on a tab with something in it", JSON.stringify(tabs.monster));

  eq(tabs.thing.labels, ["Types", "Custom", "Game-Icons", "Tlomdev"]) && !tabs.thing.hasClassCells
    ? ok("a container keeps its Types gallery, cells art-only", "no data-class claims left")
    : fail("a container keeps its Types gallery, cells art-only", JSON.stringify(tabs.thing));
  // INVERTED 2026-08-02: the pre-fix reading was classAfterPick "barrel" — the
  // pick re-kinded the sack. Art changes, the Kind does not.
  tabs.thing.classAfterPick === "sack" && tabs.thing.artAfterPick === "barrel.svg"
    ? ok("picking a glyph is art only — the sack stays a sack", "barrel.svg over Kind sack")
    : fail("picking a glyph is art only — the sack stays a sack", JSON.stringify(tabs.thing));

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
    // Scoped to the pane: since Tlomdev arrived there are TWO folder galleries
    // in one dialog wearing the same class names, and a root-wide query counts
    // both (24 + 16 read as 40 "game-icons categories").
    const pane = root.querySelector('[data-pane="gameicons"]');
    const folders = [...pane.querySelectorAll(".cairn-icon-folder")];
    const out = {
      folderCount: folders.length,
      labels: folders.slice(0, 3).map((f) => f.querySelector("span").textContent),
      // A manifest naming a file that is not on disk renders a blank tile and no
      // error; decoded width is the only thing that tells them apart.
      facesLoaded: 0,
      gridBeforeClick: pane.querySelector(".cairn-icon-category").hidden,
    };
    await Promise.all(folders.map((f) => f.querySelector("img").decode().catch(() => {})));
    out.facesLoaded = folders.filter((f) => f.querySelector("img").naturalWidth > 0).length;

    // Into a category, and back out again.
    const weapons = folders.find((f) => f.dataset.category === "weapons");
    weapons.click();
    out.foldersHiddenAfter = pane.querySelector(".cairn-icon-folders").hidden;
    out.categoryShown = !pane.querySelector(".cairn-icon-category").hidden;
    out.thumbs = pane.querySelectorAll(".cairn-icon-category .cairn-portrait-choice").length;
    pane.querySelector(".cairn-icon-back").click();
    out.backToFolders = !pane.querySelector(".cairn-icon-folders").hidden
      && pane.querySelector(".cairn-icon-category").hidden;

    // Pick one for real, through its own click handler.
    weapons.click();
    pane.querySelector(".cairn-icon-category .cairn-portrait-choice").click();
    await new Promise((r) => setTimeout(r, 400));
    out.img = a.img;
    out.token = a.prototypeToken?.texture?.src;

    await sheet.close();
    await a.delete();
    return out;
  });

  browse.folderCount === CATS && browse.gridBeforeClick
    ? ok(`all ${CATS} category folders, thumbnails hidden`, browse.labels.join(" / "))
    : fail(`all ${CATS} category folders, thumbnails hidden`, JSON.stringify(browse));
  browse.facesLoaded === CATS
    ? ok("every folder face resolves to a real file", `${CATS}/${CATS} decoded`)
    : fail("every folder face resolves to a real file", `${browse.facesLoaded}/${CATS} — the manifest names a missing icon`);
  browse.foldersHiddenAfter && browse.categoryShown && browse.thumbs === 84
    ? ok("opening a category swaps to its thumbnails", `weapons = ${browse.thumbs}`)
    : fail("opening a category swaps to its thumbnails", JSON.stringify(browse));
  browse.backToFolders
    ? ok("back returns to the categories")
    : fail("back returns to the categories", JSON.stringify(browse));
  browse.img?.includes("/game-icons/weapons/") && browse.token === browse.img
    ? ok("picking one sets the portrait AND the token", browse.img.split("/").pop())
    : fail("picking one sets the portrait AND the token", JSON.stringify(browse));

  /* --- 2b. the Tlomdev gallery browses the same way ---------------------- */

  const tl = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const a = await Cls.create({ name: "ZZ Art Tlomdev", type: "npc", system: { role: "npc" } });
    const sheet = a.sheet;
    await sheet.render(true);
    await sheet._pickPortrait(new Event("click"));
    const dlg = [...foundry.applications.instances.values()]
      .find((x) => x.constructor.name === "DialogV2" && x.element?.querySelector(".cairn-portrait-gallery"));
    const root = dlg.element;

    // A missing tab is a RESULT, not a crash: throwing here would abort the
    // probe and silently skip every section after this one (the roller legs
    // found that out during the negative control).
    const tlTab = root.querySelector('.cairn-portrait-tab[data-tab="tlomdev"]');
    if (!tlTab) {
      await dlg.close(); await sheet.close(); await a.delete();
      return { missing: true };
    }
    tlTab.click();
    const pane = root.querySelector('[data-pane="tlomdev"]');
    const folders = [...pane.querySelectorAll(".cairn-icon-folder")];
    const out = {
      folderCount: folders.length,
      kwTile: folders.some((f) => f.dataset.category === "Kettlewright Portraits"),
      credit: pane.querySelector(".cairn-portrait-credit")?.textContent.includes("tlomdev") ?? false,
      facesLoaded: 0,
    };
    await Promise.all(folders.map((f) => f.querySelector("img").decode().catch(() => {})));
    out.facesLoaded = folders.filter((f) => f.querySelector("img").naturalWidth > 0).length;

    // Into the Kettlewright folder — the one whose FILENAMES are load-bearing
    // (the KW importer maps by them), and the one with spaces in its path.
    folders.find((f) => f.dataset.category === "Kettlewright Portraits").click();
    out.kwThumbs = pane.querySelectorAll(".cairn-icon-category .cairn-portrait-choice").length;
    pane.querySelector(".cairn-icon-category .cairn-portrait-choice").click();
    await new Promise((r) => setTimeout(r, 400));
    out.img = a.img;
    out.token = a.prototypeToken?.texture?.src;

    await sheet.close();
    await a.delete();
    return out;
  });

  !tl.missing && tl.folderCount === TL_CATS && tl.kwTile
    ? ok(`all ${TL_CATS} tlomdev folders, Kettlewright included`)
    : fail(`all ${TL_CATS} tlomdev folders, Kettlewright included`, JSON.stringify(tl));
  tl.facesLoaded === TL_CATS
    ? ok("every tlomdev folder face resolves", `${TL_CATS}/${TL_CATS} decoded`)
    : fail("every tlomdev folder face resolves", `${tl.facesLoaded}/${TL_CATS} — the manifest names a missing file`);
  tl.kwThumbs === TL_KW_COUNT
    ? ok("the Kettlewright folder holds the full set", `${tl.kwThumbs} thumbnails`)
    : fail("the Kettlewright folder holds the full set", `${tl.kwThumbs} of ${TL_KW_COUNT}`);
  tl.img?.includes("/tlomdev/Kettlewright Portraits/") && tl.token === tl.img
    ? ok("picking a tlomdev drawing sets portrait AND token", tl.img.split("/").pop())
    : fail("picking a tlomdev drawing sets portrait AND token", JSON.stringify([tl.img, tl.token]));
  tl.credit
    ? ok("the pane carries the CC BY-SA credit")
    : fail("the pane carries the CC BY-SA credit", "no tlomdev credit line in the pane");

  /* --- 2c. the Lydia Comer gallery: flat, and PAIRED -------------------- */

  // Everything here that is worth asserting comes from this gallery being the
  // only one shaped BOTH ways at once: a flat grid like Aspeheim's, whose two
  // halves carry DIFFERENT EXTENSIONS because her grant forbids re-encoding.
  // So "the token is the portrait" — right for tlomdev, right for game-icons,
  // right for a custom upload — is WRONG here, and is exactly what a
  // pairedTokenFor that failed to learn the second manifest would produce
  // (`?? img`, silently, with no error anywhere).
  const ly = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const a = await Cls.create({ name: "ZZ Art Lydia", type: "npc", system: { role: "monster" } });
    const sheet = a.sheet;
    await sheet.render(true);
    await sheet._pickPortrait(new Event("click"));
    const dlg = [...foundry.applications.instances.values()]
      .find((x) => x.constructor.name === "DialogV2" && x.element?.querySelector(".cairn-portrait-gallery"));
    const root = dlg.element;

    // Same rule as the tlomdev section: a missing tab is a returned result, not
    // a throw, or every section after this one is skipped in silence.
    const tab = root.querySelector('.cairn-portrait-tab[data-tab="lydia"]');
    if (!tab) {
      await dlg.close(); await sheet.close(); await a.delete();
      return { missing: true };
    }
    tab.click();
    const pane = root.querySelector('[data-pane="lydia"]');
    const cells = [...pane.querySelectorAll(".cairn-portrait-choice")];
    const out = {
      cellCount: cells.length,
      // Flat, not category-first: no folder tiles and no drill-down at all.
      folderTiles: pane.querySelectorAll(".cairn-icon-folder").length,
      // Her grant is the one that is NOT a public licence, so the credit under
      // this grid must not read as Creative Commons. Measured as the ABSENCE OF
      // A LICENCE DEED LINK, not as the absence of the words: the line says
      // "not Creative Commons" in as many words, and a text search for
      // "Creative Commons" reds on the very phrase that makes the point.
      // Every other gallery's credit links to creativecommons.org; hers links
      // to the artist, at the same address her licence file names.
      credit: pane.querySelector(".cairn-portrait-credit")?.textContent ?? "",
      creditCcLink: !!pane.querySelector('.cairn-portrait-credit a[href*="creativecommons.org"]'),
      creditArtistLink: pane.querySelector('.cairn-portrait-credit a')?.getAttribute("href") ?? "",
      // Captions are the artist's own titles, de-hyphenated — not raw filenames.
      firstLabel: cells[0]?.getAttribute("title") ?? "",
      facesLoaded: 0,
    };
    await Promise.all(cells.map((c) => c.decode().catch(() => {})));
    out.facesLoaded = cells.filter((c) => c.naturalWidth > 0).length;

    // POLLED, not slept. The rest of this file waits a flat 400ms after a click
    // that fires an async actor.update(); that is a race with a comfortable
    // margin rather than a wait, and a busy machine closes the margin. Wait for
    // the write instead — the picked path is known before the click.
    const want = cells[0].dataset.src;
    cells[0].click();
    for (let i = 0; i < 60 && a.img !== want; i++) await new Promise((r) => setTimeout(r, 100));
    out.img = a.img;
    out.token = a.prototypeToken?.texture?.src;

    await sheet.close();
    await a.delete();
    return out;
  });

  !ly.missing && ly.cellCount === LY_COUNT && ly.folderTiles === 0
    ? ok(`the Lydia pane is a flat grid of ${LY_COUNT}`, "no folder tiles")
    : fail(`the Lydia pane is a flat grid of ${LY_COUNT}`, JSON.stringify(ly));
  ly.facesLoaded === LY_COUNT
    ? ok("every Lydia portrait resolves", `${LY_COUNT}/${LY_COUNT} decoded`)
    : fail("every Lydia portrait resolves", `${ly.facesLoaded}/${LY_COUNT} — the manifest names a missing file`);
  ly.firstLabel === LY_FIRST.portrait.replace(/\.[^.]+$/, "").replace(/-/g, " ")
    ? ok("captions are titles, not filenames", ly.firstLabel)
    : fail("captions are titles, not filenames", JSON.stringify([ly.firstLabel, LY_FIRST.portrait]));
  // The whole point of the section. Portrait is the .jpg square; token is the
  // .png circle — a DIFFERENT FILE, which `?? img` can never produce.
  ly.img === `${LY_MANIFEST.portraitDir}/${LY_FIRST.portrait}`
    && ly.token === `${LY_MANIFEST.tokenDir}/${LY_FIRST.token}`
    && ly.token !== ly.img
    ? ok("picking sets the square AND its paired circle", `${LY_FIRST.portrait} -> ${LY_FIRST.token}`)
    : fail("picking sets the square AND its paired circle", JSON.stringify([ly.img, ly.token]));
  /all rights reserved/i.test(ly.credit) && !/\bCC BY\b/i.test(ly.credit) && !ly.creditCcLink
    ? ok("the credit says all rights reserved, no CC deed link")
    : fail("the credit says all rights reserved, no CC deed link", JSON.stringify([ly.credit, ly.creditCcLink]));
  ly.creditArtistLink === "https://linktr.ee/lydiadidmyink"
    ? ok("the credit links where her licence links", ly.creditArtistLink)
    : fail("the credit links where her licence links", JSON.stringify(ly.creditArtistLink));

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
    ? ok("an item gets Custom + Game-Icons", "no Tlomdev — actor sheets only")
    : fail("an item gets Custom + Game-Icons", JSON.stringify(item));
  item.img?.includes("/game-icons/tools/")
    ? ok("picking sets the item's art", item.img.split("/").pop())
    : fail("picking sets the item's art", JSON.stringify(item.img));

  /* --- 3b. the portrait die re-rolls within the current folder ----------- */

  const roll = await page.evaluate(async ({ beastFirst }) => {
    const until = async (test, ms = 4000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (test()) return true; await new Promise((r) => setTimeout(r, 100)); }
      return test();
    };
    const Cls = CONFIG.Actor.documentClass;
    const beastDir = "systems/air-bladder/art/tlomdev/beast";
    // generationEnabled seeded TRUE: the default flipped to Off (2026-08-02)
    // and the portrait die this section clicks is exactly what the flag gates.
    const a = await Cls.create({ name: "ZZ Art Roller", type: "npc", system: { role: "npc", generationEnabled: true }, img: `${beastDir}/${beastFirst}` });
    const sheet = a.sheet;
    await sheet.render(true);
    const out = { start: a.img };
    const clickDie = async () => {
      await until(() => !!sheet.element?.querySelector('[data-action="rollPortrait"]'));
      sheet.element.querySelector('[data-action="rollPortrait"]').click();
    };

    // A tlomdev pick: the die must stay inside beast/, and the art is its own token.
    await clickDie();
    await until(() => a.img !== `${beastDir}/${beastFirst}`);
    out.afterBeast = a.img;
    out.tokenAfterBeast = a.prototypeToken?.texture?.src;

    // An Aspeheim face: stays Aspeheim, and the PAIRED token file swaps with it.
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const m = await gen.getPortraitManifest();
    const firstShipped = `${m.portraitDir}/${m.names[0]}`;
    await a.update({ img: firstShipped, "prototypeToken.texture.src": `${m.tokenDir}/${m.names[0]}` });
    await clickDie();
    await until(() => a.img !== firstShipped);
    out.afterAspeheim = a.img;
    out.tokenAfterAspeheim = a.prototypeToken?.texture?.src;
    out.portraitDir = m.portraitDir;
    out.tokenDir = m.tokenDir;

    // A Lydia creature: the gallery is FLAT, so the whole of it is the folder,
    // and the paired token must swap to the matching .png — the second paired
    // gallery, and the only one where "roll stays in the folder" and "token is
    // a different file from the portrait" have to hold at once.
    const ly = await gen.getLydiaManifest();
    const firstLydia = `${ly.portraitDir}/${ly.pairs[0].portrait}`;
    await a.update({ img: firstLydia, "prototypeToken.texture.src": `${ly.tokenDir}/${ly.pairs[0].token}` });
    await clickDie();
    await until(() => a.img !== firstLydia);
    out.afterLydia = a.img;
    out.tokenAfterLydia = a.prototypeToken?.texture?.src;
    out.lydiaPortraitDir = ly.portraitDir;
    out.lydiaTokenDir = ly.tokenDir;
    out.lydiaPairs = ly.pairs;

    // No known folder: back to the auto-assignment pool (custom when the world
    // has any, else Aspeheim) — computed here, not assumed, so the leg does not
    // depend on whether this world's custom folder happens to be empty. Lydia's
    // gallery is deliberately NOT a fallback: it is monsters, and the die on an
    // unrecognised image must not turn a hireling into a black pudding.
    await a.update({ img: "icons/svg/mystery-man.svg" });
    await clickDie();
    await until(() => a.img !== "icons/svg/mystery-man.svg");
    out.afterUnknown = a.img;
    const custom = gen.getCustomPortraitPaths();
    out.unknownLandsInPool = custom.length ? custom.includes(a.img) : a.img.startsWith(`${m.portraitDir}/`);

    await sheet.close();
    await a.delete();
    return out;
  }, { beastFirst: TL_BEAST_FIRST });

  roll.afterBeast?.startsWith("systems/air-bladder/art/tlomdev/beast/") && roll.afterBeast !== roll.start
    ? ok("the die re-rolls within tlomdev/beast", roll.afterBeast.split("/").pop())
    : fail("the die re-rolls within tlomdev/beast", JSON.stringify([roll.start, roll.afterBeast]));
  roll.tokenAfterBeast === roll.afterBeast
    ? ok("a tlomdev roll is its own token")
    : fail("a tlomdev roll is its own token", JSON.stringify([roll.afterBeast, roll.tokenAfterBeast]));
  roll.afterAspeheim?.startsWith(`${roll.portraitDir}/`)
    && roll.tokenAfterAspeheim === `${roll.tokenDir}/${roll.afterAspeheim.split("/").pop()}`
    ? ok("an Aspeheim roll stays Aspeheim, token paired", roll.afterAspeheim.split("/").pop())
    : fail("an Aspeheim roll stays Aspeheim, token paired", JSON.stringify([roll.afterAspeheim, roll.tokenAfterAspeheim]));
  const rolledPair = roll.lydiaPairs?.find((p) => roll.afterLydia === `${roll.lydiaPortraitDir}/${p.portrait}`);
  rolledPair && roll.tokenAfterLydia === `${roll.lydiaTokenDir}/${rolledPair.token}`
    ? ok("a Lydia roll stays Lydia, token paired", `${rolledPair.portrait} -> ${rolledPair.token}`)
    : fail("a Lydia roll stays Lydia, token paired", JSON.stringify([roll.afterLydia, roll.tokenAfterLydia]));
  roll.unknownLandsInPool && !roll.afterUnknown?.includes("/lydia-comer/")
    ? ok("an unknown image falls back to the auto pool", roll.afterUnknown.split("/").pop())
    : fail("an unknown image falls back to the auto pool", JSON.stringify(roll.afterUnknown));

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
