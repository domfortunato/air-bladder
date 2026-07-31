#!/usr/bin/env node
/**
 * Item Piles, and the container class label every container sheet now carries.
 *
 * Two things are being protected here.
 *
 * The LABEL is derived from one classifier shared with the art, so a sheet can
 * say what a container actually is. The case that forced it: a "Heavy Destrier"
 * is a horse, and nothing anywhere said so — not the name, not the description,
 * and not `transportKind`, which only ever says "Mount". If the classifier and
 * the art map ever drift apart, a sheet reads "Horse" beside a picture of a cart.
 * So this walks EVERY shipped transport and checks both together.
 *
 * The PILE is a container nothing carries: a loot heap a Warden drops in a room.
 * It is reachable only from the Actor Directory (a character's Containers tab is
 * the one place it can never appear), and a player needs ownership to use it —
 * which is also the natural "the party has found it" switch, so this asserts the
 * refusal is visible rather than silent.
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
  Handcart: ["Handcart", "handcart.svg"],
  Wagon: ["Wagon", "wagon.svg"],
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

  const drifted = classes.filter((c) => c.icon !== c.packImg);
  !drifted.length
    ? ok("the classifier picks the shipped art", "no document would be re-arted")
    : fail("the classifier picks the shipped art", JSON.stringify(drifted));

  const destrier = classes.find((c) => c.name === "Heavy Destrier");
  destrier?.label === "Horse"
    ? ok('a Heavy Destrier reads "Horse"', "the case this was built for")
    : fail('a Heavy Destrier reads "Horse"', `got "${destrier?.label}"`);

  /* --- 2. a Warden makes a pile ------------------------------------------ */
  console.log("\nmaking an Item Pile");
  const made = await gmPage.evaluate(async () => {
    // Through CONFIG.Actor.documentClass, NOT the global `Actor`: they are
    // different classes, and only the configured one runs our create hook. The
    // Actor Directory uses the configured one; a probe using the global tests a
    // path no user takes and reads Foundry's mystery-man.
    const Impl = CONFIG.Actor.documentClass;
    for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Cache"))) await a.delete();

    // Deliberately a name with no give-away word, so only the TYPE can classify
    // it. "Loot Pile" would pass on the name alone and prove nothing.
    const pile = await Impl.create({ name: "ZZ Cache Alpha", type: "container" });
    const before = { img: pile.img.split("/").pop(), label: pile.system.classLabel };
    await pile.update({ "system.transportKind": "pile", "system.slots": 6 });

    // Hand-picked art must survive the same change.
    const custom = await Impl.create({ name: "ZZ Cache Custom", type: "container", img: "icons/svg/coins.svg" });
    await custom.update({ "system.transportKind": "pile" });

    await pile.sheet.render(true);
    await new Promise((r) => setTimeout(r, 1200));
    const el = pile.sheet.element;
    const sel = el.querySelector('select[name="system.transportKind"]');
    const out = {
      before,
      after: {
        img: pile.img.split("/").pop(),
        token: pile.prototypeToken.texture.src.split("/").pop(),
        label: pile.system.classLabel,
      },
      customKept: custom.img,
      sheet: {
        classText: el.querySelector(".container-class")?.textContent?.trim() ?? null,
        selectValue: sel?.value ?? null,
        options: [...(sel?.options ?? [])].map((o) => o.text).filter(Boolean),
        // Not clipped: "Item Pile" is the longest option and the reason this
        // control has its own row rather than a third column beside Slots/Cost.
        clipped: sel ? sel.scrollWidth > sel.clientWidth + 1 : null,
      },
      pileId: pile.id,
      customId: custom.id,
    };
    await pile.sheet.close();
    return out;
  });

  made.before.img === "chest.svg"
    ? ok("a hand-made container gets class art", `${made.before.img}, labelled "${made.before.label}"`)
    : fail("a hand-made container gets class art", `img=${made.before.img} (mystery-man means the create hook was skipped)`);
  made.after.img === "stack.svg" && made.after.token === "stack.svg"
    ? ok("switching to Item Pile re-arts it", "sheet AND prototype token")
    : fail("switching to Item Pile re-arts it", JSON.stringify(made.after));
  made.after.label === "Item Pile"
    ? ok("and relabels it", made.after.label)
    : fail("and relabels it", made.after.label);
  made.customKept === "icons/svg/coins.svg"
    ? ok("hand-picked art is never overwritten", made.customKept)
    : fail("hand-picked art is never overwritten", made.customKept);
  made.sheet.classText === "Item Pile" && made.sheet.selectValue === "pile"
    ? ok("the sheet shows and stores the type", `"${made.sheet.classText}"`)
    : fail("the sheet shows and stores the type", JSON.stringify(made.sheet));
  made.sheet.options.includes("Item Pile") && made.sheet.clipped === false
    ? ok("the Type control fits its longest option", made.sheet.options.join(" / "))
    : fail("the Type control fits its longest option", JSON.stringify(made.sheet));

  /* --- 3. the directory shows it ----------------------------------------- */
  console.log("\nreachability");
  const visible = await gmPage.evaluate(async (id) => {
    const wasShow = game.settings.get("air-bladder", "show-container-actors");
    await game.settings.set("air-bladder", "show-container-actors", false);
    ui.actors.render(true);
    await new Promise((r) => setTimeout(r, 900));
    const row = document.querySelector(`#actors [data-entry-id="${id}"], #actors [data-document-id="${id}"]`);
    const res = { found: !!row, hidden: row ? row.classList.contains("hidden") : null };
    await game.settings.set("air-bladder", "show-container-actors", wasShow);
    return res;
  }, made.pileId);

  // Worn containers are hidden from the directory because a character's
  // Containers tab reaches them. Nothing reaches a pile that way.
  visible.found && visible.hidden === false
    ? ok("a pile is listed even with containers hidden", "like mounts and vehicles")
    : fail("a pile is listed even with containers hidden", JSON.stringify(visible));

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
