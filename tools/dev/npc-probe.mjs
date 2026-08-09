#!/usr/bin/env node
/**
 * NPC acceptance probe: prove that a generated NPC is a faithful copy
 * of one of Cairn 2e's twelve example statblocks, and that its gear is a live
 * COPY of the editable pool -- the same reference guarantee as a character's
 * starting gear, not a second inlined loadout.
 *
 *   node tools/dev/npc-probe.mjs     (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. Load the shipped catalogue; assert 12 statblocks, all gear by-name refs
 *      (a `tags` key would mean the inline shape crept back in).
 *   2. Create an NPC; assert its profession/day-rate/HP/abilities match its
 *      book statblock exactly, and that every gear reference resolved into an
 *      owned item tagged grantSource "profession".
 *   3. Assert derived Armor equals the statblock's printed Armor -- which only
 *      holds if the armor pieces resolved from the pool AND were equipped.
 *   4. Edit a pool item the NPC carries; re-roll the profession until it
 *      comes back round to that statblock, and assert the edit flows through.
 *   5. Profession re-roll replaces only profession-tagged gear: a GM-added item
 *      survives.
 *   6. Name re-roll changes the name and leaves the statblock alone.
 *   7. Render the sheet and check the merged NPC layout: a Description tab exists,
 *      Features show there even with the world setting OFF, that tab holds exactly
 *      ONE editor (the description -- notes belong on the Notes tab), the portrait
 *      opens the picker, and no checkbox is left on Foundry's own styling.
 *   7b. CLICK those controls, because a present `data-action` proves only that the
 *      attribute is there: the portrait must really open the gallery, Add Feature
 *      must really open its dialog, and a feature must round-trip through
 *      system.features and appear on the tab. Both feature dialogs are answered
 *      rather than dismissed -- see the notes inline, each cost a hung run.
 *   8. NPC-role sheet parity (2026-08-01): a generated NPC arrives with pronouns,
 *      an age and eight traits; all of them — plus scarEnabled and a picked scar —
 *      ROUND-TRIP through the real sheet (written via the form, read off the
 *      document, surviving a re-render). Witness: the same write path drops an
 *      UNDECLARED sibling key, so the greens are load-bearing on the NpcData
 *      declarations rather than on Foundry keeping whatever it is handed.
 *   9. Identity is kept by omission: profession and name re-rolls leave
 *      pronouns/age/traits alone (seeded with sentinels first, so "unchanged" is
 *      observable), and regenerateNpc — a whole new person — replaces all three.
 *  10. The role gate: the biography block is ABSENT on a monster, a mount and a
 *      container-role npc, present on the person from step 8. Witness in-page:
 *      `_prepareContext` patched to force showBiography on a monster, and the
 *      block must appear — proof the absence assertions can fail.
 *  11. Career → day-rate autofill (CairnActor._preUpdate): a known career name
 *      fills a still-zero rate (case-insensitively); a non-zero rate is never
 *      overwritten; an explicit dayRate in the same update wins; an unknown name
 *      fills nothing. Witness: the base class's _preUpdate shadowed onto the
 *      instance (the autofill removed, nothing else), and the same known-name
 *      write must leave 0.
 *  12. Revert the pool item and delete the test actors.
 * Exits non-zero on any failed assertion or console error.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await withSettings(page, () => page.evaluate(async () => {
    const CG = game.cairn.characterGenerator;
    const gear = await import("/systems/air-bladder/module/gear.js");

    const findPoolDoc = async (name) => {
      const lower = String(name).toLowerCase();
      for (const key of gear.CANONICAL_GEAR_PACKS) {
        const p = game.packs.get(key);
        if (!p) continue;
        const d = (await p.getDocuments()).find((x) => x.name.toLowerCase() === lower);
        if (d) return d;
      }
      return null;
    };

    // 1. The shipped catalogue must be references, not inline records.
    const list = await CG.getNpcCareers2e();
    if (!list.length) return { error: "NPC careers catalogue is empty or unreachable" };
    const inlineLeak = list.flatMap((h) => h.gear ?? []).filter((g) => "tags" in g || "description" in g);
    const catalogue = {
      count: list.length,
      refCount: list.reduce((n, h) => n + (h.gear?.length ?? 0), 0),
      inlineLeak: inlineLeak.length,
    };

    // 2. Create an NPC and match it against its book statblock.
    const actor = await CG.createNpc();
    const book = list.find((h) => h.name === actor.system.profession);
    if (!book) return { error: `generated profession "${actor.system.profession}" is not in the catalogue` };

    const tagged = actor.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "profession");
    const gen = {
      profession: book.name,
      dayRate: actor.system.dayRate === book.rate,
      hp: actor.system.hp.value === book.hp && actor.system.hp.max === book.hp,
      abilities:
        actor.system.abilities.STR.value === book.abilities.STR &&
        actor.system.abilities.DEX.value === book.abilities.DEX &&
        actor.system.abilities.WIL.value === book.abilities.WIL,
      // Every reference resolved into an owned item.
      resolvedAll: tagged.length === (book.gear?.length ?? 0),
      resolved: tagged.length,
      expected: book.gear?.length ?? 0,
      // 3. Printed Armor is DERIVED: it only matches if the armor pieces came out
      //    of the pool and were equipped.
      armorDerived: (actor.system.armor ?? 0) === (book.armor ?? 0),
      armorGot: actor.system.armor ?? 0,
      armorBook: book.armor ?? 0,
      portrait: !!actor.img && actor.img.includes("/jon-aspeheim/portraits"),
    };

    // 3b. The armor check above is vacuous when the rolled statblock prints 0
    //     Armor (most do). Cycle to one that prints armor so "resolved from the
    //     pool AND equipped" is actually exercised.
    const armored = list.find((h) => (h.armor ?? 0) > 0);
    let armorCase = null;
    if (armored) {
      for (let i = 0; i < 200 && actor.system.profession !== armored.name; i++) {
        await CG.rerollNpcProfession(actor);
      }
      if (actor.system.profession === armored.name) {
        armorCase = {
          profession: armored.name,
          book: armored.armor,
          got: actor.system.armor ?? 0,
          matches: (actor.system.armor ?? 0) === armored.armor,
          equipped: actor.items.filter((i) => i.type === "armor" && i.system.equipped).length,
        };
      }
    }

    // 4. Edit a pool item this statblock grants, then re-roll professions until we
    //    land back on it, and check the edit came through.
    const refName = book.gear[0].name;
    const poolDoc = await findPoolDoc(refName);
    let editFlowed = null, editTarget = null;
    if (poolDoc) {
      const pack = game.packs.get(poolDoc.pack);
      const wasLocked = pack.locked;
      if (wasLocked) await pack.configure({ locked: false });
      const origDesc = poolDoc.system.description ?? "";
      const marker = "NPC-PROBE-MARKER-7";
      await poolDoc.update({ "system.description": marker });

      // Re-roll AWAY first -- the actor currently IS this profession, and its gear
      // was built before the edit, so a loop that stops on "already there" would
      // compare the stale pre-edit item and always fail. Then cycle back to it
      // (re-roll avoids the current profession, so it wanders); bounded so a miss
      // cannot hang the probe.
      await CG.rerollNpcProfession(actor);
      for (let i = 0; i < 200 && actor.system.profession !== book.name; i++) {
        await CG.rerollNpcProfession(actor);
      }
      if (actor.system.profession === book.name) {
        const it = actor.items.find((x) => x.name.toLowerCase() === poolDoc.name.toLowerCase());
        editFlowed = (it?.system.description ?? "") === marker;
        editTarget = poolDoc.name;
      }
      await poolDoc.update({ "system.description": origDesc });
      if (wasLocked) await pack.configure({ locked: true });
    }

    // 5. A GM-added item must survive a profession re-roll (it carries no
    //    grantSource, so _replace-by-source must not touch it).
    await actor.createEmbeddedDocuments("Item", [{ name: "PROBE GM Item", type: "item" }]);
    const beforeProf = actor.system.profession;
    await CG.rerollNpcProfession(actor);
    const survive = {
      gmItemKept: !!actor.items.find((i) => i.name === "PROBE GM Item"),
      professionChanged: actor.system.profession !== beforeProf,
      // Old profession gear must be gone: no item tagged "profession" should
      // belong to a statblock other than the current one.
      staleCleared: (() => {
        const now = list.find((h) => h.name === actor.system.profession);
        const names = new Set((now?.gear ?? []).map((g) => g.name.toLowerCase()));
        const tagged2 = actor.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "profession");
        // Aliased names resolve to a differently-named pool item, so compare on
        // COUNT rather than identity: no more tagged items than the statblock grants.
        return tagged2.length <= (now?.gear?.length ?? 0);
      })(),
    };

    // 6. Name re-roll: name changes, statblock untouched.
    const nameBefore = actor.name;
    const profBefore = actor.system.profession;
    const hpBefore = actor.system.hp.max;
    await CG.rerollNpcName(actor);
    const rename = {
      changed: actor.name !== nameBefore,
      statblockKept: actor.system.profession === profBefore && actor.system.hp.max === hpBefore,
      newName: actor.name,
    };

    // 7. The sheet itself renders (the probe above is all data; a template typo
    //    would sail straight through it).
    //    Force the features world setting OFF first. The character sheet hides its
    //    Features list when this is off; a non-player sheet must NOT, because a
    //    monster's attacks are its statblock rather than an optional extra. Left at
    //    whatever the world happens to hold, that assertion passes for the wrong
    //    reason. Restored from Node by withSettings, so a throw here cannot leak it.
    await game.settings.set("air-bladder", "show-features-section", false);
    await actor.sheet.render(true);
    for (let i = 0; i < 40 && !(actor.sheet.element instanceof HTMLElement); i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    await new Promise((res) => setTimeout(res, 500));
    const el = actor.sheet.element;
    // Order matters, and getting it backwards fails SILENTLY. An ApplicationV2
    // sheet root is a <form>, and HTMLFormElement is indexed by its own
    // controls — so `el?.[0]` is not undefined, it is the first <input>.
    // `el?.[0] ?? el` therefore hands back an input whose querySelector finds
    // nothing, and every DOM assertion reads false with no error.
    const node = el instanceof HTMLElement ? el : el?.[0];
    const sheet = {
      cls: actor.sheet.constructor.name,
      // ApplicationV2 frames are `.application`; `.app.window-app` is the AppV1
      // window template and matches nothing after the port.
      inDom: !!document.querySelector(".application, .app.window-app"),
      tabs: [...(node?.querySelectorAll?.("nav .item, .tabs .item") ?? [])].map((t) => t.textContent.trim()),
      // The notes tab reads plain "Notes" on EVERY npc role since 2026-08-08 —
      // the person role used to carry the character sheet's "Background &
      // Notes" wording (this actor IS a person, so it exercises exactly the
      // role that changed). The character sheet keeps the long label;
      // ui-parity-probe.mjs asserts that half.
      notesTabLabel: node?.querySelector?.('nav .item[data-tab="notes"]')?.textContent?.trim() ?? null,
      hasProfession: !!node?.querySelector?.(".profession-input"),
      hasDayRate: !!node?.querySelector?.(".day-rate-input"),
      // A hireling has no Description tab -- that is the point of the stripped sheet.
      // The Description tab is now REQUIRED, not forbidden. The two non-player
      // types were merged onto one sheet, and the 205 shipped monsters are `npc`
      // documents keeping prose in system.description — a two-tab sheet would
      // make all of it unreachable. This assertion was the exact opposite until
      // that merge.
      hasDescriptionTab: [...(node?.querySelectorAll?.("nav .item") ?? [])]
        .some((t) => t.dataset.tab === "description"),
      // Features are ALWAYS on for a non-player actor -- a monster's attacks are
      // its statblock, so they must not sit behind the world setting the character
      // sheet gates them with. Assert against the setting turned OFF, or the check
      // passes for the wrong reason in a world that happens to have it on.
      featuresSettingOff: !game.settings.get("air-bladder", "show-features-section"),
      hasFeatures: !!node?.querySelector?.('[data-tab="description"] .feature-create'),
      // Exactly ONE editor on Description (the description) and one on Notes.
      // There were two here: an always-true `showBio` guard put an unlabelled
      // biography box above the description.
      descEditors: [...(node?.querySelectorAll?.('[data-tab="description"] prose-mirror') ?? [])]
        .map((p) => p.getAttribute("name")),
      notesEditors: [...(node?.querySelectorAll?.('[data-tab="notes"] prose-mirror') ?? [])]
        .map((p) => p.getAttribute("name")),
      // ApplicationV2 dispatches clicks through the actions map only, so a portrait
      // with no data-action is inert however good it looks.
      portraitAction: node?.querySelector?.(".portrait")?.dataset?.action ?? null,
      // Every checkbox on the sheet must be house-style. "For Hire" was the one
      // left on Foundry's own: transparent fill, white border, core glyph.
      unstyledChecks: [...(node?.querySelectorAll?.('input[type="checkbox"]') ?? [])]
        .filter((c) => getComputedStyle(c).appearance !== "none"
          || getComputedStyle(c).backgroundColor === "rgba(0, 0, 0, 0)")
        .map((c) => [...c.classList].join(".") || "(no class)"),
    };

    // 7b. Clicking things, not just finding them. `data-action` present proves the
    //     attribute is there; only a click proves the handler is registered for THIS
    //     actor type and does not throw halfway through.
    const settle = (ms = 400) => new Promise((res) => setTimeout(res, ms));
    const live = {};

    // Portrait -> the same gallery a character gets.
    node?.querySelector(".portrait")?.click();
    await settle(600);
    live.galleryOpened = !!document.querySelector(".cairn-portrait-gallery");
    // Spread first: close() deletes from the live instances map as we walk it.
    for (const app of [...foundry.applications.instances.values()]) {
      if (app.element?.querySelector?.(".cairn-portrait-gallery")) await app.close();
    }
    await settle(300);

    // Add Feature -> a feature record on the actor, then remove it again. Features
    // live in system.features (an ArrayField), not as embedded Items, so a handler
    // that assumed `character` would fail here and nowhere else.
    //
    // Add Feature opens a DialogV2 PROMPT: nothing is created until OK is pressed,
    // and the name must be non-blank. A first version of this check clicked the
    // control, dismissed the dialog and reported a bug that was not there.
    //
    // Split in two deliberately. The CLICK is checked as far as "the dialog opened",
    // and no further: driving DialogV2's OK from inside page.evaluate hung the run,
    // and the dialog is shared with the character sheet and covered by dev:dialogs.
    // What is specific to an NPC is the STORAGE — features are an ArrayField on
    // system.features, not embedded Items — so the round trip is exercised through
    // the same method the dialog's callback calls.
    const beforeFeatures = actor.system.features?.length ?? 0;
    node?.querySelector('[data-tab="description"] .feature-create')?.click();
    await settle(700);
    const dlg = [...foundry.applications.instances.values()]
      .find((a) => a.element?.querySelector?.('[name="itemname"]'));
    live.featureDialogOpened = !!dlg;
    if (dlg) await dlg.close();
    await settle(300);

    await actor.createOwnedFeature({ name: "PROBE Feature", description: "probe", str: true });
    live.featureAdded = (actor.system.features?.length ?? 0) === beforeFeatures + 1;
    const added = actor.system.features?.find((f) => f.name === "PROBE Feature");
    // Only meaningful if one was actually created -- otherwise "the count matches"
    // is true because nothing ever happened.
    if (added) {
      // It must also REACH the sheet: the list is rendered from the same array, and
      // a Description tab that dropped the partial would still pass the count check.
      await actor.sheet.render(false);
      await settle(500);
      const n2 = actor.sheet.element instanceof HTMLElement ? actor.sheet.element : actor.sheet.element?.[0];
      live.featureShown = [...(n2?.querySelectorAll?.('[data-tab="description"] .cairn-feature-title') ?? [])]
        .some((t) => t.textContent.includes("PROBE Feature"));
      // deleteOwnedFeature asks "Delete <name>?" through a MODAL DialogV2.confirm,
      // so awaiting it directly waits forever for a click that never comes -- which
      // is exactly how this probe hung. Kick it off, answer the dialog, then await.
      const deletion = actor.deleteOwnedFeature(added.id);
      await settle(600);
      const confirmDlg = [...foundry.applications.instances.values()]
        .find((a) => a.element?.querySelector?.('button[data-action="yes"]'));
      live.deleteConfirmed = !!confirmDlg;
      confirmDlg?.element.querySelector('button[data-action="yes"]').click();
      await deletion;
      live.featureRemoved = (actor.system.features?.length ?? 0) === beforeFeatures;
    }

    // 7c. The shared confirmations must address an NPC, not a player's character.
    //      Deprived/Panicked/Rest/Restore all come from the character sheet, where
    //      they ask "Is your character deprived?" and explain a rule that opens
    //      "A PC that lacks a crucial need" -- nonsense asked of a wolf.
    const sh = actor.sheet;
    const words = {
      // Resolved by key existence, so the two halves are checked separately: a
      // variant IS used where the wording differs...
      deprivedQ: sh._wording("CAIRN.DeprivedConfirm"),
      deprivedTip: sh._wording("CAIRN.DeprivedTip"),
      panickedQ: sh._wording("CAIRN.PanickedConfirm"),
      restQ: sh._wording("CAIRN.RestConfirm"),
      restoreQ: sh._wording("CAIRN.RestoreConfirm"),
      // ...and is NOT invented where it does not. PanickedTip/RestTip already say
      // "character"/"the party", and a duplicate string is one more thing to keep
      // in step in every language.
      panickedTip: sh._wording("CAIRN.PanickedTip"),
      restTip: sh._wording("CAIRN.RestTip"),
    };

    // End to end, through the real dialog: tick Deprived and read what it says.
    const deprivedBox = node?.querySelector(".deprived-check");
    if (deprivedBox) {
      deprivedBox.click();
      await settle(700);
      const confirm = [...foundry.applications.instances.values()]
        .find((a) => a.element?.querySelector?.(".cairn-confirm"));
      live.deprivedDialogText = confirm?.element.querySelector(".cairn-confirm")?.textContent ?? "";
      // Decline, so the condition is not left set on the actor about to be deleted.
      confirm?.element.querySelector('button[data-action="no"]')?.click();
      await settle(400);
    }

    // 8. A generated NPC is a PERSON: pronouns, age and eight traits arrive
    //    filled, and every biography field round-trips through the real sheet.
    const el8 = () => (actor.sheet.element instanceof HTMLElement ? actor.sheet.element : actor.sheet.element?.[0]);
    const PRONOUN_SET = ["he/him", "she/her", "they/them"];
    const bioGen = {
      pronounsValid: PRONOUN_SET.includes(actor.system.pronouns),
      pronouns: actor.system.pronouns,
      ageValid: /^\d+$/.test(actor.system.age ?? "") && Number(actor.system.age) >= 12,
      age: actor.system.age,
      traitsFilled: Object.values(actor.system.traits ?? {}).filter(Boolean).length,
    };
    // Differential: a bare Create Actor npc carries NONE of it — the schema
    // initial is "" — so the greens above cannot be satisfied by the model alone.
    const bareNpc = await CONFIG.Actor.documentClass.create({ name: "PROBE bare npc", type: "npc" });
    bioGen.bare = {
      pronouns: bareNpc.system.pronouns,
      age: bareNpc.system.age,
      traitsFilled: Object.values(bareNpc.system.traits ?? {}).filter(Boolean).length,
    };
    await bareNpc.delete();

    // The round trip, through the form the way a user edits it: set the
    // fields, dispatch ONE change — submitOnChange serialises the whole form.
    await actor.sheet.render(true);
    await settle(800);
    const roundTrip = { hasBlock: !!el8()?.querySelector(".character-traits") };
    const pIn = el8()?.querySelector('input[name="system.pronouns"]');
    const aIn = el8()?.querySelector('input[name="system.age"]');
    if (pIn && aIn) {
      pIn.value = "ze/zir";
      aIn.value = "44";
      aIn.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(1300);
    }
    roundTrip.pronouns = actor.system.pronouns === "ze/zir";
    roundTrip.age = actor.system.age === "44";

    // Traits hide behind the collapse; the toggle is transient sheet state, so
    // expanding once holds for the rest of this section.
    el8()?.querySelector(".trait-toggle")?.click();
    await settle(900);
    const sels = [...(el8()?.querySelectorAll('select[name^="system.traits."]') ?? [])];
    roundTrip.traitSelects = sels.length;
    const picked = {};
    for (const s of sels) {
      const opt = s.options[s.options.length - 1];
      s.value = opt.value;
      picked[s.name.split(".").pop()] = opt.value;
    }
    sels.at(-1)?.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(1300);
    roundTrip.traits = sels.length === 8
      && Object.entries(picked).every(([k, v]) => actor.system.traits?.[k] === v);

    // Scars: the enable box reveals the checklist, the first check stores one.
    el8()?.querySelector(".scar-enable")?.click();
    await settle(1300);
    roundTrip.scarEnabled = actor.system.scarEnabled === true;
    const firstScar = el8()?.querySelector(".scar-check");
    const firstScarName = firstScar?.value ?? null;
    firstScar?.click();
    await settle(900);
    roundTrip.scar = !!firstScarName
      && (actor.system.scars ?? []).length === 1 && actor.system.scars[0] === firstScarName;

    // ...and everything survives a re-render (a value that only lived in the
    // DOM would not).
    await actor.sheet.render(false);
    await settle(800);
    roundTrip.survivesRender =
      el8()?.querySelector('input[name="system.pronouns"]')?.value === "ze/zir"
      && el8()?.querySelector('input[name="system.age"]')?.value === "44"
      && !!el8()?.querySelector(".scar-check:checked")
      && el8()?.querySelector('select[name="system.traits.physique"]')?.value === actor.system.traits.physique;

    // FAIL-WITNESS (schema): the exact failure mode the declarations prevent —
    // an undeclared key on the same write is dropped silently, the declared one
    // lands. If the greens above could pass without NpcData declaring the
    // fields, this control could not tell the two keys apart.
    await actor.update({ "system.pronouns": "they/them", "system.zzUndeclared": "X" });
    const schemaWitness = {
      declaredLanded: actor.toObject().system.pronouns === "they/them",
      undeclaredDropped: !("zzUndeclared" in actor.toObject().system),
    };

    // 9. Identity by omission. Sentinels first, so "unchanged" is observable
    //    (a re-roll that wrote fresh random values would still differ from a
    //    fresh random baseline — it can never differ from PROBE sentinels).
    await actor.update({ system: {
      pronouns: "PROBE/pronouns", age: "999",
      traits: { physique: "PROBE-physique", skin: "PROBE-skin", hair: "PROBE-hair", face: "PROBE-face",
        speech: "PROBE-speech", clothing: "PROBE-clothing", virtue: "PROBE-virtue", vice: "PROBE-vice" },
    } });
    const idSnapshot = () => JSON.stringify([actor.system.pronouns, actor.system.age, actor.system.traits]);
    const seeded = idSnapshot();
    await CG.rerollNpcProfession(actor);
    const identity = { profKeeps: idSnapshot() === seeded };
    await CG.rerollNpcName(actor);
    identity.nameKeeps = idSnapshot() === seeded;
    await CG.regenerateNpc(actor);
    identity.regenPronouns = PRONOUN_SET.includes(actor.system.pronouns);
    identity.regenAge = actor.system.age !== "999" && /^\d+$/.test(actor.system.age ?? "");
    identity.regenTraits = Object.values(actor.system.traits ?? {})
      .every((v) => v && !String(v).startsWith("PROBE-"));

    // 10. The role gate: no biography block on anything that is not a person.
    const gate = {};
    for (const [label, sys] of [
      ["monster", { role: "monster" }],
      ["mount", { role: "mount", containerClass: "horse" }],
      ["container", { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false }],
    ]) {
      const x = await CONFIG.Actor.documentClass.create({ name: `PROBE gate ${label}`, type: "npc", system: sys });
      await x.sheet.render(true);
      await settle(700);
      const xe = x.sheet.element instanceof HTMLElement ? x.sheet.element : x.sheet.element?.[0];
      gate[label] = {
        traits: !!xe?.querySelector(".character-traits"),
        scars: !!xe?.querySelector(".scar-section"),
        pronouns: !!xe?.querySelector('input[name="system.pronouns"]'),
      };
      await x.sheet.close();
      await x.delete();
    }
    // FAIL-WITNESS (in-page): the gate defeated — _prepareContext patched to
    // force showBiography + the bio context onto a monster — and the block
    // must come back, or "absent on a monster" was never the gate's doing.
    const SheetCls = Object.values(CONFIG.Actor.sheetClasses.npc)[0].cls;
    const sheetProto = SheetCls.prototype;
    const origPrepCtx = sheetProto._prepareContext;
    sheetProto._prepareContext = async function (...args) {
      const ctx = await origPrepCtx.apply(this, args);
      ctx.showBiography = true;
      await this._prepareBiographyContext(ctx);
      ctx.showScars = true;
      ctx.showAge = true;
      ctx.showOmen = false;
      return ctx;
    };
    const gateControlActor = await CONFIG.Actor.documentClass.create({
      name: "PROBE gate control", type: "npc", system: { role: "monster" },
    });
    await gateControlActor.sheet.render(true);
    await settle(700);
    const gcEl = gateControlActor.sheet.element instanceof HTMLElement
      ? gateControlActor.sheet.element : gateControlActor.sheet.element?.[0];
    gate.control = !!gcEl?.querySelector(".character-traits");
    await gateControlActor.sheet.close();
    await gateControlActor.delete();
    sheetProto._prepareContext = origPrepCtx;

    // 11. Career → day-rate autofill.
    const careers = await CG.getNpcCareers2e();
    const knownCareer = careers.find((h) => (h.rate ?? 0) > 0);
    const mkPerson = (name, sys = {}) => CONFIG.Actor.documentClass.create({
      name, type: "npc", system: { role: "npc", generationEnabled: false, ...sys },
    });
    const fill = { career: knownCareer?.name, rate: knownCareer?.rate };
    if (knownCareer) {
      const p1 = await mkPerson("PROBE fill zero");
      await p1.update({ "system.profession": knownCareer.name });
      fill.filled = p1.system.dayRate === knownCareer.rate;
      const p2 = await mkPerson("PROBE fill case");
      await p2.update({ "system.profession": knownCareer.name.toUpperCase() });
      fill.caseInsensitive = p2.system.dayRate === knownCareer.rate;
      const p3 = await mkPerson("PROBE fill nonzero", { dayRate: 3 });
      await p3.update({ "system.profession": knownCareer.name });
      fill.keptNonzero = p3.system.dayRate === 3;
      const p4 = await mkPerson("PROBE fill explicit");
      await p4.update({ "system.profession": knownCareer.name, "system.dayRate": 9 });
      fill.explicitWins = p4.system.dayRate === 9;
      // Differential: only a catalogue match fills — a Warden's own word never.
      const p5 = await mkPerson("PROBE fill unknown");
      await p5.update({ "system.profession": "Underwater Basket Weaver" });
      fill.unknownStaysZero = p5.system.dayRate === 0;
      // FAIL-WITNESS (in-page): the base class's _preUpdate shadowed onto the
      // instance — the autofill (and only our _preUpdate work) removed — and
      // the same write must now leave the rate at 0.
      const p6 = await mkPerson("PROBE fill witness");
      p6._preUpdate = Object.getPrototypeOf(CONFIG.Actor.documentClass).prototype._preUpdate;
      await p6.update({ "system.profession": knownCareer.name });
      fill.witnessStaysZero = p6.system.dayRate === 0;
      delete p6._preUpdate;
      for (const x of [p1, p2, p3, p4, p5, p6]) await x.delete();
    }

    await actor.delete();
    return { catalogue, gen, armorCase, editFlowed, editTarget, survive, rename, sheet, live, words,
      bioGen, roundTrip, schemaWitness, identity, gate, fill };
  }));

  if (r.error) {
    fail(r.error);
  } else {
    console.log(`  catalogue: ${r.catalogue.count} statblocks, ${r.catalogue.refCount} gear references`);
    r.catalogue.count === 12 ? ok("12 example hirelings shipped") : fail(`expected 12 statblocks, got ${r.catalogue.count}`);
    r.catalogue.inlineLeak === 0 ? ok("all gear is by-name references (no inline tags/descriptions)") : fail(`${r.catalogue.inlineLeak} gear entries still carry inline tags/description`);

    console.log(`  generated NPC: ${r.gen.profession}`);
    r.gen.dayRate ? ok("day rate matches the book statblock") : fail("day rate does not match the statblock");
    r.gen.hp ? ok("HP matches the book statblock") : fail("HP does not match the statblock");
    r.gen.abilities ? ok("STR/DEX/WIL match the book statblock") : fail("abilities do not match the statblock");
    r.gen.resolvedAll ? ok(`all ${r.gen.expected} gear references resolved from the pool`) : fail(`only ${r.gen.resolved}/${r.gen.expected} gear references resolved`);
    r.gen.armorDerived ? ok(`derived Armor ${r.gen.armorGot} matches the printed ${r.gen.armorBook} (pool armor resolved AND equipped)`) : fail(`derived Armor ${r.gen.armorGot} != printed ${r.gen.armorBook}`);
    r.gen.portrait ? ok("NPC got a shipped portrait") : fail("NPC has no shipped portrait");

    if (!r.armorCase) fail("could not reach an armoured statblock to test derived Armor");
    else r.armorCase.matches
      ? ok(`${r.armorCase.profession}: derived Armor ${r.armorCase.got} matches the printed ${r.armorCase.book} (${r.armorCase.equipped} armor piece(s) equipped from the pool)`)
      : fail(`${r.armorCase.profession}: derived Armor ${r.armorCase.got} != printed ${r.armorCase.book} (${r.armorCase.equipped} equipped)`);

    if (r.editFlowed === null) fail("could not cycle back to the edited profession to test pool edits");
    else r.editFlowed ? ok(`EDIT FLOWS THROUGH: pool edit to "${r.editTarget}" appears on the re-rolled NPC`) : fail(`pool edit to "${r.editTarget}" did NOT flow through`);

    r.survive.professionChanged ? ok("profession re-roll changes the profession") : fail("profession re-roll did not change the profession");
    r.survive.gmItemKept ? ok("GM-added item survives a profession re-roll") : fail("profession re-roll destroyed a GM-added item");
    r.survive.staleCleared ? ok("previous profession's gear was cleared") : fail("stale profession gear left behind");

    r.rename.changed ? ok(`name re-roll changed the name (${r.rename.newName})`) : fail("name re-roll did not change the name");
    r.rename.statblockKept ? ok("name re-roll left the statblock alone") : fail("name re-roll disturbed the statblock");

    r.sheet.inDom ? ok(`${r.sheet.cls} rendered [${r.sheet.tabs.join(" | ")}]`) : fail("NPC sheet did not appear in the DOM");
    // Person role — the one that used to read "Background & Notes" (see the
    // collection comment). Asserted against the literal old wording too, so a
    // revert of the 2026-08-08 flattening reddens this leg by name.
    r.sheet.notesTabLabel === "Notes"
      ? ok(`the npc-person notes tab reads plain "Notes"`)
      : fail(`npc-person notes tab reads "${r.sheet.notesTabLabel}", expected "Notes" — the per-role label split is back`);
    r.sheet.hasProfession && r.sheet.hasDayRate ? ok("sheet shows the Profession and Day Rate fields") : fail("sheet is missing the Profession/Day Rate fields");
    r.sheet.hasDescriptionTab ? ok("has a Description tab (one merged non-player sheet, so monster prose stays reachable)") : fail("no Description tab — monster/NPC description text would be unreachable");

    r.sheet.featuresSettingOff
      ? (r.sheet.hasFeatures
        ? ok("Features show on Description with the world setting OFF (a statblock is not optional)")
        : fail("Features are missing from the Description tab — they must not follow the character sheet's world setting"))
      : fail("could not force show-features-section off, so the Features check would prove nothing");

    JSON.stringify(r.sheet.descEditors) === JSON.stringify(["system.description"])
      ? ok("Description tab has exactly one editor, the description")
      : fail(`Description tab editors are [${r.sheet.descEditors.join(", ")}] — expected only system.description (notes belong on the Notes tab)`);
    JSON.stringify(r.sheet.notesEditors) === JSON.stringify(["system.notes"])
      ? ok("Notes tab has exactly one editor, the notes")
      : fail(`Notes tab editors are [${r.sheet.notesEditors.join(", ")}] — expected only system.notes`);

    r.sheet.portraitAction === "editPortrait"
      ? ok("portrait opens the picker (data-action=editPortrait, same as a character)")
      : fail(`portrait carries data-action="${r.sheet.portraitAction}" — it must be editPortrait or clicking it does nothing`);

    r.sheet.unstyledChecks.length === 0
      ? ok("every checkbox is house-style")
      : fail(`checkbox(es) left on Foundry's own styling: ${r.sheet.unstyledChecks.join(", ")}`);

    r.live.galleryOpened
      ? ok("clicking the portrait really opens the portrait gallery")
      : fail("clicking the portrait opened nothing");
    r.live.featureDialogOpened
      ? ok("Add Feature opens its dialog on an NPC")
      : fail("Add Feature opened no dialog");
    r.live.featureAdded
      ? ok("createOwnedFeature stores a feature on an NPC")
      : fail("createOwnedFeature stored nothing — system.features may be missing from NpcData");
    // Vacuous unless something was created, so both are only reported in that case.
    if (r.live.featureAdded) {
      r.live.featureShown ? ok("the new feature appears on the Description tab") : fail("the feature was stored but the Description tab does not list it");
      r.live.deleteConfirmed ? ok("deleting a feature asks for confirmation") : fail("no confirmation dialog appeared for a feature delete");
      r.live.featureRemoved ? ok("the confirmed delete removes the feature") : fail("deleteOwnedFeature left the record behind");
    }

    const w = r.words;
    const varied = ["deprivedQ", "deprivedTip", "panickedQ", "restQ", "restoreQ"]
      .filter((k) => !w[k].endsWith("Npc"));
    varied.length === 0
      ? ok("Deprived/Panicked/Rest/Restore prompts use their NPC wording")
      : fail(`still on the player-character wording: ${varied.join(", ")}`);
    const overreach = ["panickedTip", "restTip"].filter((k) => w[k].endsWith("Npc"));
    overreach.length === 0
      ? ok("strings that already read neutrally were not duplicated")
      : fail(`needless NPC variant invented for: ${overreach.join(", ")}`);

    const dt = r.live.deprivedDialogText ?? "";
    if (!dt) fail("ticking Deprived opened no confirmation dialog");
    else if (/your character|\bPC\b/.test(dt)) fail(`the Deprived dialog still addresses a player character: "${dt.slice(0, 90)}…"`);
    else if (!/this NPC/.test(dt)) fail(`the Deprived dialog does not address the NPC: "${dt.slice(0, 90)}…"`);
    else ok("the Deprived confirmation reads as being about this NPC");

    console.log("\n  a generated NPC is a person");
    r.bioGen.pronounsValid ? ok(`pronouns arrive filled (${r.bioGen.pronouns})`) : fail(`pronouns are "${r.bioGen.pronouns}" — not one of he/him, she/her, they/them`);
    r.bioGen.ageValid ? ok(`age arrives filled (${r.bioGen.age})`) : fail(`age is "${r.bioGen.age}" — expected a rolled number`);
    r.bioGen.traitsFilled === 8 ? ok("all eight traits arrive filled") : fail(`only ${r.bioGen.traitsFilled}/8 traits filled`);
    r.bioGen.bare.pronouns === "" && r.bioGen.bare.age === "" && r.bioGen.bare.traitsFilled === 0
      ? ok("   differential: a bare Create Actor npc has none of it (the schema alone cannot green the above)")
      : fail(`a bare npc arrived with biography values: ${JSON.stringify(r.bioGen.bare)}`);

    console.log("\n  the biography round-trips through the sheet");
    r.roundTrip.hasBlock ? ok("the bio block renders on a role-npc sheet") : fail("no .character-traits block on the person's Description tab");
    r.roundTrip.pronouns ? ok("pronouns: form write → document") : fail("pronouns did not round-trip");
    r.roundTrip.age ? ok("age: form write → document") : fail("age did not round-trip");
    r.roundTrip.traits ? ok("all eight trait selects: form write → document") : fail(`traits did not round-trip (${r.roundTrip.traitSelects} selects found)`);
    r.roundTrip.scarEnabled ? ok("scarEnabled: checkbox → document") : fail("scarEnabled did not store");
    r.roundTrip.scar ? ok("a picked scar: checkbox → document") : fail("the picked scar did not store");
    r.roundTrip.survivesRender ? ok("every value survives a re-render") : fail("a value vanished on re-render — DOM-only state");
    r.schemaWitness.declaredLanded && r.schemaWitness.undeclaredDropped
      ? ok("   witness: an UNDECLARED sibling key on the same write is dropped — the greens hang on the NpcData declarations")
      : fail(`schema witness failed: ${JSON.stringify(r.schemaWitness)}`);

    console.log("\n  identity is kept by omission");
    r.identity.profKeeps ? ok("profession re-roll keeps pronouns/age/traits") : fail("profession re-roll disturbed the identity fields");
    r.identity.nameKeeps ? ok("name re-roll keeps pronouns/age/traits") : fail("name re-roll disturbed the identity fields");
    r.identity.regenPronouns && r.identity.regenAge && r.identity.regenTraits
      ? ok("regenerateNpc replaces all three — a whole new person")
      : fail(`regenerateNpc left a sentinel behind: ${JSON.stringify(r.identity)}`);

    console.log("\n  the biography block is role-gated");
    for (const role of ["monster", "mount", "container"]) {
      const g = r.gate[role];
      !g.traits && !g.scars && !g.pronouns
        ? ok(`absent on a ${role}`)
        : fail(`the bio block leaks onto a ${role}: ${JSON.stringify(g)}`);
    }
    r.gate.control
      ? ok("   witness: the gate defeated in-page puts the block on a monster — the absence assertions can fail")
      : fail("the in-page gate control changed nothing — the absence assertions are not load-bearing");

    console.log("\n  career → day-rate autofill");
    if (!r.fill.career) fail("no career with a non-zero rate in the catalogue — the autofill legs ran on nothing");
    else {
      r.fill.filled ? ok(`a known career fills a zero rate (${r.fill.career} → ${r.fill.rate})`) : fail("a known career did not fill the zero rate");
      r.fill.caseInsensitive ? ok("the match is case-insensitive") : fail("an upper-cased career name did not fill the rate");
      r.fill.keptNonzero ? ok("a non-zero rate is never overwritten") : fail("the autofill clobbered a stored rate");
      r.fill.explicitWins ? ok("an explicit dayRate in the same update wins") : fail("the autofill overrode an explicit dayRate");
      r.fill.unknownStaysZero ? ok("   differential: an unknown career fills nothing") : fail("an unknown career name filled a rate from nowhere");
      r.fill.witnessStaysZero
        ? ok("   witness: with the base-class _preUpdate shadowed in, the rate stays 0 — the fill is our _preUpdate's doing")
        : fail("the shadow control still filled the rate — the assertion is not reading the autofill");
    }
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  // Sweep the parity legs' actors FROM NODE, so an aborted run cannot leave a
  // "PROBE …" actor behind for the next run to mistake for its own state.
  try {
    await page.evaluate(async () => {
      for (const a of game.actors.filter((x) => x.name.startsWith("PROBE "))) await a.delete();
    });
  } catch { /* the page may already be closed */ }
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nNPC PROBE FAILED\n" : "\nnpc probe passed\n");
process.exit(failed ? 1 : 0);
