#!/usr/bin/env node
/**
 * Token defaults by actor kind: who arrives friendly and linked, and who does not.
 *
 * A hireling is a player-facing helper, so its token should behave like a
 * character's — friendly ring, and `actorLink` so HP edited on the token reaches
 * the sheet. A monster must be the opposite, and the Hireling->NPC fold made both
 * of them `type: "npc"`, so the two cases are one keystroke apart in
 * `CairnActor.create`. The discriminator is `system.forHire`.
 *
 * This exists because the fold broke it silently. The old test was
 * `type === "hireling"`, which stopped matching anything the generator produces
 * (`hirelingToActorData` emits `npc`), so generated hirelings fell through to
 * Foundry's schema defaults: `actorLink` false, `disposition` HOSTILE. Nothing
 * threw, nothing logged, and the sheet looked correct — the damage only shows on
 * the canvas, and then only as a red ring and HP that will not stick.
 *
 * Every case creates through **`CONFIG.Actor.documentClass`**, never the global
 * `Actor`. They are not the same class: the global skips this system's `static
 * create` override entirely, so a probe using it would exercise a path no user
 * takes and pass no matter what the override said.
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
      forHire: a.system?.forHire ?? null,
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

  // A monster: same type, no forHire. The specificity control.
  const mon = await Cls.create({ name: "ZZ Tok Monster", type: "npc" });
  snap(mon, "hand-made npc / monster", false);

  // The legacy alias, as pre-fold worlds still hold.
  const legacy = await Cls.create({ name: "ZZ Tok Legacy Hireling", type: "hireling" });
  snap(legacy, "legacy `hireling` type", true);

  // An npc explicitly marked for hire at creation.
  const forHire = await Cls.create({ name: "ZZ Tok ForHire NPC", type: "npc", system: { forHire: true } });
  snap(forHire, "npc created with forHire", true);

  // Positive control: if this is not friendly+linked the branch is dead entirely
  // and every "friendly" assertion above would be meaningless.
  const pc = await Cls.create({ name: "ZZ Tok Character", type: "character" });
  snap(pc, "character (positive control)", true);

  // An explicit disposition must still win -- the merge is overwrite:false, so a
  // caller (or a pack import) that states one keeps it.
  const explicit = await Cls.create({
    name: "ZZ Tok Explicit", type: "hireling",
    prototypeToken: { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE },
  });
  res.explicitKept = explicit.prototypeToken.disposition === D.HOSTILE;

  // The user-visible end of it: a real token placed on a real scene.
  const scene = game.scenes.current ?? game.scenes.contents[0];
  if (scene) {
    const [td] = await scene.createEmbeddedDocuments("Token", [
      { ...gen.prototypeToken.toObject(), actorId: gen.id, x: 140, y: 140 },
    ]);
    res.placed = td ? { disposition: td.disposition, actorLink: td.actorLink } : null;
    if (td) await scene.deleteEmbeddedDocuments("Token", [td.id]);
  } else res.placedSkipped = "no scene in this world";

  for (const a of [gen, mon, legacy, forHire, pc, explicit]) await a.delete();
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
      + ` [type ${c.type}, forHire ${c.forHire}]`);
  } else {
    fail(`${c.label} — should stay hostile and unlinked, got ${shape}. `
      + "The branch is too wide: every shipped monster is affected");
  }
}

if (out.explicitKept) ok("an explicitly-stated disposition still wins (merge is overwrite:false)");
else fail("an explicitly-stated disposition was overwritten — pack imports would lose theirs");

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
