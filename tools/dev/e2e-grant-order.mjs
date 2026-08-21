#!/usr/bin/env node
/**
 * The ORDER a generated loadout arrives in, and where a later item lands.
 *
 * Five bands, top to bottom: weapons, armor, everything else, light sources
 * (each with its fuel directly beneath it), Rations. Written as each item's
 * `sort` by `orderGrantedItems` (module/gear.js) at the four generators, and
 * read back by `_sortItemsForDisplay` — so this asserts the RENDERED ROW ORDER,
 * never the stored array. The rules describe what a player sees.
 *
 * Why these four fixtures and not four random rolls:
 *
 *   - A 2e **Marchguard** grants "Rations, Lantern, Oil Can, Long Sword, Boiled
 *     Leather" — every band, the fuel pairing, and a build order that is very
 *     nearly the reverse of the target. A leg whose input was already in the
 *     right order would prove nothing.
 *   - A Barebones **Oil Collector** grants "Lantern, Oil Can, Sealable Bottle",
 *     and the Barebones kit adds Rations and a Torch, so its light band holds a
 *     paired lamp AND a loose torch.
 *   - A Barebones **Acolyte** grants a "Spellbook" instruction row, the book
 *     band's fixture (2026-08-21): the resolved book — a scroll under GLOG,
 *     same type — must sit after the rolled weapon/armor, before the rest.
 *   - A **hireling** takes a random career, and that is safe to leave random:
 *     all twelve in npc-careers-2e.json begin "Rations, <a light>", so the two
 *     bands this is about are present by construction rather than by luck.
 *   - An **NPC** takes a random Background, and its kit always adds Rations and
 *     a Torch, for the same reason.
 *
 * The band rule is RESTATED here rather than imported from gear.js. It is the
 * thing under test, and a probe that asks the code what the answer should be
 * cannot fail.
 *
 * Two negative controls, both in-page, both against documents this probe made:
 *   - ORDERING: zero every item's sort on the generated Marchguard and
 *     re-render. `_sortItemsForDisplay` falls back to display name, so the list
 *     goes alphabetical — Lantern, Long Sword, Oil Can — and the Oil Can is no
 *     longer under its lamp. Without this leg, "the order is right" could just
 *     be the alphabet agreeing by luck for this loadout.
 *   - APPENDING: replace `CairnItem._preCreateOperation` with a no-op, which is
 *     exactly the pre-fix state, and watch the new item land FIRST. (That also
 *     lifts the one-book wall sharing the method; this leg creates a rope, so
 *     nothing about books is exercised either way.)
 *
 * World state — the reorder setting and every actor created here — is restored
 * from NODE in a finally, never from inside a page that may have died.
 *
 * Usage: npm run dev:grant-order
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const BANDS = ["weapon", "armor", "book", "other", "light", "rations"];

/**
 * The in-page helpers, built inside each evaluate by `new Function` rather than
 * by `eval`: a direct eval's `const` declarations stay inside the eval and never
 * reach the calling scope, so every helper would be undefined at the point of
 * use. Returning them from a function body is the shape that actually works.
 */
const HELPERS = `
  const LIGHT_RE = /\\b(torch(es)?|lanterns?|lamps?|candles?)\\b/i;
  const FUEL = new Set(["oil can"]);
  const RATIONS_RE = /\\brations?\\b/i;
  // Restated on purpose — see the file docstring. Books (spellbooks AND
  // scrolls — one TYPE, a scroll is a flag) sit together after armor
  // (2026-08-21, user ask).
  const bandOf = (name, type) => {
    if (type === "weapon") return 0;
    if (type === "armor") return 1;
    if (type === "spellbook") return 2;
    const n = String(name ?? "");
    if (RATIONS_RE.test(n)) return 5;
    if (LIGHT_RE.test(n) || FUEL.has(n.trim().toLowerCase())) return 4;
    return 3;
  };
  // The rendered row order, mapped back to each item's STORED name. Reading the
  // row TEXT would read the content overlay's translation instead, so the same
  // assertion would quietly mean something different in a Spanish world.
  const renderedRows = (actor) => {
    const root = actor.sheet?.element;
    if (!root) return [];
    const sel = '.tab[data-tab="items"] .cairn-items-list-row[data-item-id]';
    return [...root.querySelectorAll(sel)].map((el) => {
      const item = actor.items.get(el.dataset.itemId);
      return item ? { id: item.id, name: item.name, type: item.type, sort: item.sort } : null;
    }).filter(Boolean);
  };
  const openSheet = async (actor) => {
    await actor.sheet.render(true);
    // Settle on CONTENT, not on a timer: a row count read too early is zero,
    // which reads exactly like a sheet that rendered nothing.
    for (let i = 0; i < 40 && !renderedRows(actor).length; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return renderedRows(actor);
  };
  return { bandOf, renderedRows, openSheet };
`;

const browser = await chromium.launch();
watchdog(420000, "grant order probe");

const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

let saved = null;
const made = [];
const restore = async () => {
  try {
    const left = await page.evaluate(async ({ ids, s }) => {
      for (const id of ids) await game.actors.get(id)?.delete();
      // A grant can connect a container Actor of its own, and that does not go
      // with its keeper.
      for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ GrantOrder"))) await a.delete();
      if (s) await game.settings.set("air-bladder", "enable-inventory-reorder", s.reorder);
      return game.actors.filter((a) => ids.includes(a.id) || a.name?.startsWith("ZZ GrantOrder")).length;
    }, { ids: made, s: saved });
    // ASSERT the restore rather than assume it: a delete that silently failed
    // leaves this probe's litter in the user's dev world.
    if (left) fail(`restore left ${left} probe actor(s) in the world`);
    else if (made.length) ok(`restored: ${made.length} actor(s) removed, settings put back`);
  } catch (e) {
    fail(`could not restore world state: ${e.message}`);
  }
};

try {
  /* --- setup ----------------------------------------------------------------- */

  const setup = await page.evaluate(async () => {
    const NS = "air-bladder";
    // A stale actor from an aborted run would satisfy preconditions this run
    // never established.
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ GrantOrder"))) await a.delete();
    const out = { saved: { reorder: game.settings.get(NS, "enable-inventory-reorder") } };
    // ESTABLISH it. `sort` is read only when drag-to-reorder is on; with it off
    // the sheet sorts alphabetically and every assertion below would be about
    // the alphabet. It is on by default, so this is usually a no-op — but "the
    // default says so" is not the same as having checked.
    await game.settings.set(NS, "enable-inventory-reorder", true);
    out.reorderNow = game.settings.get(NS, "enable-inventory-reorder");

    const bg = async (packId, name) => {
      const pack = game.packs.get(packId);
      if (!pack) return null;
      const hit = (await pack.getIndex()).find((e) => e.name === name);
      return hit ? (await pack.getDocument(hit._id))?.uuid ?? null : null;
    };
    out.marchguard = await bg("air-bladder.backgrounds-2e", "Marchguard");
    out.oilCollector = await bg("air-bladder.backgrounds-barebones", "Oil Collector");
    out.acolyte = await bg("air-bladder.backgrounds-barebones", "Acolyte");
    return out;
  });
  saved = setup.saved;

  if (!setup.reorderNow) {
    fail("enable-inventory-reorder would not turn on — nothing below reads `sort`");
    throw new Error("precondition not established");
  }
  for (const [key, label] of [["marchguard", "2e Marchguard"], ["oilCollector", "Barebones Oil Collector"],
    ["acolyte", "Barebones Acolyte"]]) {
    if (!setup[key]) fail(`the ${label} background is not in this world — its leg cannot run`);
  }

  /* --- 1. the four generated loadouts ---------------------------------------- */

  console.log("\n1. a generated loadout arrives arranged");

  const generate = (kind, bgUuid) => page.evaluate(async ({ kind, bgUuid, helpers }) => {
    const H = new Function(helpers)();
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    let actor = null;
    try {
      if (kind === "2e" || kind === "barebones") {
        const bg = bgUuid ? await fromUuid(bgUuid) : null;
        const data = kind === "2e"
          ? await gen.generate2eCharacter(bg)
          : await gen.generateBarebonesCharacter(bg);
        if (!data) return { error: `${kind} generation returned nothing` };
        data.name = `ZZ GrantOrder ${kind}`;
        actor = await gen.createActorWithCharacter(data);
      } else if (kind === "hireling") {
        actor = await gen.createHireling();
      } else {
        // ESTABLISH a Background that grants gear. Since 2026-08-21 a Lord or
        // Politician generates with NO ITEMS AT ALL, and a loadout of zero
        // bands would fail the "nothing to order" guard below on the 2-in-20
        // rolls that land one — the precondition-off-a-random-roll race.
        // Bounded and loud, the npc-split probe's shape.
        const MAP = CONFIG.Cairn?.npcGenerator?.backgroundGear ?? {};
        for (let tries = 0; tries < 6 && !actor; tries++) {
          const cand = await gen.createNpc();
          if (MAP[cand.system.background]) actor = cand;
          else await cand.delete();
        }
        if (!actor) return { error: "npc: six creations in a row landed a no-gear Background" };
      }
      if (!actor) return { error: `${kind}: no actor was created` };
      await actor.update({ name: `ZZ GrantOrder ${kind}` });

      const rows = await H.openSheet(actor);
      await actor.sheet.close();
      if (!rows.length) return { id: actor.id, error: `${kind}: no inventory rows rendered` };
      return { id: actor.id, rows: rows.map((r) => ({ ...r, band: H.bandOf(r.name, r.type) })) };
    } catch (e) {
      // Hand the id back whatever happened, or the actor is orphaned in the
      // user's world under a name the sweep may not have reached yet.
      return { id: actor?.id ?? null, error: `${kind} threw: ${e.message}` };
    }
  }, { kind, bgUuid, helpers: HELPERS });

  const report = (label, res) => {
    if (res.id) made.push(res.id);
    if (res.error) { fail(`${label}: ${res.error}`); return null; }
    const bands = res.rows.map((r) => r.band);
    const present = [...new Set(bands)].sort();
    console.log(`   ${label}: ${res.rows.map((r) => `${r.name} [${BANDS[r.band]}]`).join(", ")}`);
    // A loadout that landed in one or two bands has nothing to order and would
    // pass against any build at all. Say so rather than counting it as evidence.
    if (present.length < 3) {
      fail(`${label}: only ${present.length} band(s) present (${present.map((b) => BANDS[b]).join(", ")}) `
        + "— there is nothing here to order, so this leg is not evidence");
      return res;
    }
    const wrong = bands.findIndex((b, i) => i > 0 && b < bands[i - 1]);
    if (wrong > 0) {
      fail(`${label}: "${res.rows[wrong].name}" (${BANDS[bands[wrong]]}) renders below `
        + `"${res.rows[wrong - 1].name}" (${BANDS[bands[wrong - 1]]})`);
    } else {
      ok(`${label}: ${present.map((b) => BANDS[b]).join(" -> ")}`);
    }
    return res;
  };

  const twoE = report("2e (Marchguard)", await generate("2e", setup.marchguard));
  const bare = report("barebones (Oil Collector)", await generate("barebones", setup.oilCollector));
  const acolyte = report("barebones (Acolyte)", await generate("barebones", setup.acolyte));
  report("hireling (random career)", await generate("hireling", null));
  report("npc (random background)", await generate("npc", null));

  // The BOOK band: the Acolyte's resolved Spellbook is a real precondition —
  // its background declares the instruction row — so an absence is a finding,
  // and its position is what the 2026-08-21 rule adds over plain monotonicity.
  if (acolyte && !acolyte.error) {
    const rows = acolyte.rows;
    const book = rows.findIndex((r) => r.type === "spellbook");
    if (book < 0) {
      fail("Acolyte: no spellbook in the loadout — the instruction row did not resolve");
    } else if (!rows.slice(0, book).every((r) => r.band <= 2)
        || !rows.slice(book + 1).every((r) => r.band >= 2)) {
      fail(`Acolyte: the book at row ${book + 1} has a later band above it or an earlier one below`);
    } else {
      ok(`Acolyte: "${rows[book].name}" sits after weapons/armor, before everything else`);
    }
  }

  /* --- 2. the tail: the light block, then Rations ----------------------------- */

  console.log("\n2. the bottom of the list");

  const tailOf = (label, res) => {
    if (!res || res.error) return;
    const rows = res.rows;
    const last = rows[rows.length - 1];
    // By NAME into BANDS, never a literal index — the book band's arrival
    // (2026-08-21) moved every band below it and a hardcoded 4 went stale.
    if (last.band !== BANDS.indexOf("rations")) {
      fail(`${label}: the last row is "${last.name}" (${BANDS[last.band]}), not Rations`);
    } else ok(`${label}: "${last.name}" is the last row`);

    const lantern = rows.findIndex((r) => /lantern/i.test(r.name));
    const oil = rows.findIndex((r) => /^oil can$/i.test(r.name));
    // A leg whose subject was never granted is not a leg. Both fixtures name
    // both items in their own startingGear, so an absence is a finding about
    // the content, not a reason to skip.
    if (lantern < 0 || oil < 0) {
      fail(`${label}: expected a Lantern and an Oil Can from this background, got `
        + `lantern=${lantern}, oil=${oil}`);
    } else if (oil !== lantern + 1) {
      fail(`${label}: the Oil Can renders at row ${oil + 1}, not directly under the `
        + `Lantern at row ${lantern + 1}`);
    } else {
      ok(`${label}: the Oil Can sits directly under its Lantern`);
    }
  };
  tailOf("2e (Marchguard)", twoE);
  tailOf("barebones (Oil Collector)", bare);

  /* --- 3. negative control: the same actor with its sorts removed ------------- */

  console.log("   negative control: the same character with every sort zeroed");

  if (twoE?.id) {
    const control = await page.evaluate(async ({ id, helpers }) => {
      const H = new Function(helpers)();
      const actor = game.actors.get(id);
      if (!actor) return { error: "the 2e character is gone" };
      // PUT THEM BACK afterwards. Leaving this actor zeroed made the append
      // control below meaningless without saying so: with every sibling at 0 the
      // new item ties with all of them, falls through to the alphabetical
      // tie-break, and "ZZ GrantOrder Rope Control" sorts last anyway — so the
      // control reported the fix as not load-bearing when what had actually
      // happened was one leg destroying the next leg's precondition.
      const was = actor.items.map((i) => ({ _id: i.id, sort: i.sort }));
      let out;
      try {
        await actor.updateEmbeddedDocuments("Item",
          was.map((u) => ({ _id: u._id, sort: 0 })), { render: false });
        const rows = await H.openSheet(actor);
        await actor.sheet.close();
        const lantern = rows.findIndex((r) => /lantern/i.test(r.name));
        const oil = rows.findIndex((r) => /^oil can$/i.test(r.name));
        const last = rows[rows.length - 1];
        out = {
          names: rows.map((r) => r.name),
          paired: lantern >= 0 && oil === lantern + 1,
          rationsLast: !!last && H.bandOf(last.name, last.type) === 5,
        };
      } finally {
        await actor.updateEmbeddedDocuments("Item", was, { render: false });
      }
      out.restored = actor.items.every((i) => i.sort > 0);
      return out;
    }, { id: twoE.id, helpers: HELPERS });

    if (control.error) fail(`control: ${control.error}`);
    else if (control.paired) {
      fail("with every sort zeroed the Oil Can is STILL under the Lantern — the alphabet "
        + `agrees with the rule for this loadout, so leg 2 proved nothing: ${control.names.join(", ")}`);
    } else {
      ok(`reproduced — alphabetical without sorts: ${control.names.join(", ")}`);
      // Say it out loud: the leg below depends on this having been undone.
      if (control.restored) ok("the sorts were put back, so the append leg has a real arrangement to append to");
      else fail("the sorts were NOT restored — the append leg below is testing a zeroed actor");
      if (control.rationsLast) {
        console.log("   note  Rations sorts last alphabetically here too, so the pairing is "
          + "the load-bearing half of this control");
      }
    }
  }

  /* --- 4. where a NEW item lands --------------------------------------------- */

  console.log("\n3. an item acquired after generation");

  const appendLeg = (control) => page.evaluate(async ({ id, control, helpers }) => {
    const H = new Function(helpers)();
    const actor = game.actors.get(id);
    if (!actor) return { error: "the 2e character is gone" };
    const CairnItem = game.cairn?.CairnItem;
    if (!CairnItem) return { error: "game.cairn.CairnItem is not exposed" };

    // NEGATIVE CONTROL: a no-op _preCreateOperation IS the pre-fix state. The
    // sort seam lives in that method and nowhere else, so removing it restores
    // the old behaviour exactly rather than simulating it.
    const original = CairnItem._preCreateOperation;
    if (control) CairnItem._preCreateOperation = async () => {};

    const name = `ZZ GrantOrder Rope${control ? " Control" : ""}`;
    let created = null;
    try {
      [created] = await actor.createEmbeddedDocuments("Item", [{ name, type: "item" }], { render: false });
    } catch (e) {
      return { error: `the create threw: ${e.message}` };
    } finally {
      if (control) CairnItem._preCreateOperation = original;
    }
    if (!created) return { error: "the item was not created" };

    const rows = await H.openSheet(actor);
    await actor.sheet.close();
    const at = rows.findIndex((r) => r.id === created.id);
    const res = { at, count: rows.length, sort: created.sort, names: rows.map((r) => r.name) };
    await created.delete();
    return res;
  }, { id: twoE?.id ?? null, control, helpers: HELPERS });

  if (twoE?.id) {
    const a = await appendLeg(false);
    if (a.error) fail(`append: ${a.error}`);
    else if (a.at !== a.count - 1) {
      fail(`a newly created item rendered at row ${a.at + 1} of ${a.count}, not last `
        + `(sort ${a.sort}): ${a.names.join(", ")}`);
    } else {
      ok(`a newly created item appends (row ${a.at + 1} of ${a.count}, sort ${a.sort})`);
    }

    console.log("   negative control: the same create with _preCreateOperation neutralised");
    const c = await appendLeg(true);
    if (c.error) fail(`append control: ${c.error}`);
    else if (c.at === 0 && c.sort === 0) {
      ok(`reproduced — sort ${c.sort} put it at row 1 of ${c.count}, above the sword`);
    } else {
      fail(`the control did NOT reproduce the defect (row ${c.at + 1} of ${c.count}, sort ${c.sort}) `
        + "— the sort seam above cannot be shown to be load-bearing");
    }
  }

  /* --- 5. the sheet and the printed page cannot drift ------------------------- */

  console.log("\n4. the printed page reads the same order");

  if (twoE?.id) {
    const shared = await page.evaluate(async ({ id, helpers }) => {
      const H = new Function(helpers)();
      const actor = game.actors.get(id);
      const rows = await H.openSheet(actor);
      const sheet = actor.sheet;
      // The two calls the print builder makes for its own rows (#fillPrintPage):
      // sort, then group each book's pages under it. Asked with the namespace
      // _prepareContext uses. This asserts the SHARED ordering, not a rendered
      // print page — dev:print covers the page itself.
      const { groupPagesUnderBooks } = await import("/systems/air-bladder/module/grimoire.js");
      const ns = sheet._itemNamespaces().nameNs;
      const viaHelper = groupPagesUnderBooks(
        actor, sheet._sortItemsForDisplay(actor.items.contents, ns), (i) => i.id,
      ).map((i) => i.id);
      await sheet.close();
      return { dom: rows.map((r) => r.id), helper: viaHelper };
    }, { id: twoE.id, helpers: HELPERS });

    if (shared.dom.length && shared.dom.join() === shared.helper.join()) {
      ok(`_sortItemsForDisplay agrees with the rendered rows (${shared.dom.length} items)`);
    } else {
      fail("the sheet's rows and _sortItemsForDisplay disagree, so the printed page would "
        + `order differently: dom ${shared.dom.length}, helper ${shared.helper.length}`);
    }
  }
} finally {
  await restore();
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "GRANT ORDER PROBE FAILED" : "Grant order probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);
