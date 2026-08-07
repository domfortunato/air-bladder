/**
 * One-off probe: the four sheet dialogs ported from V1 Dialog to DialogV2.
 *
 * Each one used to reach through the V1 callback's jQuery argument
 * (`html[0].querySelector("form")`). DialogV2 hands the callback the clicked
 * BUTTON instead, and renders content inside its own <form> -- so a nested
 * <form> in the content template would be dropped by the parser and
 * `button.form` would resolve to the wrong thing (or the class would vanish).
 *
 * Drives real clicks, not programmatic calls, because the whole point is that
 * the button/form wiring is correct in the DOM.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(34)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(34)} ${d}`); failures++; };

// This probe awaits DIALOG promises, which never resolve if the dialog fails to
// open — so a bug here is a hang, not a failure, and it ran 15 minutes with no
// output before anyone noticed. Every dialog await below is raced against a
// timeout as well; this is the backstop for the ones that are not.
watchdog(300000, "dialogs");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await page.goto(FOUNDRY_URL);
await joinAsGM(page);
await dismissChrome(page);

// A throwaway actor, so nothing in the dev world is disturbed. The Features
// section is behind a GM setting, so turn it on and put it back afterwards.
//
// Sweep leftovers FIRST. This probe creates a world Actor by name and later looks
// it up the same way, so a run that dies midway leaves one behind — and every
// later run then finds the STALE sack, whose keeper points at an actor that no
// longer exists, and fails identically forever. One real failure otherwise turns
// into a permanent one, which reads exactly like a code bug and is not.
const { actorId, featuresWere } = await page.evaluate(async () => {
  for (const stale of game.actors.filter((a) => ["ZZ DialogV2 Probe", "ZZ Probe Mochila"].includes(a.name))) {
    await stale.delete().catch(() => {});
  }
  const was = game.settings.get("air-bladder", "show-features-section");
  if (!was) await game.settings.set("air-bladder", "show-features-section", true);
  // generationEnabled seeded: the default is Off since 2026-08-02 and the
  // rollActor leg below clicks the header button that flag reveals.
  const a = await Actor.create({ name: "ZZ DialogV2 Probe", type: "character", system: { generationEnabled: true } });
  a.sheet.render(true);
  return { actorId: a.id, featuresWere: was };
});
await page.waitForTimeout(2500);

/* ---------------------------------------------------------------- item ---- */
await page.locator(".item-create").first().click();
await page.waitForSelector("dialog.dialog input[name='itemname']", { timeout: 5000 });

// The content template must NOT have introduced a nested form.
//
// Counting forms is the WEAK check and will not catch the bug on its own: the
// parser drops a nested <form> START TAG outright, so the count stays 1 either
// way and the inputs still land in the dialog's form. The damage is that the
// dropped tag takes its attributes with it. Verified 2026-07-28 by reverting
// the template to <form> -- the count assertion passed, this one failed.
const nestedForms = await page.evaluate(() =>
  document.querySelectorAll("dialog.dialog form").length);
nestedForms === 1
  ? ok("dialog has exactly one form", `${nestedForms}`)
  : fail("dialog has exactly one form", `found ${nestedForms}`);

const classKept = await page.evaluate(() =>
  !!document.querySelector("dialog.dialog .custom-dialog"));
classKept
  ? ok(".custom-dialog survived parsing")
  : fail(".custom-dialog survived parsing", "class was dropped with a nested <form>");

// The type it OPENS on, before anything is chosen. Two options carried
// `selected`, and the last one wins, so Add Item defaulted to "object" — the type
// with no damage, no armor and no uses. Read `.value`, not the attribute: the
// attribute is what was wrong, the value is what the form actually submits.
const defaultType = await page.evaluate(() =>
  document.querySelector("dialog.dialog select[name='itemtype']")?.value ?? null);
defaultType === "item"
  ? ok("add-item defaults to Item", defaultType)
  : fail("add-item defaults to Item", `defaults to "${defaultType}"`);

await page.fill("dialog.dialog input[name='itemname']", "Probe Lantern");
await page.selectOption("dialog.dialog select[name='itemtype']", "weapon").catch(async () => {
  // v14 hides <select> behind a custom element; set it directly.
  await page.evaluate(() => {
    const s = document.querySelector("dialog.dialog select[name='itemtype']");
    s.value = "weapon";
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
});
await page.check("dialog.dialog input[name='itempetty']");
await page.locator("dialog.dialog button[data-action='ok']").click();
await page.waitForTimeout(1200);

const made = await page.evaluate((id) => {
  const it = game.actors.get(id).items.find((i) => i.name === "Probe Lantern");
  return it ? { type: it.type, weightless: it.system.weightless } : null;
}, actorId);
made && made.type === "weapon" && made.weightless === true
  ? ok("item created with form values", JSON.stringify(made))
  : fail("item created with form values", JSON.stringify(made));

/* ------------------------------------------------------------- feature ---- */
// The Features section lives on the Description tab, not the default Items tab.
await page.locator(`nav.tabs a[data-tab="description"]`).first().click();
await page.waitForTimeout(600);
await page.locator(".feature-create").first().click().catch(() => {});
const hasFeatureDialog = await page
  .waitForSelector("dialog.dialog input[name='itemname']", { timeout: 5000 })
  .then(() => true)
  .catch(() => false);

if (!hasFeatureDialog) {
  fail("feature dialog opened", "no .feature-create on this sheet/tab");
} else {
  // The description TEXTAREA keeps its localized placeholder. DialogV2 runs
  // STRING content through cleanHTML, whose allow-list gives <textarea> no
  // `placeholder` (constants.mjs:1885) — the attribute silently vanished until
  // the content became a <div> ELEMENT (review #6 batch 3). The name INPUT
  // beside it proves nothing: `input` is allowed the attribute, so it survived
  // the string path all along.
  const descPlaceholder = await page.evaluate(() =>
    document.querySelector("dialog.dialog textarea[name='itemdesc']")?.getAttribute("placeholder") ?? null);
  descPlaceholder
    ? ok("textarea placeholder survives DialogV2", `"${descPlaceholder}"`)
    : fail("textarea placeholder survives DialogV2", "cleanHTML stripped it — content went in as a string");

  await page.fill("dialog.dialog input[name='itemname']", "Probe Feature");
  await page.fill("dialog.dialog textarea[name='itemdesc']", "probe description");
  await page.check("dialog.dialog input[name='str']");
  await page.check("dialog.dialog input[name='blast']");
  await page.locator("dialog.dialog button[data-action='ok']").click();
  await page.waitForTimeout(1200);

  const feat = await page.evaluate((id) =>
    game.actors.get(id).system.features?.find((f) => f.name === "Probe Feature") ?? null, actorId);
  feat && feat.str === true && feat.blast === true && feat.dex === false
    ? ok("feature created, all 9 flags read", `str=${feat.str} blast=${feat.blast} dex=${feat.dex}`)
    : fail("feature created, all 9 flags read", JSON.stringify(feat));

  // A SECOND feature, so the edit below has an order to preserve. With one
  // feature there is no observable difference between replacing it in place and
  // removing it and pushing it back on.
  await page.locator(".feature-create").first().click();
  await page.waitForSelector("dialog.dialog input[name='itemname']", { timeout: 5000 });
  await page.fill("dialog.dialog input[name='itemname']", "Probe Feature Two");
  await page.locator("dialog.dialog button[data-action='ok']").click();
  await page.waitForTimeout(1200);

  // Edit reads the SAME template as Create and must read the same flag list --
  // that list used to be declared twice, inline, once per dialog.
  await page.locator(".feature-edit").first().click();
  await page.waitForSelector("dialog.dialog input[name='itemname']", { timeout: 5000 });
  const prefilled = await page.inputValue("dialog.dialog input[name='itemname']");
  prefilled === "Probe Feature"
    ? ok("edit dialog pre-filled", prefilled)
    : fail("edit dialog pre-filled", `got "${prefilled}"`);
  await page.fill("dialog.dialog input[name='itemname']", "Probe Feature Edited");
  await page.uncheck("dialog.dialog input[name='str']");
  await page.check("dialog.dialog input[name='wil']");
  await page.locator("dialog.dialog button[data-action='ok']").click();
  await page.waitForTimeout(1200);

  const after = await page.evaluate((id) => {
    const fs = game.actors.get(id).system.features ?? [];
    return { names: fs.map((f) => f.name), edited: fs.find((f) => f.name === "Probe Feature Edited") ?? null };
  }, actorId);
  const edited = after.edited;
  edited && edited.str === false && edited.wil === true && edited.blast === true
    ? ok("feature edited, flags round-tripped", `str=${edited.str} wil=${edited.wil} blast=${edited.blast}`)
    : fail("feature edited, flags round-tripped", JSON.stringify(edited));

  // Editing the FIRST feature must leave it first. The handler filtered it out
  // and pushed it back, so every edit silently sent that feature to the bottom
  // of the list -- on a sheet where the Warden chose the order.
  after.names[0] === "Probe Feature Edited" && after.names[1] === "Probe Feature Two"
    ? ok("edit keeps list order", after.names.join(", "))
    : fail("edit keeps list order", `order is now ${after.names.join(", ")}`);
}

/* ----------------------------------------------------------- container ---- */
// GONE (2026-08-01): the "Custom container…" dialog was removed with the flat
// graph — dragging a document out of Mounts & Transports does the same job with
// a stat block and art already on it. The leg that drove it lived here; its real
// coverage was the Kind→art→label chain, and that survives in `dev:item-pile`
// (name-alone classification, explicit-class re-art/relabel, hand-picked art
// preserved). `dev:ui-parity` asserts the link is ABSENT from the tab.
// The "ZZ Probe Mochila" sweep at the top stays: old worlds may still hold one.

/* ---------------------------------------------------- header controls ---- */
// Roll Character and the Randomization toggle are INLINE title-bar buttons
// (`_getFrameButtons`), not ⋮ menu entries. They were briefly `window.controls`
// during the AppV2 port, which is where this probe used to drive them from; the
// menu is the wrong home for a control used every session, so they moved back
// out. Their labelling and state live in `npm run dev:header-buttons` — all this
// needs is the click that opens the regenerate dialog.
const sheetSel = await page.evaluate((id) => `#${game.actors.get(id).sheet.element.id}`, actorId);

/* --------------------------------------------------------- regenerate ---- */
// DialogV2.confirm must default to No, replacing V1's defaultYes: false.
await page.locator(`${sheetSel} .window-header button[data-action="rollActor"]`).click();
await page.waitForTimeout(600);
const defaultIsNo = await page.evaluate(() => {
  const d = document.querySelector("dialog.dialog");
  if (!d) return null;
  const auto = d.querySelector("button[autofocus]");
  return auto?.dataset.action ?? "none";
});
defaultIsNo === "no"
  ? ok("confirm defaults to No", defaultIsNo)
  : fail("confirm defaults to No", `autofocus is on "${defaultIsNo}"`);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

/* ---------------------------- Create Actor: the role SWITCHBOARD ---- */
// Core's type-picker never renders on the world path (2026-08-02):
// CairnActor.createDialog is a switchboard of ROLES — a complete workflow per
// choice — so the retired `hireling` alias TYPE is unmintable from any UI
// path BY CONSTRUCTION, the list being roles and never types. The
// abHideHirelingType hook (DOM surgery on core's rendered dialog) is deleted
// with the dialog it operated on, so its withHookOff control is replaced by
// STRUCTURAL assertions: the hook is no longer registered, the switchboard
// lists exactly the six choices for a Warden, and no `select[name="type"]`
// renders on the world create path.
const switchboard = await page.evaluate(async () => {
  const p = getDocumentClass("Actor").createDialog();
  let sel = null;
  for (let i = 0; i < 30 && !sel; i++) {
    await new Promise((r) => setTimeout(r, 200));
    sel = document.querySelector('dialog select[name="choice"]');
  }
  const out = {
    opened: !!sel,
    values: sel ? [...sel.options].map((o) => o.value) : [],
    selected: sel?.value ?? null,
    coreTypeSelect: !!document.querySelector('dialog select[name="type"]'),
    hookGone: !(Hooks.events.renderDialogV2 ?? []).some((h) => h.fn?.name === "abHideHirelingType"),
  };
  // Dismiss WITHOUT creating — and dismiss WHATEVER opened: under the
  // negative control core's own dialog renders instead of the switchboard,
  // and an unanswered modal never settles this evaluate (the first control
  // run hung on exactly that until the harness killed it). The race is the
  // second belt: even an undismissable dialog cannot hang the probe.
  (sel?.closest("dialog") ?? [...document.querySelectorAll("dialog")].pop())
    ?.querySelector('[data-action="close"], button[data-action="cancel"]')?.click();
  const doc = await Promise.race([
    p.catch(() => null),
    new Promise((r) => setTimeout(() => r("UNSETTLED"), 5000)),
  ]);
  out.resolvedNull = doc === null;
  if (doc && doc !== "UNSETTLED") {
    await doc.sheet?.close();
    await doc.delete();
  }
  return out;
});

switchboard.opened
  && JSON.stringify(switchboard.values) === JSON.stringify(["character", "npc", "monster", "mount", "transport", "container"])
  ? ok("the switchboard offers the Warden six role choices", switchboard.values.join(", "))
  : fail("the switchboard offers the Warden six role choices", JSON.stringify(switchboard));
!switchboard.values.includes("hireling") && !switchboard.coreTypeSelect
  ? ok("no hireling, no core type-picker", "roles, never types — unmintable by construction")
  : fail("no hireling, no core type-picker", JSON.stringify(switchboard));
switchboard.selected === "character" && switchboard.resolvedNull
  ? ok("defaults to Player Character; dismissing creates nothing")
  : fail("defaults to Player Character; dismissing creates nothing", JSON.stringify(switchboard));
switchboard.hookGone
  ? ok("abHideHirelingType is no longer registered", "the surgery died with the dialog it operated on")
  : fail("abHideHirelingType is no longer registered", "still on renderDialogV2");

/* ------------------------------------------- impaired / enhanced damage ---
 * Cairn has no advantage or disadvantage: a damage roll is normal (the weapon's
 * die), impaired (1d4 whatever the weapon) or enhanced (1d12 whatever the
 * weapon). The choice is asked on the damage click.
 *
 * Run with use-panic OFF, and that is a REQUIREMENT of the design rather than
 * probe tidiness: the only d4 substitution that existed before this lived inside
 * panic's branch and was gated on that setting, so a version of this feature
 * built by extending it would disappear for a table with panic off. If these legs
 * only pass with panic on, the seam is wrong.
 * -------------------------------------------------------------------------- */
// Installed once: every dialog await in this section goes through it. A promise
// from a dialog that never opened never settles, and `await` on one hangs the
// whole probe with no output — which is exactly what happened while writing this.
// Racing means a missing dialog FAILS a leg instead of stopping the run.
const installQualityHelpers = async () => page.evaluate(async () => {
  window.__ab = {
    settle: (ms) => new Promise((r) => setTimeout(r, ms)),
    /**
     * Wait until NO dialog is left in the DOM.
     *
     * Call before opening the next one. A closing DialogV2 lingers for its
     * animation, so a poll for "a dialog button exists" that runs immediately
     * after a submit finds the PREVIOUS dialog — and every subsequent click then
     * lands on a corpse. That is what made the dismiss leg report UNSETTLED while
     * the ✕ works perfectly in isolation, and it silently turned the leg after it
     * into a false pass, because nothing was ever rolled.
     */
    async gone() {
      for (let i = 0; i < 40; i++) {
        if (!document.querySelector("dialog.dialog")) return true;
        await window.__ab.settle(150);
      }
      return false;
    },
    /** Wait for a button in the impaired/normal/enhanced dialog, or null. */
    async btn(action) {
      for (let i = 0; i < 40; i++) {
        const b = document.querySelector(`dialog.dialog button[data-action='${action}']`);
        if (b) return b;
        await window.__ab.settle(150);
      }
      return null;
    },
    /** Await a promise, or resolve to "UNSETTLED" — never hang. */
    race: (p, ms = 6000) =>
      Promise.race([p, new Promise((r) => setTimeout(() => r("UNSETTLED"), ms))]),
  };
});
await installQualityHelpers();

const quality = await page.evaluate(async ({ id }) => {
  const { settle, btn, race, gone } = window.__ab;
  const out = {};
  const actor = game.actors.get(id);
  const panicWas = game.settings.get("air-bladder", "use-panic");
  if (panicWas) await game.settings.set("air-bladder", "use-panic", false);
  out.panicOff = game.settings.get("air-bladder", "use-panic") === false;

  const { askDamageQuality, damageFormulaFor } = await import("/systems/air-bladder/module/utils.js");

  // 1. The three buttons render, and the middle one shows the WEAPON's die.
  await gone();
  const asked = askDamageQuality("1d6");
  const normalBtn = await btn("normal");
  out.dialogOpened = !!normalBtn;
  const btns = [...document.querySelectorAll("dialog.dialog button[data-action]")]
    .filter((b) => ["impaired", "normal", "enhanced"].includes(b.dataset.action));
  out.actions = btns.map((b) => b.dataset.action);
  out.labels = btns.map((b) => b.textContent.trim());
  normalBtn?.click();
  out.normalResult = await race(asked);

  // 2. DISMISSING resolves null and must roll nothing. This is the leg that
  //    catches DialogV2's null-callback trap: a button callback returning null
  //    resolves to the ACTION STRING instead (dialog.mjs:273), so a design that
  //    signalled "cancel" that way would be indistinguishable from a choice.
  out.priorGone = await gone();
  const dismissed = askDamageQuality("1d6");
  await btn("normal");
  document.querySelector("dialog.dialog")
    ?.querySelector('[data-action="close"], button[data-action="cancel"]')?.click();
  out.dismissed = await race(dismissed);
  await gone();

  // 3. Each choice maps to the right formula. Pure function, no dialog.
  out.formulas = ["impaired", "normal", "enhanced"].map((q) => damageFormulaFor(q, "1d6"));

  if (panicWas) await game.settings.set("air-bladder", "use-panic", true);
  return out;
}, { id: actorId });

// End to end through the REAL action, one evaluate per roll so a hang in any of
// them names itself. Asserted on the ROLL, not on the badge — the badge is the
// label, the formula is the rule.
const rollWith = async (choice) => page.evaluate(async ({ id, choice }) => {
  const { settle, btn, race, gone } = window.__ab;
  const actor = game.actors.get(id);
  const panicWas = game.settings.get("air-bladder", "use-panic");
  if (panicWas) await game.settings.set("air-bladder", "use-panic", false);
  // The previous roll's dialog must be off the DOM first, or every click below
  // lands on it instead.
  const priorGone = await gone();

  const before = game.messages.size;
  const target = document.createElement("a");
  target.dataset.roll = "1d6";
  target.dataset.label = "Probe Blade";
  const rolling = actor.sheet.options.actions.rollDamage.call(
    actor.sheet, { preventDefault() {}, button: 0 }, target);
  const asked = !!(await btn("normal"));
  if (choice === "dismiss") {
    document.querySelector("dialog.dialog")
      ?.querySelector('[data-action="close"], button[data-action="cancel"]')?.click();
  } else {
    document.querySelector(`dialog.dialog button[data-action='${choice}']`)?.click();
  }
  await race(rolling);
  for (let i = 0; i < 30 && game.messages.size <= before; i++) await settle(150);
  await settle(400);

  const posted = game.messages.size > before;
  const card = posted ? game.messages.contents.at(-1) : null;
  const out = {
    priorGone, asked, posted,
    formula: card?.rolls?.[0]?.formula ?? null,
    total: card?.rolls?.[0]?.total ?? null,
    flavor: String(card?.flavor ?? ""),
  };
  await card?.delete();
  if (panicWas) await game.settings.set("air-bladder", "use-panic", true);
  return out;
}, { id: actorId, choice });

const enhancedRoll = await rollWith("enhanced");
const normalRoll = await rollWith("normal");
const dismissedRoll = await rollWith("dismiss");

/* PANIC IMPOSES IMPAIRED and offers no choice (user ruling 2026-08-07). With
 * use-panic ON and the character panicked, NO dialog opens and the roll is 1d4.
 * This is the one leg in the section that turns panic on, and it is deliberately
 * last so it cannot leak the setting into the legs above. */
const panicRoll = await page.evaluate(async ({ id }) => {
  const { settle, btn, race, gone } = window.__ab;
  const actor = game.actors.get(id);
  const panicWas = game.settings.get("air-bladder", "use-panic");
  if (!panicWas) await game.settings.set("air-bladder", "use-panic", true);
  await actor.update({ "system.panicked": true });
  const priorGone = await gone();

  const before = game.messages.size;
  const target = document.createElement("a");
  target.dataset.roll = "1d6";
  target.dataset.label = "Probe Blade";
  const rolling = actor.sheet.options.actions.rollDamage.call(
    actor.sheet, { preventDefault() {}, button: 0 }, target);
  // A SHORT wait, deliberately: the claim is that no dialog appears, so this must
  // not be the same 6s poll the other legs use — it would pass just as well on a
  // dialog that was slow.
  await settle(1200);
  const dialogOpened = !!document.querySelector("dialog.dialog");
  if (dialogOpened) document.querySelector("dialog.dialog button[data-action='normal']")?.click();
  await race(rolling);
  for (let i = 0; i < 30 && game.messages.size <= before; i++) await settle(150);
  await settle(400);

  const card = game.messages.size > before ? game.messages.contents.at(-1) : null;
  const flavor = String(card?.flavor ?? "");
  const out = {
    priorGone, dialogOpened,
    posted: !!card,
    formula: card?.rolls?.[0]?.formula ?? null,
    total: card?.rolls?.[0]?.total ?? null,
    flavor,
    // The BADGE specifically, not "Panic appears anywhere in the flavor". The
    // weapon sentence already ends "(Panic)", so a whole-flavor regex stayed
    // GREEN in the fail-witness while the badge itself was absent.
    badge: (flavor.match(/class="dmg-quality"[^>]*>([^<]*)</) ?? [, ""])[1].trim(),
  };
  await card?.delete();
  await actor.update({ "system.panicked": false });
  if (!panicWas) await game.settings.set("air-bladder", "use-panic", false);
  return out;
}, { id: actorId });

quality.panicOff
  ? ok("precondition: use-panic is OFF", "the whole feature must work without it")
  : fail("precondition: use-panic is OFF", "these legs prove nothing with panic on");
quality.dialogOpened
  ? ok("the dialog opens")
  : fail("the dialog opens", "no dialog.dialog button[data-action=normal] appeared");
JSON.stringify(quality.actions) === JSON.stringify(["impaired", "normal", "enhanced"])
  ? ok("three choices, in order", quality.actions.join(" / "))
  : fail("three choices, in order", JSON.stringify(quality.actions));
/1d4/.test(quality.labels?.[0] ?? "") && /1d6/.test(quality.labels?.[1] ?? "") && /1d12/.test(quality.labels?.[2] ?? "")
  ? ok("the middle button shows the WEAPON's die", quality.labels.join(" | "))
  : fail("the middle button shows the WEAPON's die", JSON.stringify(quality.labels));
quality.normalResult === "normal"
  ? ok("a click resolves to its action")
  : fail("a click resolves to its action", String(quality.normalResult));
quality.dismissed === null
  ? ok("dismissing resolves null", "not the action string — DialogV2's null-callback trap")
  : fail("dismissing resolves null", String(quality.dismissed));
JSON.stringify(quality.formulas) === JSON.stringify(["1d4", "1d6", "1d12"])
  ? ok("each choice maps to its die", quality.formulas.join(" / "))
  : fail("each choice maps to its die", JSON.stringify(quality.formulas));
enhancedRoll.asked && enhancedRoll.posted && enhancedRoll.formula === "1d12"
  && enhancedRoll.total >= 1 && enhancedRoll.total <= 12 && /Enhanced/.test(enhancedRoll.flavor)
  ? ok("enhanced rolls 1d12 and says so", `${enhancedRoll.formula} = ${enhancedRoll.total}`)
  : fail("enhanced rolls 1d12 and says so", JSON.stringify(enhancedRoll));
// CONTROL: the same weapon rolled NORMAL keeps its own die and carries no badge,
// so "the formula changed" is the choice and not the plumbing.
normalRoll.posted && normalRoll.formula === "1d6" && !/Enhanced|Impaired/.test(normalRoll.flavor)
  ? ok("control: normal keeps the weapon's die, no badge", normalRoll.formula)
  : fail("control: normal keeps the weapon's die, no badge", JSON.stringify(normalRoll));
// priorGone on every leg: without it a stale dialog makes "nothing was rolled"
// pass for the wrong reason.
[enhancedRoll, normalRoll, dismissedRoll].every((r) => r.priorGone)
  ? ok("each roll starts with no dialog open", "a stale dialog eats the next leg's clicks")
  : fail("each roll starts with no dialog open",
    JSON.stringify([enhancedRoll.priorGone, normalRoll.priorGone, dismissedRoll.priorGone]));
dismissedRoll.asked && !dismissedRoll.posted
  ? ok("dismissing the damage roll posts nothing", "a ✕ is an instruction, not a default")
  : fail("dismissing the damage roll posts nothing", JSON.stringify(dismissedRoll));

// Panic imposes impaired and offers NO choice. Both halves matter: no dialog
// (the ruling) and 1d4 (the rule). Asserting only the die would pass on a build
// that still asked and then ignored the answer.
panicRoll.priorGone && !panicRoll.dialogOpened
  ? ok("panic asks nothing", "a panicked character cannot roll normal or enhanced")
  : fail("panic asks nothing", JSON.stringify(panicRoll));
panicRoll.posted && panicRoll.formula === "1d4"
  && panicRoll.total >= 1 && panicRoll.total <= 4
  ? ok("panic rolls impaired", `${panicRoll.formula} = ${panicRoll.total}`)
  : fail("panic rolls impaired", JSON.stringify(panicRoll));
// Read from the BADGE element, not the whole flavor: the weapon sentence already
// ends "(Panic)", so a flavor-wide regex stayed green in the fail-witness with no
// badge at all. It matters because the attack line REPLACES that sentence
// whenever there is a target, leaving the badge as the only thing saying why.
/Panic/.test(panicRoll.badge)
  ? ok("and the badge says why", `"${panicRoll.badge}"`)
  : fail("and the badge says why", `badge="${panicRoll.badge}"`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async ({ id, was }) => {
  await game.actors.find((a) => a.name === "ZZ Probe Mochila")?.delete();
  await game.actors.get(id)?.delete();
  if (!was) await game.settings.set("air-bladder", "show-features-section", false);
}, { id: actorId, was: featuresWere });

const errs = errors.filter((e) => !/Probe/.test(e));
errs.length === 0 ? ok("zero console errors") : fail("zero console errors", errs.join(" | "));

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\ndialogv2 probe passed");
process.exit(failures ? 1 : 0);
