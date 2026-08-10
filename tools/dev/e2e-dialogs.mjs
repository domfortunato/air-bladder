/**
 * One-off probe: the sheet dialogs ported from V1 Dialog to DialogV2 — add
 * item and the regenerate confirm (the add/edit-feature pair went with the
 * Features UI, 2026-08-09; this probe now asserts the Features section is
 * ABSENT, against planted stored data, and that the data survives).
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

// A throwaway actor, so nothing in the dev world is disturbed.
//
// Sweep leftovers FIRST. This probe creates a world Actor by name and later looks
// it up the same way, so a run that dies midway leaves one behind — and every
// later run then finds the STALE sack, whose keeper points at an actor that no
// longer exists, and fails identically forever. One real failure otherwise turns
// into a permanent one, which reads exactly like a code bug and is not.
const { actorId } = await page.evaluate(async () => {
  for (const stale of game.actors.filter((a) => ["ZZ DialogV2 Probe", "ZZ Probe Mochila"].includes(a.name))) {
    await stale.delete().catch(() => {});
  }
  // generationEnabled seeded: the default is Off since 2026-08-02 and the
  // rollActor leg below clicks the header button that flag reveals.
  const a = await Actor.create({ name: "ZZ DialogV2 Probe", type: "character", system: { generationEnabled: true } });
  a.sheet.render(true);
  return { actorId: a.id };
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

/* ------------------------------------------- features are gone (2026-08-09) */
// The add/edit-feature dialogs and the Features section were removed with the
// Features UI (user ruling). The absence is asserted on the tab that carried
// them, with STORED features planted first — the load-bearing half: an empty
// list renders nothing whether or not the removal landed, so only planted data
// can prove the section is gone rather than merely empty. The data itself must
// survive on the document (the field stays declared; user data is kept).
await page.evaluate((id) =>
  game.actors.get(id).update({ "system.features": [{ id: "zzdlg1", name: "ZZ Stored Feature", description: "kept" }] }), actorId);
await page.locator(`nav.tabs a[data-tab="description"]`).first().click();
await page.waitForTimeout(600);
const featGone = await page.evaluate((id) => {
  const a = game.actors.get(id);
  const el = a.sheet.element instanceof HTMLElement ? a.sheet.element : a.sheet.element?.[0];
  return {
    createControl: !!el?.querySelector(".feature-create"),
    section: !!el?.querySelector(".features"),
    stored: a.system.features?.length ?? 0,
  };
}, actorId);
!featGone.createControl && !featGone.section
  ? ok("no Features section on the PC Description tab", "with a stored feature planted — gone, not merely empty")
  : fail("no Features section on the PC Description tab", JSON.stringify(featGone));
featGone.stored === 1
  ? ok("the stored feature survives on the document", "the field is orphaned, not dropped")
  : fail("the stored feature survives on the document", `system.features length ${featGone.stored}`);

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
  && JSON.stringify(switchboard.values) === JSON.stringify(["character", "npc", "monster", "companion", "transport", "container"])
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
 * Cairn has no advantage or disadvantage: a damage roll is STANDARD (the weapon's
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
    /** Wait for a button in the impaired/standard/enhanced dialog, or null. */
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

  // 1. The three buttons render, and the FIRST one shows the WEAPON's die.
  //    Standard leads as of 2026-08-07 (user ruling) — the default is where the
  //    eye starts and where autofocus already sat. This leg's NAME and its three
  //    indices moved together with the order; getting only the actions array
  //    right would leave it passing while asserting the wrong button.
  await gone();
  const asked = askDamageQuality("1d6", "ZZ Probe Crossbow");
  const standardBtn = await btn("standard");
  // The dialog names the item the roll came from.
  out.titleWeapon = document.querySelector("dialog.dialog .window-title")?.textContent.trim() ?? null;
  out.dialogOpened = !!standardBtn;
  const btns = [...document.querySelectorAll("dialog.dialog button[data-action]")]
    .filter((b) => ["impaired", "standard", "enhanced"].includes(b.dataset.action));
  out.actions = btns.map((b) => b.dataset.action);
  out.labels = btns.map((b) => b.textContent.trim());
  // The QUESTION above the buttons, and the order it names the three qualities
  // in. What is asserted below is that the sentence and the buttons AGREE —
  // not that the prompt equals a literal. Round 3 moved Standard to the front of
  // the buttons and left the sentence saying "impaired, standard or enhanced",
  // so the prompt was the last place in the dialog still stating the old order;
  // a literal check would go stale the next time a button moves and would not
  // have caught that drift either.
  out.prompt = document.querySelector("dialog.dialog .window-content p")?.textContent.trim() ?? null;
  out.promptOrder = ["standard", "impaired", "enhanced"]
    .map((w) => [w, (out.prompt ?? "").toLowerCase().indexOf(w)])
    .filter(([, i]) => i >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([w]) => w);
  // Each button carries its OWN die's glyph. Read the <i>'s class list rather
  // than the rendered glyph: unlike the chat control's fa-burst, the point here
  // is that d4/d6/d12 are three DIFFERENT icons, and every fa-dice-dN renders
  // something, so an all-d20 bug would pass a "draws a glyph" check.
  out.icons = btns.map((b) => b.querySelector("i")?.className ?? null);
  // The default cue. All three read together: the class is the styling hook,
  // `autofocus` is the fact it claims, and the weight is what a player sees. A
  // class present with no rule behind it would pass on the first alone.
  out.defaultClass = standardBtn?.classList.contains("cairn-quality-default");
  out.defaultAutofocus = standardBtn?.hasAttribute("autofocus");
  out.defaultWeight = standardBtn ? getComputedStyle(standardBtn).fontWeight : null;
  out.footerDirection = getComputedStyle(
    document.querySelector("dialog.dialog .form-footer") ?? document.body).flexDirection;
  // NO OFFSET (user ask). Two declarations, because the ⏎ and the label/icon are
  // pushed apart by different rules: the button centres its contents, and the
  // pseudo-element no longer claims the leading space with `margin-left: auto`.
  // Asserted as declarations rather than geometry AND THE PROBE SAYS SO — a
  // pseudo-element has no rect, so whether it LOOKS centred is the user's eye.
  out.defaultJustify = standardBtn ? getComputedStyle(standardBtn).justifyContent : null;
  out.defaultAfterMargin = standardBtn
    ? getComputedStyle(standardBtn, "::after").marginLeft : null;
  standardBtn?.click();
  out.standardResult = await race(asked);

  // 1b. THE FALLBACK, BOTH ENDS. A formula naming no standard die gets no icon
  //     at all rather than a generic one. Asserting only "standard has none"
  //     would pass on a dieIcon that never returns anything, so the other two
  //     buttons — whose formulas are constants — must still carry theirs in the
  //     SAME dialog.
  await gone();
  const oddAsked = askDamageQuality("3");
  const oddStandard = await btn("standard");
  out.oddIcons = ["standard", "impaired", "enhanced"].map((a) =>
    document.querySelector(`dialog.dialog button[data-action='${a}']`)
      ?.querySelector("i")?.className ?? null);
  // BOTH ENDS of the title too: no weapon name falls back to the plain title.
  // Asserting only the named form would pass on a build that always appends.
  out.titlePlain = document.querySelector("dialog.dialog .window-title")?.textContent.trim() ?? null;
  oddStandard?.click();
  await race(oddAsked);

  // 2. DISMISSING resolves null and must roll nothing. This is the leg that
  //    catches DialogV2's null-callback trap: a button callback returning null
  //    resolves to the ACTION STRING instead (dialog.mjs:273), so a design that
  //    signalled "cancel" that way would be indistinguishable from a choice.
  out.priorGone = await gone();
  const dismissed = askDamageQuality("1d6");
  await btn("standard");
  document.querySelector("dialog.dialog")
    ?.querySelector('[data-action="close"], button[data-action="cancel"]')?.click();
  out.dismissed = await race(dismissed);
  await gone();

  // 3. Each choice maps to the right formula. Pure function, no dialog.
  out.formulas = ["impaired", "standard", "enhanced"].map((q) => damageFormulaFor(q, "1d6"));

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
  const asked = !!(await btn("standard"));
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
const standardRoll = await rollWith("standard");
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
  if (dialogOpened) document.querySelector("dialog.dialog button[data-action='standard']")?.click();
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
  : fail("the dialog opens", "no dialog.dialog button[data-action=standard] appeared");
// STANDARD LEADS (user ruling 2026-08-07). Beyond the ask, this closes a latent
// trap: `isDefault` falls back to `(i === 0) && !buttons.some(b => b.default)`
// (dialog.mjs:228), so with Impaired at index 0, dropping `default: true` would
// silently have made IMPAIRED the button Enter presses.
JSON.stringify(quality.actions) === JSON.stringify(["standard", "impaired", "enhanced"])
  ? ok("three choices, in order", quality.actions.join(" / "))
  : fail("three choices, in order", JSON.stringify(quality.actions));
/1d6/.test(quality.labels?.[0] ?? "") && /1d4/.test(quality.labels?.[1] ?? "") && /1d12/.test(quality.labels?.[2] ?? "")
  ? ok("the FIRST button shows the WEAPON's die", quality.labels.join(" | "))
  : fail("the FIRST button shows the WEAPON's die", JSON.stringify(quality.labels));
// THE PROMPT AGREES WITH THE BUTTONS. Compared to `actions` rather than to a
// literal sentence: the invariant is that the question does not name the three
// in an order the buttons contradict, and that is what stops this drifting again
// the next time one moves. All three must appear, or promptOrder is short and
// the comparison fails.
JSON.stringify(quality.promptOrder) === JSON.stringify(quality.actions)
  ? ok("the question names them in button order", `"${quality.prompt}"`)
  : fail("the question names them in button order",
    `prompt "${quality.prompt}" reads ${JSON.stringify(quality.promptOrder)}, buttons are ${JSON.stringify(quality.actions)}`);
// The title names the item the roll came from, BOTH ENDS: a roll with no item
// falls back to the plain title. Asserting only the named form passes on a build
// that always appends, and a dangling "— " is not repairable by a translator —
// which is why there are two keys rather than one with an empty placeholder.
quality.titleWeapon === "Damage roll — ZZ Probe Crossbow" && quality.titlePlain === "Damage roll"
  ? ok("the title names the item", `"${quality.titleWeapon}" / "${quality.titlePlain}"`)
  : fail("the title names the item", `"${quality.titleWeapon}" / "${quality.titlePlain}"`);
// The ICON per button, read as a class list rather than as a rendered glyph:
// every fa-dice-dN renders something, so "it draws a glyph" would pass on a
// helper that returned d20 for all three. The claim is that they DIFFER.
JSON.stringify(quality.icons)
  === JSON.stringify(["fa-solid fa-dice-d6", "fa-solid fa-dice-d4", "fa-solid fa-dice-d12"])
  ? ok("each button carries its own die", quality.icons.join(" | "))
  : fail("each button carries its own die", JSON.stringify(quality.icons));
// The fallback, BOTH ENDS in one dialog: a formula naming no standard die gets
// no icon, while the two constants still have theirs. Either end alone passes on
// a dieIcon that always returns "" (or always returns something). The NULL is at
// index 0 now — oddIcons is read in the new button order.
quality.oddIcons?.[0] === null
  && /fa-dice-d4$/.test(quality.oddIcons?.[1] ?? "")
  && /fa-dice-d12$/.test(quality.oddIcons?.[2] ?? "")
  ? ok("a formula with no die gets NO icon", JSON.stringify(quality.oddIcons))
  : fail("a formula with no die gets NO icon", JSON.stringify(quality.oddIcons));
// Three readings of one claim: the hook, the fact it asserts, and what a player
// actually sees. A class with no rule behind it passes the first alone.
quality.defaultClass && quality.defaultAutofocus && Number(quality.defaultWeight) >= 700
  ? ok("the default choice says it is one", `class + autofocus, weight ${quality.defaultWeight}`)
  : fail("the default choice says it is one",
    `class=${quality.defaultClass} autofocus=${quality.defaultAutofocus} weight=${quality.defaultWeight}`);
quality.footerDirection === "column"
  ? ok("the three choices stack", "core's row rule is @layer blocks.base; system outranks it")
  : fail("the three choices stack", String(quality.footerDirection));
// NO OFFSET (user ask). Read as the two declarations, not as geometry, AND THAT
// IS A STATED LIMIT: a pseudo-element has no rect, so whether the result LOOKS
// centred is the user's eye. What is checkable is that neither rule is pushing
// anything to an edge any more.
// The margin is read as a NUMBER under 20px rather than as `!== "auto"`, and the
// difference matters: getComputedStyle may resolve an auto margin to its USED
// value, in which case a string comparison against "auto" never matches and the
// leg is green with the offset live. A used auto in this footer is tens of px
// wide; 0.4em is ~6. Either way the browser reports it, this discriminates.
const afterPx = parseFloat(quality.defaultAfterMargin ?? "");
quality.defaultJustify === "center" && Number.isFinite(afterPx) && afterPx < 20
  ? ok("nothing is pushed to an edge",
    `justify-content: ${quality.defaultJustify}, ::after margin-left: ${quality.defaultAfterMargin}`)
  : fail("nothing is pushed to an edge",
    `justify-content: ${quality.defaultJustify}, ::after margin-left: ${quality.defaultAfterMargin}`);
quality.standardResult === "standard"
  ? ok("a click resolves to its action")
  : fail("a click resolves to its action", String(quality.standardResult));
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
standardRoll.posted && standardRoll.formula === "1d6" && !/Enhanced|Impaired/.test(standardRoll.flavor)
  ? ok("control: standard keeps the weapon's die, no badge", standardRoll.formula)
  : fail("control: standard keeps the weapon's die, no badge", JSON.stringify(standardRoll));
// priorGone on every leg: without it a stale dialog makes "nothing was rolled"
// pass for the wrong reason.
[enhancedRoll, standardRoll, dismissedRoll].every((r) => r.priorGone)
  ? ok("each roll starts with no dialog open", "a stale dialog eats the next leg's clicks")
  : fail("each roll starts with no dialog open",
    JSON.stringify([enhancedRoll.priorGone, standardRoll.priorGone, dismissedRoll.priorGone]));
dismissedRoll.asked && !dismissedRoll.posted
  ? ok("dismissing the damage roll posts nothing", "a ✕ is an instruction, not a default")
  : fail("dismissing the damage roll posts nothing", JSON.stringify(dismissedRoll));

// Panic imposes impaired and offers NO choice. Both halves matter: no dialog
// (the ruling) and 1d4 (the rule). Asserting only the die would pass on a build
// that still asked and then ignored the answer.
panicRoll.priorGone && !panicRoll.dialogOpened
  ? ok("panic asks nothing", "a panicked character cannot roll standard or enhanced")
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
await page.evaluate(async (id) => {
  await game.actors.find((a) => a.name === "ZZ Probe Mochila")?.delete();
  await game.actors.get(id)?.delete();
}, actorId);

const errs = errors.filter((e) => !/Probe/.test(e));
errs.length === 0 ? ok("zero console errors") : fail("zero console errors", errs.join(" | "));

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\ndialogv2 probe passed");
process.exit(failures ? 1 : 0);
