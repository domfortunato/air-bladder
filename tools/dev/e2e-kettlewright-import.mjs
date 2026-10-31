import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

// Self-contained sample KW export written to a temp file for the file chooser.
const tmp = path.join(process.env.TEMP || ".", "kw_sample_e2e.json");
fs.writeFileSync(tmp, JSON.stringify({
  name: "Yorsa E2E", background: "Kettlewright",
  strength: 12, strength_max: 12, dexterity: 10, dexterity_max: 10, willpower: 7, willpower_max: 9,
  hp: 4, hp_max: 4, gold: 30, deprived: false, panicked: false, armor: "1",
  description: "An e2e peddler.", traits: "Stern", notes: "hi", bonds: "A debt.", scars: "Nicked;Burned", omens: "Ravens.",
  // A STOCK portrait pick: Kettlewright stores the bare filename, and the
  // import must map it to our shipped copy (tlomdev/kettlewright-portraits/,
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

// The fleet's hang guard (review #34 finding 25): without it a hang runs to

// the runner's 65-minute cap, skips every restore, and the box is never

// marked suspect. A bound on a hang, not a timing claim.

watchdog(600000, "kettlewright-import probe", () => browser.close());
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

// Open the Actors sidebar tab so renderActorDirectory fires + the button injects.
await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
await page.waitForTimeout(600);
const hasButton = await page.evaluate(() => !!document.querySelector(".import-kettlewright-button"));

// Intercept the native file chooser and feed our sample.
page.on("filechooser", (fc) => fc.setFiles(tmp).catch(() => {}));

// BY ID DIFFERENCE, never by name (review #34 finding 36). The wait and the
// read used `getName("Yorsa E2E")`, and the delete ran only on the straight
// path — so a run that stopped between the create and the cleanup left a
// Yorsa behind, and the NEXT run's wait succeeded at once and read every
// assertion off that old, correctly imported actor, even with the import
// broken. The cleanup is in the finally below.
const beforeIds = await page.evaluate(() => game.actors.map((a) => a.id));
const KW_DIR = "systems/air-bladder/art/tlomdev/kettlewright-portraits";
let out, mapping, badUrlCreate, optionsDialogFound;
try {
  await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());

  // The button no longer opens the file chooser directly: it first shows an
  // OPTIONS dialog (informational since the gate retired) whose Import button is
  // what actually calls the picker. Without this the probe sat on that dialog and
  // reported `summaryShown: true` — because the options dialog is a dialog too.
  // Assert we are on the right one rather than clicking whatever is on screen.
  await page.waitForSelector('[data-action="import"]', { timeout: 10000 }).catch(() => {});
  optionsDialogFound = await page.evaluate(() => {
    const btn = document.querySelector('[data-action="import"]');
    if (!btn) return false;
    btn.click();
    return true;
  });

  // Wait for the import to finish: a NEW actor appears + the summary dialog renders.
  await page.waitForFunction((ids) => game.actors.some((a) => a.name === "Yorsa E2E" && !ids.includes(a.id)),
    beforeIds, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);

  out = await page.evaluate((ids) => {
    const fresh = game.actors.filter((x) => x.name === "Yorsa E2E" && !ids.includes(x.id));
    const a = fresh.length === 1 ? fresh[0] : null;
    // THE SUMMARY, by its own content — not "any dialog", which the lingering
    // options dialog also satisfies.
    const dlg = document.querySelector(".kwi-summary")?.closest(".application") ?? null;
    return {
      freshCount: fresh.length,
      actorCreated: !!a,
      itemCount: a?.items?.size ?? 0,
      bgUuidSet: !!a?.system?.backgroundUuid,
      armor: a?.system?.armorOverride,
      scars: a?.system?.scars ?? [],
      img: a?.img ?? null,
      token: a?.prototypeToken?.texture?.src ?? null,
      // THE PARTY FOLDER (review #34 finding 174), where Create PC beside the
      // import button files a new character.
      inParty: a?.folder?.getFlag("air-bladder", "partyFolder") === true,
      summaryShown: !!dlg,
      summaryText: dlg?.textContent?.replace(/\s+/g, " ").trim().slice(0, 300) ?? "",
    };
  }, beforeIds);

  // The rest of the portrait decision table, straight through the exported
  // converter: the placeholder and an unknown number keep the random-pair
  // fallback (asserted as "NOT the Kettlewright folder" — whether the random
  // pool is Aspeheim or the world's custom folder is not this probe's business),
  // and a custom absolute URL is used verbatim WHEN core's img field would
  // accept it. One Foundry refuses (no image extension) is dropped with a
  // report.portrait entry instead of killing the create — as is a discarded
  // filename, so the summary can say the chosen face was lost (2026-09-01).
  mapping = await page.evaluate(async () => {
    const { kettlewrightToActorData } = await import("/systems/air-bladder/module/kettlewright-import.js");
    const base = {
      name: "ZZ KW Map", background: "Kettlewright",
      strength: 10, strength_max: 10, dexterity: 10, dexterity_max: 10, willpower: 10, willpower_max: 10,
      hp: 3, hp_max: 3, gold: 0, deprived: false, panicked: false, armor: "0",
      description: "", traits: "", notes: "", bonds: "", scars: "", omens: "",
      items: [], containers: [],
    };
    const imgOf = async (patch) => {
      const { data, report } = await kettlewrightToActorData({ ...base, ...patch });
      return { img: data.img ?? null, token: data.prototypeToken?.texture?.src ?? null, portrait: report.portrait ?? null };
    };
    return {
      placeholder: await imgOf({ custom_image: false, image_url: "default-portrait.webp" }),
      unknown: await imgOf({ custom_image: false, image_url: "portrait999.webp" }),
      custom: await imgOf({ custom_image: true, image_url: "https://example.com/me.png" }),
      customNoExt: await imgOf({ custom_image: true, image_url: "https://example.com/myimage" }),
    };
  });

  // An unusable URL must not kill the CREATE either — this is the very failure
  // the 2026-09-01 report was about: the GM picked a file, clicked Import, and
  // got a raw DataModelValidationError instead of a character.
  badUrlCreate = await page.evaluate(async () => {
    const { kettlewrightToActorData } = await import("/systems/air-bladder/module/kettlewright-import.js");
    const { data } = await kettlewrightToActorData({
      name: "ZZ KW BadUrl", background: "Kettlewright",
      strength: 10, strength_max: 10, dexterity: 10, dexterity_max: 10, willpower: 10, willpower_max: 10,
      hp: 3, hp_max: 3, gold: 0, deprived: false, panicked: false, armor: "0",
      description: "", traits: "", notes: "", bonds: "", scars: "", omens: "",
      custom_image: true, image_url: "https://example.com/download?id=abc&format=png",
      items: [], containers: [],
    });
    try {
      const actor = await CONFIG.Actor.documentClass.create(data);
      const created = !!actor;
      if (actor) {
        await actor.delete();
        // Poll the deletion home — a probe must not leave a planted actor behind.
        for (let i = 0; i < 20 && game.actors.get(actor.id); i++) await new Promise((r) => setTimeout(r, 100));
      }
      return { created, gone: !game.actors.getName("ZZ KW BadUrl"), error: null };
    } catch (e) {
      return { created: false, gone: !game.actors.getName("ZZ KW BadUrl"), error: e.message };
    }
  });

  const dlg = await page.$(".application:has(.kwi-summary)");
  if (dlg) await dlg.screenshot({ path: "tools/dev/out/kw-import-summary.png" });
} finally {
  // Cleanup, BY ID DIFFERENCE, from the finally (review #34 finding 36): only
  // the Yorsa this run created, whatever happened above. A Warden's own
  // imported Yorsa — it is a real player's exported character — is never
  // touched.
  await page.evaluate(async (ids) => {
    for (const a of game.actors.filter((x) => x.name === "Yorsa E2E" && !ids.includes(x.id))) await a.delete();
  }, beforeIds).catch(() => {});
  await browser.close();
  fs.rmSync(tmp, { force: true });
}

console.log(JSON.stringify(out, null, 2));
console.log(JSON.stringify(mapping, null, 2));
console.log(JSON.stringify(badUrlCreate, null, 2));
const stockMapped = out.img === `${KW_DIR}/portrait17.webp` && out.token === out.img;
const fallbacksKept = !mapping.placeholder.img?.startsWith(KW_DIR) && !!mapping.placeholder.img
  && !mapping.unknown.img?.startsWith(KW_DIR) && !!mapping.unknown.img
  && mapping.custom.img === "https://example.com/me.png";
// The silent cases stay silent; the discarded ones say so in the report.
const portraitReported = mapping.placeholder.portrait === null
  && mapping.custom.portrait === null
  && mapping.unknown.portrait?.reason === "unknown" && mapping.unknown.portrait?.dropped === "portrait999.webp"
  && mapping.customNoExt.portrait?.reason === "url" && !mapping.customNoExt.img?.startsWith("https://");
const badUrlSurvives = badUrlCreate.created && badUrlCreate.gone && !badUrlCreate.error;
const ok = hasButton && optionsDialogFound && out.freshCount === 1 && out.actorCreated && out.itemCount === 3 && out.bgUuidSet && out.armor === 1
  && JSON.stringify(out.scars) === JSON.stringify(["Nicked", "Burned"]) && out.summaryShown
  && stockMapped && fallbacksKept && portraitReported && badUrlSurvives && out.inParty && errors.length === 0;
if (!hasButton) console.log("FAIL: import button not injected");
if (!optionsDialogFound) console.log("FAIL: no [data-action=import] options dialog appeared");
if (out.freshCount !== 1) console.log(`FAIL: expected ONE new "Yorsa E2E" from this run, found ${out.freshCount}`);
if (!out.summaryShown) console.log("FAIL: the import summary (.kwi-summary) never rendered");
if (!out.inParty) console.log("FAIL: the imported character landed outside the Party folder (review #34 finding 174)");
if (!stockMapped) console.log(`FAIL: stock portrait17.webp not mapped to the shipped tlomdev copy (img=${out.img}, token=${out.token})`);
if (!fallbacksKept) console.log("FAIL: placeholder/unknown/custom portrait fallbacks changed behaviour");
if (!portraitReported) console.log("FAIL: discarded portrait references are not reported (or a kept one is)");
if (!badUrlSurvives) console.log(`FAIL: an extension-less custom URL still breaks the import (created=${badUrlCreate.created}, error=${badUrlCreate.error})`);
if (errors.length) console.log("Console errors:\n" + errors.join("\n"));
console.log(ok ? "e2e passed" : "e2e FAILED");
process.exit(ok ? 0 : 1);
