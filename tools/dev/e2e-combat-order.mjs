/**
 * Cairn's turn order in Foundry's tracker.
 *
 * Cairn has no initiative queue: each party member makes a DEX save at the
 * start of combat — pass acts before the enemies, fail acts after — and order
 * inside a bucket is table talk. The buckets are stored as initiative
 * 1 / 0 / −1 (core's descending sort orders them by itself), the save posts an
 * HONEST card ("DEX save 8 vs 13: acts before the enemies"), and the tracker
 * prints words and section dividers where core prints a numeric input.
 *
 * THE SAVE IS DETERMINISTIC WITHOUT STUBBING A DIE: DEX 20 cannot fail a d20
 * save and DEX 0 cannot pass one, so every bucket is forced by fixture — no
 * dice-decided assertion (the 0.1.12 lesson).
 *
 * The dev world has NO actors; every fixture is created here and removed.
 * Needs `npm run dev:players` (Alice) for the unowned-skip leg.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAs, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(38)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(38)} ${d}`); failures++; };
const check = (l, cond, d = "") => (cond ? ok(l, d) : fail(l, d));

watchdog(420000, "combat-order");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await page.goto(FOUNDRY_URL);
await joinAsGM(page);
await dismissChrome(page);

/* ---------------------------------------------------------------------------
 * 1. The roll: buckets, save cards, and ONE batched write.
 *
 * Fixtures force every bucket: DEX 20 cannot fail, DEX 0 cannot pass, a
 * hostile never rolls. The neutral-token PC is the leg for "a disguised PC is
 * still a PC" — the old code read disposition alone and sent her to the enemy
 * slot. The write count is taken by wrapping the combat's own
 * updateEmbeddedDocuments and Combatant#update: the old super-then-patch shape
 * was one batch plus N awaited per-combatant updates.
 * ------------------------------------------------------------------------- */
console.log("\nthe DEX save decides the bucket");
const roll = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};

  const scene = await Scene.create({ name: "ZZ Combat Scene", width: 1400, height: 1000 });
  await scene.view();
  await sleep(400);

  const alice = game.users.find((u) => u.name === "Alice");
  r.hasAlice = !!alice;

  const mk = async (name, type, system, { disposition = 1, ownership = null } = {}, x) => {
    const a = await ActorImpl.create({
      name, type, system,
      ...(ownership ? { ownership } : {}),
      prototypeToken: { disposition },
    });
    const [t] = await scene.createEmbeddedDocuments("Token", [await a.getTokenDocument({ x, y: 100 })]);
    return { a, t };
  };
  const DEX = (v) => ({ abilities: { DEX: { value: v, max: Math.max(v, 1) } } });
  const pass = await mk("ZZ Init Pass", "character", DEX(20), {}, 100);
  const failC = await mk("ZZ Init Fail", "character", DEX(0), {}, 250);
  // The disguised PC: NEUTRAL token, still a character, still saves.
  const neutral = await mk("ZZ Init Neutral", "character", DEX(20), { disposition: 0 }, 400);
  const hostile = await mk("ZZ Init Foe", "npc", { role: "monster", hp: { value: 6, max: 6 } }, { disposition: -1 }, 550);
  const hidden = await mk("ZZ Init Hidden", "character", DEX(20), {}, 700);
  // Two UNROLLED: one Alice's (she rolls it herself in section 3), one only
  // the Warden's (the id Alice passes and must be SKIPPED, not coerced).
  const mine = await mk("ZZ Init Mine", "character", DEX(20),
    { ownership: alice ? { default: 0, [alice.id]: 3 } : null }, 850);
  const unrolled = await mk("ZZ Init Unrolled", "character", DEX(20), {}, 1000);

  const combat = await Combat.create({ scene: scene.id });
  await combat.activate();
  const specs = [pass, failC, neutral, hostile, hidden, mine, unrolled].map((v) => ({
    actorId: v.a.id, tokenId: v.t.id, sceneId: scene.id,
  }));
  specs[4].hidden = true; // ZZ Init Hidden
  const combatants = await combat.createEmbeddedDocuments("Combatant", specs);
  const byName = (n) => combatants.find((c) => c.actorId === game.actors.getName(n)?.id);

  // Count the WRITES while rolling everyone except the two unrolled.
  let batches = 0;
  let perDoc = 0;
  const origUED = combat.updateEmbeddedDocuments.bind(combat);
  combat.updateEmbeddedDocuments = (...a) => { batches++; return origUED(...a); };
  const CombatantCls = CONFIG.Combatant?.documentClass ?? Combatant;
  const origUpdate = CombatantCls.prototype.update;
  CombatantCls.prototype.update = function (...a) { perDoc++; return origUpdate.apply(this, a); };
  const before = new Set(game.messages.contents.map((m) => m.id));
  try {
    await combat.rollInitiative([
      byName("ZZ Init Pass"), byName("ZZ Init Fail"), byName("ZZ Init Neutral"),
      byName("ZZ Init Foe"), byName("ZZ Init Hidden"),
    ].map((c) => c.id));
  } finally {
    CombatantCls.prototype.update = origUpdate;
    delete combat.updateEmbeddedDocuments; // the own property; the prototype returns
  }
  r.batches = batches;
  r.perDoc = perDoc;

  // NOT `?? "missing"` — the ?? swallows exactly the null this probe observes.
  const init = (n) => { const c = byName(n); return c ? c.initiative : "missing"; };
  r.pass = init("ZZ Init Pass");
  r.fail = init("ZZ Init Fail");
  r.neutral = init("ZZ Init Neutral");
  r.foe = init("ZZ Init Foe");
  r.hidden = init("ZZ Init Hidden");
  r.mine = init("ZZ Init Mine");
  r.unrolled = init("ZZ Init Unrolled");

  const fresh = game.messages.contents.filter((m) => !before.has(m.id));
  r.cards = fresh.length;
  const flavorOf = (n) => fresh.find((m) => m.speaker?.alias === n)?.flavor ?? "";
  r.passFlavor = flavorOf("ZZ Init Pass");
  r.failFlavor = flavorOf("ZZ Init Fail");
  r.foeCard = fresh.some((m) => m.speaker?.alias === "ZZ Init Foe");
  const hiddenMsg = fresh.find((m) => m.speaker?.alias === "ZZ Init Hidden");
  r.hiddenWhisper = (hiddenMsg?.whisper ?? []).length > 0;
  r.passWhisper = (fresh.find((m) => m.speaker?.alias === "ZZ Init Pass")?.whisper ?? []).length;

  // The ORDER: every 1 before the 0, the 0 before every −1, nulls LAST.
  const posOf = (n) => combat.turns.findIndex((c) => c.name === n);
  r.order = ["ZZ Init Pass", "ZZ Init Neutral", "ZZ Init Hidden", "ZZ Init Foe",
    "ZZ Init Fail", "ZZ Init Mine", "ZZ Init Unrolled"].map((n) => posOf(n));
  r.bucketSorted = [r.order[0], r.order[1], r.order[2]].every((i) => i < r.order[3])
    && r.order[3] < r.order[4]
    && [r.order[5], r.order[6]].every((i) => i > r.order[4]);

  r.ids = {
    sceneId: scene.id, combatId: combat.id,
    actorIds: [pass, failC, neutral, hostile, hidden, mine, unrolled].map((v) => v.a.id),
    msgIds: fresh.map((m) => m.id),
  };
  return r;
});

check("DEX 20 passes: acts first", roll.pass === 1, `initiative=${roll.pass}`);
check("DEX 0 fails: acts last", roll.fail === -1, `initiative=${roll.fail}`);
check("a NEUTRAL-token PC still saves", roll.neutral === 1,
  `initiative=${roll.neutral} — a disguised PC is still a PC; disposition alone sent her to the enemy slot`);
check("the enemy takes the middle, no roll, no card", roll.foe === 0 && !roll.foeCard,
  `initiative=${roll.foe} card=${roll.foeCard} — the enemies don't save, and a card for a non-roll is noise`);
check("the save card is an honest save", /DEX save \d+ vs 20/.test(roll.passFlavor)
  && /before the enemies/.test(roll.passFlavor) && /after the enemies/.test(roll.failFlavor),
  `"${roll.passFlavor}" / "${roll.failFlavor}" — not "rolls for Initiative — 14"`);
check("a hidden combatant's card is whispered", roll.hidden === 1 && roll.hiddenWhisper
  && roll.passWhisper === 0,
  `hidden whisper=${roll.hiddenWhisper}, visible whisper count=${roll.passWhisper}`);
check("ONE batched write, zero per-combatant", roll.batches === 1 && roll.perDoc === 0,
  `updateEmbeddedDocuments=${roll.batches} Combatant#update=${roll.perDoc} — the old shape was 1 + N, each re-running setupTurns`);
check("four cards for four savers", roll.cards === 4, `${roll.cards}`);
check("turns read bucket-sorted, unrolled LAST", roll.bucketSorted
  && roll.mine === null && roll.unrolled === null,
  `positions=${JSON.stringify(roll.order)} mine=${roll.mine} unrolled=${roll.unrolled} — null sorts -Infinity, visibly unrolled rather than quietly passed`);

/* ---------------------------------------------------------------------------
 * 2. The tracker prints words, dividers, and a roll button — never numbers.
 * ------------------------------------------------------------------------- */
console.log("\nthe tracker speaks Cairn");
const dom = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  r.trackerClass = ui.combat.constructor.name;
  ui.sidebar.expand();
  ui.sidebar.changeTab("combat", "primary");
  await ui.combat.render({ force: true });
  await sleep(600);
  const root = document.querySelector("#combat");
  r.dividers = [...(root?.querySelectorAll(".cairn-bucket-divider") ?? [])].map((el) => el.textContent.trim());
  r.words = [...(root?.querySelectorAll(".cairn-bucket-word") ?? [])].map((el) => el.textContent.trim());
  r.numericInputs = root?.querySelectorAll("input.initiative-input").length ?? -1;
  r.rollButtons = root?.querySelectorAll('button[data-action="rollInitiative"]').length ?? -1;
  // The whole list in DOCUMENT order — dividers and rows interleaved — because
  // two separate NodeLists can each look right while the interleaving is wrong.
  r.sequence = [...(root?.querySelectorAll(".cairn-bucket-divider, li.combatant") ?? [])].map((el) =>
    el.classList.contains("cairn-bucket-divider")
      ? `# ${el.textContent.trim()}`
      : `${el.querySelector(".name")?.textContent.trim()}: ${el.querySelector(".cairn-bucket-word")?.textContent.trim()
        ?? (el.querySelector('button[data-action="rollInitiative"]') ? "(roll)" : "(nothing)")}`);
  return r;
});

check("our tracker is registered", dom.trackerClass === "CairnCombatTracker", dom.trackerClass);
check("three dividers, in Cairn's order",
  JSON.stringify(dom.dividers) === JSON.stringify(["Act first", "Enemies", "Act last"]),
  JSON.stringify(dom.dividers));
// The INTERLEAVED sequence, position by position — two separate NodeLists can
// each count right while the list is shuffled. This is the leg that catches
// Dice So Nice's InitiativeMask, which re-appends every combatant row from its
// own renderCombatTracker hook: without the ready-registered order guard the
// dividers strand at the top and the rows land in DSN's order, while every
// count below stays green.
const tokens = dom.sequence.map((s) => (s.startsWith("# ") ? s : s.split(": ").at(-1)));
check("dividers and rows interleave in Cairn's order",
  JSON.stringify(tokens) === JSON.stringify(["# Act first", "First", "First", "First",
    "# Enemies", "—", "# Act last", "Last", "(roll)", "(roll)"]),
  JSON.stringify(dom.sequence));
check("a word on every rolled row, no numbers", dom.numericInputs === 0
  && dom.words.length === 5 && dom.words.filter((w) => w === "First").length === 3
  && dom.words.includes("—") && dom.words.includes("Last"),
  `words=${JSON.stringify(dom.words)} numeric inputs=${dom.numericInputs} — 1/0/−1 is an encoding, not information`);
check("the unrolled keep the roll button", dom.rollButtons === 2,
  `${dom.rollButtons} — the empty slot is the invitation to save`);

/* ---------------------------------------------------------------------------
 * 3. A player's roll: hers lands, an id she does not own is SKIPPED.
 *
 * This is the `null <= DEX` leg. Core skips combatants the caller does not
 * own; the old post-processing loop then read the skipped combatant's null
 * initiative, and `null <= DEX` is TRUE — an un-rolled save counted as a
 * pass. The Warden-only combatant she names must stay null.
 * ------------------------------------------------------------------------- */
console.log("\na player rolls her own save");
const alice = { ran: false };
try {
  const alicePage = await browser.newPage({ viewport: VIEWPORT });
  await joinAs(alicePage, "Alice");
  Object.assign(alice, await alicePage.evaluate(async () => {
    const combat = game.combats.find((c) => c.combatants.some((x) => x.name === "ZZ Init Mine"));
    if (!combat) return { ran: false };
    const mine = combat.combatants.find((c) => c.name === "ZZ Init Mine");
    const notMine = combat.combatants.find((c) => c.name === "ZZ Init Unrolled");
    let threw = null;
    try {
      await combat.rollInitiative([mine.id, notMine.id]);
    } catch (e) {
      threw = `${e.name}: ${e.message}`;
    }
    return {
      ran: true, isGM: game.user.isGM, threw,
      mineOwned: mine.isOwner, otherOwned: notMine.isOwner,
      mine: mine.initiative, other: notMine.initiative,
    };
  }));
  await alicePage.close();
} catch (e) {
  alice.error = `${e.name}: ${e.message}`;
}
if (alice.error) check("the player leg ran", false, alice.error);
check("the player leg ran", alice.ran && !alice.isGM && alice.mineOwned && !alice.otherOwned,
  `ran=${alice.ran} owns hers=${alice.mineOwned} owns the other=${alice.otherOwned} (needs npm run dev:players)`);
check("her save lands", alice.threw === null && alice.mine === 1,
  `threw=${alice.threw} initiative=${alice.mine} — DEX 20 cannot fail`);
check("the unowned id is skipped, NOT passed", alice.other === null,
  `initiative=${alice.other} — null <= DEX is true, so the old code put exactly this combatant in the acts-first bucket`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async (ids) => {
  await game.combats.get(ids.combatId)?.delete();
  for (const m of game.messages.contents.slice().reverse()) {
    if (/ZZ Init/.test(m.speaker?.alias ?? "") || ids.msgIds.includes(m.id)) await m.delete();
  }
  await game.scenes.get(ids.sceneId)?.delete();
  for (const id of ids.actorIds) await game.actors.get(id)?.delete();
}, roll.ids);

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\ncombat-order e2e FAILED — ${failures}` : "\ncombat-order e2e passed");
process.exit(failures ? 1 : 0);
