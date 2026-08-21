#!/usr/bin/env node
/**
 * The NPC / Hireling split (2026-08-20) — e2e.
 *
 *   npm run dev:npc-split      (dev world on :30000, which runs the working tree)
 *
 * `npc` was one role until this change: a person with a Career, a For Hire box
 * and a Day Rate. It is two now — the hireling the party PAYS, and the NPC the
 * party MEETS, who has a Background off the Warden's Guide table and four
 * traits of their own (Quirk, Goal, Virtue, Vice) off that book's NPC tables.
 *
 * The migration half lives in `dev:role-migration`, which plants a genuine
 * pre-split document through the raw socket. This probe is about what the two
 * roles ARE once they exist, and it goes through the real generators rather
 * than seeding documents: the whole risk in a split like this is a call site
 * that still writes the old role or reads the old field, and a seeded actor
 * cannot catch one.
 *
 * An NPC's STATBLOCK is rolled (2026-08-20, the day after the split): 3d6 a
 * piece and 1d6 HP, because a hireling's numbers arrive with its career and an
 * NPC has no career. Section 6 makes five of them — one rolled statblock is
 * indistinguishable from a fixed one — and its control is a planted npc with
 * nothing written, which must still read the schema's 10/10/10 and 6.
 *
 * The trait keys are the interesting part. `virtue` and `vice` exist on BOTH
 * sets and differ by SOURCE TABLE, so an NPC is "Shrewd" off the Warden's Guide
 * list where a character is "Honest" off tables-2e. Same stored key on purpose
 * — which is what makes re-roling an actor lossless, and what the round-trip
 * leg at the end proves.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, withSettings } from "./lib.mjs";

let failures = 0;
const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(46)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(46)} ${detail}`); failures++; };
const check = (cond, label, detail) => (cond ? ok(label, detail) : fail(label, detail));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

// Sweep by the id DIFFERENCE. A leftover from an aborted run would otherwise be
// deleted, or worse, satisfy an assertion this run never earned.
const idsBefore = await page.evaluate(() => game.actors.map((a) => a.id));

let R = {};
await withSettings(page, async () => {
  R = await page.evaluate(async () => {
    const cg = game.cairn.characterGenerator;
    const Cls = CONFIG.Actor.documentClass;
    const out = { errors: [] };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /* The sheet context, which is what both surfaces render from: the sheet
     * itself and — for the trait sentence — the printed page, which calls the
     * same `_buildTraitSentence`. Read through a real render so a context key
     * that only exists on a rendered sheet cannot be missed. */
    const ctxOf = async (actor) => {
      const s = actor.sheet;
      await s.render(true);
      for (let i = 0; i < 60 && !s.element; i++) await sleep(100);
      const c = await s._prepareContext({});
      // The RENDERED sheet, not just the context: what a Warden is offered is
      // what the template chose to draw, and a flag can be right while the
      // `{{#if}}` reading it names a different one.
      const dom = {
        forHire: !!s.element?.querySelector(".for-hire-check"),
        dayRate: !!s.element?.querySelector(".day-rate-input"),
      };
      await s.close();
      return {
        dom,
        sentence: c.traitSentence ?? "",
        rows: (c.traitRows ?? []).map((t) => t.key),
        labels: (c.traitRows ?? []).map((t) => t.label),
        options: Object.fromEntries((c.traitRows ?? []).map((t) => [t.key, (t.options ?? []).map((o) => o.value)])),
        showCareer: c.showCareer === true,
        showBackground: c.showBackground === true,
        showBiography: c.showBiography === true,
      };
    };

    try {
      /* --- 1. what each generator makes ---------------------------------- */
      const npc = await cg.createNpc();
      const hire = await cg.createHireling();
      out.npc = {
        role: npc.system.role, background: npc.system.background,
        profession: npc.system.profession, dayRate: npc.system.dayRate,
        showDayRate: npc.system.showDayRate, isNpcPerson: npc.system.isNpcPerson,
        traits: npc.system.traits, items: npc.items.size,
        slotsMax: npc.system.slotsMax, name: npc.name,
        hp: npc.system.hp?.max, str: npc.system.abilities?.STR?.max,
      };
      out.hire = {
        role: hire.system.role, background: hire.system.background,
        profession: hire.system.profession, dayRate: hire.system.dayRate,
        showDayRate: hire.system.showDayRate, isNpcPerson: hire.system.isNpcPerson,
        traits: hire.system.traits, items: hire.items.size, name: hire.name,
      };

      // The Background must come off the SHIPPED table, not be any old string.
      const bgPack = game.packs.get("air-bladder.warden-npcs");
      const bgTable = bgPack ? (await bgPack.getDocuments()).find((t) => t.name === "Warden: NPC - Background") : null;
      out.backgroundTable = bgTable ? bgTable.results.map((r) => r.description ?? r.text ?? "") : [];
      const careers = await cg.getNpcCareers2e();
      out.careerNames = careers.map((c) => c.name);

      /* --- 2. the sheets ------------------------------------------------- */
      out.npcCtx = await ctxOf(npc);
      out.hireCtx = await ctxOf(hire);

      // A character, for the second-person control. Made rather than found: a
      // world with no character would make the control silently absent, which
      // reads exactly like it passing.
      const pc = await Cls.create({
        name: "ZZ Split PC", type: "character",
        system: {
          age: "27",
          traits: {
            physique: "Lithe", skin: "Pale", hair: "Long", face: "Broken",
            speech: "Booming", clothing: "Elegant", virtue: "Honest", vice: "Vain",
          },
        },
      });
      out.pcCtx = await ctxOf(pc);

      /* --- 3. re-roling loses nothing ------------------------------------ */
      // The one thing a Warden will actually do to these: decide the innkeeper
      // is for hire after all. Both job fields and every trait must survive the
      // trip out and back, which they do BECAUSE the two roles use different
      // keys and share the trait schema.
      const seed = {
        background: "PROBE-background", profession: "PROBE-career", dayRate: 7,
        traits: { physique: "PROBE-phys", virtue: "PROBE-virtue", quirk: "PROBE-quirk", goal: "PROBE-goal" },
      };
      const trip = await Cls.create({ name: "ZZ Split Round Trip", type: "npc", system: { role: "npc", ...seed } });
      await trip.update({ "system.role": "hireling" });
      out.asHireling = {
        role: trip.system.role, background: trip.system.background,
        profession: trip.system.profession, dayRate: trip.system.dayRate,
        quirk: trip.system.traits?.quirk, goal: trip.system.traits?.goal,
      };
      await trip.update({ "system.role": "npc" });
      out.backToNpc = {
        role: trip.system.role, background: trip.system.background,
        profession: trip.system.profession, dayRate: trip.system.dayRate,
        quirk: trip.system.traits?.quirk, goal: trip.system.traits?.goal,
        virtue: trip.system.traits?.virtue, physique: trip.system.traits?.physique,
      };

      /* --- 4. the roles that are NOT people ------------------------------ */
      // showBiography is the gate that keeps pronouns and a trait sentence off a
      // crate. It widened to two roles in this change, and "widened" is exactly
      // the edit that leaks.
      out.gate = {};
      for (const role of ["monster", "companion", "transport", "container"]) {
        const a = await Cls.create({ name: `ZZ Split ${role}`, type: "npc", system: { role } });
        const c = await ctxOf(a);
        out.gate[role] = { bio: c.showBiography, career: c.showCareer, background: c.showBackground };
      }
      /* --- 5. the warning matches what the button does -------------------- */
      // Through the REAL frame button and the REAL dialog, not by reading the
      // two keys: what broke here was a BRANCH, and a string compare cannot see
      // which branch a handler took. Dismissing the dialog writes nothing
      // (rejectClose: false -> null -> the handler returns), so this leg costs
      // the actors nothing and needs no restore of its own.
      //
      // show-generate-header is a world setting and gates the Roll button, so
      // it is set BEFORE the render that builds the frame — a frame is built
      // once. withSettings puts it back.
      await game.settings.set("air-bladder", "show-generate-header", true);
      const warningOf = async (actor) => {
        await actor.update({ "system.generationEnabled": true });
        const s = actor.sheet;
        await s.render(true);
        for (let i = 0; i < 60 && !s.element?.querySelector('[data-action="rollActor"]'); i++) await sleep(100);
        // By the id DIFFERENCE: a dialog closing from an earlier leg lingers in
        // the instances map, and picking it up would read a stale warning.
        const seen = new Set(foundry.applications.instances.keys());
        s.element?.querySelector('[data-action="rollActor"]')?.click();
        let dlg = null;
        for (let i = 0; i < 60 && !dlg; i++) {
          await sleep(100);
          dlg = [...foundry.applications.instances.entries()]
            .filter(([id]) => !seen.has(id))
            .map(([, app]) => app)
            .find((app) => app instanceof foundry.applications.api.DialogV2 && app.rendered);
        }
        const text = dlg ? `${dlg.title ?? ""} :: ${dlg.element?.textContent ?? ""}` : "";
        await dlg?.close();
        await s.close();
        return text;
      };
      out.npcWarning = await warningOf(npc);
      out.hireWarning = await warningOf(hire);

      /* --- 6. an NPC's statblock is ROLLED -------------------------------- */
      // User ask, 2026-08-20: an NPC arrives with rolled STR/DEX/WIL and HP,
      // not the schema's 10/10/10 and 6. FIVE of them, because a single rolled
      // statblock is indistinguishable from a fixed one — a generator that
      // wrote a constant would pass every range check on earth.
      out.rolled = [];
      for (let i = 0; i < 5; i++) {
        const a = await cg.createNpc();
        const ab = a.system.abilities ?? {};
        out.rolled.push({
          str: ab.STR?.value, dex: ab.DEX?.value, wil: ab.WIL?.value, hp: a.system.hp?.value,
          full: ab.STR?.value === ab.STR?.max && ab.DEX?.value === ab.DEX?.max
            && ab.WIL?.value === ab.WIL?.max && a.system.hp?.value === a.system.hp?.max,
        });
      }

      // The negative control, in-page and against a PLANTED document rather
      // than against edited source: an npc created with no statblock written is
      // exactly what this generator produced before the change, so every leg
      // above must be FALSE of it. If it is not, they are testing nothing.
      const bare = await Cls.create({ name: "ZZ Split Bare", type: "npc", system: { role: "npc" } });
      out.bare = {
        str: bare.system.abilities?.STR?.value, dex: bare.system.abilities?.DEX?.value,
        wil: bare.system.abilities?.WIL?.value, hp: bare.system.hp?.value,
      };

      // A full re-roll replaces it — and BOTH halves, so a wounded NPC does not
      // come back carrying the last one's damage on a new maximum. That write
      // lives in regenerateNpc, a second place, which is where a statblock the
      // create path handles correctly goes missing.
      const hurt = await cg.createNpc();
      const hb = hurt.system.abilities ?? {};
      out.regenBefore = { str: hb.STR?.max, dex: hb.DEX?.max, wil: hb.WIL?.max, hp: hurt.system.hp?.max };
      await hurt.update({ "system.hp.value": 1, "system.abilities.STR.value": 3 });
      await cg.regenerateNpc(hurt);
      const ha = hurt.system.abilities ?? {};
      out.regenAfter = {
        str: ha.STR?.max, dex: ha.DEX?.max, wil: ha.WIL?.max, hp: hurt.system.hp?.max,
        full: ha.STR?.value === ha.STR?.max && hurt.system.hp?.value === hurt.system.hp?.max,
      };
      /* --- 7. the Background grants gear ---------------------------------- */
      // User ask, 2026-08-20: an NPC arrives carrying what its Background says
      // it should, through the same by-name resolution a Barebones PC and a 2e
      // hireling use. The mapping is READ from config, never copied here — a
      // probe holding its own copy of a list is the fourth-copy failure this
      // repo has already paid for twice.
      const MAP = CONFIG.Cairn?.npcGenerator?.backgroundGear ?? {};
      const gearNamesOf = async (bbName) => {
        const bg = bbName ? await cg.getBarebonesBackgroundByName(bbName) : null;
        return (bg?.system?.startingGear ?? []).map((g) => g.name).sort();
      };
      const bySource = (a, src) => a.items
        .filter((i) => i.getFlag("air-bladder", "grantSource") === src)
        .map((i) => i.name).sort();
      const grantedOf = (a) => bySource(a, "background");
      const kitOf = (a) => bySource(a, "npc-kit");

      // (a) Whatever THIS run happened to roll, the gear must match that
      //     Background's counterpart. Asserting the rule rather than a fixture
      //     means the leg keeps working when the mapping changes.
      out.grant = {
        background: npc.system.background,
        target: MAP[npc.system.background] ?? null,
        want: await gearNamesOf(MAP[npc.system.background]),
        got: grantedOf(npc),
        kit: kitOf(npc),
        untagged: npc.items.filter((i) => !i.getFlag("air-bladder", "grantSource")).map((i) => i.name),
      };

      // (b) The mapping must cover the table. Every row except Lord and
      //     Politician has a counterpart, and those two have none BY DECISION —
      //     asserted in both directions so neither a silent gap nor a silent
      //     addition passes.
      const rows = (out.backgroundTable ?? []).filter(Boolean);
      out.coverage = {
        rows: rows.length,
        missing: rows.filter((r) => !MAP[r]),
        strays: Object.keys(MAP).filter((k) => !rows.includes(k)),
        targetsResolve: (await Promise.all(Object.values(MAP)
          .map(async (t) => ((await gearNamesOf(t)).length ? null : t)))).filter(Boolean),
      };

      // (c) Deterministic, and the two things (a) cannot reach: a Background
      //     with NO counterpart grants nothing, and a re-roll takes back only
      //     what it gave. The die is pinned in page to the row whose text is
      //     "Lord" — mid-bucket, and INVERTED, because core maps a face as
      //     ceil((1-u)*faces).
      //
      //     BOTH ends are pinned, and the first one is the fix for a real
      //     flake: this read `before` off whatever createNpc happened to roll,
      //     so on the 2-in-20 runs that landed Lord or Politician the "its old
      //     gear went with it" leg had nothing to lose and failed. A
      //     precondition that holds 90% of the time is a race, not a flake —
      //     establish it.
      const rowFor = (text) => bgTable?.results
        .find((r) => (r.type === "text" ? r.description : r.name) === text)?.range?.[0] ?? null;
      const faces = Math.max(...(bgTable?.results ?? [{ range: [1, 20] }]).map((r) => r.range[1]));
      const granting = rows.find((r) => MAP[r]);
      const origRnd = CONFIG.Dice.randomUniform;
      const rollOnto = async (actor, text) => {
        CONFIG.Dice.randomUniform = () => 1 - (rowFor(text) - 0.5) / faces;
        try { await cg.rerollNpcBackground(actor); } finally { CONFIG.Dice.randomUniform = origRnd; }
      };
      const gift = await cg.createNpc();
      await gift.createEmbeddedDocuments("Item", [{ name: "ZZ Warden Gift", type: "item" }]);
      await rollOnto(gift, granting);
      out.reroll = { granting, before: grantedOf(gift), wantBefore: await gearNamesOf(MAP[granting]) };
      await rollOnto(gift, "Lord");
      out.reroll.background = gift.system.background;
      out.reroll.granted = grantedOf(gift);
      out.reroll.kitKept = kitOf(gift);
      out.reroll.handKept = gift.items.some((i) => i.name === "ZZ Warden Gift");

      // (d) The INSTRUCTION row, pinned, because the leg above only meets one
      //     by chance — two of the eighteen targets carry one and a 1-in-10
      //     assertion is not a gate. Derived from the data, not named here: a
      //     row whose target declares a gear entry that is an instruction
      //     rather than an item ("Random Additional Gear"). Without
      //     resolveStartingGear these come back an item short, silently.
      const INSTRUCTIONS = ["random additional gear", "scroll of random spellbook",
        "spellbook", "random spellbook"];
      const declaredOf = async (bbName) => {
        const bg = bbName ? await cg.getBarebonesBackgroundByName(bbName) : null;
        return (bg?.system?.startingGear ?? []).map((g) => String(g.name));
      };
      let instructionRow = null;
      for (const r of rows) {
        if (!MAP[r]) continue;
        const decl = await declaredOf(MAP[r]);
        if (decl.some((d) => INSTRUCTIONS.includes(d.trim().toLowerCase()))) { instructionRow = r; break; }
      }
      out.instruction = { row: instructionRow, declared: await declaredOf(MAP[instructionRow]) };
      if (instructionRow) {
        await rollOnto(gift, instructionRow);
        out.instruction.background = gift.system.background;
        out.instruction.granted = grantedOf(gift);
      }

      // (e) A WHOLE new person replaces the kit as well. The two sources part
      //     company exactly here: the Background die leaves the kit alone
      //     because changing someone's trade does not unpack their bag, while a
      //     regenerate is a different human being. Compared by item ID, not by
      //     name — a fresh Rations is a different document with the same name,
      //     and a name compare would call a replacement a survival.
      const kitIdsBefore = gift.items
        .filter((i) => i.getFlag("air-bladder", "grantSource") === "npc-kit").map((i) => i.id);
      await cg.regenerateNpc(gift);
      const kitIdsAfter = gift.items
        .filter((i) => i.getFlag("air-bladder", "grantSource") === "npc-kit").map((i) => i.id);
      out.regen = {
        before: kitIdsBefore.length,
        after: kitIdsAfter.length,
        shared: kitIdsAfter.filter((id) => kitIdsBefore.includes(id)).length,
        handKept: gift.items.some((i) => i.name === "ZZ Warden Gift"),
      };

    } catch (e) {
      out.errors.push(`threw: ${e.message}`);
    }
    return out;
  });
});

const sweep = await page.evaluate(async (before) => {
  const known = new Set(before);
  const mine = game.actors.filter((a) => !known.has(a.id));
  const names = mine.map((a) => a.name);
  for (const a of mine) await a.delete();
  return { deleted: names, left: game.actors.filter((a) => !known.has(a.id)).length };
}, idsBefore);

await browser.close();

/* -------------------------------------------------------------------------- */

const N = R.npc ?? {}; const H = R.hire ?? {};
const NC = R.npcCtx ?? {}; const HC = R.hireCtx ?? {}; const PC = R.pcCtx ?? {};

console.log("\nan NPC is somebody the party meets");
check(N.role === "npc", "role npc", JSON.stringify(N.role));
check(!!N.background && (R.backgroundTable ?? []).includes(N.background),
  "Background comes off the Warden's Guide table", JSON.stringify(N.background));
check(N.profession === "" && N.dayRate === 0 && N.showDayRate === false,
  "no Career, no rate, no day-rate row", JSON.stringify({ career: N.profession, rate: N.dayRate }));
const G = R.grant ?? {}; const COV = R.coverage ?? {}; const RR = R.reroll ?? {};
const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
// COUNT, not names, and this is the leg that found the defect. Nine Barebones
// backgrounds write a row as an instruction ("Random Additional Gear") whose
// resolved name is whatever the d100 handed over, so comparing names would
// have to special-case them — while comparing the COUNT says the thing that
// actually matters: no declared row was silently dropped. A bare resolveRefs
// left a Peddler holding a Sack and nothing else.
check(G.want?.length > 0 ? G.got?.length === G.want?.length : G.got?.length === 0,
  "every declared row resolved — none dropped",
  `${G.background} -> ${G.target}: ${JSON.stringify(G.want)} => ${JSON.stringify(G.got)}`);
// The KIT, which is what a Background alone could not supply: an NPC was
// arriving with two or three items where a hireling arrives with six off its
// career. Rations and a Torch are named, the third is a roll, so the leg names
// the two and counts the three.
check(G.kit?.includes("Rations") && G.kit?.includes("Torch") && G.kit?.length === 3,
  "plus a kit: rations, a torch and one random find", JSON.stringify(G.kit));
check(G.untagged?.length === 0,
  "and NOTHING arrives untagged — every item has an owner", JSON.stringify(G.untagged));
// Not pinned to 10 — inherited from the Warden's max-equip-slots setting, whose
// default is 10. Asserting the number would freeze a setting the Warden owns.
check(N.slotsMax === 10, "ten slots, from the Warden's own setting", `${N.slotsMax}`);
check(N.hp >= 1 && N.hp <= 6 && N.str >= 3 && N.str <= 18,
  "arrives with a rolled statblock", `HP ${N.hp}, STR ${N.str}`);
check(["quirk", "goal", "virtue", "vice"].every((k) => !!N.traits?.[k]),
  "all four NPC traits are filled", JSON.stringify({ quirk: N.traits?.quirk, goal: N.traits?.goal }));
check(["physique", "skin", "hair", "face", "speech", "clothing"].every((k) => !!N.traits?.[k]),
  "and the six appearance traits too", "");

console.log("\nan NPC's statblock is rolled, not defaulted");
const rolled = R.rolled ?? [];
const inRange = (r) => r.hp >= 1 && r.hp <= 6 && [r.str, r.dex, r.wil].every((v) => v >= 3 && v <= 18);
const tuple = (r) => `${r.str}/${r.dex}/${r.wil}/${r.hp}`;
// Bounds only, and it is NOT the leg that catches a generator writing nothing:
// 10/10/10 and 6 sit inside 3d6 and 1d6, so this passed green against the
// unfixed build (control run, 2026-08-20). It reds a wrong FORMULA — 3d20, a
// flat 1d6 ability — and the distinct-tuple leg below is what reds a constant.
check(rolled.length === 5 && rolled.every(inRange),
  "every statblock inside 3d6 / 1d6 bounds", rolled.map(tuple).join("  "));
check(rolled.length === 5 && rolled.every((r) => r.full),
  "and at full — value equals max on all four", "");
check(new Set(rolled.map(tuple)).size > 1,
  "five NPCs, more than one statblock among them", `${new Set(rolled.map(tuple)).size} distinct`);
// The control. This is what createNpc produced BEFORE the change — nothing
// written, so the schema answers — and every leg above is false of it.
const BARE = R.bare ?? {};
check(BARE.str === 10 && BARE.dex === 10 && BARE.wil === 10 && BARE.hp === 6,
  "control: nothing written still means 10/10/10, 6", tuple({ ...BARE }));

const RB = R.regenBefore ?? {}; const RA = R.regenAfter ?? {};
check(RA.full === true, "a full re-roll heals as it replaces", "value === max");
check(inRange({ str: RA.str, dex: RA.dex, wil: RA.wil, hp: RA.hp }) && tuple(RB) !== tuple(RA),
  "and the numbers it lands on are new ones", `${tuple(RB)} -> ${tuple(RA)}`);

console.log("\nthe Background says what an NPC is carrying");
// The mapping covers the table in BOTH directions. A missing row grants
// nothing silently; a stray key is a word no die can ever produce.
check(same(COV.missing, ["Lord", "Politician"]),
  "only Lord and Politician map to nothing", JSON.stringify(COV.missing));
check(COV.strays?.length === 0, "and the map invents no row the table lacks", JSON.stringify(COV.strays));
check(COV.targetsResolve?.length === 0,
  "every target names a real Barebones background with gear", JSON.stringify(COV.targetsResolve));
// Pinned die, so this is a fact and not a coincidence.
check(RR.background === "Lord", "re-rolled onto Lord with the die pinned", JSON.stringify(RR.background));
check(RR.granted?.length === 0,
  "a Background with no counterpart grants NOTHING", JSON.stringify(RR.granted));
check(same(RR.before, RR.wantBefore) && RR.before?.length > 0,
  "precondition: it was carrying a granting Background's gear",
  `${RR.granting}: ${JSON.stringify(RR.before)}`);
check(RR.before?.length > 0 && RR.granted?.length === 0,
  "and the previous Background's gear went with it", `${JSON.stringify(RR.before)} -> []`);
check(RR.handKept === true,
  "while the Warden's own item survives — grantSource is the whole difference", "");
check(RR.kitKept?.length === 3,
  "and so does the kit — a new trade does not unpack the bag", JSON.stringify(RR.kitKept));
const IN = R.instruction ?? {};
check(!!IN.row && IN.background === IN.row,
  "pinned onto a Background whose gear names an INSTRUCTION", `${IN.row}: ${JSON.stringify(IN.declared)}`);
check(IN.granted?.length === IN.declared?.length,
  "the instruction row resolved to a real item, not nothing",
  `${IN.declared?.length} declared -> ${JSON.stringify(IN.granted)}`);
const RG = R.regen ?? {};
check(RG.before === 3 && RG.after === 3 && RG.shared === 0,
  "a WHOLE re-roll replaces the kit too, by id",
  `${RG.before} -> ${RG.after}, ${RG.shared} shared`);
check(RG.handKept === true, "and still keeps the Warden's own item", "");

console.log("\na hireling is somebody the party pays");
check(H.role === "hireling", "role hireling", JSON.stringify(H.role));
check((R.careerNames ?? []).includes(H.profession),
  "Career comes off the 2e careers catalogue", JSON.stringify(H.profession));
check(H.dayRate > 0 && H.showDayRate === true, "a day rate, and the row that shows it", `${H.dayRate}`);
check(H.items > 0, "arrives with the career's loadout", `${H.items} item(s)`);
check(H.background === "", "and NO Background — that is the other role's field", JSON.stringify(H.background));
check(!H.traits?.quirk && !H.traits?.goal, "no Quirk or Goal — those are the NPC's", "");
check(N.isNpcPerson === true && H.isNpcPerson === true,
  "both are PEOPLE — isNpcPerson covers the pair", "");

console.log("\none row, two names");
// The user's ask, in the same breath as the split: "NPCs do not need the For
// Hire or Day Rate fields." The rate was gated on the role from the start; the
// CHECKBOX was not — it read isNpcPerson, which was the same set as "hireling"
// until this change put a second role in it. So the NPC sheet offered a box
// whose only effect is a row the NPC role never shows.
check(NC.dom?.forHire === false && NC.dom?.dayRate === false,
  "an NPC is offered NEITHER For Hire nor a rate", JSON.stringify(NC.dom));
check(HC.dom?.forHire === true && HC.dom?.dayRate === true,
  "a hireling is offered both", JSON.stringify(HC.dom));
check(NC.showBackground && !NC.showCareer, "the NPC sheet shows Background, not Career", "");
check(HC.showCareer && !HC.showBackground, "the hireling sheet shows Career, not Background", "");
check(NC.showBiography && HC.showBiography, "both get the biography block", "");

console.log("\nthe trait pick-lists follow the role");
check(NC.rows?.includes("quirk") && NC.rows?.includes("goal"),
  "the NPC gets Quirk and Goal rows", JSON.stringify(NC.rows));
check(!HC.rows?.includes("quirk") && !HC.rows?.includes("goal"),
  "the hireling gets neither — absent, not blank", JSON.stringify(HC.rows));
check(NC.labels?.includes("Quirk") && NC.labels?.includes("Goal"),
  "and they are LABELLED, not named after their table", JSON.stringify(NC.labels?.slice(-4)));
// The two keys that exist on both sets. Different source table is the whole
// point, and a label compare cannot see it — the OPTIONS can.
const npcVirtue = NC.options?.virtue ?? [];
const pcVirtue = PC.options?.virtue ?? [];
check(npcVirtue.length > 0 && pcVirtue.length > 0 && npcVirtue.join("|") !== pcVirtue.join("|"),
  "Virtue offers a DIFFERENT list to an NPC than to a character",
  `npc[0]=${JSON.stringify(npcVirtue[0])} vs pc[0]=${JSON.stringify(pcVirtue[0])}`);

console.log("\nthe biography sentence changes person");
check(/\bThey\b/.test(NC.sentence) && !/\bYou\b/.test(NC.sentence),
  "an NPC reads THEY", JSON.stringify(NC.sentence?.slice(0, 70)));
check(/\bThey\b/.test(HC.sentence) && !/\bYou\b/.test(HC.sentence),
  "a hireling reads THEY", JSON.stringify(HC.sentence?.slice(0, 70)));
// The control. Without it "everything says They" would pass every leg above.
check(/\bYou\b/.test(PC.sentence) && !/\bThey\b/.test(PC.sentence),
  "a character still reads YOU", JSON.stringify(PC.sentence?.slice(0, 70)));
check(/Quirk is/.test(NC.sentence) && /seek/.test(NC.sentence),
  "and it carries the Quirk and Goal clauses", "");

console.log("\nre-roling a person loses nothing");
const A = R.asHireling ?? {}; const B = R.backToNpc ?? {};
check(A.role === "hireling" && A.background === "PROBE-background" && A.profession === "PROBE-career",
  "NPC -> Hireling keeps BOTH job fields", JSON.stringify(A));
check(A.quirk === "PROBE-quirk" && A.goal === "PROBE-goal",
  "...and the traits the new role does not show", "");
check(B.role === "npc" && B.background === "PROBE-background" && B.dayRate === 7
  && B.quirk === "PROBE-quirk" && B.virtue === "PROBE-virtue" && B.physique === "PROBE-phys",
  "and back again returns everything untouched", JSON.stringify(B));

console.log("\nthe re-roll warning matches what the button does");
const NW = R.npcWarning ?? ""; const HW = R.hireWarning ?? "";
// One string served both roles until 2026-08-20 and it described the hireling:
// it promised an NPC that everything it carried would be deleted and that its
// career and day rate would be replaced. regenerateNpc does neither. A Warden
// cancelling to protect gear that was never at risk was talked out of the
// feature by its own dialog.
//
// `abilities` is asserted because the statblock became rolled the next day and
// the re-roll replaces it: what a warning must list is what the button DOES,
// so the string and the behaviour have to move together or this leg reds.
check(/Background/.test(NW) && /abilities/i.test(NW) && !/deleted/i.test(NW),
  "an NPC is told what actually changes", JSON.stringify(NW.slice(0, 100)));
check(/deleted/i.test(HW) && /day rate/i.test(HW),
  "a hireling is still warned about its gear", JSON.stringify(HW.slice(0, 100)));
// The control for a future single-string regression: both legs above pass if
// the two roles share a warning that happens to mention Background.
check(NW !== "" && NW !== HW, "the two roles get DIFFERENT warnings", "");

console.log("\nnothing that is not a person gets a biography");
for (const role of ["monster", "companion", "transport", "container"]) {
  const g = R.gate?.[role] ?? {};
  check(!g.bio && !g.career && !g.background, `absent on a ${role}`, JSON.stringify(g));
}

console.log("\nrestored");
check(sweep.left === 0, "every actor this run made is gone",
  `deleted ${sweep.deleted.length}: ${sweep.deleted.join(", ")}`);

if (R.errors?.length) { failures += R.errors.length; console.log("\nIn-page errors:\n  " + R.errors.join("\n  ")); }
if (errors.length) { failures++; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(failures === 0 ? "\nnpc split e2e passed" : `\nnpc split e2e FAILED — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
