#!/usr/bin/env node
/**
 * `system.inanimate` — the creature-or-thing switch on the NPC sheet.
 *
 * A container is becoming "an NPC with `slots` and a `connectedTo`", which means
 * a cart, a crate and a loot pile are all NPC documents. They must not carry a
 * stat block. `inanimate` drops HP, STR/DEX/WIL, Armor, Deprived/Panicked, the
 * Rest / Restore / Die-of-Fate buttons and every derived condition, while KEEPING
 * the name, Gold, inventory and tabs.
 *
 * Two things here are correctness, not cosmetics:
 *
 * 1. **The derived conditions.** `_computeStatContext` reads `dead = STR <= 0`,
 *    `paralyzed = DEX <= 0`, `delirious = WIL <= 0`. Those are exactly the values
 *    a crate sits at, so without the guard the sheet announces that a barrel is
 *    Dead, Paralyzed and Delirious at once. Hiding the inputs in the template is
 *    not enough — the banners render from a separate context array in a section
 *    that stays visible.
 *
 * 2. **The toggle must not be one-way.** The Inanimate checkbox is deliberately
 *    OUTSIDE every block it hides. Put it inside one (the obvious home is beside
 *    Deprived/Panicked) and ticking it removes the only control that could untick
 *    it — a sheet you cannot get back, with no error to explain why.
 *
 * Drives the real checkbox so `submitOnChange` commits it the way a user does,
 * rather than an `actor.update()` standing in for one.
 *
 * NEGATIVE CONTROL, in-page: `_computeStatContext` is swapped on the prototype
 * for the base implementation's behaviour (the guard removed by wrapping, so the
 * early return never happens). A zero-STR inanimate actor must then show the
 * Dead banner again — otherwise assertion 1 below cannot fail and proves nothing.
 *
 * Usage: npm run dev:inanimate
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m.padEnd(44)} ${d}`);
const bad = (m, d = "") => { console.error(`  FAIL  ${m.padEnd(44)} ${d}`); failed = true; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
watchdog(180000, "dev:inanimate");
await joinAsGM(page);
await dismissChrome(page);

/** Everything the sheet is or is not showing, read from the live DOM. */
const READ = `(sheet) => {
  const el = sheet.element;
  const vis = (sel) => {
    const n = el.querySelector(sel);
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  return {
    hp:        vis('input[name="system.hp.value"]'),
    str:       vis('input[name="system.abilities.STR.value"]'),
    armor:     vis('.armor-counter'),
    deprived:  vis('.deprived-check'),
    restBtn:   vis('#rest-button'),
    dieOfFate: vis('#die-of-fate-button'),
    gold:      vis('input[name="system.gold"]'),
    inanimateBox: vis('.inanimate-check'),
    forHireBox:   vis('.for-hire-check'),
    dayRate:      vis('.day-rate-line'),
    itemsTab:  vis('[data-tab="items"]'),
    banners:   [...el.querySelectorAll('.status-banner')].map((b) => b.className),
    visiblePanels: [...el.querySelectorAll('.tab[data-tab]')].filter((p) => {
      const r = p.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length,
  };
}`;

try {
  const out = await page.evaluate(async ({ READ }) => {
    const read = eval(READ);
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const a = await Cls.create({
      name: "ZZ Inanimate Probe",
      type: "npc",
      // Zeroed on purpose: this is the state that makes the derived conditions
      // fire, so a crate at 0/0/0 is the case that matters. For Hire on too:
      // review #5 found the day-rate row outliving the checkbox that reveals it
      // when Inanimate hid the For Hire box, so this probe starts as a hireling
      // and turns into a thing — the exact sequence that stranded the row.
      system: { abilities: { STR: { value: 0, max: 0 }, DEX: { value: 0, max: 0 }, WIL: { value: 0, max: 0 } }, gold: 25, forHire: true, dayRate: 5 },
    });
    const sheet = a.sheet;
    await sheet.render(true);
    await sleep(900);

    const asCreature = read(sheet);

    // Tick it the way a user does: click the real checkbox and let
    // submitOnChange commit and re-render.
    const box = sheet.element.querySelector(".inanimate-check");
    if (!box) return { error: "no .inanimate-check on the sheet" };
    box.click();
    await sleep(1400);
    const asThing = read(sheet);
    const storedOn = a.system.inanimate;

    // And back again — the one-way trap.
    const box2 = sheet.element.querySelector(".inanimate-check");
    const reachable = !!box2;
    if (box2) { box2.click(); await sleep(1400); }
    const backAgain = read(sheet);
    const storedOff = a.system.inanimate;

    await sheet.close();
    await a.delete();
    return { asCreature, asThing, backAgain, storedOn, storedOff, reachable };
  }, { READ });

  if (out.error) throw new Error(out.error);
  const { asCreature, asThing, backAgain } = out;

  console.log("\na plain NPC keeps its stat block");
  asCreature.hp && asCreature.str && asCreature.armor && asCreature.restBtn
    ? ok("HP, STR, Armor and Rest all present")
    : bad("HP, STR, Armor and Rest all present", JSON.stringify(asCreature));
  asCreature.banners.length
    ? ok("zeroed abilities raise banners", `${asCreature.banners.length} banner(s)`)
    : bad("zeroed abilities raise banners", "none — the control case cannot fail");

  console.log("\nticking Inanimate drops the stat block");
  out.storedOn === true
    ? ok("the checkbox committed through submitOnChange", "system.inanimate = true")
    : bad("the checkbox committed through submitOnChange", `stored ${JSON.stringify(out.storedOn)}`);
  !asThing.hp && !asThing.str && !asThing.armor && !asThing.deprived
    ? ok("HP, STR, Armor, Deprived all gone")
    : bad("HP, STR, Armor, Deprived all gone", JSON.stringify(asThing));
  !asThing.restBtn && !asThing.dieOfFate
    ? ok("Rest and Die of Fate gone", "a crate does not rest")
    : bad("Rest and Die of Fate gone", JSON.stringify(asThing));
  asThing.banners.length === 0
    ? ok("no Dead/Paralyzed/Delirious banner", "derived conditions suppressed")
    : bad("no Dead/Paralyzed/Delirious banner", asThing.banners.join(" | "));

  console.log("\nwhat a thing KEEPS");
  asThing.gold
    ? ok("Gold survives", "a chest holds coins, and coins take slots")
    : bad("Gold survives", "the Gold box went with the vitals line");
  asThing.itemsTab && asThing.visiblePanels === 1
    ? ok("inventory intact, exactly one panel visible", `${asThing.visiblePanels}`)
    : bad("inventory intact, exactly one panel visible", JSON.stringify(asThing));
  !asThing.forHireBox
    ? ok("For Hire is hidden", "a thing cannot be hired")
    : bad("For Hire is hidden", "still on screen");
  // The control half first: the row must EXIST as a creature (forHire is on),
  // or its absence as a thing proves nothing.
  asCreature.dayRate
    ? ok("day-rate row shows while a for-hire creature", "the hidden-state assertion can fail")
    : bad("day-rate row shows while a for-hire creature", "never rendered — nothing below is load-bearing");
  !asThing.dayRate
    ? ok("day-rate row goes with it", "no orphaned rate on a crate")
    : bad("day-rate row goes with it", "the row outlives the checkbox that reveals it");

  console.log("\nand it is not a one-way trip");
  out.reachable
    ? ok("the Inanimate box is still on screen", "outside every block it hides")
    : bad("the Inanimate box is still on screen", "TRAPPED — nothing left to untick");
  out.storedOff === false && backAgain.hp && backAgain.str && backAgain.armor
    ? ok("unticking restores the whole stat block")
    : bad("unticking restores the whole stat block", JSON.stringify({ stored: out.storedOff, ...backAgain }));

  /* ---- the container art picker ---- */
  console.log("\nthe art picker treats an inanimate NPC as a container");
  const pick = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const a = await Cls.create({ name: "ZZ Art Picker", type: "npc", system: { inanimate: true } });
    const sheet = a.sheet;
    await sheet.render(true);
    await sleep(800);

    // Route: an inanimate npc must get the CONTAINER gallery, not 80 portraits.
    sheet.element.querySelector(".portrait")?.click();
    await sleep(900);
    const dlg = [...document.querySelectorAll("dialog")].pop();
    const gallery = dlg?.querySelector(".cairn-container-gallery");
    const cells = [...(dlg?.querySelectorAll(".cairn-portrait-choice") ?? [])];
    const classed = cells.filter((c) => c.dataset.class).length;
    const srcs = cells.map((c) => c.dataset.src);
    const classes = cells.map((c) => c.dataset.class);
    // The two files that spent a year as the same cartwheel glyph.
    const [cartSvg, wagonSvg] = await Promise.all(
      ["cart", "wagon"].map((n) => fetch(`systems/air-bladder/icons/${n}.svg`).then((r) => r.text())));
    const hasBrowse = !!dlg?.querySelector(".cairn-portrait-browse");
    const barrel = cells.find((c) => c.dataset.class === "barrel");
    barrel?.click();
    await sleep(1200);
    // The dialog must be GONE before anything else opens one -- a settled
    // DialogV2 lingers in the DOM while its close transition runs.
    for (let i = 0; i < 40 && document.querySelector("dialog.dialog"); i++) await sleep(100);

    const afterPick = {
      img: a.img,
      token: a.prototypeToken.texture.src,
      cls: a.system.containerClass,
      slots: a.system.slots,
      label: a.system.classLabel,
    };

    // A capacity someone typed must survive a later art change.
    await a.update({ "system.slots": 12 });
    await sheet._setContainerArt("systems/air-bladder/icons/crate.svg", "crate");
    const afterSecond = { cls: a.system.containerClass, slots: a.system.slots };

    // The Browse escape stores no class, so the label falls back to the name.
    await sheet._setContainerArt("icons/svg/chest.svg", "");
    const afterBrowse = { img: a.img, cls: a.system.containerClass };

    await sheet.close();
    await a.delete();
    return { isContainerGallery: !!gallery, cellCount: cells.length, classed, srcs, classes,
      cartWagonDiffer: cartSvg !== wagonSvg, hasBrowse, afterPick, afterSecond, afterBrowse };
  });

  pick.isContainerGallery
    ? ok("an inanimate NPC gets the container gallery", "not the 80-portrait one")
    : bad("an inanimate NPC gets the container gallery", "it opened the character portrait picker");
  // 12 cells for 13 classes: the gallery shows each GLYPH once, and mule/donkey
  // share Skoll's donkey (game-icons.net has no mule). Removing the dedupe
  // filter fails BOTH of the first two assertions — 13 cells, donkey.svg twice.
  pick.cellCount === 12 && pick.classed === 12
    ? ok("one cell per glyph, each carrying its class key", `${pick.cellCount} cells for 13 classes`)
    : bad("one cell per glyph, each carrying its class key", `${pick.cellCount} cells, ${pick.classed} classed`);
  new Set(pick.srcs).size === pick.srcs.length
    ? ok("no two cells wear the same image", "the doubled donkey is gone")
    : bad("no two cells wear the same image", JSON.stringify(pick.srcs));
  pick.classes.includes("mule") && !pick.classes.includes("donkey")
    ? ok("the shared donkey glyph belongs to the MULE", "donkey stays a name-inferred class")
    : bad("the shared donkey glyph belongs to the MULE", JSON.stringify(pick.classes));
  pick.cartWagonDiffer
    ? ok("cart and wagon wear different glyphs", "wagon.svg is no longer a copy of cart.svg")
    : bad("cart and wagon wear different glyphs", "the two files are byte-identical again");
  pick.hasBrowse
    ? ok("the Browse escape is present", "a Warden can use their own art")
    : bad("the Browse escape is present", "no browse button");
  pick.afterPick.cls === "barrel" && /barrel\.svg$/.test(pick.afterPick.img)
    ? ok("picking barrel sets art AND class", `${pick.afterPick.cls}`)
    : bad("picking barrel sets art AND class", JSON.stringify(pick.afterPick));
  pick.afterPick.token === pick.afterPick.img
    ? ok("the map token follows the portrait", "one field, no drift")
    : bad("the map token follows the portrait", JSON.stringify(pick.afterPick));
  pick.afterPick.slots === 4
    ? ok("an unset capacity takes the class default", "barrel = 4")
    : bad("an unset capacity takes the class default", `slots=${pick.afterPick.slots}`);
  pick.afterSecond.cls === "crate" && pick.afterSecond.slots === 12
    ? ok("a capacity someone TYPED is not overwritten", "12 survived a re-art to crate")
    : bad("a capacity someone TYPED is not overwritten", JSON.stringify(pick.afterSecond));
  pick.afterBrowse.cls === ""
    ? ok("custom art stores no class", "the label falls back to the name")
    : bad("custom art stores no class", JSON.stringify(pick.afterBrowse));

  /* ---- negative control: remove the guard, in page ---- */
  console.log("\n   negative control: _computeStatContext guard removed");
  const ctrl = await page.evaluate(async ({ READ }) => {
    const read = eval(READ);
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const proto = CONFIG.Actor.sheetClasses.npc
      ? Object.values(CONFIG.Actor.sheetClasses.npc)[0].cls.prototype
      : null;
    if (!proto) return { error: "could not resolve the npc sheet class" };

    const original = proto._computeStatContext;
    // Pre-fix behaviour and nothing else: run the real thing, but with the
    // inanimate early-return defeated by lying about the flag for the duration
    // of the call. Restores the getter immediately afterwards.
    proto._computeStatContext = function patched(context) {
      const real = this.actor.system.inanimate;
      Object.defineProperty(this.actor.system, "inanimate", { value: false, configurable: true });
      try { return original.call(this, context); } finally {
        Object.defineProperty(this.actor.system, "inanimate", { value: real, configurable: true });
      }
    };

    const a = await Cls.create({
      name: "ZZ Inanimate Control",
      type: "npc",
      system: {
        inanimate: true,
        abilities: { STR: { value: 0, max: 0 }, DEX: { value: 0, max: 0 }, WIL: { value: 0, max: 0 } },
      },
    });
    await a.sheet.render(true);
    await sleep(900);
    const seen = read(a.sheet);
    await a.sheet.close();
    await a.delete();
    proto._computeStatContext = original;
    return { banners: seen.banners };
  }, { READ });

  if (ctrl.error) bad("control", ctrl.error);
  else if (ctrl.banners.length)
    ok("reproduced — the banners come back", `${ctrl.banners.length}: ${ctrl.banners.join(" | ")}`);
  else
    bad("reproduced — the banners come back",
      "the control changed nothing, so the banner assertion above is not load-bearing");
} catch (e) {
  bad("threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
  if (errors.length) failed = true;
  await browser.close();
}

console.log(failed ? "\nINANIMATE PROBE FAILED" : "\ninanimate probe passed");
process.exit(failed ? 1 : 0);
