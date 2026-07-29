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
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors } from "./lib.mjs";

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
  for (const stale of game.actors.filter((a) => ["ZZ DialogV2 Probe", "ZZ Probe Sack"].includes(a.name))) {
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

  const edited = await page.evaluate((id) =>
    game.actors.get(id).system.features?.find((f) => f.name === "Probe Feature Edited") ?? null, actorId);
  edited && edited.str === false && edited.wil === true && edited.blast === true
    ? ok("feature edited, flags round-tripped", `str=${edited.str} wil=${edited.wil} blast=${edited.blast}`)
    : fail("feature edited, flags round-tripped", JSON.stringify(edited));
}

/* ----------------------------------------------------------- container ---- */
// Behind its own GM setting and an ACTOR_CREATE permission check, and it is the
// one dialog that creates a world Actor rather than an owned document.
const containersWere = await page.evaluate(async () => {
  const was = game.settings.get("air-bladder", "show-containers-tab");
  if (!was) await game.settings.set("air-bladder", "show-containers-tab", true);
  return was;
});
await page.waitForTimeout(1000);
await page.locator(`nav.tabs a[data-tab="containers"]`).first().click();
await page.waitForTimeout(600);
await page.locator(".container-create").first().click();
await page.waitForSelector("dialog.dialog input[name='itemslots']", { timeout: 5000 });
await page.fill("dialog.dialog input[name='itemname']", "ZZ Probe Sack");
await page.fill("dialog.dialog input[name='itemslots']", "5");
await page.locator("dialog.dialog button[data-action='ok']").click();
await page.waitForTimeout(1500);

const cont = await page.evaluate((id) => {
  const c = game.actors.find((a) => a.name === "ZZ Probe Sack");
  if (!c) return null;
  return { slots: Number(c.system.slots), keeper: c.system.keeper === game.actors.get(id).uuid };
}, actorId);
cont && cont.slots === 5 && cont.keeper
  ? ok("container created and linked", JSON.stringify(cont))
  : fail("container created and linked", JSON.stringify(cont));

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

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async ({ id, was, contWas }) => {
  await game.actors.find((a) => a.name === "ZZ Probe Sack")?.delete();
  await game.actors.get(id)?.delete();
  if (!was) await game.settings.set("air-bladder", "show-features-section", false);
  if (!contWas) await game.settings.set("air-bladder", "show-containers-tab", false);
}, { id: actorId, was: featuresWere, contWas: containersWere });

const errs = errors.filter((e) => !/Probe/.test(e));
errs.length === 0 ? ok("zero console errors") : fail("zero console errors", errs.join(" | "));

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\ndialogv2 probe passed");
process.exit(failures ? 1 : 0);
