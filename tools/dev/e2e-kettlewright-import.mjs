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
  custom_image: false, image_url: "",
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
    summaryShown: !!dlg,
    summaryText: dlg?.textContent?.replace(/\s+/g, " ").trim().slice(0, 300) ?? "",
  };
});

const dlg = await page.$(".dialog-v2, .application.dialog, dialog.application");
if (dlg) await dlg.screenshot({ path: "tools/dev/out/kw-import-summary.png" });

// Cleanup
await page.evaluate(() => game.actors.getName("Yorsa E2E")?.delete());
await browser.close();
fs.rmSync(tmp, { force: true });

console.log(JSON.stringify(out, null, 2));
const ok = hasButton && out.actorCreated && out.itemCount === 3 && out.bgUuidSet && out.armor === 1
  && JSON.stringify(out.scars) === JSON.stringify(["Nicked", "Burned"]) && out.summaryShown && errors.length === 0;
if (!hasButton) console.log("FAIL: import button not injected");
if (errors.length) console.log("Console errors:\n" + errors.join("\n"));
console.log(ok ? "e2e passed" : "e2e FAILED");
process.exit(ok ? 0 : 1);
