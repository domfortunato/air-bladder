#!/usr/bin/env node
/**
 * Token defaults by actor kind: who arrives friendly and linked, and who does not.
 *
 * A hireling is a player-facing helper, so its token should behave like a
 * character's — friendly ring, and `actorLink` so HP edited on the token reaches
 * the sheet. A monster must be the opposite, and the Hireling->NPC fold made both
 * of them `type: "npc"`, so the two cases are one keystroke apart in
 * `CairnActor.create`. The discriminator is `system.role` (formerly `forHire`).
 *
 * This exists because the fold broke it silently. The old test was
 * `type === "hireling"`, which stopped matching anything the generator produces
 * (`hirelingToActorData` emits `npc`), so generated hirelings fell through to
 * Foundry's schema defaults: `actorLink` false, `disposition` HOSTILE. Nothing
 * threw, nothing logged, and the sheet looked correct — the damage only shows on
 * the canvas, and then only as a red ring and HP that will not stick.
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
 * The monster case is the one that matters most. Widening the branch to plain
 * `npc` fixes the hireling and quietly turns all 205 shipped monsters friendly and
 * linked — a bug with no error and no obvious symptom until a Warden drags a wolf
 * onto a scene and it does not threaten anyone.
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
  const snap = (a, label, wantFriendly) => {
    const pt = a.prototypeToken;
    res.cases.push({
      label,
      type: a.type,
      role: a.system?.role ?? null,
      disposition: pt.disposition,
      friendly: pt.disposition === D.FRIENDLY,
      hostile: pt.disposition === D.HOSTILE,
      actorLink: pt.actorLink,
      wantFriendly,
    });
    return a;
  };

  // The real path a Warden takes: the Actor Directory's "Generate NPC" button.
  const gen = await game.cairn.characterGenerator.createHireling();
  await gen.update({ name: "ZZ Tok Generated Hireling" });
  snap(gen, "generated hireling (createHireling)", true);

  // A monster: same type, default role. The specificity control.
  const mon = await Cls.create({ name: "ZZ Tok Monster", type: "npc" });
  snap(mon, "hand-made npc / monster", false);

  // The legacy alias, as pre-fold worlds still hold.
  const legacy = await Cls.create({ name: "ZZ Tok Legacy Hireling", type: "hireling" });
  snap(legacy, "legacy `hireling` type", true);

  // An npc explicitly given the hireling role at creation.
  const forHire = await Cls.create({ name: "ZZ Tok ForHire NPC", type: "npc", system: { role: "hireling" } });
  snap(forHire, "npc created role hireling", true);

  // Positive control: if this is not friendly+linked the branch is dead entirely
  // and every "friendly" assertion above would be meaningless.
  const pc = await Cls.create({ name: "ZZ Tok Character", type: "character" });
  snap(pc, "character (positive control)", true);

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
  snap(viaGlobal, "hireling via the global Actor (the importAll shape)", true);

  // Negative control: reassign `_preCreate` to the base class's and prove the
  // defaults DISAPPEAR. If this still comes out friendly and linked, something
  // other than the override is supplying the defaults and every green above is
  // meaningless. Restored in the finally so a throw cannot leave the swap in.
  const proto = Cls.prototype;
  const origPreCreate = proto._preCreate;
  let off = null;
  try {
    proto._preCreate = Object.getPrototypeOf(proto)._preCreate;
    off = await Cls.create({ name: "ZZ Tok Control", type: "hireling" });
    res.control = {
      friendly: off.prototypeToken.disposition === D.FRIENDLY,
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

  // ---- hired LATER, not at creation ------------------------------------------
  // Role is a pick-list on the NPC sheet, so the natural way to take an existing
  // npc into the party's employ never goes near _preCreate. Nothing re-applied the
  // defaults, so the actor kept Foundry's own -- hostile, unlinked -- and HP typed
  // on its token never reached the sheet. Observed 2026-07-30; this is the same
  // bug b3eefa6 fixed for GENERATED hirelings, by the other route.
  const late = await Cls.create({ name: "ZZ Tok Hired Later", type: "npc" });
  res.lateBefore = {
    hostile: late.prototypeToken.disposition === D.HOSTILE,
    actorLink: late.prototypeToken.actorLink,
  };
  await late.update({ "system.role": "hireling" });
  res.lateAfter = {
    friendly: late.prototypeToken.disposition === D.FRIENDLY,
    actorLink: late.prototypeToken.actorLink,
  };

  // ...but only from Foundry's defaults. A Warden who deliberately made a hireling
  // NEUTRAL keeps it -- the same "an explicit value wins" rule _preCreate follows,
  // applied to a value chosen earlier rather than passed in the same breath.
  const chosen = await Cls.create({
    name: "ZZ Tok Hired Later Neutral", type: "npc",
    prototypeToken: { disposition: D.NEUTRAL },
  });
  await chosen.update({ "system.role": "hireling" });
  res.deliberateKept = chosen.prototypeToken.disposition === D.NEUTRAL;

  // And leaving the role is not the mirror image: ceasing to be for hire is no
  // reason to turn someone hostile.
  await late.update({ "system.role": "npc" });
  res.unhiredStaysFriendly = late.prototypeToken.disposition === D.FRIENDLY;

  for (const a of [gen, mon, legacy, forHire, pc, explicit, viaGlobal, late, chosen]) await a.delete();
  return res;
});

console.log("\ntoken defaults by kind");
for (const c of out.cases) {
  const wantLink = c.wantFriendly;
  const good = c.friendly === c.wantFriendly && c.actorLink === wantLink;
  const shape = `disposition ${c.disposition}, actorLink ${c.actorLink}`;
  if (good && c.wantFriendly) ok(`${c.label} — friendly and linked (${shape})`);
  else if (good) ok(`${c.label} — hostile and unlinked, as a monster must be (${shape})`);
  else if (c.wantFriendly) {
    fail(`${c.label} — should be friendly and linked, got ${shape}`
      + ` [type ${c.type}, role ${c.role}]`);
  } else {
    fail(`${c.label} — should stay hostile and unlinked, got ${shape}. `
      + "The branch is too wide: every shipped monster is affected");
  }
}

if (out.explicitKept) ok("an explicitly-stated disposition still wins (_preCreate fills only unstated fields)");
else fail("an explicitly-stated disposition was overwritten — pack imports would lose theirs");

if (out.control && !out.control.friendly && !out.control.actorLink) {
  ok("with _preCreate swapped to the base class's, the defaults vanish — the override is load-bearing");
} else {
  fail(`negative control: defaults survived a disabled _preCreate (${JSON.stringify(out.control)}) — `
    + "the assertions above cannot fail and prove nothing");
}

console.log("\nhired after creation (the role pick, not the generator)");
// The precondition, stated: if a plain npc were already friendly and linked the
// assertion below would pass without anything re-applying anything.
if (out.lateBefore?.hostile && out.lateBefore?.actorLink === false) {
  ok("a plain npc starts hostile and unlinked, as Foundry makes it");
} else {
  fail(`a plain npc started ${JSON.stringify(out.lateBefore)} — it is already friendly, `
    + "so the assertion below proves nothing");
}
if (out.lateAfter?.friendly && out.lateAfter?.actorLink === true) {
  ok("picking the Hireling role re-applies friendly + linked");
} else {
  fail(`picking Hireling left the prototype ${JSON.stringify(out.lateAfter)} — its token arrives `
    + "red-ringed and unlinked, so HP edited on the token never reaches the sheet");
}
if (out.deliberateKept) ok("a deliberately-chosen disposition survives being hired (NEUTRAL kept)");
else fail("hiring overwrote a disposition the Warden had chosen on purpose");
if (out.unhiredStaysFriendly) ok("leaving the hireling role does not turn them hostile again");
else fail("leaving the hireling role made them hostile — that is not the mirror image of hiring");

if (out.placedSkipped) console.log(`  note  placed-token check skipped: ${out.placedSkipped}`);
else if (out.placed?.disposition === 1 && out.placed?.actorLink === true) {
  ok("a token placed from a generated hireling really is friendly and linked");
} else {
  fail(`a placed token came out ${JSON.stringify(out.placed)} — the prototype is right `
    + "but the placed token is not, which is the half a user actually sees");
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "TOKEN DEFAULTS PROBE FAILED" : "Token defaults probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);
