/**
 * The printable character sheet.
 *
 * A detached sheet prints only its displayed tab; the Print frame button opens
 * one standalone page holding the whole character (Kettlewright's /print/
 * layout) and offers the browser's print dialog. The page is the ONE surface
 * exempt from the dark-mode token rule — paper is white — and docs/theming.md
 * records the exemption; the leg here is what enforces it.
 *
 * The popup is driven WITHOUT playwright's popup machinery: `window.open` is
 * wrapped in the opener before the click, which hands back the Window
 * reference (same origin) and lets `print` be stubbed BEFORE the page can call
 * it — a stub attached after the popup event would race the call it exists to
 * observe. The stub records what the document held at call time, which is what
 * makes "print fires after the page is built" a deterministic claim rather
 * than a timing bet.
 *
 * The dev world has NO actors; every fixture is created here and removed.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(38)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(38)} ${d}`); failures++; };
const check = (l, cond, d = "") => (cond ? ok(l, d) : fail(l, d));

watchdog(420000, "print");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await page.goto(FOUNDRY_URL);
await joinAsGM(page);
await dismissChrome(page);

const XSS_ITEM = 'ZZ Inj <img src=x onerror="window.__printXSS=1">';
const r = await page.evaluate(async ({ xssName }) => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  const pc = await ActorImpl.create({
    name: "ZZ Print Hero", type: "character",
    img: "icons/svg/mystery-man.svg",
    system: {
      background: "Greenwise",
      pronouns: "they/them",
      abilities: { STR: { value: 12, max: 12 }, DEX: { value: 6, max: 6 }, WIL: { value: 9, max: 9 } },
      hp: { value: 5, max: 5 }, gold: 11,
      traits: { physique: "Towering", skin: "Soft", hair: "Long" },
      age: "40",
      description: "<p>ZZ DESC MARKER prying secrets from boughs.</p>",
      notes: "<p>ZZ NOTES MARKER the tincture has side-effects.</p>",
      bonds: [{ id: "b1", description: "ZZ BOND MARKER a signet ring.", gold: 0 }],
      // Omen text present but DISABLED — the section must be omitted.
      omenEnabled: false, omen: "ZZ OMEN MARKER laughter from the wells.",
      scars: ["ZZ SCAR MARKER a burn"],
      features: [{ name: "ZZ Feature", description: "ZZ FEATURE MARKER" }],
    },
  });
  await pc.createEmbeddedDocuments("Item", [
    { name: "Root Knife", type: "weapon", system: { damageFormula: "d6" } },
    { name: "Rations", type: "item", system: { uses: { value: 3, max: 3 } } },
    { name: "Signet Ring", type: "item", system: { weightless: true } },
    { name: xssName, type: "item" },
  ]);
  const sack = await ActorImpl.create({
    name: "ZZ Print Sack", type: "npc",
    system: { role: "container", connectedTo: pc.uuid, slots: 4, generationEnabled: false },
  });
  await sack.createEmbeddedDocuments("Item", [{ name: "ZZ Sack Item", type: "item" }]);

  // The NPC leg's fixture: same viewer, no Print button.
  const npc = await ActorImpl.create({ name: "ZZ Print Foe", type: "npc", system: { role: "monster" } });

  // Render both sheets and read their frame buttons.
  await pc.sheet.render(true);
  await npc.sheet.render(true);
  await sleep(800);
  out.pcHasButton = !!pc.sheet.element?.querySelector('[data-action="printSheet"]');
  out.npcHasButton = !!npc.sheet.element?.querySelector('[data-action="printSheet"]');
  await npc.sheet.close();

  // Wrap window.open BEFORE the click; stub print on the popup BEFORE the
  // page can call it. Same origin, so the opener owns the popup entirely.
  const origOpen = window.open;
  const calls = [];
  let popup = null;
  window.open = (...a) => {
    popup = origOpen.apply(window, a);
    Object.defineProperty(popup, "print", {
      configurable: true,
      value: () => calls.push({
        sections: popup.document.querySelectorAll("section").length,
        imgComplete: popup.document.querySelector("header.pc img")?.complete ?? null,
        title: popup.document.title,
      }),
    });
    return popup;
  };
  pc.sheet.element.querySelector('[data-action="printSheet"]')?.click();
  for (let i = 0; i < 60 && !calls.length; i++) await sleep(150);
  window.open = origOpen;

  out.printCalls = calls;
  const doc = popup?.document;
  const body = doc?.body?.innerText ?? "";
  out.title = doc?.title ?? null;
  out.hasDesc = body.includes("ZZ DESC MARKER");
  out.hasNotes = body.includes("ZZ NOTES MARKER");
  out.hasBond = body.includes("ZZ BOND MARKER");
  out.hasScar = body.includes("ZZ SCAR MARKER");
  out.hasFeature = body.includes("ZZ FEATURE MARKER");
  out.omenOmitted = !body.includes("ZZ OMEN MARKER");
  out.omenHeader = [...(doc?.querySelectorAll("h2") ?? [])].some((h) => h.textContent.trim() === game.i18n.localize("CAIRN.Omen"));
  out.traitsProse = [...(doc?.querySelectorAll("section p") ?? [])]
    .map((p) => p.textContent).find((s) => s.includes("Physique")) ?? "";
  out.statsText = doc?.querySelector(".stats")?.textContent.replace(/\s+/g, " ") ?? "";
  out.sackSection = body.includes("ZZ Print Sack") && body.includes("ZZ Sack Item");
  out.sackSlots = /ZZ Print Sack\s*\(\s*1\s*\/\s*4\s*\)/.test(body.replace(/\s+/g, " "));
  out.knifeNote = /Root Knife\s*\(d6\)/.test(body.replace(/\s+/g, " "));
  out.rationsNote = /Rations\s*\(3 uses\)/.test(body.replace(/\s+/g, " "));
  out.pettyNote = /Signet Ring\s*\(petty\)/.test(body.replace(/\s+/g, " "));
  // Injection: the item name is LITERAL TEXT — one text node, no element, no fire.
  const injRow = [...(doc?.querySelectorAll("ul.inv li") ?? [])].find((li) => li.textContent.includes("ZZ Inj"));
  out.injText = injRow?.textContent.trim() ?? null;
  out.injTags = injRow ? [...injRow.querySelectorAll("*")].filter((n) => n.className !== "notes").map((n) => n.tagName) : null;
  out.injFired = popup?.__printXSS === 1 || window.__printXSS === 1;
  // The exemption: black on white whatever the opener's theme.
  const cs = popup ? popup.getComputedStyle(doc.body) : null;
  out.bodyColor = cs?.color ?? null;
  out.bodyBg = cs?.backgroundColor ?? null;
  out.openerThemed = document.body.className.includes("theme-") ? document.body.className : "(unthemed)";

  popup?.close();
  await pc.sheet.close();
  out.ids = { pc: pc.id, sack: sack.id, npc: npc.id };
  return out;
}, { xssName: XSS_ITEM });

console.log("\nthe Print button");
check("on the character sheet, not the npc's", r.pcHasButton && !r.npcHasButton,
  `pc=${r.pcHasButton} npc=${r.npcHasButton} — the KW layout is a PC sheet`);
check("print() fires once, on a BUILT page", r.printCalls.length === 1
  && r.printCalls[0].sections >= 5 && r.printCalls[0].imgComplete === true,
  `${JSON.stringify(r.printCalls)} — sections and the settled portrait recorded AT CALL TIME`);
check("the page is titled", r.title === "ZZ Print Hero", `"${r.title}"`);

console.log("\none page, the whole character");
check("Description AND Notes", r.hasDesc && r.hasNotes,
  "the both-tabs leg — a detached sheet prints only its displayed tab, which is why this feature exists");
check("bonds, scars, features", r.hasBond && r.hasScar && r.hasFeature,
  `bond=${r.hasBond} scar=${r.hasScar} feature=${r.hasFeature}`);
check("a disabled omen is OMITTED", r.omenOmitted && !r.omenHeader,
  "text present on the actor, omenEnabled false — empty sections are dropped, not printed as placeholders");
check("traits compose to prose, age included",
  /Towering Physique/.test(r.traitsProse) && /40 years old/.test(r.traitsProse),
  `"${r.traitsProse}" — the sheet's own _buildTraitSentence, not a second composer`);
check("stats carry the numbers", /12\/12/.test(r.statsText) && /6\/6/.test(r.statsText)
  && /11/.test(r.statsText) && /5\/5/.test(r.statsText),
  `"${r.statsText.slice(0, 90)}"`);
check("KW's item annotations", r.knifeNote && r.rationsNote && r.pettyNote,
  `(d6)=${r.knifeNote} (3 uses)=${r.rationsNote} (petty)=${r.pettyNote}`);
check("a connected container is its own section", r.sackSection && r.sackSlots,
  "ZZ Print Sack ( 1 / 4 ) with ZZ Sack Item — KW's multi-container inventory");

console.log("\nwhat must not happen");
check("an item name is never parsed as HTML", r.injText?.includes("ZZ Inj <img")
  && r.injTags?.length === 0 && !r.injFired,
  `tags=${JSON.stringify(r.injTags)} fired=${r.injFired} text="${(r.injText ?? "").slice(0, 50)}…"`);
check("black on white, whatever the theme", r.bodyColor === "rgb(0, 0, 0)"
  && r.bodyBg === "rgb(255, 255, 255)",
  `color=${r.bodyColor} bg=${r.bodyBg} opener=${r.openerThemed} — paper is white; the one theming exemption (docs/theming.md)`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async (ids) => {
  for (const id of Object.values(ids)) await game.actors.get(id)?.delete();
}, r.ids);

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\nprint e2e FAILED — ${failures}` : "\nprint e2e passed");
process.exit(failures ? 1 : 0);
