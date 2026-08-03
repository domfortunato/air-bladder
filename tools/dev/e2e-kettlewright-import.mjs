import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

// Self-contained sample KW export written to a temp file for the file chooser.
const tmp = path.join(process.env.TEMP || ".", "kw_sample_e2e.json");
fs.writeFileSync(tmp, JSON.stringify({
  name: "Yorsa E2E", background: "Kettlewright",
  strength: 12, strength_max: 12, dexterity: 10, dexterity_max: 10, willpower: 7, willpower_max: 9,
  hp: 4, hp_max: 4, gold: 30, deprived: false, panicked: false, armor: "1",
  description: "An e2e peddler.", traits: "Stern", notes: "hi", bonds: "A debt.", scars: "Nicked;Burned", omens: "Ravens.",
  // A STOCK portrait pick: Kettlewright stores the bare filename, and the
  // import must map it to our shipped copy (tlomdev/Kettlewright Portraits/,
  // Kettlewright's exact numbering) on portrait AND token.
  custom_image: false, image_url: "portrait17.webp",
  items: [
    { id: "a", name: "Rations", tags: ["uses"], uses: 3, location: 0, description: "-" },
    { id: "b", name: "Widget QZ", tags: ["1 Armor"], location: 0, description: "odd" },
    { id: "c", name: "Fatigue", tags: [], location: 0, editable: false },
  ],
  containers: [{ id: 0, name: "Main", slots: 10 }, { id: 1, name: "Mule", slots: 4 }],
}));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

// Open the Actors sidebar tab so renderActorDirectory fires + the button injects.
await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
await page.waitForTimeout(600);
const hasButton = await page.evaluate(() => !!document.querySelector(".import-kettlewright-button"));

// Intercept the native file chooser and feed our sample.
page.on("filechooser", (fc) => fc.setFiles(tmp).catch(() => {}));

await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());

// The button no longer opens the file chooser directly: it first shows an
// OPTIONS dialog ("Require a matching background") whose Import button is what
// actually calls the picker. Without this the probe sat on that dialog and
// reported `summaryShown: true` — because the options dialog is a dialog too.
// Assert we are on the right one rather than clicking whatever is on screen.
await page.waitForSelector('[data-action="import"]', { timeout: 10000 }).catch(() => {});
const optionsDialogFound = await page.evaluate(() => {
  const btn = document.querySelector('[data-action="import"]');
  if (!btn) return false;
  btn.click();
  return true;
});

// Wait for the import to finish: the actor appears + the summary dialog renders.
await page.waitForFunction(() => !!game.actors.getName("Yorsa E2E"), null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);

const out = await page.evaluate(() => {
  const a = game.actors.getName("Yorsa E2E");
  const dlg = document.querySelector(".dialog-v2, .application.dialog, dialog.application");
  return {
    actorCreated: !!a,
    itemCount: a?.items?.size ?? 0,
    bgUuidSet: !!a?.system?.backgroundUuid,
    armor: a?.system?.armorOverride,
    scars: a?.system?.scars ?? [],
    img: a?.img ?? null,
    token: a?.prototypeToken?.texture?.src ?? null,
    summaryShown: !!dlg,
    summaryText: dlg?.textContent?.replace(/\s+/g, " ").trim().slice(0, 300) ?? "",
  };
});

// The rest of the portrait decision table, straight through the exported
// converter: the placeholder and an unknown number keep the random-pair
// fallback (asserted as "NOT the Kettlewright folder" — whether the random
// pool is Aspeheim or the world's custom folder is not this probe's business),
// and a custom absolute URL is used verbatim.
const KW_DIR = "systems/air-bladder/tlomdev/Kettlewright Portraits";
const mapping = await page.evaluate(async () => {
  const { kettlewrightToActorData } = await import("/systems/air-bladder/module/kettlewright-import.js");
  const base = {
    name: "ZZ KW Map", background: "Kettlewright",
    strength: 10, strength_max: 10, dexterity: 10, dexterity_max: 10, willpower: 10, willpower_max: 10,
    hp: 3, hp_max: 3, gold: 0, deprived: false, panicked: false, armor: "0",
    description: "", traits: "", notes: "", bonds: "", scars: "", omens: "",
    items: [], containers: [],
  };
  const imgOf = async (patch) => {
    const { data } = await kettlewrightToActorData({ ...base, ...patch });
    return { img: data.img ?? null, token: data.prototypeToken?.texture?.src ?? null };
  };
  return {
    placeholder: await imgOf({ custom_image: false, image_url: "default-portrait.webp" }),
    unknown: await imgOf({ custom_image: false, image_url: "portrait999.webp" }),
    custom: await imgOf({ custom_image: true, image_url: "https://example.com/me.png" }),
  };
});

const dlg = await page.$(".dialog-v2, .application.dialog, dialog.application");
if (dlg) await dlg.screenshot({ path: "tools/dev/out/kw-import-summary.png" });

// Cleanup
await page.evaluate(() => game.actors.getName("Yorsa E2E")?.delete());
await browser.close();
fs.rmSync(tmp, { force: true });

console.log(JSON.stringify(out, null, 2));
console.log(JSON.stringify(mapping, null, 2));
const stockMapped = out.img === `${KW_DIR}/portrait17.webp` && out.token === out.img;
const fallbacksKept = !mapping.placeholder.img?.startsWith(KW_DIR) && !!mapping.placeholder.img
  && !mapping.unknown.img?.startsWith(KW_DIR) && !!mapping.unknown.img
  && mapping.custom.img === "https://example.com/me.png";
const ok = hasButton && optionsDialogFound && out.actorCreated && out.itemCount === 3 && out.bgUuidSet && out.armor === 1
  && JSON.stringify(out.scars) === JSON.stringify(["Nicked", "Burned"]) && out.summaryShown
  && stockMapped && fallbacksKept && errors.length === 0;
if (!hasButton) console.log("FAIL: import button not injected");
if (!optionsDialogFound) console.log("FAIL: no [data-action=import] options dialog appeared");
if (!stockMapped) console.log(`FAIL: stock portrait17.webp not mapped to the shipped tlomdev copy (img=${out.img}, token=${out.token})`);
if (!fallbacksKept) console.log("FAIL: placeholder/unknown/custom portrait fallbacks changed behaviour");
if (errors.length) console.log("Console errors:\n" + errors.join("\n"));
console.log(ok ? "e2e passed" : "e2e FAILED");
process.exit(ok ? 0 : 1);
