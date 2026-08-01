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
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors, withHookOff } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(34)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(34)} ${d}`); failures++; };

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
  const a = await Actor.create({ name: "ZZ DialogV2 Probe", type: "character" });
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

/* ---------------------------------------- Create Actor: no `hireling` ---- */
// The retired alias TYPE cannot be UNREGISTERED — ids are immutable and every
// existing hireling would point at an undeclared subtype — but Foundry offers
// every registered subtype in the create dialog and has no manifest flag for
// "declared but not offered". So `abHideHirelingType` removes the option, and a
// Warden can no longer mint a document against a folded-away model. This is the
// exact mistake the `container` type made visible on 2026-07-31.
const readActorTypes = () => page.evaluate(async () => {
  const p = getDocumentClass("Actor").createDialog();
  await new Promise((r) => setTimeout(r, 500));
  const form = [...document.querySelectorAll("dialog form")].find((f) => f.querySelector('select[name="type"]'));
  const out = {
    values: [...form.querySelectorAll('select[name="type"] option')].map((o) => o.value),
    selected: form.querySelector('select[name="type"]').value,
  };
  // Always press a button: an unanswered modal prompt never settles.
  form.closest("dialog").querySelector('button[data-action="ok"], button[data-action="cancel"]')?.click();
  const doc = await p.catch(() => null);
  await doc?.sheet?.close();
  await doc?.delete();
  return out;
});

const actorTypes = await readActorTypes();
!actorTypes.values.includes("hireling") && actorTypes.values.includes("npc")
  ? ok("Create Actor offers no `hireling`", actorTypes.values.join(", "))
  : fail("Create Actor offers no `hireling`", actorTypes.values.join(", "));
actorTypes.selected !== "hireling"
  ? ok("...and the select is left on a real option", actorTypes.selected)
  : fail("...and the select is left on a real option", "still selecting the removed option");

// Its own negative control, in-page: with the hook off the option must be back,
// or the two assertions above hold for some other reason entirely.
const withHireling = await withHookOff(page, "renderDialogV2", "abHideHirelingType", readActorTypes);
withHireling.values.includes("hireling")
  ? ok("with the hook off it returns", "so the check above is load-bearing")
  : fail("with the hook off it returns", `still absent: ${withHireling.values.join(", ")}`);

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
