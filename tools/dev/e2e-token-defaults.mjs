#!/usr/bin/env node
/**
 * Token defaults by actor kind: who arrives linked, and with which ring.
 *
 * Three answers, not two, since the hireling-role collapse (2026-08-01):
 *
 *   - **character** — FRIENDLY and linked. A PC is the party.
 *   - **npc person** (role `npc`, stated or defaulted) — NEUTRAL and linked.
 *     Linked because HP edited on the token must reach the sheet; NEUTRAL
 *     because role npc is now every person in the world who is not a monster —
 *     an innkeeper, a captain, a rival — and a green ring on all of them is a
 *     claim the system has no business making. It was FRIENDLY when this branch
 *     could only ever catch a hireling, i.e. someone already hired.
 *   - **monster** — Foundry's own: HOSTILE and unlinked.
 *
 * This exists because the Hireling->NPC fold broke it silently. The old test was
 * `type === "hireling"`, which stopped matching anything the generator produces
 * (`hirelingToActorData` emits `npc`), so generated hirelings fell through to
 * Foundry's schema defaults. Nothing threw, nothing logged, and the sheet looked
 * correct — the damage only shows on the canvas, and then only as a red ring and
 * HP that will not stick.
 *
 * **A role-less npc is now a PERSON**, which is the one deliberate reversal here.
 * The branch used to exclude it on the grounds that "a hand-made npc is as often
 * a monster as a person", and the danger it named was real: widening to plain
 * `npc` would turn all 205 shipped monsters friendly and linked. It is safe now
 * because every one of them — all 220 npc-typed pack documents, checked, and
 * every programmatic creation in `module/` — states its role outright. So the
 * monster case below states `role: "monster"`, which is what a monster IS; a
 * document that says nothing came from the Create Actor dialog and is somebody.
 *
 * Most cases create through **`CONFIG.Actor.documentClass`** — the class users
 * reach. One case deliberately uses the global `Actor` instead: the defaults
 * now live in `_preCreate`, which EVERY creation route hits (createDocuments
 * resolves `this.implementation`), and the global-Actor case stands in for the
 * routes that never call a static override by name — compendium importAll and
 * Adventure import. When the defaults lived in `static create`, those routes
 * skipped them silently; that case is the one that goes red if anyone moves
 * the defaults back.
 *
 * Usage: npm run dev:token-defaults
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "token defaults probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const out = await page.evaluate(async () => {
  const res = { cases: [] };
  for (const s of game.actors.filter((a) => a.name?.startsWith("ZZ Tok"))) await s.delete();

  const Cls = CONFIG.Actor.documentClass;
  const D = CONST.TOKEN_DISPOSITIONS;
  // `want` is the disposition NAME, so a failure line reads as the rule rather
  // than as two integers.
  const snap = (a, label, want, wantLink) => {
    const pt = a.prototypeToken;
    res.cases.push({
      label,
      type: a.type,
      role: a.system?.role ?? null,
      disposition: pt.disposition,
      got: Object.keys(D).find((k) => D[k] === pt.disposition) ?? String(pt.disposition),
      want,
      actorLink: pt.actorLink,
      wantLink,
    });
    return a;
  };

  // The real path a Warden takes: the Actor Directory's "Generate NPC" button.
  const gen = await game.cairn.characterGenerator.createHireling();
  await gen.update({ name: "ZZ Tok Generated NPC" });
  snap(gen, "generated npc (createHireling)", "NEUTRAL", true);

  // A monster: same type, role stated. The specificity control — if this comes
  // out neutral and linked the branch is too wide and every shipped monster is
  // affected.
  const mon = await Cls.create({ name: "ZZ Tok Monster", type: "npc", system: { role: "monster" } });
  snap(mon, "npc role monster", "HOSTILE", false);

  // A hand-made npc that states NOTHING: the Create Actor dialog's shape. Role
  // takes the schema initial `npc`, so this is a person.
  const bare = await Cls.create({ name: "ZZ Tok Bare NPC", type: "npc" });
  snap(bare, "hand-made npc, no role stated", "NEUTRAL", true);

  // The legacy alias, as pre-fold worlds still hold.
  const legacy = await Cls.create({ name: "ZZ Tok Legacy Hireling", type: "hireling" });
  snap(legacy, "legacy `hireling` type", "NEUTRAL", true);

  // An npc created with the RETIRED role value, which is what a stale macro, an
  // old export or a third-party module would still send. migrateData converts it
  // on the way in, so it must arrive as a person — role npc, for hire — rather
  // than failing the shrunk enum.
  const retired = await Cls.create({ name: "ZZ Tok Retired Role", type: "npc", system: { role: "hireling" } });
  snap(retired, "npc created with the retired role hireling", "NEUTRAL", true);
  res.retiredConverted = { role: retired.system.role, forHire: retired.system.forHire };

  // Positive control: if this is not friendly+linked the branch is dead entirely
  // and every assertion above would be meaningless.
  const pc = await Cls.create({ name: "ZZ Tok Character", type: "character" });
  snap(pc, "character (positive control)", "FRIENDLY", true);

  // An explicit disposition must still win -- `_preCreate` only fills fields the
  // creation data leaves unstated, so a caller (or a pack import) that states
  // one keeps it.
  const explicit = await Cls.create({
    name: "ZZ Tok Explicit", type: "hireling",
    prototypeToken: { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE },
  });
  res.explicitKept = explicit.prototypeToken.disposition === D.HOSTILE;

  // The bulk-import shape: the GLOBAL `Actor`, which is NOT this system's class.
  // importAll and an Adventure import route the same way -- createDocuments ->
  // implementation -> _preCreate -- and never call a `static create` override,
  // which is where these defaults used to live and why they were skipped on
  // exactly the paths that create the most documents at once.
  const viaGlobal = await Actor.create({ name: "ZZ Tok Global Hireling", type: "hireling" });
  snap(viaGlobal, "hireling via the global Actor (the importAll shape)", "NEUTRAL", true);

  // Negative control: reassign `_preCreate` to the base class's and prove the
  // defaults DISAPPEAR. If this still comes out neutral and linked, something
  // other than the override is supplying the defaults and every green above is
  // meaningless. Restored in the finally so a throw cannot leave the swap in.
  const proto = Cls.prototype;
  const origPreCreate = proto._preCreate;
  let off = null;
  try {
    proto._preCreate = Object.getPrototypeOf(proto)._preCreate;
    off = await Cls.create({ name: "ZZ Tok Control", type: "hireling" });
    res.control = {
      disposition: off.prototypeToken.disposition,
      actorLink: off.prototypeToken.actorLink,
    };
  } finally {
    proto._preCreate = origPreCreate;
  }
  if (off) await off.delete();

  // The user-visible end of it: a real token placed on a real scene.
  const scene = game.scenes.current ?? game.scenes.contents[0];
  if (scene) {
    const [td] = await scene.createEmbeddedDocuments("Token", [
      { ...gen.prototypeToken.toObject(), actorId: gen.id, x: 140, y: 140 },
    ]);
    res.placed = td ? { disposition: td.disposition, actorLink: td.actorLink } : null;
    if (td) await scene.deleteEmbeddedDocuments("Token", [td.id]);
  } else res.placedSkipped = "no scene in this world";

  // ---- promoted LATER, not at creation ---------------------------------------
  // Role is a pick-list on the NPC sheet, so turning a monster-shaped npc into
  // somebody the party can deal with never goes near _preCreate. Nothing
  // re-applied the defaults, so the actor kept Foundry's own -- hostile,
  // unlinked -- and HP typed on its token never reached the sheet. Observed
  // 2026-07-30 on the hireling edge; the same bug, one role rename later.
  const late = await Cls.create({ name: "ZZ Tok Promoted Later", type: "npc", system: { role: "monster" } });
  res.lateBefore = {
    hostile: late.prototypeToken.disposition === D.HOSTILE,
    actorLink: late.prototypeToken.actorLink,
  };
  await late.update({ "system.role": "npc" });
  res.lateAfter = {
    neutral: late.prototypeToken.disposition === D.NEUTRAL,
    actorLink: late.prototypeToken.actorLink,
  };

  // ...but only from Foundry's HOSTILE default. A Warden who deliberately made
  // this creature friendly keeps that -- the same "an explicit value wins" rule
  // _preCreate follows, applied to a value chosen earlier rather than passed in
  // the same breath. FRIENDLY, deliberately, because NEUTRAL is now what the
  // automatic path produces and asserting it survives would prove nothing.
  const chosen = await Cls.create({
    name: "ZZ Tok Promoted Friendly", type: "npc",
    system: { role: "monster" }, prototypeToken: { disposition: D.FRIENDLY },
  });
  await chosen.update({ "system.role": "npc" });
  res.deliberateKept = chosen.prototypeToken.disposition === D.FRIENDLY;

  // And leaving the role is not the mirror image: ceasing to be a person is no
  // reason to turn someone hostile.
  await late.update({ "system.role": "monster" });
  res.demotedStaysNeutral = late.prototypeToken.disposition === D.NEUTRAL;

  for (const a of [gen, mon, bare, legacy, retired, pc, explicit, viaGlobal, late, chosen]) await a.delete();
  return res;
});

console.log("\ntoken defaults by kind");
for (const c of out.cases) {
  const good = c.got === c.want && c.actorLink === c.wantLink;
  const shape = `${c.got}, actorLink ${c.actorLink}`;
  if (good) ok(`${c.label} — ${shape}`);
  else if (c.want === "HOSTILE") {
    fail(`${c.label} — should stay hostile and unlinked, got ${shape}. `
      + "The branch is too wide: every shipped monster is affected");
  } else {
    fail(`${c.label} — should be ${c.want} and linked ${c.wantLink}, got ${shape}`
      + ` [type ${c.type}, role ${c.role}]`);
  }
}

if (out.retiredConverted?.role === "npc" && out.retiredConverted?.forHire === true) {
  ok("the retired role converts on the way in — npc, for hire (migrateData, not the enum)");
} else {
  fail(`a creation stating role "hireling" stored ${JSON.stringify(out.retiredConverted)} — `
    + "the collapse shim is not running, and the shrunk enum has nothing else protecting it");
}

if (out.explicitKept) ok("an explicitly-stated disposition still wins (_preCreate fills only unstated fields)");
else fail("an explicitly-stated disposition was overwritten — pack imports would lose theirs");

if (out.control && out.control.disposition === -1 && !out.control.actorLink) {
  ok("with _preCreate swapped to the base class's, the defaults vanish — the override is load-bearing");
} else {
  fail(`negative control: defaults survived a disabled _preCreate (${JSON.stringify(out.control)}) — `
    + "the assertions above cannot fail and prove nothing");
}

console.log("\npromoted after creation (the role pick, not the generator)");
// The precondition, stated: if a monster were already neutral and linked the
// assertion below would pass without anything re-applying anything.
if (out.lateBefore?.hostile && out.lateBefore?.actorLink === false) {
  ok("a monster starts hostile and unlinked, as Foundry makes it");
} else {
  fail(`a monster started ${JSON.stringify(out.lateBefore)} — it is already neutral, `
    + "so the assertion below proves nothing");
}
if (out.lateAfter?.neutral && out.lateAfter?.actorLink === true) {
  ok("picking the NPC role re-applies neutral + linked");
} else {
  fail(`picking NPC left the prototype ${JSON.stringify(out.lateAfter)} — its token arrives `
    + "red-ringed and unlinked, so HP edited on the token never reaches the sheet");
}
if (out.deliberateKept) ok("a deliberately-chosen disposition survives the promotion (FRIENDLY kept)");
else fail("the promotion overwrote a disposition the Warden had chosen on purpose");
if (out.demotedStaysNeutral) ok("leaving the npc role does not turn them hostile again");
else fail("leaving the npc role made them hostile — that is not the mirror image");

if (out.placedSkipped) console.log(`  note  placed-token check skipped: ${out.placedSkipped}`);
else if (out.placed?.disposition === 0 && out.placed?.actorLink === true) {
  ok("a token placed from a generated npc really is neutral and linked");
} else {
  fail(`a placed token came out ${JSON.stringify(out.placed)} — the prototype is right `
    + "but the placed token is not, which is the half a user actually sees");
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "TOKEN DEFAULTS PROBE FAILED" : "Token defaults probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);
