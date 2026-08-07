#!/usr/bin/env node
/**
 * Item Piles, and the container class label every container sheet now carries.
 *
 * Two things are being protected here.
 *
 * The LABEL is derived from one classifier shared with the art, so a sheet can
 * say what a container actually is. The case that forced it: a "Heavy Destrier"
 * is a horse, and nothing anywhere said so — not the name, not the description,
 * and not the old `transportKind`, which only ever said "Mount". If the
 * classifier and the art map ever drift apart, a sheet reads "Horse" beside a
 * picture of a cart. So this walks EVERY shipped transport and checks both.
 *
 * The PILE is a container nothing carries: a loot heap a Warden drops in a room.
 * It is reachable only from the Actor Directory (a keeper's Connections tab is
 * the one place it can never appear), and a player needs ownership to use it —
 * which is also the natural "the party has found it" switch, so this asserts the
 * refusal is visible rather than silent. Since the roles work a pile is a
 * container KIND, not a document type and not a `transportKind` of its own, and
 * this drives the Kind box the Warden actually types in.
 *
 *   npm run dev:item-pile      (needs Alice — npm run dev:players)
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, dismissChrome, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const gmPage = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(gmPage);
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(40)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(40)} ${d}`); failures++; };

// What each shipped transport must report. The Destrier is the reason this
// exists; the rest are here so a change to the classifier cannot quietly
// re-label the ones nobody was looking at.
const EXPECTED = {
  "Heavy Destrier": ["Horse", "horse.svg"],
  "Blacklegged Dandy": ["Horse", "horse.svg"],
  "Piebald Cob": ["Horse", "horse.svg"],
  "Linden White": ["Horse", "horse.svg"],
  "Stray Fogger": ["Horse", "horse.svg"],
  Rivertooth: ["Horse", "horse.svg"],
  Horse: ["Horse", "horse.svg"],
  // Mule and Donkey SHARE a glyph but are separate classes: drawing a mule as a
  // donkey is the art we have; calling it one is wrong.
  Mule: ["Mule", "donkey.svg"],
  Donkey: ["Donkey", "donkey.svg"],
  Cart: ["Cart", "cart.svg"],
  Handcart: ["Hand Cart", "handcart.svg"],
  Wagon: ["Wagon", "wagon.svg"],
  // The funeralwagon class is RETIRED (2026-08-02): a hearse is a wagon a
  // Warden has named, so Burial Wagon stores `wagon` and labels "Wagon" —
  // while deliberately KEEPING the coffin art the pack ships, which the
  // art/Kind decoupling makes legal (see the drifted-filter exemption below).
  "Burial Wagon": ["Wagon", "wagon.svg"],
  Sack: ["Sack", "sack.svg"],
  Backpack: ["Backpack", "backpack.svg"],
};

try {
  await joinAsGM(gmPage);
  await dismissChrome(gmPage);

  /* --- 1. every shipped transport labels and draws consistently ----------- */
  // The mounts-transports ACTOR pack — the legacy transports Item pack is
  // dissolved. Every document stores its containerClass, so the label and the
  // icon both come off the stored class; what this asserts is that the stored
  // class, the shipped art and the label all still agree per document.
  console.log("\nclass labels");
  const classes = await gmPage.evaluate(async () => {
    const icons = await import("/systems/air-bladder/module/icons.js");
    const docs = await game.packs.get("air-bladder.mounts-transports").getDocuments();
    return docs.map((d) => ({
      name: d.name,
      label: game.i18n.localize(icons.containerClassLabel(d.name, "", d.system.containerClass)),
      icon: icons.iconForTransport(d.name, "", d.system.containerClass).split("/").pop(),
      // The art the classifier picks must still be the art the pack ships, or
      // the refactor silently re-arted 15 documents.
      packImg: d.img.split("/").pop(),
    }));
  });

  const wrong = classes.filter((c) => {
    const want = EXPECTED[c.name];
    return !want || c.label !== want[0] || c.icon !== want[1];
  });
  classes.length === Object.keys(EXPECTED).length && !wrong.length
    ? ok(`all ${classes.length} shipped transports`, "label and art both as expected")
    : fail("shipped transport labels", JSON.stringify(wrong.length ? wrong : classes.map((c) => c.name)));

  // Burial Wagon is EXEMPT by design: it stores class `wagon` but ships the
  // coffin art (funeralwagon.svg) — custom art over a known Kind, the exact
  // shape the 2026-08-02 decoupling exists to permit. Everything else must
  // still agree, or the refactor silently re-arted the pack.
  const drifted = classes.filter((c) => c.icon !== c.packImg && c.name !== "Burial Wagon");
  !drifted.length
    ? ok("the classifier picks the shipped art", "no document would be re-arted (Burial Wagon exempt by design)")
    : fail("the classifier picks the shipped art", JSON.stringify(drifted));
  const burial = classes.find((c) => c.name === "Burial Wagon");
  burial?.packImg === "funeralwagon.svg"
    ? ok("Burial Wagon keeps its coffin art over class wagon", "the decoupling's shipped witness")
    : fail("Burial Wagon keeps its coffin art over class wagon", JSON.stringify(burial));

  const destrier = classes.find((c) => c.name === "Heavy Destrier");
  destrier?.label === "Horse"
    ? ok('a Heavy Destrier reads "Horse"', "the case this was built for")
    : fail('a Heavy Destrier reads "Horse"', `got "${destrier?.label}"`);

  // The other half of the classifier: a name with NO stored class, which is what
  // a Warden typing one in gets. Each pair here is a rule that can only be broken
  // silently — the two word-boundary ones especially, since "Draft Horse" holds a
  // raft and every class but Small Craft used to answer to its own label.
  const BY_NAME = {
    // funeral/hearse/burial answer WAGON since the class retired — the rule
    // survives so "Hearse" (no construction word) never falls to the chest.
    "Funeral Wagon": "wagon", "Burial Wagon": "wagon", Hearse: "wagon",
    Wagon: "wagon", "Funeral Cart": "cart",
    Rowboat: "smallcraft", Skiff: "smallcraft", "Small Craft": "smallcraft",
    "Draft Horse": "horse", Handicraft: "chest",
  };
  const named = await gmPage.evaluate(async (names) => {
    const icons = await import("/systems/air-bladder/module/icons.js");
    return Object.fromEntries(names.map((n) => [n, icons.containerClass(n)]));
  }, Object.keys(BY_NAME));
  const misnamed = Object.entries(BY_NAME).filter(([n, want]) => named[n] !== want);
  !misnamed.length
    ? ok(`${Object.keys(BY_NAME).length} names classify by word alone`, "purpose before construction; no raft in a Draft Horse")
    : fail("names classify by word alone", JSON.stringify(misnamed.map(([n, w]) => `${n}: want ${w}, got ${named[n]}`)));

  /* --- 2. a Warden makes a pile ------------------------------------------ */
  console.log("\nmaking an Item Pile");
  const made = await gmPage.evaluate(async () => {
    // Through CONFIG.Actor.documentClass, NOT the global `Actor`: they are
    // different classes, and only the configured one runs our create hook. The
    // Actor Directory uses the configured one; a probe using the global tests a
    // path no user takes and reads Foundry's mystery-man.
    const Impl = CONFIG.Actor.documentClass;
    for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Cache"))) await a.delete();

    // Deliberately a name with no give-away word, so only the ROLE can classify
    // it. "Loot Pile" would pass on the name alone and prove nothing.
    //
    // An npc with role container: the `container` TYPE is retired (2026-07-31)
    // and cannot be created. The pile is a container KIND now, not a
    // `transportKind` — the
    // control it is set with is the free-text `containerClass` box, not the
    // retired sheet's `transportKind` pick-list.
    const mk = (name, extra = {}) => Impl.create({
      name, type: "npc", system: { role: "container" }, ...extra,
    });
    const pile = await mk("ZZ Cache Alpha");
    const before = { img: pile.img.split("/").pop() };
    await pile.update({ "system.containerClass": "pile", "system.slots": 6 });

    // Hand-picked art must survive the same change.
    const custom = await mk("ZZ Cache Custom", { img: "icons/svg/coins.svg" });
    await custom.update({ "system.containerClass": "pile" });

    await pile.sheet.render(true);
    await new Promise((r) => setTimeout(r, 1200));
    const el = pile.sheet.element;
    // The Type control is a strict SELECT since 2026-08-02: the label a user
    // sees is the selected option's text, the options are the role's kinds
    // plus blank and "Other…", and the free-text input sits disabled behind
    // Other. The old input+datalist reads died with the control.
    const select = el.querySelector(".kind-select");
    const out = {
      before,
      after: {
        img: pile.img.split("/").pop(),
        token: pile.prototypeToken.texture.src.split("/").pop(),
      },
      customKept: custom.img,
      sheet: {
        selectValue: select?.selectedOptions?.[0]?.textContent?.trim() ?? null,
        stored: pile.system.containerClass ?? null,
        options: select ? [...select.options].map((o) => o.textContent.trim()).filter(Boolean) : [],
        // Not clipped: the Type control has its own room for exactly this reason.
        clipped: select ? select.scrollWidth > select.clientWidth + 1 : null,
      },
      pileId: pile.id,
      customId: custom.id,
    };
    await pile.sheet.close();
    return out;
  });

  made.before.img === "chest.svg"
    ? ok("a hand-made container gets class art", made.before.img)
    : fail("a hand-made container gets class art", `img=${made.before.img} (mystery-man means the create hook was skipped)`);
  made.after.img === "stack.svg" && made.after.token === "stack.svg"
    ? ok("switching to Item Pile re-arts it", "sheet AND prototype token")
    : fail("switching to Item Pile re-arts it", JSON.stringify(made.after));
  // "and relabels it" used to assert system.classLabel here; that derived
  // property is deleted (review #6 batch 3) and the label contract lives in
  // the sheet assertion below — the selected option's text.
  made.customKept === "icons/svg/coins.svg"
    ? ok("hand-picked art is never overwritten", made.customKept)
    : fail("hand-picked art is never overwritten", made.customKept);
  // The display/value split (2026-08-02): the select SHOWS the label, the
  // document STORES the key. The original defect was the raw key on the sheet
  // in every language.
  made.sheet.selectValue === "Item Pile" && made.sheet.stored === "pile"
    ? ok("the sheet shows the Type, the doc stores the key", `"${made.sheet.selectValue}" / "${made.sheet.stored}"`)
    : fail("the sheet shows the Type, the doc stores the key", JSON.stringify(made.sheet));
  made.sheet.options.includes("Item Pile") && made.sheet.options.includes("Other…") && made.sheet.clipped === false
    ? ok("the Type select offers it, plus Other, unclipped", made.sheet.options.join(" / "))
    : fail("the Type select offers it, plus Other, unclipped", JSON.stringify(made.sheet));

  /* --- 3. the directory shows it ----------------------------------------- */
  console.log("\nreachability");
  // This leg used to force `show-container-actors` false and assert a pile
  // survived the hide rule. Both the setting and the hide rule are GONE
  // (2026-08-02, by ruling: containers are always listed), so the claim is
  // simply "a pile is listed" — no settings writes.
  const visible = await gmPage.evaluate(async (id) => {
    ui.actors.render(true);
    await new Promise((r) => setTimeout(r, 900));
    const row = document.querySelector(`#actors [data-entry-id="${id}"], #actors [data-document-id="${id}"]`);
    return { found: !!row, hidden: row ? row.classList.contains("hidden") : null };
  }, made.pileId);

  visible.found && visible.hidden === false
    ? ok("a pile is listed in the directory", "like every container actor now")
    : fail("a pile is listed in the directory", JSON.stringify(visible));

  /* --- 4. a player, which is the whole point of a pile -------------------- */
  console.log("\nas a player");
  const setup = await gmPage.evaluate(async (pileId) => {
    const alice = game.users.getName("Alice");
    if (!alice) return { error: "no Alice — run npm run dev:players" };
    const pile = game.actors.get(pileId);
    await pile.update({ ownership: { default: 0 } });
    const item = await Item.create({ name: "ZZ Cache Torch", type: "item" });
    return { aliceId: alice.id, itemUuid: item.uuid, itemId: item.id };
  }, made.pileId);

  if (setup.error) {
    fail("player checks", setup.error);
  } else {
    const alicePage = await browser.newPage({ viewport: VIEWPORT });
    await joinAs(alicePage, "Alice");
    await dismissChrome(alicePage);

    const drop = async (page, id, uuid) => page.evaluate(async ({ id, uuid }) => {
      const pile = game.actors.get(id);
      if (!pile) return { visible: false };
      await pile.sheet.render(true);
      await new Promise((r) => setTimeout(r, 900));
      const notices = [];
      const orig = ui.notifications.warn.bind(ui.notifications);
      ui.notifications.warn = (m, ...a) => { notices.push(m); return orig(m, ...a); };
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      try { await pile.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); }
      catch (e) { notices.push(`threw: ${e.message}`); }
      await new Promise((r) => setTimeout(r, 700));
      ui.notifications.warn = orig;
      await pile.sheet.close();
      return { visible: true, count: pile.items.size, notices };
    }, { id, uuid });

    const denied = await drop(alicePage, made.pileId, setup.itemUuid);
    // With no ownership the pile is not even visible to her — which is the
    // correct starting state for undiscovered loot.
    !denied.visible || denied.count === 0
      ? ok("a player cannot use a pile she has no rights to", denied.visible ? "drop refused" : "not visible at all")
      : fail("a player cannot use a pile she has no rights to", JSON.stringify(denied));

    await gmPage.evaluate(async ({ pileId, aliceId }) => {
      await game.actors.get(pileId).update({ ownership: { default: 0, [aliceId]: 3 } });
    }, { pileId: made.pileId, aliceId: setup.aliceId });
    await alicePage.reload({ waitUntil: "networkidle" });
    await alicePage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await dismissChrome(alicePage);

    const allowed = await drop(alicePage, made.pileId, setup.itemUuid);
    allowed.visible && allowed.count === 1
      ? ok("granting ownership lets her fill it", "the Warden's 'you found it' switch")
      : fail("granting ownership lets her fill it", JSON.stringify(allowed));

    await alicePage.close();
  }

  /* --- 5. a stack is only a stack when the scroll flag agrees -------------- */
  // gear.js stores a scroll under the bare spell name, so a spellbook and a
  // spellscroll can share name AND type — and the name+type merge folded a
  // dropped book into a scroll stack (review #9 finding 3). The same-flag
  // second drop is the witness: it proves the merge machinery FIRES under
  // this probe's exact conditions, so the only thing keeping the book out of
  // the scroll stack is the flag test. With the fix removed the first drop
  // merges (one doc, scroll qty 2) and the "two documents" assert goes red.
  console.log("\nscroll identity in drop-merge");
  const scrollMerge = await gmPage.evaluate(async () => {
    const ActorImpl = CONFIG.Actor.documentClass;
    const ItemImpl = CONFIG.Item.documentClass;
    for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Cache Holder"))) await a.delete();
    const holder = await ActorImpl.create({ name: "ZZ Cache Holder", type: "character" });
    await holder.createEmbeddedDocuments("Item", [
      { name: "ZZ Sigil", type: "spellbook", system: { scroll: true, quantity: 1 } },
    ]);
    const book = await ItemImpl.create({ name: "ZZ Sigil", type: "spellbook" });
    await holder.sheet.render(true);
    await new Promise((r) => setTimeout(r, 900));
    const dropBook = async () => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: book.uuid }));
      await holder.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 500));
    };
    const snap = () => holder.items
      .filter((i) => i.name === "ZZ Sigil")
      .map((i) => ({ scroll: !!i.system.scroll, qty: i.system.quantity ?? 1 }))
      .sort((a, b) => Number(a.scroll) - Number(b.scroll));
    await dropBook();
    const afterBook = snap();
    await dropBook();
    const afterSecond = snap();
    await holder.sheet.close();
    await holder.delete();
    await book.delete();
    return { afterBook, afterSecond };
  });
  JSON.stringify(scrollMerge.afterBook) === JSON.stringify([{ scroll: false, qty: 1 }, { scroll: true, qty: 1 }])
    ? ok("a book dropped on a scroll-holder stays a separate doc", "scroll qty unchanged")
    : fail("a book dropped on a scroll-holder stays a separate doc", JSON.stringify(scrollMerge.afterBook));
  JSON.stringify(scrollMerge.afterSecond) === JSON.stringify([{ scroll: false, qty: 2 }, { scroll: true, qty: 1 }])
    ? ok("the same-flag drop still merges", "the witness: merge machinery fires here")
    : fail("the same-flag drop still merges", JSON.stringify(scrollMerge.afterSecond));

  // ---- Fatigue belongs to a character, never to a thing --------------------
  // A crate cannot be tired. The +/- header shipped on every container and
  // transport because ONE npc sheet serves all five roles and passed
  // `withFatigue=1` flat, so a Warden could put Fatigue on a sack. Three things
  // are checked, and the middle one is the reason this leg is long: hiding the
  // header naively ALSO deletes the coin rows, because they rode on the same
  // flag.
  const fatigue = await gmPage.evaluate(async () => {
    const ActorImpl = CONFIG.Actor.documentClass;
    const ItemImpl = CONFIG.Item.documentClass;
    const out = {};
    // Gold, so goldSlots > 0 and the coin rows have something to render. Coins
    // take slots for every actor type, a chest included.
    const thing = await ActorImpl.create({
      name: "ZZ Fatigue Crate", type: "npc",
      system: { role: "container", slots: 6, gold: 250 },
    });
    const pc = await ActorImpl.create({ name: "ZZ Fatigue PC", type: "character" });
    const show = async (a) => {
      await a.sheet.render(true);
      await new Promise((r) => setTimeout(r, 900));
      return a.sheet.element;
    };
    const fatigueCount = (a) => a.items.filter((i) => i.name === "Fatigue").length;

    const thingEl = await show(thing);
    out.thingHasButton = !!thingEl.querySelector('[data-action="addFatigue"]');
    out.thingGoldSlots = thing.system.goldSlots ?? 0;
    out.thingCoinRows = thingEl.querySelectorAll(".gold-slot-row").length;

    // ENFORCEMENT, and the control is IN-PAGE: plant the very button the old
    // template rendered and click it. That is not a contrivance — it is exactly
    // the state of a sheet left open while the actor's role changed to
    // container, which is the case the hidden header cannot cover.
    const notices = [];
    const orig = ui.notifications.warn.bind(ui.notifications);
    ui.notifications.warn = (m, ...a) => { notices.push(m); return orig(m, ...a); };
    const planted = document.createElement("a");
    planted.dataset.action = "addFatigue";
    thingEl.querySelector(".cairn-items-list-header")?.appendChild(planted);
    planted.click();
    await new Promise((r) => setTimeout(r, 700));
    out.thingFatigueAfterClick = fatigueCount(thing);

    // The drop route, which hiding a button does nothing about.
    const loose = await ItemImpl.create({ name: "Fatigue", type: "item" });
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: loose.uuid }));
    try { await thing.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); }
    catch (e) { notices.push(`threw: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 700));
    out.thingFatigueAfterDrop = fatigueCount(thing);
    ui.notifications.warn = orig;
    out.notices = notices.slice();
    await thing.sheet.close();

    // THE OTHER END. Every assertion above is an absence, and an absence passes
    // just as well when the selector is wrong or the click never dispatched. So
    // drive the identical path on a CHARACTER and require the opposite.
    const pcEl = await show(pc);
    out.pcHasButton = !!pcEl.querySelector('[data-action="addFatigue"]');
    pcEl.querySelector('[data-action="addFatigue"]')?.click();
    await new Promise((r) => setTimeout(r, 700));
    out.pcFatigueAfterClick = fatigueCount(pc);
    await pc.sheet.close();

    await loose.delete();
    await thing.delete();
    await pc.delete();
    return out;
  });

  !fatigue.thingHasButton
    ? ok("a container offers no Fatigue control", "the +/- header is gone")
    : fail("a container offers no Fatigue control", "the header still renders");
  fatigue.pcHasButton
    ? ok("...but a character still does", "control: the selector and sheet are real")
    : fail("...but a character still does", "the header vanished from characters too");
  fatigue.thingGoldSlots > 0 && fatigue.thingCoinRows === fatigue.thingGoldSlots
    ? ok("the container's coin rows survived", `${fatigue.thingCoinRows} row(s) for ${fatigue.thingGoldSlots} slot(s)`)
    : fail("the container's coin rows survived", `rows=${fatigue.thingCoinRows} slots=${fatigue.thingGoldSlots} — the flag split lost them`);
  fatigue.thingFatigueAfterClick === 0
    ? ok("a planted Fatigue button is refused", "hiding is the affordance, this is the enforcement")
    : fail("a planted Fatigue button is refused", `${fatigue.thingFatigueAfterClick} Fatigue on the crate`);
  fatigue.thingFatigueAfterDrop === 0
    ? ok("Fatigue cannot be DROPPED on a thing", "the route hiding a button leaves open")
    : fail("Fatigue cannot be DROPPED on a thing", `${fatigue.thingFatigueAfterDrop} Fatigue on the crate`);
  fatigue.pcFatigueAfterClick === 1
    ? ok("...and a character still gains Fatigue", "control: the click path works")
    : fail("...and a character still gains Fatigue", `${fatigue.pcFatigueAfterClick} on the PC — the click never landed, so the refusals above prove nothing`);

  await gmPage.evaluate(async ({ a, b, itemId }) => {
    await game.actors.get(a)?.delete();
    await game.actors.get(b)?.delete();
    await game.items.get(itemId)?.delete();
  }, { a: made.pileId, b: made.customId, itemId: setup.itemId });
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nFAILED (${failures})\n` : "\nitem pile probe passed\n");
process.exit(failures ? 1 : 0);
