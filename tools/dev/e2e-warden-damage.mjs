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

  // AN @-REFERENCE IS REFUSED TOO, and it is a separate leg because it is the
  // case the guard used to LET THROUGH. `Roll.validate` stubs every @ref with "1"
  // and accepts it (dice/roll.mjs:772-790); `Roll.parse` then resolves it against
  // roll data with `{missing: "0"}` (:735-743), and a hazard has no actor to
  // supply any. So the validator said yes and the evaluator silently zeroed it.
  // Asserted on the CARD, not just on the notification: "it warned" would pass
  // while a gutted card was posted anyway.
  const beforeAt = game.messages.size;
  document.querySelector('button[data-tool="abWardenDamage"]')?.click();
  let f3 = null;
  for (let i = 0; i < 40 && !f3; i++) {
    f3 = document.querySelector("dialog.dialog input[name='formula']");
    if (!f3) await sleep(150);
  }
  f3.value = "1d6 + @abilities.STR.value";
  document.querySelector('dialog.dialog button[data-action="roll"]')?.click();
  await sleep(800);
  r.atRefPostedNothing = game.messages.size === beforeAt;
  // And the reason a plain `Roll.validate` gate cannot be trusted here.
  r.atRefStillValidates = Roll.validate("1d6 + @abilities.STR.value");
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
check("an @-reference is refused", dialog.atRefPostedNothing && dialog.atRefStillValidates,
  `posted nothing=${dialog.atRefPostedNothing}, Roll.validate still says yes=${dialog.atRefStillValidates}`
  + " — validate stubs @refs with 1 and ACCEPTS them, while evaluation stubs them with 0,"
  + " so this must be refused explicitly or the card is silently short by the whole term");

/* ---------------------------------------------------------------------------
 * 3b. The dice builder writes the field, and the field stays the truth.
 *
 * Two layers, asserted separately because they fail separately:
 *
 *  - `composeDiceFormula` / `parseDiceFormula` as pure functions — the
 *    composer must be `evaluateFormula`'s exact inverse, so each emitted
 *    string is fed BACK to the evaluator and the resulting roll formula is
 *    checked for `kh`. Deterministic: it asserts the rewrite, not a die.
 *  - the LIVE dialog, driven through the real palette button — clicks must
 *    change the field at all (listeners on the built nodes are serialized
 *    away, so this is the leg that catches wiring them in buildForm instead
 *    of in `render`), greying must follow a hand edit, and a built string
 *    must survive Roll.validate on the way to a card.
 *
 * The DIALECT leg shadows `game.settings.get` in-page rather than writing the
 * world setting: `use-cairn-dice-notation` is the user's world's, and a leaked
 * setting is the 0.1.12 pre-tag lesson. (It was `requiresReload` too, until
 * review #18 found both of its readers live and dropped the flag; the shadow
 * was never about the reload.)
 * ------------------------------------------------------------------------- */
console.log("\nthe dice builder");
const builder = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  const { composeDiceFormula, parseDiceFormula, evaluateFormula } =
    await import("/systems/air-bladder/module/utils.js");

  // The composer's table, then the loop closed through the evaluator.
  r.cOne = composeDiceFormula([6], "sum");                                //  1d6
  r.cOneKh = composeDiceFormula([6], "kh");                               //  1d6 — one die, same roll
  r.cSum = composeDiceFormula([6, 6], "sum");                             //  2d6
  r.cSum3 = composeDiceFormula([6, 6, 6], "sum");                         //  3d6
  r.cMix = composeDiceFormula([6, 8], "sum");                             //  {1d6,1d8}
  r.cKhOn = composeDiceFormula([6, 6], "kh", { cairnNotation: true });    //  d6 + d6
  r.cKhOff = composeDiceFormula([6, 6], "kh", { cairnNotation: false });  //  {1d6,1d6}kh
  const fml = async (s) => (await evaluateFormula(s, {})).formula;
  r.eSum = await fml(r.cSum);
  r.eMix = await fml(r.cMix);
  r.eKhOn = await fml(r.cKhOn);
  r.eKhOff = await fml(r.cKhOff);

  // The parser's refusals are what grey the buttons.
  r.pArith = parseDiceFormula("2d6 + 3");
  r.pAt = parseDiceFormula("1d6 + @str");
  r.pNum = parseDiceFormula("3");
  r.pEmpty = JSON.stringify(parseDiceFormula(""));
  r.pKhCount = parseDiceFormula("2d6 + d8");   // max(2d6,d8) is not a builder shape

  const open = async () => {
    // A CLOSING dialog LINGERS in the DOM. Reopening while the last one is
    // still tearing down hands every q() below the OLD dialog's nodes — whose
    // listeners are live and whose closure captured the OLD dialect, which is
    // exactly the wrong thing to click in the shadow leg. Wait it out first.
    for (let i = 0; i < 40 && document.querySelector("dialog.dialog"); i++) await sleep(150);
    document.querySelector('button[data-tool="abWardenDamage"]')?.click();
    let f = null;
    for (let i = 0; i < 40 && !f; i++) {
      f = document.querySelector("dialog.dialog input[name='formula']");
      if (!f) await sleep(150);
    }
    return f;
  };
  const q = (sel) => document.querySelector(`dialog.dialog ${sel}`);

  let f = await open();
  r.uiOpened = !!f;
  q(".wd-clear")?.click();
  r.uiCleared = f?.value ?? null;                                    // "" — ✕ empties, never re-fills
  r.uiEnabledAfterClear = q(".wd-die[data-die='6']")?.disabled === false;
  q(".wd-die[data-die='6']")?.click();
  q(".wd-die[data-die='6']")?.click();
  r.uiTwoD6 = f?.value ?? null;                                      // 2d6 — the live-listeners leg
  q("input[name='diceMode'][value='kh']")?.click();
  r.uiKh = f?.value ?? null;                                         // d6 + d6 (dev world: setting on)
  q(".wd-die[data-die='8']")?.click();
  r.uiKh3 = f?.value ?? null;                                        // d6 + d6 + d8
  q("input[name='diceMode'][value='sum']")?.click();
  r.uiSumMix = f?.value ?? null;                                     // {2d6,1d8}
  // A hand edit the buttons cannot represent greys them — and only them.
  f.value = "2d6 + 3";
  f.dispatchEvent(new Event("input", { bubbles: true }));
  r.uiGreyed = q(".wd-die[data-die='6']")?.disabled === true
    && q("input[name='diceMode'][value='kh']")?.disabled === true;
  r.uiFieldStillEditable = f?.disabled === false;
  q(".wd-clear")?.click();
  r.uiReEnabled = (f?.value === "") && q(".wd-die[data-die='6']")?.disabled === false;
  // A BUILT string reaches a card: through Roll.validate and the real button.
  q(".wd-die[data-die='6']")?.click();
  q(".wd-die[data-die='6']")?.click();
  const src = q("input[name='source']");
  if (src) src.value = "ZZ Builder Trap";
  const beforeRoll = game.messages.size;
  q('button[data-action="roll"]')?.click();
  for (let i = 0; i < 40 && game.messages.size === beforeRoll; i++) await sleep(150);
  r.uiPosted = game.messages.size > beforeRoll;

  // THE DIALECT LEG. With Cairn notation OFF, `d6 + d6` is ARITHMETIC — a
  // builder that emitted it would say "keep highest" and roll a sum. Shadow the
  // read on the instance, then delete the shadow so the prototype's own method
  // returns — no world write.
  const settings = game.settings;
  const origGet = settings.get.bind(settings);
  settings.get = (ns, key) =>
    key === "use-cairn-dice-notation" ? false : origGet(ns, key);
  f = await open();
  q(".wd-clear")?.click();
  q(".wd-die[data-die='6']")?.click();
  q(".wd-die[data-die='6']")?.click();
  q("input[name='diceMode'][value='kh']")?.click();
  r.uiKhOff = f?.value ?? null;                                      // {1d6,1d6}kh
  delete settings.get;
  r.settingRestored = settings.get(
    "air-bladder", "use-cairn-dice-notation") === true;
  q('button[data-action="cancel"]')?.click();
  await sleep(300);
  return r;
});

check("the composer's table", builder.cOne === "1d6" && builder.cOneKh === "1d6"
  && builder.cSum === "2d6" && builder.cSum3 === "3d6",
  `[6]→${builder.cOne} kh[6]→${builder.cOneKh} [6,6]→${builder.cSum} [6,6,6]→${builder.cSum3}`);
check("mixed sum is the pool form", builder.cMix === "{1d6,1d8}" && !/kh/.test(builder.eMix),
  `${builder.cMix} → rolls "${builder.eMix}" — the + form cannot say this: both terms are bare dice, so the rewrite would claim it as keep-highest`);
check("the loop closes through the evaluator", !/kh/.test(builder.eSum)
  && /kh/.test(builder.eKhOn) && /kh/.test(builder.eKhOff),
  `sum "${builder.eSum}" | kh-on "${builder.eKhOn}" | kh-off "${builder.eKhOff}" — kh exactly where keep-highest was meant`);
check("keep-highest speaks both dialects", builder.cKhOn === "d6 + d6"
  && builder.cKhOff === "{1d6,1d6}kh",
  `on→"${builder.cKhOn}" off→"${builder.cKhOff}" — with the setting off, d6 + d6 is ARITHMETIC`);
check("the parser refuses what the buttons can't say", builder.pArith === null
  && builder.pAt === null && builder.pNum === null && builder.pKhCount === null
  && builder.pEmpty === JSON.stringify({ sizes: [], mode: null }),
  `2d6+3, @ref, 3, 2d6+d8 → null; "" → empty tray`);
check("clicks reach the field", builder.uiOpened && builder.uiCleared === ""
  && builder.uiTwoD6 === "2d6",
  `✕→"${builder.uiCleared}" then d6,d6→"${builder.uiTwoD6}" — the leg that catches listeners wired on the built nodes, which serialization discards`);
check("the mode recomposes the same dice", builder.uiKh === "d6 + d6"
  && builder.uiKh3 === "d6 + d6 + d8" && builder.uiSumMix === "{2d6,1d8}",
  `kh→"${builder.uiKh}" +d8→"${builder.uiKh3}" sum→"${builder.uiSumMix}"`);
check("a hand edit greys the buttons", builder.uiGreyed && builder.uiFieldStillEditable,
  "2d6 + 3 — the greying is the affordance; the field stays authoritative and editable");
check("✕ clears and re-enables", builder.uiReEnabled, 'field "" and the d6 button live again');
check("a built formula reaches a card", builder.uiPosted,
  "2d6 through Roll.validate and the real Roll button");
check("the dialect is read from the setting", builder.uiKhOff === "{1d6,1d6}kh"
  && builder.settingRestored,
  `shadowed off → "${builder.uiKhOff}", shadow deleted → true — no world write`);

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

/* ---------------------------------------------------------------------------
 * 5. Every card line comes through a WHOLE-LINE key (review #13 fix #10).
 *
 * The detail cards assembled `'<strong>' + label + '</strong>: '` in code,
 * which hands a translator the nouns and keeps the punctuation — the exact
 * shape faction-generator.js:91-95 records as forbidden. The lines now go
 * through CAIRN.DamageCardLine and CAIRN.StatusBannerLine whole.
 *
 * Byte-identical English output means "the card contains the formatted key"
 * is satisfied by the OLD concatenation too, so that assertion cannot witness
 * the fix. The witness is the same shape as dev:content-overlay's Kind leg:
 * SHADOW each key to a reordered form ("ZZ-LINE {value} ← {label}") and drive
 * real cards — code reading the key renders the reordered line; the old
 * concatenation never consults it and stays "Damage: 6". Shadowing is nested
 * (lang JSON is expandObject-ed on load, localization.mjs:368), so
 * get/setProperty, restored in a finally.
 *
 * Three surfaces on purpose: the hazard card (_showAbilityDetails), the
 * combat card (_showDetails — a different method whose lines could regress
 * alone), and the status bar, read BOTH where it is posted (chat) and where
 * the sheet template renders the same key (npc-sheet.html; the character
 * sheet's block is the identical line, and dev:i18n-render's critBanner leg
 * covers that template rendering). An unshadowed hit first asserts the
 * English bytes did not move — dev:enc-damage's breakdown legs pin the
 * Damage line, this pins the banner join.
 * ------------------------------------------------------------------------- */
console.log("\nthe card lines come through whole-line keys");
const lines = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};

  const scene = await Scene.create({ name: "ZZ Line Scene", width: 1000, height: 1000 });
  await scene.view();
  await sleep(400);
  const mk = async (name, system, x) => {
    const a = await ActorImpl.create({ name, type: "npc", system: { role: "monster", ...system } });
    const [t] = await scene.createEmbeddedDocuments("Token", [await a.getTokenDocument({ x, y: 100 })]);
    return { a, t };
  };
  // TWO DEX victims: paralysis announces only on the 2->0 transition, so the
  // unshadowed and shadowed halves each need a fresh one.
  const dexA = await mk("ZZ Line Plain", { hp: { value: 9, max: 9 }, armor: 0, abilities: { DEX: { value: 2, max: 2 } } }, 100);
  const dexB = await mk("ZZ Line Shadow", { hp: { value: 9, max: 9 }, armor: 0, abilities: { DEX: { value: 2, max: 2 } } }, 300);
  const hpV = await mk("ZZ Line Combat", { hp: { value: 5, max: 5 }, armor: 0 }, 500);

  const { evaluateFormula } = await import("/systems/air-bladder/module/utils.js");
  // Same real-button drive as section 4: post a card, click its Apply control,
  // hand back the fresh messages' content in order.
  const spend = async (tok, damage, pool) => {
    const before = new Set(game.messages.contents.map((m) => m.id));
    const roll = await evaluateFormula(String(damage), {});
    const flavor = await foundry.applications.handlebars.renderTemplate(
      "systems/air-bladder/templates/chat/dmg-roll-card.html",
      { label: "ZZ line probe", targets: tok.id, pool, hazard: !!pool },
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
    await sleep(700);   // room for the trailing status bar
    return game.messages.contents
      .filter((m) => !before.has(m.id) && m.id !== msg.id && m.speaker?.token === tok.id)
      .map((m) => String(m.content));
  };

  // Unshadowed: the English bytes must not have moved.
  const plain = await spend(dexA.t, 2, "DEX");
  r.plainCard = plain[0] ?? "";
  r.plainBanner = plain[1] ?? "";

  const LINE_KEY = "CAIRN.DamageCardLine";
  const BANNER_KEY = "CAIRN.StatusBannerLine";
  const priorLine = foundry.utils.getProperty(game.i18n.translations, LINE_KEY);
  const priorBanner = foundry.utils.getProperty(game.i18n.translations, BANNER_KEY);
  try {
    foundry.utils.setProperty(game.i18n.translations, LINE_KEY, "ZZ-LINE {value} ← {label}");
    foundry.utils.setProperty(game.i18n.translations, BANNER_KEY, "ZZ-BANNER {text} ← {label}");

    const hazard = await spend(dexB.t, 2, "DEX");
    r.shadowCard = hazard[0] ?? "";
    r.shadowBanner = hazard[1] ?? "";
    const combat = await spend(hpV.t, 2, null);
    r.shadowCombat = combat[0] ?? "";

    // The SHEET's copy of the banner line, while dexB is paralyzed and the
    // shadow is still up: the npc template must render the same key. The
    // TOKEN actor's sheet, not the world actor's — the token is unlinked, so
    // the hit paralyzed the synthetic delta actor and the world actor still
    // has DEX 2 and no banner (the unlinked-token trap, third catch).
    const sheet = dexB.t.actor.sheet;
    await sheet.render(true);
    let span = null;
    for (let i = 0; i < 40 && !span; i++) {
      span = sheet.element?.querySelector(".critical-banner .status-banner span") ?? null;
      if (!span) await sleep(150);
    }
    r.sheetBanner = span?.textContent ?? "";
    await sheet.close();
  } finally {
    foundry.utils.setProperty(game.i18n.translations, LINE_KEY, priorLine);
    foundry.utils.setProperty(game.i18n.translations, BANNER_KEY, priorBanner);
  }

  r.dmgLabel = game.i18n.localize("CAIRN.Damage");
  r.hpLabel = game.i18n.localize("CAIRN.HitProtection");
  r.paralyzedJoin = "<strong>" + game.i18n.localize("CAIRN.Paralyzed") + ":</strong> "
    + game.i18n.localize("CAIRN.ParalyzedBanner");

  // Clean up: this scene's messages, then the documents.
  for (const m of game.messages.contents.slice().reverse().slice(0, 30)) {
    if (m.speaker?.scene === scene.id) await m.delete();
  }
  await scene.delete();
  for (const v of [dexA, dexB, hpV]) await v.a.delete();
  return r;
});

check("the visible English lines are unchanged",
  lines.plainCard.includes("<strong>" + lines.dmgLabel + "</strong>: ")
  && lines.plainBanner.includes(lines.paralyzedJoin),
  "colon outside the bold on card lines, inside it on the banner — each key preserves its surface byte-for-byte; the difference is history, now changeable on purpose");
check("the hazard card reads CAIRN.DamageCardLine",
  /ZZ-LINE/.test(lines.shadowCard) && lines.shadowCard.includes("← DEX"),
  `a reordered shadow renders reordered: ${JSON.stringify((lines.shadowCard.match(/ZZ-LINE[^<]*/) ?? ["NOT FOUND — the line is still concatenated in code"])[0])}`);
check("the combat card's lines do too",
  /ZZ-LINE/.test(lines.shadowCombat) && lines.shadowCombat.includes("← " + lines.hpLabel),
  "_showDetails is a separate method from the hazard card, and its lines could regress alone");
check("the status bar reads CAIRN.StatusBannerLine",
  /ZZ-BANNER/.test(lines.shadowBanner),
  (lines.shadowBanner.match(/ZZ-BANNER[^<]*/) ?? ["NOT FOUND — the banner is still concatenated in postStatusCard"])[0]);
check("and the sheet's banner is the SAME key",
  /ZZ-BANNER/.test(lines.sheetBanner),
  `npc-sheet.html renders through it — one key is what keeps a translator's reordering from splitting chat from sheet (got ${JSON.stringify(lines.sheetBanner.slice(0, 60))})`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async (ids) => {
  if (ids.msgId) await game.messages.get(ids.msgId)?.delete();
  // 30, not 20: section 3b's builder card lands on the same scene.
  for (const m of game.messages.contents.slice().reverse().slice(0, 30)) {
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
