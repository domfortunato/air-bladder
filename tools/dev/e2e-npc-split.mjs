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
      await s.close();
      return {
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
check(N.items === 0, "arrives with an EMPTY inventory", `${N.items} item(s)`);
// Not pinned to 10 — inherited from the Warden's max-equip-slots setting, whose
// default is 10. Asserting the number would freeze a setting the Warden owns.
check(N.slotsMax === 10, "ten slots, from the Warden's own setting", `${N.slotsMax}`);
check(N.hp === 6 && N.str === 10, "schema-default statblock — nothing invented", `HP ${N.hp}, STR ${N.str}`);
check(["quirk", "goal", "virtue", "vice"].every((k) => !!N.traits?.[k]),
  "all four NPC traits are filled", JSON.stringify({ quirk: N.traits?.quirk, goal: N.traits?.goal }));
check(["physique", "skin", "hair", "face", "speech", "clothing"].every((k) => !!N.traits?.[k]),
  "and the six appearance traits too", "");

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
// statblock, career and day rate would be replaced. regenerateNpc does none of
// those. A Warden cancelling to protect gear that was never at risk was talked
// out of the feature by its own dialog.
check(/Background/.test(NW) && !/deleted/i.test(NW),
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
