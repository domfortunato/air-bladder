#!/usr/bin/env node
/**
 * The Warden's Party sheet (2026-11-21, user ask): one table of every PC in the
 * Party folder, in marching order, with each character's vitals, gear tallies,
 * connections and a Warden-only notes line. Since the same day's later ask it
 * is the PARTY PAGE of the Warden's Dashboard, not a window of its own.
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
 *   6. The Dashboard's one button (2026-11-21; it replaced the people-icon
 *      Token tool) and the rail's Party tab open the Party page, and the rail
 *      turns to it from Tables; `openWardenDashboard({page: "party"})` still
 *      opens on it. No Party sheet window of its own is left, and the
 *      Dashboard has no footer.
 *   7. As Alice (a player), `openWardenDashboard({page: "party"})` refuses and
 *      no window opens.
 *   8. (2026-11-21, user asks) An NPC and a hireling filed in the Party folder
 *      get rows; a monster filed there does not. The light cell draws the
 *      light's own icon (a torch for A's Torch, a lantern for B's Lantern),
 *      and the Warden's click on a lit light puts it out: unequipped, and a
 *      public chat card reads "The Warden puts out ZZ Party A's Torch."
 *      (selected by its own class and by message id difference).
 *   9. (review #36 S22) A STACK of Rations counts its unopened units: C's
 *      Rations at quantity 2, 1/3 reads 4, and the Party NPC's at quantity
 *      2, 0/3 reads a plain 3, never the boxed red 0.
 *  10. (review #36 S17) The lit light's aria-label is plain text: the Party
 *      hireling holds "ZZ Miner's Lantern", and the label carries the
 *      apostrophe, not `&#x27;`. The tooltip keeps the escaped name.
 *  11. (review #36 S8) The window's focusout listener is bound once per
 *      frame, not once per render: after three more renders, with a render
 *      waiting on a focused note, ONE focusout asks for ONE render.
 *  12. (2026-11-21, user ask) The bulk buttons: off until a row is ticked; on
 *      A and C, Add Fatigue gives each one (B, unticked, keeps none) and Remove
 *      Fatigue, after one confirm, takes one off each; Mark Deprived asks about
 *      C alone (A already is) and marks C; Clear Deprived clears both. The
 *      select-all box ticks every row. Panicked's pair is offered exactly when
 *      the use-panic setting is on (READ, never written: it needs a reload).
 *  13. (2026-11-21, user ask) An item dropped on a row is given to that
 *      character, as a drop on their sheet: a world item is COPIED (it stays
 *      in the sidebar); A's own Lantern dropped on C's row MOVES (A has none
 *      left); and B, planted one slot short of full, takes two one-slot items —
 *      the second past the limit, which the user ruled a Warden's drop may
 *      do — with the over-capacity notice naming B. The same item through B's
 *      SHEET's own drop is refused (the control: the overfill is the Party
 *      page's alone). A row's own item dropped on its row changes nothing.
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
        if (app.id === "cairn-warden-dashboard") await app.close();
      }
      const items = game.items.filter((i) => i.getFlag("air-bladder", "probeFixture") === fixture).map((i) => i.id);
      if (items.length) await Item.deleteDocuments(items);
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
    // C carries no shield and no light (round 3): both cells must be EMPTY.
    // Leg 9: C's Rations are a STACK, two units with the open one at 1/3.
    const c = await Cls.create({
      name: "ZZ Party C", type: "character", folder, flags,
      items: [{ name: "Rations", type: "item", system: { quantity: 2, uses: { value: 1, max: 3 } } }],
    }, { abNoStatusCard: true });
    const outside = await Cls.create({ name: "ZZ Party Outside", type: "character", flags }, { abNoStatusCard: true });
    // Leg 8: persons in the Party folder are members; a monster is not.
    // Leg 9: a stack whose open unit is empty still holds one full unit.
    const pNpc = await Cls.create({
      name: "ZZ Party Npc", type: "npc", folder, flags, system: { role: "npc" },
      items: [{ name: "Rations", type: "item", system: { quantity: 2, uses: { value: 0, max: 3 } } }],
    }, { abNoStatusCard: true });
    // Leg 10: a lit light whose name carries an apostrophe.
    const pHire = await Cls.create({
      name: "ZZ Party Hired", type: "hireling", folder, flags,
      items: [{ name: "ZZ Miner's Lantern", type: "item", system: { equipped: true } }],
    }, { abNoStatusCard: true });
    const pMon = await Cls.create({ name: "ZZ Party Monster", type: "npc", folder, flags, system: { role: "monster" } }, { abNoStatusCard: true });
    const kid = (name, type, system) => Cls.create({ name, type, flags, system: { ...system, connectedTo: a.uuid } });
    await kid("ZZ Party Hireling", "hireling", {});
    await kid("ZZ Party Companion", "npc", { role: "companion" });
    await kid("ZZ Party Sack", "npc", { role: "container", containerClass: "sack", hp: { value: 0, max: 0 } });
    await kid("ZZ Party Cart", "npc", { role: "transport", containerClass: "cart", hp: { value: 0, max: 0 } });
    return {
      a: a.id, b: b.id, c: c.id, outside: outside.id, npc: pNpc.id, hired: pHire.id, monster: pMon.id, madeFolder: !hadFolder, savedOrder, alice: alice?.name ?? null,
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
    const root = document.querySelector("#cairn-warden-dashboard .cairn-party-inner");
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
      icons: { shield: !!tr.querySelector('[data-col="shield"] i'), light: !!tr.querySelector('[data-col="light"] .cairn-party-light-icon') },
      lightIcon: (() => {
        const el = tr.querySelector('[data-col="light"] .cairn-party-light-icon');
        const cs = el ? getComputedStyle(el) : null;
        const mask = cs?.maskImage || cs?.webkitMaskImage || "";
        return /game-icons\/fire\/([a-z-]+)\.svg/.exec(mask)?.[1] ?? "";
      })(),
      putOut: !!tr.querySelector('[data-col="light"] button[data-action="putOutLight"]'),
      lightAria: tr.querySelector('[data-col="light"] .cairn-party-light')?.getAttribute("aria-label") ?? null,
      lightTip: tr.querySelector('[data-col="light"] .cairn-party-light')?.dataset.tooltip ?? null,
      boxed: { fatigue: !!tr.querySelector('[data-col="fatigue"] .cairn-party-box'), rations: !!tr.querySelector('[data-col="rations"] .cairn-party-box') },
      note: tr.querySelector('[data-col="notes"] input')?.value ?? null,
    }));
  });

  const opened = await gm.evaluate(async () => {
    try {
      const mod = await import("/systems/air-bladder/module/warden-dashboard.js");
      await mod.openWardenDashboard({ page: "party" });
      await new Promise((r) => setTimeout(r, 600));
      const page = document.querySelector("#cairn-warden-dashboard .cairn-party-inner");
      return { ok: !!page && page.classList.contains("active") && page.getBoundingClientRect().height > 0 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  check(opened.ok, "openWardenDashboard({page: \"party\"}) opens the Dashboard on its Party page", opened.error ?? "");

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
    check(rowA.icons.shield && rowA.icons.light && rowA.boxed.fatigue && !rowA.boxed.rations && rowA.tones.rations === "",
      "row A: both icons; Fatigue boxed, 5 rations plain", JSON.stringify({ icons: rowA.icons, boxed: rowA.boxed, rations: rowA.tones.rations }));

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
    // Round 3 (user, 2026-11-21): colour means IN HAND and nothing else; a
    // shield or light carried but not held shows its symbol uncoloured.
    const toneB = { hp: "alert", slots: "warn", shield: "", light: "", fatigue: "", str: "", rations: "alert" };
    const offB = Object.entries(toneB).filter(([k, v]) => rowB.tones[k] !== v).map(([k, v]) => `${k}: want "${v}" got "${rowB.tones[k]}"`);
    check(!offB.length, "row B: HP 0 red, one slot amber, carried gear uncoloured, no rations red", offB.join("; "));
    check(rowB.icons.shield && rowB.icons.light && rowB.boxed.rations && !rowB.boxed.fatigue,
      "row B: slung shield and unheld light still show; 0 rations boxed", JSON.stringify({ icons: rowB.icons, boxed: rowB.boxed }));
    const rowC = rows.find((r) => r.id === setup.c);
    check(rowC && !rowC.icons.shield && !rowC.icons.light && rowC.tones.shield === "" && rowC.tones.light === "",
      "row C: no shield and no light leave both cells empty", JSON.stringify(rowC ? { icons: rowC.icons, tones: rowC.tones } : null));
    const ia = rows.indexOf(rowA);
    const ib = rows.indexOf(rowB);
    check(ia < ib, "with no stored order, A sorts before B by name", `A=${ia} B=${ib}`);
    // 8 (2026-11-21).
    check(rows.some((r) => r.id === setup.npc) && rows.some((r) => r.id === setup.hired),
      "an NPC and a hireling in the Party folder are listed", `${rows.length} rows`);
    check(!rows.some((r) => r.id === setup.monster), "a monster in the Party folder is not listed");
    check(rowA.lightIcon === "torch" && rowB.lightIcon === "lantern-flame",
      "the light cell draws the light's own icon: a torch for A, a lantern for B",
      JSON.stringify({ a: rowA.lightIcon, b: rowB.lightIcon }));
    check(rowA.putOut && !rowB.putOut, "a lit light is a button; an unlit one is not",
      JSON.stringify({ a: rowA.putOut, b: rowB.putOut }));

    /* --- 9. a stack of Rations counts its unopened units (review #36 S22) --- */
    const rowNpc = rows.find((r) => r.id === setup.npc);
    check(rowC?.cells.rations === "4", "a Rations stack of 2 at 1/3 reads four meals", `rations="${rowC?.cells.rations}"`);
    check(rowNpc?.cells.rations === "3" && rowNpc.tones.rations === "" && !rowNpc.boxed.rations,
      "a Rations stack of 2 at 0/3 reads a plain 3, not the red 0",
      JSON.stringify(rowNpc ? { rations: rowNpc.cells.rations, tone: rowNpc.tones.rations, boxed: rowNpc.boxed.rations } : null));

    /* --- 10. the lit light's aria-label is plain text (review #36 S17) ------ */
    const rowHired = rows.find((r) => r.id === setup.hired);
    check(rowHired?.putOut && rowHired.held === "ZZ Miner's Lantern", "the Party hireling holds the planted lantern",
      JSON.stringify(rowHired ? { putOut: rowHired.putOut, held: rowHired.held } : null));
    check(!!rowHired?.lightAria?.includes("ZZ Miner's Lantern") && !/&#?\w+;/.test(rowHired.lightAria),
      "the lit light's aria-label carries the apostrophe, no entity", JSON.stringify(rowHired?.lightAria ?? null));
    check(!!rowHired?.lightTip?.includes("ZZ Miner&#x27;s Lantern"),
      "its tooltip, which core draws as HTML, keeps the escaped name", JSON.stringify(rowHired?.lightTip ?? null));
  }

  /* --- 8. the Warden puts a light out -------------------------------------- */
  const putOut = await gm.evaluate(async (a) => {
    const before = new Set(game.messages.contents.map((m) => m.id));
    const btn = document.querySelector(`#cairn-warden-dashboard .cairn-party-inner tr[data-actor-id="${a}"] [data-col="light"] button[data-action="putOutLight"]`);
    if (!btn) return { error: "no put-out button" };
    btn.click();
    const torch = () => game.actors.get(a).items.find((i) => i.name === "Torch");
    const card = () => game.messages.contents.find((m) => !before.has(m.id) && (m.content ?? "").includes("cairn-light-card"));
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && (torch()?.system.equipped || !card())) await new Promise((r) => setTimeout(r, 100));
    // Let the table's own redraw land (the cell loses its button) before the
    // layout leg measures it: a queued render mid-measure detached the scroll
    // box once (box=0, 20261121T172526Z).
    const lit = () => document.querySelector(`#cairn-warden-dashboard .cairn-party-inner tr[data-actor-id="${a}"] [data-col="light"] button[data-action="putOutLight"]`);
    const t1 = Date.now();
    while (Date.now() - t1 < 5000 && lit()) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 600));
    const m = card();
    const want = game.i18n.format("CAIRN.LightCard.WardenOut", { actor: "ZZ Party A", light: "Torch" });
    const out = { equipped: torch()?.system.equipped ?? null, text: m ? new DOMParser().parseFromString(m.content, "text/html").body.textContent.trim() : null,
      want, public: m ? !(m.whisper?.length) : null };
    if (m) await m.delete();
    return out;
  }, setup.a);
  check(putOut.equipped === false && putOut.text === putOut.want && putOut.want !== "CAIRN.LightCard.WardenOut" && putOut.public,
    "the Warden's click puts the light out and tells everyone", putOut.error ?? JSON.stringify(putOut));

  /* --- 1b. layout ---------------------------------------------------------- */
  // Both found by walking the window on CT 123, not by a probe (2026-11-21):
  // at 1180px the table was 83px wider than its window, so the notes column
  // opened clipped behind a sideways scrollbar; and core gives every <table>
  // `overflow: hidden`, which makes the table the sticky header's scroll
  // container, so the header scrolled away with the rows.
  const layout = await gm.evaluate(async () => {
    const app = foundry.applications.instances.get("cairn-warden-dashboard");
    const root = app?.element;
    const sc = root?.querySelector(".cairn-party-scroll");
    if (!sc) return { error: "no scroll box" };
    const out = { fitsWide: sc.scrollWidth <= sc.clientWidth + 1, wide: `${sc.scrollWidth}/${sc.clientWidth}` };
    const home = (await import("/systems/air-bladder/module/warden-dashboard.js")).PAGE_SIZE.party;
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
    const root = document.querySelector("#cairn-warden-dashboard .cairn-party-inner");
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
    const input = document.querySelector(`#cairn-warden-dashboard .cairn-party-inner tr[data-actor-id="${a}"] [data-col="notes"] input`);
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
    await foundry.applications.instances.get("cairn-warden-dashboard")?.render();
    await new Promise((r) => setTimeout(r, 500));
  });
  rows = (await read()) ?? [];
  check(rows.find((r) => r.id === setup.a)?.note === "owes the ferryman", "the note survives a re-render");

  /* --- 4. live update ----------------------------------------------------- */
  const live = await gm.evaluate(async (a) => {
    await game.actors.get(a).update({ "system.hp.value": 1 });
    const cell = () => document.querySelector(`#cairn-warden-dashboard .cairn-party-inner tr[data-actor-id="${a}"] [data-col="hp"]`)?.textContent.replace(/\s+/g, "").trim();
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && cell() !== "1/4") await new Promise((r) => setTimeout(r, 100));
    return cell();
  }, setup.a);
  check(live === "1/4", "an HP write redraws the row", `hp="${live}"`);

  /* --- 11. one focusout listener per frame (review #36 S8) ----------------- */
  // A listener count can't be read in-page, so count what the listeners DO:
  // each one asks for a render when one is waiting on a focused note. Bound
  // in `_onRender`, the three renders here stack three more of them.
  const blurred = await gm.evaluate(async (a) => {
    const app = foundry.applications.instances.get("cairn-warden-dashboard");
    if (!app) return { error: "no Dashboard" };
    for (let i = 0; i < 3; i++) await app.render();
    const input = app.element.querySelector(`tr[data-actor-id="${a}"] [data-col="notes"] input`);
    if (!input) return { error: "no notes input" };
    input.focus();
    const focused = app.element.ownerDocument.activeElement === input;
    // The real queueRender, with a note focused: it parks the render for blur.
    const real = app.party.queueRender;
    real();
    await new Promise((r) => setTimeout(r, 400));
    let calls = 0;
    app.party.queueRender = () => { calls++; };
    try {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    } finally {
      app.party.queueRender = real;
    }
    // Leave as found: the blur runs the parked render.
    input.blur();
    await new Promise((r) => setTimeout(r, 600));
    return { focused, calls };
  }, setup.a);
  check(blurred.focused, "the note input took focus for the blur leg", blurred.error ?? "");
  check(blurred.calls === 1, "one focusout asks for one render, however many renders came before",
    blurred.error ?? `calls=${blurred.calls}`);

  /* --- 12. the bulk buttons (2026-11-21) ----------------------------------- */
  const bulk = await gm.evaluate(async ({ a, b, c }) => {
    const PAGE = "#cairn-warden-dashboard .cairn-party-inner";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const page = () => document.querySelector(PAGE);
    const box = (id) => page()?.querySelector(`tr[data-actor-id="${id}"] input[data-pick]`);
    const btn = (id) => page()?.querySelector(`button[data-bulk="${id}"]`);
    const fatigue = (id) => game.actors.get(id).items.filter((i) => i.system?.isFatigue).length;
    const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms && !fn()) await sleep(100); return fn(); };
    const yes = async () => {
      const t0 = Date.now();
      let y = null;
      while (Date.now() - t0 < 4000 && !(y = document.querySelector('.application.dialog button[data-action="yes"]'))) await sleep(100);
      const text = y?.closest(".application")?.querySelector(".cairn-confirm-q")?.textContent.trim() ?? null;
      y?.click();
      return text;
    };
    const out = {};
    // Clear any tick a previous leg left, then read the resting state.
    const app = foundry.applications.instances.get("cairn-warden-dashboard");
    app.party.picks.clear();
    await app.render({ parts: ["party"] });
    await sleep(300);
    const buttons = [...page().querySelectorAll("button[data-bulk]")];
    out.ids = buttons.map((x) => x.dataset.bulk);
    out.offAtRest = buttons.length > 0 && buttons.every((x) => x.disabled);
    out.usePanic = !!game.settings.get("air-bladder", "use-panic");
    box(a).click();
    box(c).click();
    await sleep(100);
    out.onWhenTicked = buttons.every((x) => !x.disabled);
    const before = { a: fatigue(a), b: fatigue(b), c: fatigue(c) };
    btn("addFatigue").click();
    await until(() => fatigue(a) === before.a + 1 && fatigue(c) === before.c + 1);
    await sleep(500);
    out.added = { a: fatigue(a) - before.a, b: fatigue(b) - before.b, c: fatigue(c) - before.c };
    out.ticksSurvive = !!box(a)?.checked && !!box(c)?.checked && !box(b)?.checked;
    btn("removeFatigue").click();
    out.removeAsked = await yes();
    await until(() => fatigue(a) === before.a && fatigue(c) === before.c);
    await sleep(300);
    out.removed = { a: fatigue(a) - before.a, c: fatigue(c) - before.c };
    out.aDeprived = !!game.actors.get(a).system.deprived;
    btn("markDeprived").click();
    out.deprivedAsked = await yes();
    await until(() => game.actors.get(c).system.deprived === true);
    out.markedC = game.actors.get(c).system.deprived === true;
    await sleep(300);
    btn("clearDeprived").click();
    await until(() => !game.actors.get(a).system.deprived && !game.actors.get(c).system.deprived);
    out.cleared = !game.actors.get(a).system.deprived && !game.actors.get(c).system.deprived;
    out.bUntouched = !game.actors.get(b).system.deprived;
    await sleep(300);
    const all = page().querySelector("input[data-pick-all]");
    all.click();
    await sleep(100);
    const rowBoxes = [...page().querySelectorAll("input[data-pick]")];
    out.allTicked = rowBoxes.length > 0 && rowBoxes.every((x) => x.checked) && app.party.picks.size === rowBoxes.length;
    all.click();
    await sleep(100);
    out.noneTicked = rowBoxes.every((x) => !x.checked) && app.party.picks.size === 0
      && [...page().querySelectorAll("button[data-bulk]")].every((x) => x.disabled);
    return out;
  }, { a: setup.a, b: setup.b, c: setup.c }).catch((e) => ({ error: e.message }));
  const wantIds = ["addFatigue", "removeFatigue", ...(bulk.usePanic ? ["markPanicked", "clearPanicked"] : []), "markDeprived", "clearDeprived"];
  check(JSON.stringify(bulk.ids) === JSON.stringify(wantIds),
    "the bulk buttons, Panicked's pair exactly when use-panic is on", bulk.error ?? `${JSON.stringify(bulk.ids)} use-panic=${bulk.usePanic}`);
  check(bulk.offAtRest && bulk.onWhenTicked, "they are off until a row is ticked, and on once one is",
    JSON.stringify({ rest: bulk.offAtRest, ticked: bulk.onWhenTicked }));
  check(bulk.added?.a === 1 && bulk.added?.c === 1 && bulk.added?.b === 0,
    "Add Fatigue gives the ticked A and C one each, and unticked B none", JSON.stringify(bulk.added));
  check(bulk.ticksSurvive, "the ticks survive the page's redraw");
  check(bulk.removed?.a === 0 && bulk.removed?.c === 0 && /ZZ Party A/.test(bulk.removeAsked ?? "") && /ZZ Party C/.test(bulk.removeAsked ?? ""),
    "Remove Fatigue asks once, naming both, then takes one off each", JSON.stringify({ asked: bulk.removeAsked, removed: bulk.removed }));
  check(bulk.aDeprived && bulk.markedC && /ZZ Party C/.test(bulk.deprivedAsked ?? "") && !/ZZ Party A/.test(bulk.deprivedAsked ?? ""),
    "Mark Deprived asks about C alone (A already is) and marks C", JSON.stringify({ asked: bulk.deprivedAsked, marked: bulk.markedC }));
  check(bulk.cleared && bulk.bUntouched, "Clear Deprived clears both ticked, without asking, and leaves B alone");
  check(bulk.allTicked && bulk.noneTicked, "the select-all box ticks every row, and clears them again",
    JSON.stringify({ all: bulk.allTicked, none: bulk.noneTicked }));

  /* --- 13. an item dropped on a row is given (2026-11-21) ------------------ */
  const gift = await gm.evaluate(async ({ a, b, c, fixture }) => {
    const PAGE = "#cairn-warden-dashboard .cairn-party-inner";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const flags = { "air-bladder": { probeFixture: fixture } };
    const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms && !fn()) await sleep(100); return fn(); };
    const drop = async (actorId, uuid) => {
      const row = document.querySelector(`${PAGE} tr[data-actor-id="${actorId}"]`);
      if (!row) return false;
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      row.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      row.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    };
    const has = (id, name) => game.actors.get(id).items.some((i) => i.name === name);
    const warns = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = function (m, ...r) {
      warns.push(r[0]?.format ? game.i18n.format(String(m), r[0].format) : game.i18n.localize(String(m)));
      return origWarn.call(this, m, ...r);
    };
    const out = {};
    try {
      // One create each: a batch returns in completion order, never by position.
      const g1 = await Item.create({ name: "ZZ Party Gift", type: "item", flags });
      const g2 = await Item.create({ name: "ZZ Party Gift Two", type: "item", flags });
      const g3 = await Item.create({ name: "ZZ Party Gift Three", type: "item", flags });
      // A world item is copied.
      await drop(c, g1.uuid);
      out.copied = await until(() => has(c, "ZZ Party Gift"));
      out.worldKept = game.items.has(g1.id);
      // A's own Lantern moves.
      const lantern = game.actors.get(a).items.find((i) => i.name === "Lantern");
      out.hadLantern = !!lantern;
      if (lantern) {
        await drop(c, lantern.uuid);
        out.moved = await until(() => has(c, "Lantern") && !has(a, "Lantern"));
      }
      // B: one slot short of full. The first gift fills the last slot.
      const B = () => game.actors.get(b);
      out.bFree = B().system.slotsMax - B().system.slotsUsed;
      await drop(b, g2.uuid);
      out.firstLands = await until(() => has(b, "ZZ Party Gift Two"));
      await sleep(300);
      out.bFull = B().system.slotsUsed >= B().system.slotsMax;
      // The control: B's sheet's own drop refuses the third.
      warns.length = 0;
      const viaSheet = await B().sheet._onDropItem(new DragEvent("drop"), g3);
      out.sheetRefused = !viaSheet && !has(b, "ZZ Party Gift Three");
      out.sheetWarn = warns.slice();
      // The Party row takes it past the limit, and says so.
      warns.length = 0;
      await drop(b, g3.uuid);
      out.overLands = await until(() => has(b, "ZZ Party Gift Three"));
      await sleep(300);
      out.over = `${B().system.slotsUsed}/${B().system.slotsMax}`;
      out.isOver = B().system.slotsUsed > B().system.slotsMax;
      out.overWarn = warns.slice();
      out.wantWarn = game.i18n.format("CAIRN.PartySheet.Overfilled", { name: "ZZ Party B" });
      // A row's own item on its own row: nothing.
      const own = B().items.find((i) => i.name === "ZZ Party Gift Two");
      const count = B().items.size;
      await drop(b, own.uuid);
      await sleep(800);
      out.ownNoop = B().items.size === count && (B().items.get(own.id)?.system.quantity ?? 1) === 1;
    } finally {
      ui.notifications.warn = origWarn;
    }
    return out;
  }, { a: setup.a, b: setup.b, c: setup.c, fixture: FIXTURE }).catch((e) => ({ error: e.message }));
  check(gift.copied && gift.worldKept, "a world item dropped on C's row is copied to C, the original kept",
    gift.error ?? JSON.stringify({ copied: gift.copied, kept: gift.worldKept }));
  check(gift.hadLantern && gift.moved, "A's Lantern dropped on C's row moves to C", JSON.stringify({ had: gift.hadLantern, moved: gift.moved }));
  check(gift.bFree === 1 && gift.firstLands && gift.bFull, "B, one slot short, takes the first gift and is full",
    JSON.stringify({ free: gift.bFree, landed: gift.firstLands, full: gift.bFull }));
  check(gift.sheetRefused && gift.sheetWarn?.length > 0, "the same item through B's sheet's own drop is refused",
    JSON.stringify({ refused: gift.sheetRefused, warn: gift.sheetWarn }));
  check(gift.overLands && gift.isOver, "the Warden's drop on B's row lands it past the limit", `slots ${gift.over}`);
  check(gift.overWarn?.includes(gift.wantWarn) && !gift.wantWarn?.startsWith("CAIRN."),
    "and the notice names B as over capacity", JSON.stringify({ got: gift.overWarn, want: gift.wantWarn }));
  check(gift.ownNoop, "a row's own item dropped on its row changes nothing");

  /* --- 5. the ways in ----------------------------------------------------- */
  const ways = await gm.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await foundry.applications.instances.get("cairn-warden-dashboard")?.close();
    await sleep(400);
    // The Dashboard's one button (2026-11-21; it replaced the people-icon
    // tool), then the rail's Party tab: the way a Warden takes.
    const button = document.querySelector("#cairn-dashboard-button");
    button?.click();
    await sleep(900);
    const app = foundry.applications.instances.get("cairn-warden-dashboard");
    app?.element.querySelector('nav.cairn-tab-rail button[data-tab="party"]')?.click();
    await sleep(400);
    const out = {
      tool: !!button && !ui.controls?.controls?.tokens?.tools?.abPartySheet,
      opened: !!app?.rendered,
      onParty: app?.tabGroups?.page === "party"
        && !!app.element.querySelector(".cairn-party-inner.active"),
      noOwnWindow: !document.querySelector("#cairn-party-sheet") && !foundry.applications.instances.has("cairn-party-sheet"),
      noFooter: !app?.element.querySelector(".cairn-dashboard-footer, [data-action='openPartySheet'], [data-action='wardenDamage']"),
    };
    // From Tables, the rail turns back to Party.
    await app.changeTab("tables", "page");
    await sleep(300);
    app.element.querySelector('nav.cairn-tab-rail button[data-tab="party"]')?.click();
    await sleep(400);
    out.railTurns = app.tabGroups.page === "party" && !!app.element.querySelector(".cairn-party-inner.active");
    await app.close();
    await sleep(300);
    // Code (and a probe) may still name the page.
    const mod = await import("/systems/air-bladder/module/warden-dashboard.js");
    await mod.openWardenDashboard({ page: "party" });
    await sleep(600);
    const again = foundry.applications.instances.get("cairn-warden-dashboard");
    out.byName = again?.tabGroups?.page === "party" && !!again.element.querySelector(".cairn-party-inner.active");
    await again?.close();
    return out;
  });
  check(ways.tool && ways.opened && ways.onParty, "the Dashboard's button, then the rail, opens its Party page (no people-icon tool)", JSON.stringify(ways));
  check(ways.byName, "openWardenDashboard({page: \"party\"}) opens it on Party");
  check(ways.railTurns, "the rail turns to Party from Tables");
  check(ways.noOwnWindow && ways.noFooter, "no Party sheet window of its own, and no Dashboard footer");

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
        const mod = await import("/systems/air-bladder/module/warden-dashboard.js");
        const got = await mod.openWardenDashboard({ page: "party" });
        await new Promise((r) => setTimeout(r, 500));
        return { got: got ?? null, window: !!document.querySelector("#cairn-warden-dashboard"),
          tool: !!document.querySelector("#cairn-dashboard-button") || !!ui.controls?.controls?.tokens?.tools?.abPartySheet };
      } catch (e) {
        return { error: e.message };
      }
    });
    check(!refused.error && refused.got === null && !refused.window, "as Alice, the Dashboard's Party page refuses",
      JSON.stringify(refused));
    check(!refused.tool, "as Alice, there is no Dashboard button");
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
