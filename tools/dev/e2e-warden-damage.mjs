/**
 * The Warden's damage: traps, environments, conditions.
 *
 * Every other damage path starts at a weapon on somebody's sheet, so a pit, a
 * poison or a fright had to be applied by hand — no card, no STR save, no Scar,
 * no death bar, nothing in the log. A hazard is a weapon nobody is holding: the
 * dialog posts the ORDINARY damage card and everything downstream already
 * works. What is new is the Token-controls button and the POOL.
 *
 * Its own file rather than more legs in `dev:enc-damage`, which is already the
 * largest probe here. That means `docs/release-testing.md` and `check:probes`
 * both had to move — a probe missing from a run list goes stale-red silently.
 *
 * The dev world has NO actors, so every fixture is created here and removed
 * afterwards.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAs, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(36)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(36)} ${d}`); failures++; };
const check = (l, cond, d = "") => (cond ? ok(l, d) : fail(l, d));

watchdog(420000, "warden-damage");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await page.goto(FOUNDRY_URL);
await joinAsGM(page);
await dismissChrome(page);

/* ---------------------------------------------------------------------------
 * 1. The tool exists for the Warden, and does not for a player.
 *
 * Read in BOTH places on purpose. `ui.controls.controls` is what the system
 * registered; the DOM button is what a Warden can actually click, and a tool
 * registered into a control set that never renders is invisible to the second
 * reading only. `visible: game.user.isGM` is evaluated ONCE, when the palette is
 * first prepared (scene-controls.mjs:378-380), so it is an affordance — the
 * refusal is asserted separately in section 2.
 * ------------------------------------------------------------------------- */
console.log("\nthe Warden's damage tool");
const gmTool = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The tools menu only renders for the ACTIVE control set, so make Token the
  // active one rather than hoping it already is.
  ui.controls.activate({ control: "tokens" });
  await sleep(500);
  return {
    registered: !!ui.controls.controls?.tokens?.tools?.abWardenDamage,
    title: ui.controls.controls?.tokens?.tools?.abWardenDamage?.title ?? null,
    inDom: !!document.querySelector('button[data-tool="abWardenDamage"]'),
    // The title is an i18n KEY in the registration; core localizes it into
    // aria-label when it renders (scene-controls-tools.hbs:5). Reading the
    // rendered label is what proves the key resolves — a missing one would show
    // up here as the literal "CAIRN.WardenDamage.Tool".
    label: document.querySelector('button[data-tool="abWardenDamage"]')?.getAttribute("aria-label") ?? null,
  };
});
check("registered on the Token controls", gmTool.registered && gmTool.title === "CAIRN.WardenDamage.Tool",
  `title=${JSON.stringify(gmTool.title)} — controls and tools are RECORDS keyed by name, not arrays`);
check("and rendered as a button", gmTool.inDom, 'button[data-tool="abWardenDamage"]');
check("its tooltip is localized", !!gmTool.label && !/^CAIRN\./.test(gmTool.label),
  `aria-label="${gmTool.label}"`);

/* ---------------------------------------------------------------------------
 * 2. A player gets neither the tool nor the action.
 *
 * TWO readings, and they are different claims: the tool being absent from her
 * palette is the affordance, and `openWardenDamage` refusing her call is the
 * enforcement. Removing either alone leaves a change that looks landed and is
 * not, so they are witnessed separately.
 * ------------------------------------------------------------------------- */
const player = { ran: false };
try {
  const alicePage = await browser.newPage({ viewport: VIEWPORT });
  await joinAs(alicePage, "Alice");
  Object.assign(player, await alicePage.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    ui.controls.activate({ control: "tokens" });
    await sleep(500);
    const before = game.messages.size;
    const { openWardenDamage } = await import("/systems/air-bladder/module/warden-damage.js");
    // RACED, and this is not belt-and-braces. With the refusal removed the call
    // OPENS THE DIALOG instead of returning, and a DialogV2 nobody answers never
    // settles — so the bare `await` here hung the whole run at the watchdog
    // rather than reddening this leg, which reads as a broken probe and not as a
    // regression. A witness must redden a LEG, never kill the run; the rule
    // covers awaits that only open a dialog ONCE A WITNESS IS APPLIED.
    const result = await Promise.race([
      openWardenDamage(),
      new Promise((res) => setTimeout(() => res("__never-settled__"), 4000)),
    ]);
    await sleep(300);
    const dialogOpened = !!document.querySelector("dialog.dialog");
    // Close whatever opened, or it eats the next leg's clicks.
    document.querySelector("dialog.dialog")?.remove();
    return {
      ran: true, isGM: game.user.isGM,
      registered: !!ui.controls.controls?.tokens?.tools?.abWardenDamage,
      inDom: !!document.querySelector('button[data-tool="abWardenDamage"]'),
      refused: result === null,
      // No dialog either: a refusal that still opened the form would let her
      // fill it in and only then be told no.
      dialogOpened,
      postedNothing: game.messages.size === before,
    };
  }));
  await alicePage.close();
} catch (e) {
  player.error = `${e.name}: ${e.message}`;
}
if (player.error) check("the player leg ran", false, player.error);
check("the player leg ran", player.ran && !player.isGM,
  `ran=${player.ran} isGM=${player.isGM} (needs npm run dev:players)`);
check("she has no tool", player.ran && !player.registered && !player.inDom,
  `registered=${player.registered} inDom=${player.inDom} — the affordance`);
check("and the action refuses her", player.refused && !player.dialogOpened && player.postedNothing,
  `refused=${player.refused} dialog=${player.dialogOpened} — the enforcement, which is the half that survives reaching the function another way`);

/* ---------------------------------------------------------------------------
 * 3. The dialog, driven end to end through the real button.
 *
 * Clicked rather than called: the whole claim is that a Warden can reach this
 * from the palette, and a helper invoked directly would prove only that the
 * helper works.
 * ------------------------------------------------------------------------- */
console.log("\nthe dialog posts an ordinary damage card");
const HAZARD_XSS = 'ZZ Pit <img src=x onerror="window.__abHazXSS=1">';
const dialog = await page.evaluate(async ({ xss }) => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};

  const victim = await ActorImpl.create({
    name: "ZZ Hazard Victim", type: "npc",
    system: { role: "monster", hp: { value: 9, max: 9 }, armor: 0 },
  });
  const scene = await Scene.create({ name: "ZZ Hazard Scene", width: 1000, height: 1000 });
  const [tok] = await scene.createEmbeddedDocuments("Token", [await victim.getTokenDocument({ x: 100, y: 100 })]);
  await scene.view();
  await sleep(600);
  // TARGETED, the way #onRollDamage reads its targets. Not the canvas SELECTION,
  // which is the signal the damage picker was ruled never to read.
  tok.object?.setTarget(true, { releaseOthers: true });
  await sleep(200);
  r.targeted = game.user.targets.size;

  const before = new Set(game.messages.contents.map((m) => m.id));
  document.querySelector('button[data-tool="abWardenDamage"]')?.click();
  let form = null;
  for (let i = 0; i < 40 && !form; i++) {
    form = document.querySelector("dialog.dialog input[name='formula']");
    if (!form) await sleep(150);
  }
  r.dialogOpened = !!form;
  // The formula field arrives PRE-FILLED, which is only true if the value
  // reached the markup: it is set with setAttribute because the element is
  // serialized and re-parsed, and a `.value =` property would arrive empty.
  r.formulaPrefilled = form?.value ?? null;
  r.poolOptions = [...document.querySelectorAll("dialog.dialog select[name='pool'] option")]
    .map((o) => o.value);
  r.poolDefault = document.querySelector("dialog.dialog select[name='pool']")?.value ?? null;
  r.placeholder = document.querySelector("dialog.dialog input[name='source']")?.getAttribute("placeholder") ?? null;

  const src = document.querySelector("dialog.dialog input[name='source']");
  src.value = xss;
  form.value = "3";
  document.querySelector("dialog.dialog select[name='pool']").value = "WIL";
  document.querySelector('dialog.dialog button[data-action="roll"]')?.click();

  let msg = null;
  for (let i = 0; i < 40 && !msg; i++) {
    msg = game.messages.contents.slice().reverse().find((m) => !before.has(m.id));
    if (!msg) await sleep(150);
  }
  r.posted = !!msg;
  await sleep(500);
  const row = msg ? document.querySelector(`[data-message-id="${msg.id}"]`) : null;
  const label = row?.querySelector(".dmg-label");
  r.cardPool = label?.dataset.pool ?? null;
  r.cardHazard = label?.dataset.hazard ?? null;
  r.cardTargets = row?.querySelector(".apply-dmg")?.dataset.targets ?? null;
  r.cardTargetIsToken = r.cardTargets === tok.id;
  // The Warden's own words stand: the attack-line rewrite must not turn this
  // into "<Warden> attacks ZZ Hazard Victim with !".
  r.labelText = (label?.textContent ?? "").trim();
  r.labelTags = label ? [...label.querySelectorAll("*")].map((n) => n.tagName.toLowerCase()) : null;
  r.xssFired = window.__abHazXSS === 1;
  // A trap has no actor and no token. A bare getSpeaker() would have inferred
  // one from the controlled token or the Warden's impersonated actor.
  r.speakerActor = msg?.speaker?.actor ?? null;
  r.speakerToken = msg?.speaker?.token ?? null;
  r.speakerAlias = msg?.speaker?.alias ?? null;

  // A BAD FORMULA is refused, not defaulted: silently substituting a die would
  // apply a number the Warden never chose.
  const beforeBad = game.messages.size;
  document.querySelector('button[data-tool="abWardenDamage"]')?.click();
  let f2 = null;
  for (let i = 0; i < 40 && !f2; i++) {
    f2 = document.querySelector("dialog.dialog input[name='formula']");
    if (!f2) await sleep(150);
  }
  f2.value = "not a roll";
  document.querySelector('dialog.dialog button[data-action="roll"]')?.click();
  await sleep(800);
  r.badFormulaPostedNothing = game.messages.size === beforeBad;
  document.querySelector("dialog.dialog")?.remove();

  game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
  r.ids = { sceneId: scene.id, victimId: victim.id, msgId: msg?.id ?? null };
  return r;
}, { xss: HAZARD_XSS });

check("the button opens the dialog", dialog.dialogOpened, "driven through the palette, not by calling the helper");
check("the formula field is pre-filled", dialog.formulaPrefilled === "1d6",
  `value="${dialog.formulaPrefilled}" — set with setAttribute, since a property never reaches the serialized markup`);
check("the placeholder survives", dialog.placeholder === "Spiked pit",
  `"${dialog.placeholder}" — element content bypasses cleanHTML, whose allow-list would have stripped it`);
check("four pools, HP first",
  JSON.stringify(dialog.poolOptions) === JSON.stringify(["hp", "STR", "DEX", "WIL"])
  && dialog.poolDefault === "hp",
  `${JSON.stringify(dialog.poolOptions)} default=${dialog.poolDefault}`);
check("it posts a damage card", dialog.posted, "the ordinary card, so the splat and the picker come free");
check("carrying the pool", dialog.cardPool === "WIL",
  `data-pool=${JSON.stringify(dialog.cardPool)} — on the CARD, so spending it later still means WIL`);
check("and marked a hazard", dialog.cardHazard === "1",
  `data-hazard=${JSON.stringify(dialog.cardHazard)}`);
check("targets come from the TARGETED token", dialog.targeted === 1 && dialog.cardTargetIsToken,
  `targeted=${dialog.targeted} data-targets=${dialog.cardTargets} — aiming is a gesture the Warden made, unlike the canvas selection the picker was ruled never to read`);
check("the Warden's words stand", dialog.labelText === HAZARD_XSS,
  `"${dialog.labelText}" — the attack line stands off a hazard card, or this would read "<Warden> attacks ZZ Hazard Victim with !"`);
check("and are never parsed as HTML", dialog.labelTags?.length === 0 && dialog.xssFired === false,
  `tags=${JSON.stringify(dialog.labelTags)} xssFired=${dialog.xssFired}`);
check("a trap speaks as nobody", dialog.speakerActor === null && dialog.speakerToken === null
  && !!dialog.speakerAlias,
  `actor=${dialog.speakerActor} token=${dialog.speakerToken} alias="${dialog.speakerAlias}" — a bare getSpeaker() infers one from the CONTROLLED token (chat-message.mjs:243-247), which is exactly what a Warden has selected`);
check("a bad formula is refused", dialog.badFormulaPostedNothing,
  "defaulting a die would apply a number the Warden never chose");

/* ---------------------------------------------------------------------------
 * 4. Where the damage LANDS.
 *
 * Each pool is driven by clicking the REAL Apply control on a real card, so the
 * datum is read off the card the way it will be in play.
 * ------------------------------------------------------------------------- */
console.log("\nthe pool decides where it lands");
const pools = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};

  const scene = await Scene.create({ name: "ZZ Pool Scene", width: 1000, height: 1000 });
  await scene.view();
  await sleep(400);
  const mk = async (name, system, x) => {
    const a = await ActorImpl.create({ name, type: "npc", system: { role: "monster", ...system } });
    const [t] = await scene.createEmbeddedDocuments("Token", [await a.getTokenDocument({ x, y: 100 })]);
    return { a, t };
  };
  // ARMOUR 3, deliberately: armour is hard-capped at 3, and this is the fixture
  // that catches an ability branch which reused _calculateHpAndStr.
  const strV = await mk("ZZ Pool STR", { hp: { value: 9, max: 9 }, armor: 3, abilities: { STR: { value: 10, max: 10 } } }, 100);
  const dexV = await mk("ZZ Pool DEX", { hp: { value: 9, max: 9 }, armor: 0, abilities: { DEX: { value: 3, max: 3 } } }, 300);
  const wilV = await mk("ZZ Pool WIL", { hp: { value: 9, max: 9 }, armor: 0, abilities: { WIL: { value: 2, max: 2 } } }, 500);
  const dieV = await mk("ZZ Pool Dying", { hp: { value: 9, max: 9 }, armor: 0, abilities: { STR: { value: 2, max: 2 } } }, 700);
  const oldV = await mk("ZZ Pool Legacy", { hp: { value: 5, max: 5 }, armor: 0 }, 900);
  const badV = await mk("ZZ Pool Bogus", { hp: { value: 5, max: 5 }, armor: 0 }, 1100);

  const { evaluateFormula } = await import("/systems/air-bladder/module/utils.js");
  // Post a card with a given pool, click its REAL control, and hand back what
  // the detail cards said in ORDER.
  const spend = async (tok, damage, pool) => {
    const before = new Set(game.messages.contents.map((m) => m.id));
    const roll = await evaluateFormula(String(damage), {});
    const flavor = await foundry.applications.handlebars.renderTemplate(
      "systems/air-bladder/templates/chat/dmg-roll-card.html",
      { label: "ZZ pool probe", targets: tok.id, pool, hazard: !!pool },
    );
    const msg = await roll.toMessage({
      speaker: { scene: scene.id, actor: null, token: null, alias: "ZZ Warden" }, flavor,
    });
    let btn = null;
    for (let i = 0; i < 40 && !btn; i++) {
      btn = document.querySelector(`[data-message-id="${msg.id}"] .apply-dmg`);
      if (!btn) await sleep(150);
    }
    btn?.click();
    for (let i = 0; i < 40; i++) {
      if (game.messages.contents.some((m) => !before.has(m.id) && m.id !== msg.id
        && m.speaker?.token === tok.id)) break;
      await sleep(150);
    }
    await sleep(700);   // room for a trailing status bar
    const fresh = game.messages.contents
      .filter((m) => !before.has(m.id) && m.id !== msg.id && m.speaker?.token === tok.id);
    return {
      // "damage" or the status bar's KIND, in the order they were posted.
      kinds: fresh.map((m) => (String(m.content).match(/status-banner\s+status-(\w+)/) ?? [, "damage"])[1]),
      first: String(fresh[0]?.content ?? ""),
      rollId: msg.id,
    };
  };

  // STR: armour is NOT consulted, and STR loss owes a save.
  const strOut = await spend(strV.t, 2, "STR");
  r.strKinds = strOut.kinds;
  r.strValue = strV.t.actor.system.abilities.STR.value;
  r.strHp = strV.t.actor.toObject().system.hp.value;
  r.strCard = strOut.first;
  r.strHasSave = /roll-str-save/.test(strOut.first);
  r.strNoBracket = !/damage −/.test(strOut.first);

  // DEX to 0 is paralysis, announced AFTER the card that explains it.
  const dexOut = await spend(dexV.t, 3, "DEX");
  r.dexKinds = dexOut.kinds;
  r.dexValue = dexV.t.actor.system.abilities.DEX.value;
  r.dexCard = dexOut.first;

  // WIL to 0 is delirium.
  const wilOut = await spend(wilV.t, 2, "WIL");
  r.wilKinds = wilOut.kinds;
  r.wilValue = wilV.t.actor.system.abilities.WIL.value;

  // STR to 0 is death, and a corpse is not offered the save.
  const dieOut = await spend(dieV.t, 2, "STR");
  r.dieKinds = dieOut.kinds;
  r.dieHasSave = /roll-str-save/.test(dieOut.first);

  // NO POOL AT ALL — every card already in the log. It must be Cairn's combat
  // rule, hitting HP.
  const oldOut = await spend(oldV.t, 2, null);
  r.legacyKinds = oldOut.kinds;
  r.legacyHp = oldV.t.actor.toObject().system.hp.value;
  r.legacyCard = oldOut.first;

  // AN UNRECOGNISED POOL. The value comes off a stored card and is spliced into
  // `system.abilities.<POOL>.value`, so a typo or an older/newer build's card
  // must land on Hit Protection rather than writing a field nothing declares.
  const badOut = await spend(badV.t, 2, "NOPE");
  r.bogusHp = badV.t.actor.toObject().system.hp.value;
  r.bogusAbilities = JSON.stringify(badV.t.actor.toObject().system.abilities ?? {});
  r.bogusKinds = badOut.kinds;

  // Clean up: this scene's messages, then the documents.
  for (const m of game.messages.contents.slice().reverse().slice(0, 48)) {
    if (m.speaker?.scene === scene.id) await m.delete();
  }
  await scene.delete();
  for (const v of [strV, dexV, wilV, dieV, oldV, badV]) await v.a.delete();
  return r;
});

check("STR loses exactly the damage", pools.strValue === 8,
  `STR 10 -> ${pools.strValue} after 2`);
check("ARMOUR IS NOT SUBTRACTED", pools.strValue === 8 && pools.strNoBracket,
  `armour 3 against 2 damage still costs 2 STR, and the card carries no armour bracket — the leg that catches an ability branch reusing _calculateHpAndStr`);
check("HP is untouched", pools.strHp === 9, `hp=${pools.strHp}`);
check("and the save is offered", pools.strHasSave,
  "the same `newStr < str` rule combat uses, so this needed no second branch");
check("DEX to 0 paralyses", pools.dexValue === 0
  && JSON.stringify(pools.dexKinds) === JSON.stringify(["damage", "paralyzed"]),
  `${JSON.stringify(pools.dexKinds)} — asserted on POSITIONS: a bar posted from the update hook lands ABOVE the card explaining it`);
check("WIL to 0 makes delirious", pools.wilValue === 0
  && JSON.stringify(pools.wilKinds) === JSON.stringify(["damage", "delirious"]),
  JSON.stringify(pools.wilKinds));
check("no Scar on an ability hit", !/cairn-scar-banner/.test(pools.dexCard),
  "a Scar is what a hit to exactly 0 HP costs, and HP did not move");
check("STR to 0 is death", JSON.stringify(pools.dieKinds) === JSON.stringify(["damage", "dead"]),
  JSON.stringify(pools.dieKinds));
check("a corpse is not asked to save", !pools.dieHasSave,
  "the save decides whether the character takes Critical Damage, and there is nothing left to decide");
check("NO pool means Hit Protection", pools.legacyHp === 3
  && JSON.stringify(pools.legacyKinds) === JSON.stringify(["damage"]),
  `hp 5 -> ${pools.legacyHp} — every card already in the log carries no data-pool, and must still mean combat`);
// The WHITELIST. Asserted positively (HP moved) AND negatively (no ability
// gained a value): "it did not throw" would pass on a write that silently
// created `system.abilities.NOPE.value`, which is the actual hazard of splicing
// a stored card's datum into a field path.
check("an unrecognised pool falls back to HP", pools.bogusHp === 3
  && !/NOPE/.test(pools.bogusAbilities ?? "")
  && JSON.stringify(pools.bogusKinds) === JSON.stringify(["damage"]),
  `hp 5 -> ${pools.bogusHp}, abilities ${pools.bogusAbilities} — the pool is spliced into system.abilities.<POOL>.value, so anything unrecognised must be Cairn's ordinary rule`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async (ids) => {
  if (ids.msgId) await game.messages.get(ids.msgId)?.delete();
  for (const m of game.messages.contents.slice().reverse().slice(0, 20)) {
    if (m.speaker?.scene === ids.sceneId) await m.delete();
  }
  await game.scenes.get(ids.sceneId)?.delete();
  await game.actors.get(ids.victimId)?.delete();
}, dialog.ids);

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\nwarden-damage e2e FAILED — ${failures}` : "\nwarden-damage e2e passed");
process.exit(failures ? 1 : 0);
