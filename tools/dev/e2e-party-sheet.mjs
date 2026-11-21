#!/usr/bin/env node
/**
 * The Warden's Party sheet (2026-11-21, user ask): one table of every PC in the
 * Party folder, in marching order, with each character's vitals, gear tallies,
 * connections and a Warden-only notes line.
 *
 * What this protects, leg by leg:
 *   1. Every cell reads the actor it claims to. A planted PC carries one of
 *      everything the table counts — a held Torch and a spare Lantern (two
 *      lights, one in hand), Rations at 2 and 3 uses (five left, not "two
 *      items"), two Fatigue, a held shield, gold, Deprived, and one connection
 *      of each of the four roles. A second PC carries nothing, so a column
 *      that prints a constant reds on one of the two rows.
 *   2. The marching order: a real DROP of B's row onto A's writes [B, A] to
 *      the setting and the rows redraw in that order.
 *   3. The notes line writes the actor flag and survives a re-render.
 *   4. The table follows the actor: an HP write redraws the cell.
 *   5. A character outside the Party folder is not listed.
 *   6. The Dashboard's footer button opens it, and the Token control exists.
 *   7. As Alice (a player), `openPartySheet()` refuses and no window opens.
 *
 * Fixtures are stamped `probeFixture` and swept from the catch; the
 * marching-order setting is READ first and restored, and SET to [] for the run
 * so a stored order from the world cannot place the rows for it.
 *
 *   npm run dev:party-sheet      (needs Alice — npm run dev:players)
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, dismissChrome, watchErrors, watchdog } from "./lib.mjs";

const FIXTURE = "party-sheet";
const browser = await chromium.launch();
// The fleet's hang guard (review #34): a bound on a hang, not a timing claim.
watchdog(300000, "party-sheet probe", () => browser.close());
const gm = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(gm);
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(52)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(52)} ${d}`); failures++; };
const check = (cond, l, d = "") => (cond ? ok(l, d) : fail(l, d));

let savedOrder = null;
let madeFolder = false;
const cleanup = async () => {
  try {
    await gm.evaluate(async ({ fixture, savedOrder, madeFolder }) => {
      for (const app of foundry.applications.instances.values()) {
        if (app.id === "cairn-party-sheet") await app.close();
      }
      const mine = game.actors.filter((a) => a.getFlag("air-bladder", "probeFixture") === fixture);
      // Children first, so a keeper's delete does not convert them.
      const kids = mine.filter((a) => a.system?.connectedTo).map((a) => a.id);
      if (kids.length) await Actor.deleteDocuments(kids);
      const rest = mine.map((a) => a.id).filter((id) => game.actors.has(id));
      if (rest.length) await Actor.deleteDocuments(rest);
      if (savedOrder !== null && game.settings.settings.has("air-bladder.party-marching-order")) {
        await game.settings.set("air-bladder", "party-marching-order", savedOrder);
      }
      if (madeFolder) {
        const { findPartyFolder } = await import("/systems/air-bladder/module/party-pile.js");
        const f = findPartyFolder();
        if (f && !f.contents.length) await f.delete();
      }
    }, { fixture: FIXTURE, savedOrder, madeFolder });
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
};

try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  await cleanup();

  /* --- plant -------------------------------------------------------------- */
  const setup = await gm.evaluate(async (fixture) => {
    const flags = { "air-bladder": { probeFixture: fixture } };
    const Cls = CONFIG.Actor.documentClass;
    const pile = await import("/systems/air-bladder/module/party-pile.js");
    const hadFolder = !!pile.findPartyFolder();
    const folder = await pile.partyFolderId();
    const alice = game.users.getName("Alice");
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const registered = game.settings.settings.has("air-bladder.party-marching-order");
    const savedOrder = registered ? foundry.utils.deepClone(game.settings.get("air-bladder", "party-marching-order")) : null;
    if (registered) await game.settings.set("air-bladder", "party-marching-order", []);

    const a = await Cls.create({
      name: "ZZ Party A", type: "character", folder, flags,
      ownership: { default: 0, ...(alice ? { [alice.id]: L.OWNER } : {}) },
      system: {
        pronouns: "they/them", background: "ZZ Probe Background", gold: 37, deprived: true,
        hp: { value: 3, max: 4 },
        abilities: { STR: { value: 11, max: 12 }, DEX: { value: 9, max: 10 }, WIL: { value: 14, max: 14 } },
      },
      items: [
        { name: "Torch", type: "item", system: { equipped: true, uses: { value: 3, max: 3 } } },
        { name: "Lantern", type: "item", system: { equipped: false } },
        { name: "Rations", type: "item", system: { uses: { value: 2, max: 3 } } },
        { name: "Rations", type: "item", system: { uses: { value: 3, max: 3 } } },
        { name: "Fatigue", type: "item" },
        { name: "Fatigue", type: "item" },
        { name: "ZZ Probe Shield", type: "armor", system: { armor: 1, equipped: true, shield: true } },
      ],
    }, { abNoStatusCard: true });
    // B is A's other side (round 2, 2026-11-21): Panicked (HP derives to 0),
    // a SLUNG shield, a Lantern carried but not held, and padded to exactly
    // one free slot — every amber and red tone A does not reach.
    const b = await Cls.create({
      name: "ZZ Party B", type: "character", folder, flags,
      system: { panicked: true, hp: { value: 4, max: 4 } },
      items: [
        { name: "Lantern", type: "item", system: { equipped: false } },
        { name: "ZZ Probe Shield B", type: "armor", system: { armor: 1, equipped: false, shield: true } },
      ],
    }, { abNoStatusCard: true });
    const pad = b.system.slotsMax - 1 - b.system.slotsUsed;
    if (pad > 0) await b.createEmbeddedDocuments("Item", [{ name: "ZZ Probe Pebbles", type: "item", system: { quantity: pad } }]);
    const outside = await Cls.create({ name: "ZZ Party Outside", type: "character", flags }, { abNoStatusCard: true });
    const kid = (name, type, system) => Cls.create({ name, type, flags, system: { ...system, connectedTo: a.uuid } });
    await kid("ZZ Party Hireling", "hireling", {});
    await kid("ZZ Party Companion", "npc", { role: "companion" });
    await kid("ZZ Party Sack", "npc", { role: "container", containerClass: "sack", hp: { value: 0, max: 0 } });
    await kid("ZZ Party Cart", "npc", { role: "transport", containerClass: "cart", hp: { value: 0, max: 0 } });
    return {
      a: a.id, b: b.id, outside: outside.id, madeFolder: !hadFolder, savedOrder, alice: alice?.name ?? null,
      want: {
        slots: `${a.system.slotsUsed}/${a.system.slotsMax}`, armor: String(a.system.armor),
        slotsB: `${b.system.slotsUsed}/${b.system.slotsMax}`,
        oneFreeB: b.system.slotsMax - b.system.slotsUsed === 1,
      },
    };
  }, FIXTURE);
  savedOrder = setup.savedOrder;
  madeFolder = setup.madeFolder;

  /* --- 1. open, and read every cell --------------------------------------- */
  const read = () => gm.evaluate(async () => {
    const root = document.querySelector("#cairn-party-sheet");
    if (!root) return null;
    const rows = [...root.querySelectorAll("tr[data-actor-id]")];
    return rows.map((tr) => ({
      id: tr.dataset.actorId,
      cells: Object.fromEntries([...tr.querySelectorAll("[data-col]")].map((td) => [
        td.dataset.col, td.textContent.replace(/\s+/g, " ").trim(),
      ])),
      shield: tr.querySelector('[data-col="shield"]')?.dataset.state ?? "",
      held: tr.querySelector('[data-col="light"]')?.dataset.held ?? "",
      lights: tr.querySelector('[data-col="light"]')?.dataset.count ?? "",
      conditions: [...tr.querySelectorAll('[data-col="conditions"] [data-condition]')].map((e) => e.dataset.condition),
      letters: [...tr.querySelectorAll('[data-col="conditions"] [data-condition]')].map((e) => e.textContent.trim()).join(""),
      tones: Object.fromEntries([...tr.querySelectorAll("[data-col]")].map((td) => [td.dataset.col, td.dataset.tone ?? ""])),
      note: tr.querySelector('[data-col="notes"] input')?.value ?? null,
    }));
  });

  const opened = await gm.evaluate(async () => {
    try {
      const mod = await import("/systems/air-bladder/module/party-sheet.js");
      await mod.openPartySheet();
      await new Promise((r) => setTimeout(r, 600));
      return { ok: !!document.querySelector("#cairn-party-sheet") };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  check(opened.ok, "openPartySheet() opens the window", opened.error ?? "");

  let rows = (await read()) ?? [];
  const rowA = rows.find((r) => r.id === setup.a);
  const rowB = rows.find((r) => r.id === setup.b);
  check(rowA && rowB, "both planted PCs are listed", `${rows.length} rows`);
  check(!rows.some((r) => r.id === setup.outside), "a character outside the Party folder is not listed");

  if (rowA && rowB) {
    const c = rowA.cells;
    const expectA = {
      name: "ZZ Party A", pronouns: "they/them", background: "ZZ Probe Background",
      hp: "3/4", str: "11/12", dex: "9/10", wil: "14/14", armor: setup.want.armor, gold: "37",
      slots: setup.want.slots, fatigue: "2", rations: "5",
      hirelings: "1", companions: "1", containers: "1", transports: "1",
    };
    if (setup.alice) expectA.player = setup.alice;
    const wrongA = Object.entries(expectA).filter(([k, v]) => c[k] !== v).map(([k, v]) => `${k}: want "${v}" got "${c[k]}"`);
    check(!wrongA.length, "row A: every value cell matches the actor", wrongA.join("; "));
    check(rowA.shield === "held", "row A: the shield is held", `state="${rowA.shield}"`);
    check(rowA.held === "Torch" && rowA.lights === "2", "row A: Torch in hand, two light sources",
      `held="${rowA.held}" count="${rowA.lights}"`);
    check(JSON.stringify(rowA.conditions) === '["deprived"]' && rowA.letters === "D",
      "row A: Deprived alone, boxed as D", `${JSON.stringify(rowA.conditions)} "${rowA.letters}"`);
    // Round 2 (user, 2026-11-21): colour does the warning.
    const toneA = { hp: "warn", str: "alert", dex: "alert", wil: "", fatigue: "accent", shield: "accent", light: "accent", slots: "" };
    const offA = Object.entries(toneA).filter(([k, v]) => rowA.tones[k] !== v).map(([k, v]) => `${k}: want "${v}" got "${rowA.tones[k]}"`);
    check(!offA.length, "row A: HP amber, abilities red, held gear and Fatigue teal", offA.join("; "));

    const b = rowB.cells;
    const expectB = { name: "ZZ Party B", fatigue: "0", rations: "0", slots: setup.want.slotsB,
      hirelings: "0", companions: "0", containers: "0", transports: "0" };
    const wrongB = Object.entries(expectB).filter(([k, v]) => b[k] !== v).map(([k, v]) => `${k}: want "${v}" got "${b[k]}"`);
    check(!wrongB.length, "row B: its counts match the actor", wrongB.join("; "));
    check(setup.want.oneFreeB, "row B was planted with exactly one slot free", setup.want.slotsB);
    check(rowB.shield === "slung" && rowB.held === "" && rowB.lights === "1",
      "row B: shield slung, a light carried but not held",
      `shield="${rowB.shield}" held="${rowB.held}" lights="${rowB.lights}"`);
    check(JSON.stringify(rowB.conditions) === '["panicked"]' && rowB.letters === "P",
      "row B: Panicked shows, boxed as P", `${JSON.stringify(rowB.conditions)} "${rowB.letters}"`);
    const toneB = { hp: "alert", slots: "warn", shield: "warn", light: "warn", fatigue: "", str: "" };
    const offB = Object.entries(toneB).filter(([k, v]) => rowB.tones[k] !== v).map(([k, v]) => `${k}: want "${v}" got "${rowB.tones[k]}"`);
    check(!offB.length, "row B: HP 0 red, one slot left amber, slung and unheld amber", offB.join("; "));
    const ia = rows.indexOf(rowA);
    const ib = rows.indexOf(rowB);
    check(ia < ib, "with no stored order, A sorts before B by name", `A=${ia} B=${ib}`);
  }

  /* --- 1b. layout ---------------------------------------------------------- */
  // Both found by walking the window on CT 123, not by a probe (2026-11-21):
  // at 1180px the table was 83px wider than its window, so the notes column
  // opened clipped behind a sideways scrollbar; and core gives every <table>
  // `overflow: hidden`, which makes the table the sticky header's scroll
  // container, so the header scrolled away with the rows.
  const layout = await gm.evaluate(async () => {
    const app = foundry.applications.instances.get("cairn-party-sheet");
    const root = app?.element;
    const sc = root?.querySelector(".cairn-party-scroll");
    if (!sc) return { error: "no scroll box" };
    const out = { fitsWide: sc.scrollWidth <= sc.clientWidth + 1, wide: `${sc.scrollWidth}/${sc.clientWidth}` };
    const home = app.constructor.DEFAULT_OPTIONS.position;
    await app.setPosition({ width: 600, height: 300 });
    await new Promise((r) => setTimeout(r, 300));
    sc.scrollTop = sc.scrollHeight;
    await new Promise((r) => setTimeout(r, 200));
    const th = root.querySelector("thead th").getBoundingClientRect().top;
    const top = sc.getBoundingClientRect().top;
    out.scrolled = sc.scrollTop > 0;
    out.pinned = Math.abs(th - top) < 2;
    out.pin = `th=${Math.round(th)} box=${Math.round(top)}`;
    out.noSpill = root.querySelector(".window-content").scrollWidth <= root.querySelector(".window-content").clientWidth + 1;
    sc.scrollTop = 0;
    await app.setPosition({ width: home.width, height: home.height });
    return out;
  });
  check(layout.fitsWide, "at its default width the table needs no sideways scroll", layout.error ?? layout.wide);
  check(layout.scrolled && layout.pinned, "narrowed, the header stays pinned while rows scroll", layout.error ?? layout.pin);
  check(layout.noSpill, "narrowed, nothing spills out of the window sideways");

  /* --- 2. drag B onto A --------------------------------------------------- */
  const dragged = await gm.evaluate(async ({ a, b }) => {
    const root = document.querySelector("#cairn-party-sheet");
    const from = root?.querySelector(`tr[data-actor-id="${b}"]`);
    const to = root?.querySelector(`tr[data-actor-id="${a}"]`);
    if (!from || !to) return { error: "rows missing" };
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const t0 = Date.now();
    const stored = () => game.settings.get("air-bladder", "party-marching-order") ?? [];
    while (Date.now() - t0 < 5000) {
      const s = stored();
      if (s.includes(a) && s.includes(b)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 600));
    const s = stored();
    return { bBeforeA: s.includes(a) && s.includes(b) && s.indexOf(b) < s.indexOf(a), stored: s };
  }, { a: setup.a, b: setup.b }).catch((e) => ({ error: e.message }));
  check(dragged.bBeforeA, "dropping B on A stores B before A", dragged.error ?? JSON.stringify(dragged.stored));
  rows = (await read()) ?? [];
  {
    const ia = rows.findIndex((r) => r.id === setup.a);
    const ib = rows.findIndex((r) => r.id === setup.b);
    check(ib >= 0 && ia > ib, "the rows redraw in the new order", `A=${ia} B=${ib}`);
  }

  /* --- 3. the notes line -------------------------------------------------- */
  const noted = await gm.evaluate(async (a) => {
    const input = document.querySelector(`#cairn-party-sheet tr[data-actor-id="${a}"] [data-col="notes"] input`);
    if (!input) return { error: "no notes input" };
    input.focus();
    input.value = "owes the ferryman";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && game.actors.get(a).getFlag("air-bladder", "wardenNote") !== "owes the ferryman") {
      await new Promise((r) => setTimeout(r, 100));
    }
    return { flag: game.actors.get(a).getFlag("air-bladder", "wardenNote") ?? null };
  }, setup.a);
  check(noted.flag === "owes the ferryman", "typing a note writes the actor flag", noted.error ?? `flag=${JSON.stringify(noted.flag)}`);
  await gm.evaluate(async () => {
    await foundry.applications.instances.get("cairn-party-sheet")?.render();
    await new Promise((r) => setTimeout(r, 500));
  });
  rows = (await read()) ?? [];
  check(rows.find((r) => r.id === setup.a)?.note === "owes the ferryman", "the note survives a re-render");

  /* --- 4. live update ----------------------------------------------------- */
  const live = await gm.evaluate(async (a) => {
    await game.actors.get(a).update({ "system.hp.value": 1 });
    const cell = () => document.querySelector(`#cairn-party-sheet tr[data-actor-id="${a}"] [data-col="hp"]`)?.textContent.replace(/\s+/g, "").trim();
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && cell() !== "1/4") await new Promise((r) => setTimeout(r, 100));
    return cell();
  }, setup.a);
  check(live === "1/4", "an HP write redraws the row", `hp="${live}"`);

  /* --- 5. the ways in ----------------------------------------------------- */
  const ways = await gm.evaluate(async () => {
    await foundry.applications.instances.get("cairn-party-sheet")?.close();
    await new Promise((r) => setTimeout(r, 400));
    const tool = !!ui.controls?.controls?.tokens?.tools?.abPartySheet;
    const dash = await import("/systems/air-bladder/module/warden-dashboard.js");
    await dash.openWardenDashboard();
    await new Promise((r) => setTimeout(r, 600));
    const btn = document.querySelector('#cairn-warden-dashboard .cairn-dashboard-footer button[data-action="openPartySheet"]');
    btn?.click();
    await new Promise((r) => setTimeout(r, 800));
    const opened = !!document.querySelector("#cairn-party-sheet");
    await foundry.applications.instances.get("cairn-warden-dashboard")?.close();
    await foundry.applications.instances.get("cairn-party-sheet")?.close();
    return { tool, btn: !!btn, opened };
  });
  check(ways.tool, "the Token controls carry the Party sheet tool");
  check(ways.btn && ways.opened, "the Dashboard footer button opens it", JSON.stringify(ways));

  /* --- 6. a player is refused --------------------------------------------- */
  if (!setup.alice) {
    fail("a player is refused", "no Alice in this world — npm run dev:players");
  } else {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const ap = await ctx.newPage();
    const aliceErrors = watchErrors(ap);
    await joinAs(ap, "Alice");
    await dismissChrome(ap);
    const refused = await ap.evaluate(async () => {
      try {
        const mod = await import("/systems/air-bladder/module/party-sheet.js");
        const got = await mod.openPartySheet();
        await new Promise((r) => setTimeout(r, 500));
        return { got: got ?? null, window: !!document.querySelector("#cairn-party-sheet"),
          tool: !!ui.controls?.controls?.tokens?.tools?.abPartySheet?.visible };
      } catch (e) {
        return { error: e.message };
      }
    });
    check(!refused.error && refused.got === null && !refused.window, "as Alice, openPartySheet() refuses",
      JSON.stringify(refused));
    check(!refused.tool, "as Alice, the tool is not visible");
    if (aliceErrors.length) fail("Alice's console is clean", aliceErrors.slice(0, 3).join(" | "));
    await ctx.close();
  }
} catch (e) {
  fail("probe ran to the end", e.message);
} finally {
  await cleanup();
  if (errors.length) fail("the Warden's console is clean", errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : "\nall ok");
  process.exit(failures ? 1 : 0);
}
