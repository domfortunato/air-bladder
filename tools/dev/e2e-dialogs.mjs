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
// Behind an ACTOR_CREATE permission check, and it is the one dialog that creates
// a world Actor rather than an owned document.
//
// No setup any more: the Connections tab is structural. This used to enable
// `show-containers-tab` and RELOAD, because that setting was registered
// `requiresReload: true` — it changed which PARTS the sheet had — so setting it
// did not make the tab appear on an open sheet however long you waited. An
// earlier version set it, slept 1s and clicked, which only ever worked because a
// previous run had left it ON: the first run on a clean world timed out and
// every run after passed. That was the stale-precondition trap
// docs/release-testing.md warns about, and the setting it depended on is now
// gone entirely.
await page.locator(`nav.tabs a[data-tab="containers"]`).first().click();
await page.waitForTimeout(600);
await page.locator(".container-create").first().click();
await page.waitForSelector("dialog.dialog input[name='itemslots']", { timeout: 5000 });
await page.fill("dialog.dialog input[name='itemname']", "ZZ Probe Mochila");
await page.fill("dialog.dialog input[name='itemslots']", "5");
// Named in Spanish ON PURPOSE. A container's art and its one-word class label
// both come from a list of ENGLISH keywords, so "Mochila" classified as a chest
// and there was no way to say otherwise -- the affordance was English-only. The
// Kind select is that way. Setting .value directly for the same reason the item
// type does above: v14 hides <select> behind a custom element.
await page.evaluate(() => {
  const s = document.querySelector("dialog.dialog select[name='itemclass']");
  s.value = "backpack";
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.locator("dialog.dialog button[data-action='ok']").click();
await page.waitForTimeout(1500);

const cont = await page.evaluate(async (id) => {
  const c = game.actors.find((a) => a.name === "ZZ Probe Mochila");
  if (!c) return null;
  // The control: what the NAME alone would have produced. If this ever comes back
  // "backpack" the probe has stopped testing anything -- the picker and the
  // keyword table would agree and the assertions below would pass either way.
  const { containerClass } = await import("/systems/air-bladder/module/icons.js");
  return {
    // An npc connected at creation now, not a `container` keeper-linked after
    // (review #5: this dialog was the last module path minting the dissolved
    // type). A backpack is a thing: role container, hp 0/0, never the phantom 6.
    type: c.type,
    slots: Number(c.system.slots),
    connected: c.system.connectedTo === game.actors.get(id).uuid,
    role: c.system.role,
    hpMax: c.system.hp.max,
    stored: c.system.containerClass,
    art: c.img.split("/").pop(),
    label: c.system.classLabel,
    fromNameAlone: containerClass(c.name),
  };
}, actorId);
cont && cont.type === "npc" && cont.slots === 5 && cont.connected
  ? ok("an npc created and connected", `slots=${cont.slots} connected=${cont.connected}`)
  : fail("an npc created and connected", JSON.stringify(cont));
cont && cont.role === "container" && cont.hpMax === 0
  ? ok("a hand-made backpack is a thing", "role container, hp 0/0 — not the phantom 6")
  : fail("a hand-made backpack is a thing", `role=${cont?.role} hpMax=${cont?.hpMax}`);

if (!cont) {
  fail("the Kind select drove the container's class", "no container to inspect");
} else if (cont.fromNameAlone !== "chest") {
  fail("the Kind select drove the container's class",
    `the name "ZZ Probe Mochila" now classifies as "${cont.fromNameAlone}" on its own, `
    + "so this section no longer tests the picker");
} else if (cont.stored !== "backpack") {
  fail("the Kind select drove the container's class", `stored class is "${cont.stored}"`);
} else if (cont.art !== "backpack.svg") {
  fail("the Kind select drove the container's ART", `art is ${cont.art}, wanted backpack.svg`);
} else if (cont.label !== "Backpack") {
  fail("the Kind select drove the container's LABEL", `label is "${cont.label}", wanted Backpack`);
} else {
  ok("the Kind select drove art AND label", `a Spanish name the keyword table calls a `
    + `"${cont.fromNameAlone}" is a ${cont.art.replace(".svg", "")} labelled "${cont.label}"`);
}

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
