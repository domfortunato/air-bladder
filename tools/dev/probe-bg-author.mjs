/**
 * Probe: the editable custom-background authoring sheet.
 * Verifies the editor renders, its class-managed handlers persist array edits,
 * drag-to-snapshot lands onto gear AND a table option, generation resolves a
 * snapshot that lives in NO canonical pack, and dropping a background onto an
 * actor sheet swaps it (or is refused) per issue #10.
 *
 * Structured as STAGES — each its own page.evaluate behind a printed banner —
 * after this probe spent weeks as one 210-line evaluate that hung silently: a
 * modal DialogV2 nobody clicked left one await pending forever, and a hang
 * inside a single giant evaluate prints NOTHING — no partial results, no error,
 * no hint of a section. Now a hang names the stage it entered, and watchdog()
 * turns it into an exit 1 instead of a burned harness timeout.
 *
 *   node tools/dev/probe-bg-author.mjs
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(240000, "bg-author");
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

const SWORD = "Probe Snapshot Blade ZZ";
const BOND_TEXT = "You owe the ferryman a debt he will collect.";

/**
 * Everything this probe creates, by NAME. Swept twice from NODE: before the run,
 * so an earlier aborted run's leftovers can never satisfy (or poison) this run's
 * assertions, and in the finally below, so a throw mid-stage still cleans up —
 * the old in-page cleanup sat AFTER the very await that hung, so every hung run
 * orphaned a background and a sword into the shared dev world (8 of each by the
 * time it was fixed). Same reasoning as withSettings() in lib.mjs.
 *
 * "ZZ Probe background" (lowercase b) is historical litter from an older probe
 * revision; it names no current document but is swept on sight.
 */
const LITTER = {
  items: ["Probe Background ZZ", SWORD, "ZZ Probe background"],
  actors: ["zz-bg-drop", "zz-bb-drop", "zz-bg-drop-npc", "zz-credit"],
  tables: ["ZZ Probe Bonds"],
};
const sweepLitter = async () => {
  const gone = await page.evaluate(async (names) => {
    const gone = [];
    for (const d of game.items.filter((d) => names.items.includes(d.name))) { await d.delete(); gone.push(`Item "${d.name}"`); }
    for (const d of game.actors.filter((d) => names.actors.includes(d.name))) { await d.delete(); gone.push(`Actor "${d.name}"`); }
    for (const d of game.tables.filter((d) => names.tables.includes(d.name))) { await d.delete(); gone.push(`RollTable "${d.name}"`); }
    return gone;
  }, LITTER);
  if (gone.length) console.log(`  note  swept ${gone.length} probe document(s): ${gone.join(", ")}`);
};

const stage = (name) => console.log(`  stage  ${name}`);

/**
 * Drop `bg` onto an actor's sheet and answer — or prove the absence of — the
 * modal confirm, from NODE, never from inside the evaluate that awaits the drop.
 * Returns whether a confirm appeared. `action` ("yes"/"no") is also the unstick
 * answer if a confirm appears where none should: the probe then still terminates
 * and the caller's `confirmAppeared === false` check reports the regression.
 *
 * THE RACE THAT HUNG THIS PROBE, so nobody rebuilds it: the old code pre-armed an
 * in-page 100ms poller for `dialog button[data-action]`, clicked "no", then armed
 * a second poller for "yes" and awaited the second drop. But a settled DialogV2
 * OUTLIVES its promise: ApplicationV2#close awaits a CSS transition before
 * removing the element (client/applications/api/application.mjs:1016 → :1046 in
 * 14.365), so the declined dialog was still in the DOM when the "yes" poller's
 * first tick fired. `.find()` returned the DEAD dialog's yes button in document
 * order, the poller clicked it (a no-op — that dialog's promise had settled),
 * cleared its own interval, and the real second confirm rendered with no clicker
 * left. DialogV2.confirm is modal — it settles ONLY on a button press — so the
 * await never resolved and the whole evaluate never returned. Hence the shape
 * here: start the call unawaited, wait for THIS dialog's DOM, click, await the
 * stored promise, then wait for the dialog to actually LEAVE the DOM before
 * anyone may raise the next one.
 */
const dropBackground = async (actorId, bgId, action) => {
  await page.evaluate(([aid, bid]) => {
    delete globalThis.__abDropErr;
    globalThis.__abDropDone = false;
    const p = game.actors.get(aid).sheet._onDropBackground(game.items.get(bid));
    p.catch((e) => { globalThis.__abDropErr = String(e?.message ?? e); })
      .finally(() => { globalThis.__abDropDone = true; });
  }, [actorId, bgId]);

  // Either the confirm appears or the call settles without one (a guard refused).
  await page.waitForFunction(
    () => globalThis.__abDropDone || !!document.querySelector("dialog.dialog button[data-action]"),
    null, { timeout: 20000 },
  );
  const confirmAppeared = await page.evaluate(
    () => !!document.querySelector("dialog.dialog button[data-action]"));
  if (confirmAppeared) {
    await page.evaluate((a) => {
      [...document.querySelectorAll("dialog.dialog button[data-action]")]
        .find((b) => b.dataset.action === a)?.click();
    }, action);
  }
  await page.waitForFunction(() => globalThis.__abDropDone, null, { timeout: 20000 });
  // The closing dialog lingers through its transition; see the header comment.
  await page.waitForFunction(() => !document.querySelector("dialog.dialog"), null, { timeout: 20000 });
  const err = await page.evaluate(() => globalThis.__abDropErr ?? null);
  if (err) throw new Error(`_onDropBackground rejected: ${err}`);
  return confirmAppeared;
};

const result = {};
let aborted = false;
try {
  await sweepLitter();

  stage("editor: authoring sheet renders and persists");
  const ed = await page.evaluate(async (SWORD) => {
    const out = {};
    // AppV1's `element` is a jQuery object; ApplicationV2's is the HTMLElement.
    // Works either way so this probe survives sheet-class churn.
    const sheetRoot = (app) => (app.element instanceof HTMLElement ? app.element : app.element?.[0]);

    // getDocumentClass, not the bare Item global — the same convention as the
    // Actor/RollTable creates below, and the class a real user's create goes
    // through, so _preCreate behaviour is exercised rather than assumed.
    // A source item that exists in NO canonical pack, so if it resolves at
    // generation it can only have come from the snapshot.
    const src = await getDocumentClass("Item").create({
      name: SWORD, type: "weapon",
      system: { damageFormula: "d8", bulky: true },
    });
    const bg = await getDocumentClass("Item").create({
      name: "Probe Background ZZ", type: "background",
      system: { source: "2e", archetype: "Fighter", names: [], startingGear: [], tables: [] },
    });

    const sheet = bg.sheet;
    await sheet.render(true);
    for (let i = 0; i < 30 && !sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    const root = sheetRoot(sheet);
    if (!root) throw new Error("authoring sheet element never rendered");

    out.hasEditor = !!root.querySelector(".background-editor");
    // A background opens on Description, which is prose with a hover-only edit
    // button — so nothing on screen says the authoring form exists. An editable
    // one points at Details.
    out.editHint = root.querySelector(".bg-tab-hint")?.textContent?.trim() ?? null;
    // Source is deliberately NOT a pick-list: a GM must not be able to make their
    // background undiscoverable by choosing another source. It renders as fixed text.
    out.sourceVal = root.querySelector(".bg-source-fixed")?.textContent.trim();
    out.archetypeVal = root.querySelector('select[name="system.archetype"]')?.value;
    out.tableCount = root.querySelectorAll(".bg-edit-table").length;
    out.optionCount = root.querySelectorAll(".bg-edit-option").length;
    out.optionDropZones = root.querySelectorAll('[data-drop="option"]').length;

    // Handler: add an example name via a real click. Under ApplicationV2 this is a
    // declarative `data-action`, so a native click is what exercises the wiring —
    // there is no handler bound to the element to trigger directly any more.
    root.querySelector(".bg-name-add")?.click();
    await new Promise((r) => setTimeout(r, 400));
    out.namesAfterAdd = (bg.system.names ?? []).length;

    // Drop the sword onto the starting-gear zone, then onto table 0 option 0.
    const drop = async (selector) => {
      const target = root.querySelector(selector);
      const ev = {
        target,
        preventDefault() {}, stopPropagation() {},
        dataTransfer: { getData: () => JSON.stringify({ type: "Item", uuid: src.uuid }) },
      };
      await sheet._onDrop(ev);
      await new Promise((r) => setTimeout(r, 200));
    };
    await drop('[data-drop="gear"]');
    const gear0 = (bg.system.startingGear ?? [])[0];
    out.gearSnapshot = { name: gear0?.name, hasItemData: !!gear0?.itemData, type: gear0?.itemData?.type, bulky: gear0?.itemData?.system?.bulky };

    await drop('[data-drop="option"][data-t="0"][data-o="0"]');
    const optItem = bg.system.tables?.[0]?.options?.[0]?.items?.[0];
    out.optionSnapshot = { name: optItem?.name, hasItemData: !!optItem?.itemData };

    // Give option 0 the ONLY nonempty description + a gold grant so the d6 roll,
    // whatever it lands on, has a defined answer.
    const tables = foundry.utils.deepClone(bg.system.tables);
    for (const o of tables[0].options) { o.description = "You found it."; o.bonusGold = 5; }
    for (const o of tables[1].options) { o.description = "So it goes."; }
    await bg.update({ "system.tables": tables });

    return { out, srcId: src.id, bgId: bg.id };
  }, SWORD);
  Object.assign(result, ed.out);
  const bgId = ed.bgId;

  stage("generation: snapshot gear + default bonds");
  Object.assign(result, await page.evaluate(async ([bgId, SWORD]) => {
    const out = {};
    const bg = game.items.get(bgId);
    const root = bg.sheet.element instanceof HTMLElement ? bg.sheet.element : bg.sheet.element?.[0];

    // Generation must resolve the snapshot even though SWORD is in no pack. Starting
    // gear is folded into `items`, tagged grantSource "background"; the question's
    // rolled option tags its grant "question:0".
    const cd = await game.cairn.characterGenerator.generate2eCharacter(bg);
    const gs = (g) => g.flags?.["air-bladder"]?.grantSource;
    out.genItemNames = (cd?.items ?? []).map((g) => g.name);
    out.genHasSnapshotGear = (cd?.items ?? []).some((g) => g.name === SWORD && gs(g) === "background");
    out.genQuestionGrantedSnapshot = (cd?.items ?? []).filter((g) => g.name === SWORD && String(gs(g)).startsWith("question:")).length;

    // Bonds: one by default, two once the author ticks "Grants two bonds". Asserted in
    // BOTH directions in one pass, so the check is its own negative control — a field
    // the generator ignored would give 1 and 1. This background's description says
    // nothing about bonds, so the prose path (`mentionsSecondBond`) is not in play.
    out.hasSecondBondBox = !!root.querySelector('input[name="system.secondBond"]');
    out.bondsDefault = (cd?.bonds ?? []).length;
    out.bondsDefaultFrom2e = (cd?.bonds ?? []).every((b) => (b.description ?? "").length > 0);
    await bg.update({ "system.secondBond": true });
    const cd2 = await game.cairn.characterGenerator.generate2eCharacter(bg);
    out.bondsWithFlag = (cd2?.bonds ?? []).length;
    return out;
  }, [bgId, SWORD]));

  stage("custom bonds table + missing-table fallback");
  Object.assign(result, await page.evaluate(async ([bgId, BOND_TEXT]) => {
    const out = {};
    const bg = game.items.get(bgId);
    const root = bg.sheet.element instanceof HTMLElement ? bg.sheet.element : bg.sheet.element?.[0];

    // A bonds table of the author's own: a plain world RollTable, named on the
    // background. One row, so the drawn text is knowable, and NO flags — which is the
    // point: a hand-made table cannot carry the gold/gear payload the 2e rows do, so the
    // bond must come back with the text and zero gold rather than fabricating either.
    out.hasBondsTableField = !!root.querySelector('input[name="system.bondsTable"]');

    // The credit line (2026-08-15). The PERSISTENCE half is what is worth
    // asserting: AppV2 does not submit on change unless the sheet asks for it,
    // so a field can render perfectly and save nothing — and a licence claim
    // that silently fails to save is worse than no field at all.
    const attrInput = root.querySelector('input[name="system.attribution"]');
    out.hasAttributionField = !!attrInput;
    if (attrInput) {
      attrInput.value = "ZZ Probe Credit — A. Warden · CC BY-SA 4.0";
      attrInput.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 40 && !bg.system.attribution; i++) await new Promise((r) => setTimeout(r, 100));
      out.attributionSaved = bg.system.attribution;
      await bg.update({ "system.attribution": "" });
      out.attributionCleared = bg.system.attribution;
    }
    const customTable = await getDocumentClass("RollTable").create({
      name: "ZZ Probe Bonds",
      formula: "1d1",
      results: [{ type: "text", description: BOND_TEXT, range: [1, 1] }],
    });
    await bg.update({ "system.bondsTable": "ZZ Probe Bonds", "system.secondBond": false });
    const cd3 = await game.cairn.characterGenerator.generate2eCharacter(bg);
    out.customBond = {
      count: (cd3?.bonds ?? []).length,
      description: cd3?.bonds?.[0]?.description ?? null,
      gold: cd3?.bonds?.[0]?.gold ?? null,
    };

    // A name that resolves to nothing must fall back to the 2e table, not to no bond.
    await bg.update({ "system.bondsTable": "ZZ No Such Table" });
    const cd4 = await game.cairn.characterGenerator.generate2eCharacter(bg);
    out.missingTableFallback = {
      count: (cd4?.bonds ?? []).length,
      isCustom: (cd4?.bonds?.[0]?.description ?? "") === BOND_TEXT,
    };
    await customTable.delete();
    await bg.update({ "system.bondsTable": "" });
    return out;
  }, [bgId, BOND_TEXT]));

  // Dropping a background onto a character SWAPS the background (issue #10). It used to
  // fall through to the inventory transfer path and be pocketed as a 1-slot item — and
  // on an encumbered character the capacity refusal rejected it outright, so nothing
  // happened at all.
  //
  // Two distinct things, easy to confuse: the swap MUST rewrite the inventory (the old
  // background's grants out, the new one's gear in — `gearGained`), and the background
  // DOCUMENT must never itself be in there (`pocketed`).
  stage("background drop: decline leaves the character untouched");
  const targetId = await page.evaluate(async () => {
    const target = await getDocumentClass("Actor").create({ name: "zz-bg-drop", type: "character" });
    await target.sheet.render(true);
    for (let i = 0; i < 30 && !target.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    if (!target.sheet.element) throw new Error("target sheet never rendered");
    return target.id;
  });
  const itemsBefore = await page.evaluate((id) => game.actors.get(id).items.size, targetId);
  const askedOnDecline = await dropBackground(targetId, bgId, "no");
  result.dropDeclined = await page.evaluate((id) => {
    const t = game.actors.get(id);
    return { background: t.system.background, items: t.items.size };
  }, targetId);
  result.dropDeclined.asked = askedOnDecline;

  stage("background drop: accept swaps the background");
  const askedOnAccept = await dropBackground(targetId, bgId, "yes");
  result.dropAccepted = await page.evaluate(([id, bgId, itemsBefore]) => {
    const t = game.actors.get(id);
    const bg = game.items.get(bgId);
    return {
      background: t.system.background,
      uuid: t.system.backgroundUuid === bg.uuid,
      // The background document itself must NOT be in the inventory.
      pocketed: t.items.some((i) => i.type === "background"),
      gearGained: t.items.size > itemsBefore,
    };
  }, [targetId, bgId, itemsBefore]);
  result.dropAccepted.asked = askedOnAccept;

  // A BAREBONES character must refuse a 2e background outright — a character does not
  // change edition, the rule the picker already follows. Measured before it was
  // refused: the swap left the Barebones character's generated Rations/Torch/weapon/
  // armor in place (the 2e background knows nothing about them) and added its own on
  // top, duplicates included. No confirm should even appear.
  stage("background drop: cross-edition refusal");
  const bbId = await page.evaluate(async () => {
    const bb = await getDocumentClass("Actor").create({
      name: "zz-bb-drop", type: "character", system: { contentSource: "barebones" },
    });
    await bb.createEmbeddedDocuments("Item", [{ name: "zz-kept", type: "item" }]);
    await bb.sheet.render(true);
    for (let i = 0; i < 30 && !bb.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    if (!bb.sheet.element) throw new Error("barebones sheet never rendered");
    return bb.id;
  });
  const bbAsked = await dropBackground(bbId, bgId, "no");
  result.dropCrossSource = await page.evaluate((id) => {
    const a = game.actors.get(id);
    return { background: a.system.background, contentSource: a.system.contentSource, items: a.items.size };
  }, bbId);
  result.dropCrossSource.confirmAppeared = bbAsked;

  // An NPC has no background at all, so it must refuse rather than pocket it.
  stage("background drop: NPC refusal");
  const npcId = await page.evaluate(async () => {
    const npc = await getDocumentClass("Actor").create({ name: "zz-bg-drop-npc", type: "npc" });
    await npc.sheet.render(true);
    for (let i = 0; i < 30 && !npc.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    if (!npc.sheet.element) throw new Error("npc sheet never rendered");
    return npc.id;
  });
  const npcAsked = await dropBackground(npcId, bgId, "no");
  result.dropOnNpc = await page.evaluate((id) => {
    const a = game.actors.get(id);
    return { pocketed: a.items.some((i) => i.type === "background"), items: a.items.size };
  }, npcId);
  result.dropOnNpc.confirmAppeared = npcAsked;

  // A LOCKED shipped background must still render the read-only view (that path
  // was refactored alongside the editor).
  stage("read-only view of a locked shipped background");
  result.readOnly = await page.evaluate(async () => {
    const sheetRoot = (app) => (app.element instanceof HTMLElement ? app.element : app.element?.[0]);
    const roPack = game.packs.get("air-bladder.backgrounds-2e");
    const roDocs = await roPack.getDocuments();
    const roBg = roDocs.find((d) => d.name === "Jongleur") ?? roDocs[0];
    const roSheet = roBg.sheet;
    await roSheet.render(true);
    for (let i = 0; i < 30 && !roSheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    const roRoot = sheetRoot(roSheet);
    if (!roRoot) throw new Error("read-only sheet never rendered");
    const out = {
      locked: roPack.locked,
      hasReadOnly: !!roRoot.querySelector(".background-details"),
      hasEditor: !!roRoot.querySelector(".background-editor"),
      gearListed: roRoot.querySelectorAll(".background-gear li").length,
      tables: roRoot.querySelectorAll(".background-table").length,
      // A canon 2e background carries no credit line, so the row must be ABSENT
      // rather than empty — Cairn's own credit prints on every sheet anyway, and
      // a blank "Credit line:" label on twenty shipped backgrounds is noise.
      attrRow: !!roRoot.querySelector(".background-attribution"),
      // Locked, and this probe runs as GM: the hint must point at Duplicate,
      // not at an authoring form that is not there.
      lockedHint: roRoot.querySelector(".bg-tab-hint")?.textContent?.trim() ?? null,
    };
    await roSheet.close();

    // …and a shipped CLASS background shows whose text it is, because the
    // sheet is locked: a Warden about to duplicate it cannot read the field
    // in an input, so the read-only view is the only place that tells them.
    const cbPack = game.packs.get("air-bladder.backgrounds-custom");
    const cleric = (await cbPack?.getDocuments() ?? []).find((d) => d.name === "Cleric");
    if (cleric) {
      await cleric.sheet.render(true);
      for (let i = 0; i < 30 && !cleric.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      const cRoot = sheetRoot(cleric.sheet);
      out.classAttrRow = cRoot?.querySelector(".background-attribution")?.textContent?.trim() ?? null;
      await cleric.sheet.close();
    }
    return out;
  });

  stage("the credit on a CHARACTER's sheet, not just the printed page");
  result.sheetCredit = await page.evaluate(async () => {
    const sheetRoot = (app) => (app.element instanceof HTMLElement ? app.element : app.element?.[0]);
    const creditOf = async (bg) => {
      const actor = await Actor.create({ name: "zz-credit", type: "character" });
      await actor.update({ "system.contentSource": "2e", "system.backgroundUuid": bg.uuid,
        "system.background": bg.name });
      await actor.sheet.render(true);
      for (let i = 0; i < 30 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      const root = sheetRoot(actor.sheet);
      const el = root?.querySelector(".background-credit");
      const out = { present: !!el, text: el?.textContent?.trim() ?? null,
        // The credit is authored free text. If it ever renders through a triple
        // stash, markup pasted into the field becomes real elements here.
        html: el?.innerHTML ?? null };
      await actor.sheet.close();
      await actor.delete();
      return out;
    };
    const cleric = (await game.packs.get("air-bladder.backgrounds-custom")?.getDocuments() ?? [])
      .find((d) => d.name === "Cleric");
    const canon = (await game.packs.get("air-bladder.backgrounds-2e")?.getDocuments() ?? [])
      .find((d) => d.name === "Jongleur");
    const out = { credited: cleric ? await creditOf(cleric) : null,
                  uncredited: canon ? await creditOf(canon) : null };

    // CHANGING THE BACKGROUND MUST CHANGE THE CREDIT. The line is read live off
    // the linked document every render rather than copied onto the actor, so a
    // character who swaps a credited background for an uncredited one must lose
    // the line entirely — a stale credit is a false attribution, which is the
    // one failure this feature can introduce.
    if (cleric && canon) {
      const actor = await Actor.create({ name: "zz-credit", type: "character" });
      await actor.update({ "system.contentSource": "2e", "system.backgroundUuid": cleric.uuid,
        "system.background": cleric.name });
      await actor.sheet.render(true);
      for (let i = 0; i < 30 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      const root = () => (actor.sheet.element instanceof HTMLElement
        ? actor.sheet.element : actor.sheet.element?.[0]);
      out.beforeSwap = root()?.querySelector(".background-credit")?.textContent?.trim() ?? null;

      await actor.update({ "system.backgroundUuid": canon.uuid, "system.background": canon.name });
      await actor.sheet.render(true);
      await new Promise((r) => setTimeout(r, 300));
      out.afterSwap = root()?.querySelector(".background-credit")?.textContent?.trim() ?? null;

      // …and back again, so "it cleared" is not just the sheet failing to render.
      await actor.update({ "system.backgroundUuid": cleric.uuid, "system.background": cleric.name });
      await actor.sheet.render(true);
      await new Promise((r) => setTimeout(r, 300));
      out.afterSwapBack = root()?.querySelector(".background-credit")?.textContent?.trim() ?? null;

      await actor.sheet.close();
      await actor.delete();
    }
    return out;
  });
} catch (e) {
  aborted = true;
  result.error = String(e?.message ?? e);
  console.error(`\n  FAIL  ${result.error}`);
} finally {
  // Node-level, so a throw (or a click that never came) inside any stage above
  // cannot skip it — the shared dev world must come back clean regardless.
  try { await sweepLitter(); } catch (e) { console.error(`  note  litter sweep failed: ${e.message}`); }
  await browser.close();
}

const checks = [
  ["editor renders", result.hasEditor === true],
  ["source shown as fixed text", result.sourceVal === "Cairn 2e"],
  ["archetype = Fighter", result.archetypeVal === "Fighter"],
  ["2 tables padded", result.tableCount === 2],
  ["12 options padded", result.optionCount === 12],
  ["12 option drop zones", result.optionDropZones === 12],
  ["name-add handler persists", result.namesAfterAdd === 1],
  ["gear drop → snapshot w/ itemData", result.gearSnapshot?.hasItemData === true && result.gearSnapshot?.name === SWORD],
  ["gear snapshot kept type+bulky", result.gearSnapshot?.type === "weapon" && result.gearSnapshot?.bulky === true],
  ["option drop → snapshot w/ itemData", result.optionSnapshot?.hasItemData === true],
  ["generation resolved snapshot gear (not in any pack)", result.genHasSnapshotGear === true],
  ["\"Grants two bonds\" box on the authoring form", result.hasSecondBondBox === true],
  ["one bond by default, two with the box ticked", result.bondsDefault === 1 && result.bondsWithFlag === 2],
  ["default bonds carry text (the 2e table resolved)", result.bondsDefaultFrom2e === true],
  ["\"Bonds table\" field on the authoring form", result.hasBondsTableField === true],
  ["a named world table supplies the bond text", result.customBond?.count === 1 && result.customBond?.description === BOND_TEXT],
  ["a hand-made row grants no gold (narrative only)", result.customBond?.gold === 0],
  ["an unresolvable table name falls back to 2e, not to nothing", result.missingTableFallback?.count === 1 && result.missingTableFallback?.isCustom === false],
  ["declining the drop changes nothing", result.dropDeclined?.background === "" && result.dropDeclined?.items === 0 && result.dropDeclined?.asked === true],
  ["dropping a background swaps it", result.dropAccepted?.background === "Probe Background ZZ" && result.dropAccepted?.uuid === true && result.dropAccepted?.asked === true],
  ["...rewrites the inventory with the new background's gear", result.dropAccepted?.gearGained === true],
  ["...and never puts the background document in the inventory", result.dropAccepted?.pocketed === false],
  ["a Barebones character refuses a 2e background, asking nothing", result.dropCrossSource?.background === "" && result.dropCrossSource?.contentSource === "barebones" && result.dropCrossSource?.items === 1 && result.dropCrossSource?.confirmAppeared === false],
  ["an NPC refuses a background instead of pocketing it", result.dropOnNpc?.pocketed === false && result.dropOnNpc?.items === 0 && result.dropOnNpc?.confirmAppeared === false],
  ["locked shipped bg → read-only view", result.readOnly?.hasReadOnly === true && result.readOnly?.hasEditor === false],
  ["read-only view lists gear + 2 tables", result.readOnly?.gearListed > 0 && result.readOnly?.tables === 2],
  ["\"Credit line\" field on the authoring form", result.hasAttributionField === true],
  ["typing a credit PERSISTS, and it can be cleared again",
    result.attributionSaved === "ZZ Probe Credit — A. Warden · CC BY-SA 4.0" && result.attributionCleared === ""],
  ["a canon 2e background shows NO credit row", result.readOnly?.attrRow === false],
  ["a shipped class background shows its author", /McCormick/.test(result.readOnly?.classAttrRow ?? "")],
  ["an editable bg points at the Details tab", /Details/.test(result.editHint ?? "")],
  ["a locked bg points at Duplicate instead", /Duplicate/.test(result.readOnly?.lockedHint ?? "")],
  ["a character's sheet shows the background's credit",
    /McCormick/.test(result.sheetCredit?.credited?.text ?? "")],
  ["an uncredited background prints no empty line",
    result.sheetCredit?.uncredited?.present === false],
  ["the sheet credit is text, never markup",
    !/[<>]/.test(result.sheetCredit?.credited?.html ?? "")],
  ["changing the background CLEARS a stale credit",
    /McCormick/.test(result.sheetCredit?.beforeSwap ?? "")
      && result.sheetCredit?.afterSwap === null],
  ["...and swapping back restores it (not just a dead sheet)",
    /McCormick/.test(result.sheetCredit?.afterSwapBack ?? "")],
];

console.log(`\n${FOUNDRY_URL}\n`);
let ok = !aborted;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log("\n", JSON.stringify(result, null, 2));
if (errors.length) { ok = false; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(ok ? "\nprobe passed\n" : "\nprobe FAILED\n");
process.exit(ok ? 0 : 1);
