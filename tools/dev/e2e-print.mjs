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
 * The spellbook fixtures plant under a settings-read shadow forcing GLOG OFF
 * (2026-08-10): in a GLOG world the create seam converts a bare spellbook to
 * a scroll on arrival, which turned "Detect Magic" into a scroll and redded
 * the book-prefix leg — the dev:grimoire corollary reaching this probe.
 *
 * Deprived/Panicked print as ALWAYS-PRESENT mark boxes on a character page
 * (user ask 2026-08-10): empty on a clean actor (pass 1), pre-filled when
 * the conditions are on (pass 2), absent on an npc page (pass 3), which
 * keeps the text status line instead. The boxes ride the HEADER, in the
 * free height the portrait reserves — under the stats they cost a row, and
 * that row pushed a boundary character's Notes to a third page.
 *
 * Pagination policy (rulings 2026-08-10): entries are ATOMIC (an inventory
 * row, a bond, a scar, a connection, a question WITH its answer prints
 * whole or moves whole), headings keep their content, and Notes takes the
 * MIN-ROOM rule — break-inside: avoid + min-height 4cm, the FIVE-LINE
 * ruling (heading + five blank lines of pencil room; the same day's 10cm
 * draft was the defect — its worst case was the near-half-page blank
 * before Notes the ruling forbids). Supersedes 2026-08-08's
 * always-fresh-page break; pencil room lands on the earliest page with
 * real space and never buys a near-empty page.
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
  const ItemImpl = CONFIG.Item.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // The background document the print page pulls its description from —
  // planted, so the leg never depends on pack prose (which the overlay rule
  // says must not be edited casually, so must not be asserted casually either).
  const bgItem = await ItemImpl.create({
    name: "ZZ Print Background", type: "background",
    system: { source: "2e", description: "<p>ZZ BGDESC MARKER raised in the fens.</p>" },
  });

  const pc = await ActorImpl.create({
    name: "ZZ Print Hero", type: "character",
    // A REAL Aspeheim gallery path — the credits footer picks its
    // attribution line from the portrait's path.
    img: "systems/air-bladder/art/jon-aspeheim/portraits/dwarf_01.webp",
    system: {
      background: "Greenwise",
      backgroundUuid: bgItem.uuid,
      contentSource: "2e",
      pronouns: "they/them",
      abilities: { STR: { value: 12, max: 12 }, DEX: { value: 6, max: 6 }, WIL: { value: 9, max: 9 } },
      hp: { value: 5, max: 5 }, gold: 11,
      traits: { physique: "Towering", skin: "Soft", hair: "Long" },
      age: "40",
      description: "<p>ZZ DESC MARKER prying secrets from boughs.</p>",
      notes: "<p>ZZ NOTES MARKER the tincture has side-effects.</p>",
      bonds: [{ id: "b1", description: "ZZ BOND MARKER a signet ring.", gold: 0 }],
      // Set but INVISIBLE in pass 1: the line is Barebones-only and this
      // character is 2e. Pass 2 flips the source and shadows the setting.
      failedCareer: "ZZ CAREER MARKER gravedigger",
      // Two answered questions — the separate-paragraphs leg needs at least
      // two pairs to tell "each its own block" from "one merged blob".
      questions: [
        { question: "ZZ Q1 whom do you serve?", answer: "ZZ A1 the ferryman", gold: 0 },
        { question: "ZZ Q2 what was taken?", answer: "ZZ A2 a brass key", gold: 0 },
      ],
      // Omen text present but DISABLED — the section must be omitted.
      omenEnabled: false, omen: "ZZ OMEN MARKER laughter from the wells.",
      scars: ["ZZ SCAR MARKER a burn"],
      // STORED features stay OFF the page since the Features UI went
      // (2026-08-09) — planted so the absence assertion bites on data, not on
      // an empty list, and so the survival of the orphaned field is witnessed.
      features: [{ name: "ZZ Feature", description: "ZZ FEATURE MARKER" }],
    },
  });
  // The fixtures assume a 2e world: in a GLOG world the create seam converts
  // any bare spellbook to a scroll on arrival, which turned "Detect Magic"
  // into a scroll and redded the book-prefix leg (found 2026-08-10 — the
  // dev:grimoire corollary reaching this probe). Plant under a settings-READ
  // shadow forcing GLOG off; the world's value is the user's, never written.
  const origGetGlog = game.settings.get;
  game.settings.get = function (scope, key, ...rest) {
    if (scope === game.system.id && key === "enable-glog-magic") return false;
    return origGetGlog.call(this, scope, key, ...rest);
  };
  try {
    await pc.createEmbeddedDocuments("Item", [
      { name: "Root Knife", type: "weapon", system: { damageFormula: "d6" } },
      { name: "Rations", type: "item", system: { uses: { value: 3, max: 3 } } },
      { name: "Signet Ring", type: "item", system: { weightless: true } },
      // The three spellbook shapes the prefix logic distinguishes (user report
      // 2026-08-08: the printed sheet dropped the prefixes): a bare-named book,
      // a scroll (a flagged spellbook, never a type), and a stored name that
      // already CARRIES the prefix — the idempotence case, which must not print
      // it twice.
      { name: "Detect Magic", type: "spellbook" },
      { name: "Charm Person", type: "spellbook", system: { scroll: true } },
      { name: "Spellbook (Fireball)", type: "spellbook" },
      { name: xssName, type: "item" },
    ]);
  } finally { game.settings.get = origGetGlog; }
  if (pc.items.find((i) => i.name === "Detect Magic")?.system.scroll) {
    return { error: "planted book arrived as a scroll DESPITE the shadow — the seam is not reading game.settings.get" };
  }
  const sack = await ActorImpl.create({
    name: "ZZ Print Sack", type: "npc",
    system: { role: "container", connectedTo: pc.uuid, slots: 4, generationEnabled: false },
  });
  await sack.createEmbeddedDocuments("Item", [{ name: "ZZ Sack Item", type: "item" }]);
  // A 0-slot companion: its stat line and description belong to the
  // Connections section, and it must NOT print as an empty inventory heading.
  const falcon = await ActorImpl.create({
    name: "ZZ Print Falcon", type: "npc",
    system: {
      role: "companion", connectedTo: pc.uuid, slots: 0, generationEnabled: false,
      hp: { value: 3, max: 3 },
      abilities: { STR: { value: 5, max: 5 }, DEX: { value: 16, max: 16 }, WIL: { value: 4, max: 4 } },
      description: "<p>ZZ COMPANION MARKER claws (d6+d6), only eats live game.</p>",
    },
  });

  // A monster PRINTS since 2026-08-08 (superseding the same day's
  // characters-only ruling); a thing still does not — the sack's sheet is the
  // no-button fixture now.
  const npc = await ActorImpl.create({
    name: "ZZ Print Foe", type: "npc",
    // A Tlomdev gallery path — the monster page must credit TLOMDEV, and
    // never Aspeheim.
    img: "systems/air-bladder/art/tlomdev/kettlewright-portraits/portrait1.webp",
    system: {
      role: "monster", generationEnabled: false,
      hp: { value: 6, max: 6 },
      abilities: { STR: { value: 8, max: 8 }, DEX: { value: 12, max: 12 }, WIL: { value: 7, max: 7 } },
      description: "<p>ZZ FOE MARKER horns and hunger.</p>",
    },
  });

  // Render the sheets and read their frame buttons.
  await pc.sheet.render(true);
  await npc.sheet.render(true);
  await sack.sheet.render(true);
  await sleep(800);
  out.pcHasButton = !!pc.sheet.element?.querySelector('[data-action="printSheet"]');
  out.npcHasButton = !!npc.sheet.element?.querySelector('[data-action="printSheet"]');
  out.sackHasButton = !!sack.sheet.element?.querySelector('[data-action="printSheet"]');
  // Print sits to the RIGHT of Pop Out (user ruling 2026-08-08).
  const hdrOrder = [...(pc.sheet.element?.querySelectorAll(".window-header button[data-action]") ?? [])]
    .map((b) => b.dataset.action);
  out.printAfterPopOut = hdrOrder.includes("printSheet")
    && hdrOrder.indexOf("printSheet") > hdrOrder.indexOf("detach");
  // The word "Print" next to the icon (user ruling 2026-08-08) — visible
  // text, not a hover tooltip, the Pop Out treatment.
  const printBtn = pc.sheet.element?.querySelector('.window-header button[data-action="printSheet"]');
  out.printLabelVisible = (printBtn?.textContent ?? "").trim() === game.i18n.localize("CAIRN.Print")
    && !!printBtn?.querySelector("i");
  await npc.sheet.close();
  await sack.sheet.close();

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
  out.featureOffPage = !body.includes("ZZ FEATURE MARKER");
  out.featureSurvives = (game.actors.get(pc.id) ?? pc).system.features?.length === 1;
  out.omenOmitted = !body.includes("ZZ OMEN MARKER");
  out.omenHeader = [...(doc?.querySelectorAll("h2") ?? [])].some((h) => h.textContent.trim() === game.i18n.localize("CAIRN.Omen"));
  out.traitsProse = [...(doc?.querySelectorAll("section p") ?? [])]
    .map((p) => p.textContent).find((s) => s.includes("Physique")) ?? "";
  out.statsText = doc?.querySelector(".stats")?.textContent.replace(/\s+/g, " ") ?? "";
  // Deprived/Panicked print as ALWAYS-PRESENT mark boxes (user ask
  // 2026-08-10) — EMPTY here, on an actor with neither condition: the ask's
  // exact case, a clean sheet with somewhere to pencil them later.
  const condBoxes = [...(doc?.querySelectorAll(".cond-marks .box") ?? [])];
  out.condBoxCount = condBoxes.length;
  out.condBoxesEmpty = condBoxes.every((b) => !b.textContent.trim());
  out.condLabels = doc?.querySelector(".cond-marks")?.textContent.replace(/\s+/g, " ") ?? "";
  out.condDeprivedLabel = game.i18n.localize("CAIRN.Deprived");
  out.condPanickedLabel = game.i18n.localize("CAIRN.Panicked");
  // The boxes ride the HEADER — free height beside the portrait; under the
  // stats they cost a row (the page-3 Notes report, 2026-08-10).
  out.condInHeader = !!doc?.querySelector("header.pc .cond-marks");
  // The atomic-entry policy: an entry prints whole or moves whole, and a
  // heading never strands apart from its section.
  const csOf = (sel) => (doc?.querySelector(sel) ? popup.getComputedStyle(doc.querySelector(sel)) : null);
  out.invLiBreak = csOf("ul.inv li")?.breakInside ?? null;
  out.plainLiBreak = csOf("ul.plain li")?.breakInside ?? null;
  out.qaPairBreak = csOf(".qa-pair")?.breakInside ?? null;
  out.h2BreakAfter = csOf("h2")?.breakAfter ?? null;
  out.invHeadBreakAfter = csOf(".inv-head")?.breakAfter ?? null;
  out.sackSection = body.includes("ZZ Print Sack") && body.includes("ZZ Sack Item");
  out.sackSlots = /ZZ Print Sack\s*\(\s*1\s*\/\s*4\s*\)/.test(body.replace(/\s+/g, " "));

  // Round-6 additions (user report from play, 2026-08-08).
  const h2s = [...(doc?.querySelectorAll("h2") ?? [])].map((h) => h.textContent.trim());
  out.hasBgDesc = body.includes("ZZ BGDESC MARKER");
  out.bgHeader = h2s.includes(game.i18n.localize("CAIRN.Background"));
  const qs = [...(doc?.querySelectorAll("p.q") ?? [])].map((p) => p.textContent);
  const qas = [...(doc?.querySelectorAll("p.qa") ?? [])].map((p) => p.textContent);
  out.qCount = qs.length; out.qaCount = qas.length;
  // The not-smushed claim: the question paragraph does NOT hold the answer,
  // the answer paragraph does.
  out.qSeparate = (qs[0] ?? "").includes("ZZ Q1") && !(qs[0] ?? "").includes("ZZ A1")
    && (qas[0] ?? "").includes("ZZ A1") && (qas[1] ?? "").includes("ZZ A2");
  out.headerSource = doc?.querySelector("header.pc .bg-source")?.textContent?.trim() ?? null;
  out.headerSourceItalic = doc && doc.querySelector("header.pc .bg-source")
    ? popup.getComputedStyle(doc.querySelector("header.pc .bg-source")).fontStyle : null;
  // The fixture background is a WORLD item — not the canon pack — so the
  // custom label is what must print (custom is MEMBERSHIP, not a stored
  // source; the character stores contentSource "2e").
  out.customLabel = `(${game.i18n.localize("CAIRN.PrintSourceCustom")})`;
  // Kettlewright's band (user rulings 2026-08-08): Stats+Items left; Traits,
  // the background's description and Connections right; the Q&A full-width
  // BELOW the band under its own Questions heading.
  out.bandLeft = [...(doc?.querySelectorAll(".band .col-main h2") ?? [])].map((h) => h.textContent.trim());
  out.bandRight = [...(doc?.querySelectorAll(".band .col-side h2") ?? [])].map((h) => h.textContent.trim());
  out.bandLeftWanted = ["CAIRN.PrintStats", "CAIRN.Items"].map((k) => game.i18n.localize(k));
  out.bandRightWanted = ["CAIRN.Traits", "CAIRN.Background", "CAIRN.Connections"].map((k) => game.i18n.localize(k));
  out.bandIsGrid = doc ? popup.getComputedStyle(doc.querySelector(".band")).display : null;
  out.qOutsideBand = !doc?.querySelector(".band p.q")
    && h2s.includes(game.i18n.localize("CAIRN.PrintQuestions"));
  out.connHeader = h2s.includes(game.i18n.localize("CAIRN.Connections"));
  const connRows = [...(doc?.querySelectorAll("li.conn") ?? [])];
  const falconRow = connRows.find((li) => li.textContent.includes("ZZ Print Falcon"));
  const sackRow = connRows.find((li) => li.textContent.includes("ZZ Print Sack"));
  out.falconConn = !!falconRow && /DEX 16/.test(falconRow.querySelector(".conn-stats")?.textContent ?? "")
    && falconRow.textContent.includes("ZZ COMPANION MARKER");
  out.sackConnLine = !!sackRow && !sackRow.querySelector(".conn-stats");
  out.falconNotInventory = ![...(doc?.querySelectorAll(".inv-head") ?? [])]
    .some((h) => h.textContent.includes("ZZ Print Falcon"));
  const credits = doc?.querySelector("footer.credits");
  out.creditsText = credits?.textContent ?? "";
  out.creditsSmall = credits ? parseFloat(popup.getComputedStyle(credits).fontSize) : null;
  // Notes opens its own PAGE on a character print (user ruling 2026-08-08) —
  // the computed break, which is what the print engine reads.
  const notesSec = doc?.querySelector("section.notes-section");
  out.notesBreak = notesSec ? popup.getComputedStyle(notesSec).breakBefore : null;
  out.notesBreakInside = notesSec ? popup.getComputedStyle(notesSec).breakInside : null;
  out.notesMinHeight = notesSec ? parseFloat(popup.getComputedStyle(notesSec).minHeight) : null;
  out.knifeNote = /Root Knife\s*\(d6\)/.test(body.replace(/\s+/g, " "));
  out.rationsNote = /Rations\s*\(3 uses\)/.test(body.replace(/\s+/g, " "));
  // The spellbook prefixes, exactly as the inventory shows them — read
  // against the localized keys, so the legs survive a translation.
  const bodyOne = body.replace(/\s+/g, " ");
  const bookP = game.i18n.localize("CAIRN.SpellbookPrefix").replace(/\s+/g, " ");
  const scrollP = game.i18n.localize("CAIRN.SpellscrollPrefix").replace(/\s+/g, " ");
  out.bookPrefixed = bodyOne.includes(`${bookP}Detect Magic`);
  out.scrollPrefixed = bodyOne.includes(`${scrollP}Charm Person`);
  out.prefixNotDoubled = bodyOne.includes("Spellbook (Fireball)")
    && !bodyOne.includes(`${bookP}Spellbook (Fireball)`);
  // "(Petty)" as the translator wrote it — review #11 removed the print
  // page's locale-less toLowerCase, the only case transform of a localized
  // value in module/.
  out.pettyNote = /Signet Ring\s*\(Petty\)/.test(body.replace(/\s+/g, " "));
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

  // The failed-career line is INVISIBLE in pass 1: the pc is 2e.
  out.careerPass1 = !body.includes("ZZ CAREER MARKER");

  // Second pass: notes emptied, every connection broken, and the character
  // flipped to Barebones. The Notes HEADER must still print (user ruling: the
  // empty block is where the pencil goes), the Connections section must be
  // gone — it exists only when connections do — and the failed career must
  // appear under the background. The `barebones-failed-career` setting
  // defaults OFF, so its READ is shadowed in-page for this pass — never a
  // world write (the leaked-setting rule).
  // Both conditions ON for this pass — the boxes must arrive FILLED.
  await pc.update({ "system.notes": "", "system.contentSource": "barebones",
    "system.deprived": true, "system.panicked": true });
  await sack.update({ "system.connectedTo": "" });
  await falcon.update({ "system.connectedTo": "" });
  const calls2 = [];
  let popup2 = null;
  window.open = (...a) => {
    popup2 = origOpen.apply(window, a);
    Object.defineProperty(popup2, "print", { configurable: true, value: () => calls2.push(1) });
    return popup2;
  };
  const origGet = game.settings.get;
  game.settings.get = function (ns, key) {
    if (key === "barebones-failed-career") return true;
    return origGet.call(this, ns, key);
  };
  try {
    pc.sheet.element.querySelector('[data-action="printSheet"]')?.click();
    for (let i = 0; i < 60 && !calls2.length; i++) await sleep(150);
  } finally {
    game.settings.get = origGet;
    window.open = origOpen;
  }
  const doc2 = popup2?.document;
  const body2 = doc2?.body?.innerText ?? "";
  const h2s2 = [...(doc2?.querySelectorAll("h2") ?? [])].map((h) => h.textContent.trim());
  out.emptyNotesHeader = h2s2.includes(game.i18n.localize("CAIRN.Notes"))
    && !body2.includes("ZZ NOTES MARKER");
  out.connectionsGone = !h2s2.includes(game.i18n.localize("CAIRN.Connections"))
    && !body2.includes("ZZ Print Sack");
  const fcLine = doc2?.querySelector("header.pc .failed-career");
  out.careerPass2 = !!fcLine && fcLine.textContent.includes("ZZ CAREER MARKER")
    && fcLine.textContent.includes(game.i18n.localize("CAIRN.PrintFailedCareer"));
  // Barebones is NOT custom — the plain source label branch.
  out.sourcePass2 = doc2?.querySelector("header.pc .bg-source")?.textContent?.trim() ?? null;
  out.barebonesLabel = `(${game.i18n.localize("CAIRN.ContentSourceBarebones")})`;
  const condBoxes2 = [...(doc2?.querySelectorAll(".cond-marks .box") ?? [])];
  out.condBoxesFilled = condBoxes2.length === 2
    && condBoxes2.every((b) => b.textContent.trim() === "✕");
  popup2?.close();

  await pc.sheet.close();

  // Third pass: the monster prints its own page — role subtitle, statblock
  // prose, none of the PC-only sections.
  await npc.sheet.render(true);
  await sleep(600);
  const calls3 = [];
  let popup3 = null;
  window.open = (...a) => {
    popup3 = origOpen.apply(window, a);
    Object.defineProperty(popup3, "print", { configurable: true, value: () => calls3.push(1) });
    return popup3;
  };
  npc.sheet.element.querySelector('[data-action="printSheet"]')?.click();
  for (let i = 0; i < 60 && !calls3.length; i++) await sleep(150);
  window.open = origOpen;
  const doc3 = popup3?.document;
  const body3 = doc3?.body?.innerText ?? "";
  const h2s3 = [...(doc3?.querySelectorAll("h2") ?? [])].map((h) => h.textContent.trim());
  out.npcPrinted = calls3.length === 1;
  out.npcSubtitle = doc3?.querySelector("header.pc .background")?.textContent?.trim() ?? null;
  out.npcRoleWord = game.i18n.localize("CAIRN.RoleMonster");
  out.npcDesc = body3.includes("ZZ FOE MARKER");
  out.npcStats = /8\/8/.test(doc3?.querySelector(".stats")?.textContent ?? "")
    && /12\/12/.test(doc3?.querySelector(".stats")?.textContent ?? "");
  out.npcNoPcSections = !h2s3.includes(game.i18n.localize("CAIRN.Background"))
    && !h2s3.includes(game.i18n.localize("CAIRN.PrintBonds"))
    && !h2s3.includes(game.i18n.localize("CAIRN.Omen"));
  out.npcNotesHeader = h2s3.includes(game.i18n.localize("CAIRN.Notes"));
  out.npcCredits = !!doc3?.querySelector("footer.credits");
  out.npcCreditsText = doc3?.querySelector("footer.credits")?.textContent ?? "";
  // A monster's one-pager stays one page — no forced break and NO min-height
  // inflating ITS notes.
  const notesSec3 = doc3?.querySelector("section.notes-section");
  out.npcNotesBreak = notesSec3 ? popup3.getComputedStyle(notesSec3).breakBefore : null;
  out.npcNotesMinHeight = notesSec3 ? parseFloat(popup3.getComputedStyle(notesSec3).minHeight) : null;
  // The mark boxes are CHARACTER-only; an npc page keeps the text status.
  out.npcNoCondBoxes = !doc3?.querySelector(".cond-marks");
  popup3?.close();
  await npc.sheet.close();

  // Fourth pass: the route prefix (review #13 #7). abs() used to resolve
  // against location.origin alone, which drops ROUTE_PREFIX — on a prefixed
  // host every portrait and item icon printed broken, invisible on this
  // unprefixed dev server where the two spellings coincide. ROUTE_PREFIX is
  // shadowed in-page (never a server setting) and restored in a finally; the
  // assertions are on the URL STRING — the image cannot load under a fake
  // prefix and must not need to (the builder's error listener + timeout keep
  // print() firing over a dead image path).
  await pc.sheet.render(true);
  await sleep(600);
  const priorPrefix = globalThis.ROUTE_PREFIX;
  try {
    globalThis.ROUTE_PREFIX = "pfx-probe";
    const calls4 = [];
    let popup4 = null;
    window.open = (...a) => {
      popup4 = origOpen.apply(window, a);
      Object.defineProperty(popup4, "print", { configurable: true, value: () => calls4.push(1) });
      return popup4;
    };
    try {
      pc.sheet.element.querySelector('[data-action="printSheet"]')?.click();
      for (let i = 0; i < 60 && !calls4.length; i++) await sleep(150);
    } finally { window.open = origOpen; }
    out.prefixedSrc = popup4?.document.querySelector("header.pc img")?.getAttribute("src") ?? null;
    popup4?.close();

    // Fifth: an already-absolute portrait URL passes through UNTOUCHED with
    // the prefix still in force — getRoute strips and re-joins slashes, so
    // feeding it a scheme'd URL would mangle it; the guard must win here.
    // render:false, or the OPEN sheet re-renders with the unresolvable URL
    // and its fetch failure lands in the watched opener console as a
    // resource error — a race the first run happened to win (the popup's own
    // console is a separate page and stays unwatched).
    await pc.update({ img: "https://example.invalid/zz-remote.png" }, { render: false });
    const calls5 = [];
    let popup5 = null;
    window.open = (...a) => {
      popup5 = origOpen.apply(window, a);
      Object.defineProperty(popup5, "print", { configurable: true, value: () => calls5.push(1) });
      return popup5;
    };
    try {
      pc.sheet.element.querySelector('[data-action="printSheet"]')?.click();
      for (let i = 0; i < 60 && !calls5.length; i++) await sleep(150);
    } finally { window.open = origOpen; }
    out.absoluteSrc = popup5?.document.querySelector("header.pc img")?.getAttribute("src") ?? null;
    popup5?.close();
  } finally {
    globalThis.ROUTE_PREFIX = priorPrefix;
  }
  await pc.sheet.close();

  out.ids = { pc: pc.id, sack: sack.id, npc: npc.id, falcon: falcon.id };
  out.itemIds = [bgItem.id];
  return out;
}, { xssName: XSS_ITEM });

console.log("\nthe Print button");
check("on characters and monsters, not things", r.pcHasButton && r.npcHasButton && !r.sackHasButton,
  `pc=${r.pcHasButton} monster=${r.npcHasButton} container=${r.sackHasButton} — a cart prints on its keeper's page`);
check("to the RIGHT of Pop Out", r.printAfterPopOut === true,
  "the title-bar order is a ruling, not an accident");
check("says the word Print", r.printLabelVisible === true,
  "visible text beside the printer glyph, the Pop Out treatment");
check("print() fires once, on a BUILT page", r.printCalls.length === 1
  && r.printCalls[0].sections >= 5 && r.printCalls[0].imgComplete === true,
  `${JSON.stringify(r.printCalls)} — sections and the settled portrait recorded AT CALL TIME`);
check("the page is titled", r.title === "ZZ Print Hero", `"${r.title}"`);

console.log("\none page, the whole character");
check("Description AND Notes", r.hasDesc && r.hasNotes,
  "the both-tabs leg — a detached sheet prints only its displayed tab, which is why this feature exists");
check("bonds and scars carried", r.hasBond && r.hasScar,
  `bond=${r.hasBond} scar=${r.hasScar}`);
check("stored features stay OFF the page", r.featureOffPage && r.featureSurvives,
  `offPage=${r.featureOffPage} survives=${r.featureSurvives} — the UI went 2026-08-09; the data must not`);
check("a disabled omen is OMITTED", r.omenOmitted && !r.omenHeader,
  "text present on the actor, omenEnabled false — empty sections are dropped, not printed as placeholders");
check("traits compose to prose, age included",
  /Towering Physique/.test(r.traitsProse) && /40 years old/.test(r.traitsProse),
  `"${r.traitsProse}" — the sheet's own _buildTraitSentence, not a second composer`);
check("stats carry the numbers", /12\/12/.test(r.statsText) && /6\/6/.test(r.statsText)
  && /11/.test(r.statsText) && /5\/5/.test(r.statsText),
  `"${r.statsText.slice(0, 90)}"`);
check("Deprived/Panicked mark boxes print EMPTY on a clean character",
  r.condBoxCount === 2 && r.condBoxesEmpty
  && r.condLabels.includes(r.condDeprivedLabel) && r.condLabels.includes(r.condPanickedLabel),
  `boxes=${r.condBoxCount} empty=${r.condBoxesEmpty} "${r.condLabels}" — the ask's exact case (2026-08-10): somewhere to pencil a condition mid-session`);
check("and they ride the HEADER, in the portrait's free height", r.condInHeader,
  "under the stats they cost a row — the row that pushed a boundary character's Notes to page 3");
check("entries are ATOMIC — whole on a page or moved whole",
  r.invLiBreak === "avoid" && r.plainLiBreak === "avoid" && r.qaPairBreak === "avoid",
  `inv=${r.invLiBreak} plain=${r.plainLiBreak} qa-pair=${r.qaPairBreak} — a question never strands apart from its answer (ruling 2026-08-10)`);
check("headings keep their content", r.h2BreakAfter === "avoid" && r.invHeadBreakAfter === "avoid",
  `h2=${r.h2BreakAfter} inv-head=${r.invHeadBreakAfter} — no heading alone at a page bottom`);
check("KW's item annotations", r.knifeNote && r.rationsNote && r.pettyNote,
  `(d6)=${r.knifeNote} (3 uses)=${r.rationsNote} (Petty)=${r.pettyNote} — Petty as the translator wrote it, uses via formatCount`);
check("spellbook rows print their prefixes", r.bookPrefixed && r.scrollPrefixed,
  `book=${r.bookPrefixed} scroll=${r.scrollPrefixed} — the same helper the inventory uses, so the two surfaces cannot drift`);
check("a stored prefix is not doubled", r.prefixNotDoubled,
  "the idempotence case — a name already carrying \"Spellbook (\" gets no second prefix");
check("a connected container is its own section", r.sackSection && r.sackSlots,
  "ZZ Print Sack ( 1 / 4 ) with ZZ Sack Item — KW's multi-container inventory");

console.log("\nround-6 additions (user report from play)");
check("the background's own prose prints", r.hasBgDesc && r.bgHeader,
  `desc=${r.hasBgDesc} header=${r.bgHeader} — every 2e background has one, and KW's print carries it`);
check("Q&A as SEPARATE paragraphs", r.qCount === 2 && r.qaCount === 2 && r.qSeparate,
  `q=${r.qCount} qa=${r.qaCount} separate=${r.qSeparate} — never Kettlewright's single blob`);
check("the source, parenthetical and italic", r.headerSource === r.customLabel
  && r.headerSourceItalic === "italic",
  `"${r.headerSource}" style=${r.headerSourceItalic} — a world-item background is CUSTOM by membership`);
check("Barebones is not custom", r.sourcePass2 === r.barebonesLabel,
  `pass2="${r.sourcePass2}" — the plain source-label branch`);
check("both mark boxes print FILLED when the conditions are on", r.condBoxesFilled,
  "pass 2 set deprived+panicked — the boxes arrive pre-marked, not re-blanked");
check("KW's two-column band", JSON.stringify(r.bandLeft) === JSON.stringify(r.bandLeftWanted)
  && JSON.stringify(r.bandRight) === JSON.stringify(r.bandRightWanted) && r.bandIsGrid === "grid",
  `left=${JSON.stringify(r.bandLeft)} right=${JSON.stringify(r.bandRight)} display=${r.bandIsGrid}`);
check("Q&A full-width BELOW the band", r.qOutsideBand === true,
  "under its own Questions heading — never inside a half-width column");
check("a companion prints in Connections", r.connHeader && r.falconConn,
  `header=${r.connHeader} falcon=${r.falconConn} — stat line (DEX 16) and its description prose`);
check("a thing gets the line only", r.sackConnLine,
  "the sack's contents are an inventory section; Connections adds no stat line for a container");
check("no empty inventory heading for the falcon", r.falconNotInventory,
  "a 0-slot companion carrying nothing lives in Connections, not as a bare inv-head");
check("credits match the art ON the page", /Yochai Gal/.test(r.creditsText)
  && /Aspeheim/.test(r.creditsText) && !/Tlomdev/.test(r.creditsText)
  && r.creditsSmall !== null && r.creditsSmall < 10,
  `${r.creditsSmall}px — an Aspeheim portrait credits Aspeheim and NEVER Tlomdev; the text credit always prints`);
check("empty Notes still prints its header", r.emptyNotesHeader,
  "the ruling: the empty block is where the pencil goes");
check("Notes takes the MIN-ROOM rule (PC only)",
  // BOUNDED both ways: 4cm ≈ 151px (heading + five 12pt/1.45 lines — the
  // user's five-line rule). The lower bound catches the rule vanishing; the
  // upper bound catches the 10cm regression, whose worst case moved Notes
  // overleaf with a near-half-page blank after Omen — the gap the ruling
  // forbids. 10cm (378px) fails this leg on BOTH bounds' intent.
  r.notesBreak !== "page" && r.notesBreakInside === "avoid"
  && r.notesMinHeight > 140 && r.notesMinHeight < 200
  && r.npcNotesBreak !== "page" && !(r.npcNotesMinHeight > 100),
  `pc break-inside=${r.notesBreakInside} min=${r.notesMinHeight}px npc min=${r.npcNotesMinHeight} — heading + five lines (~4cm) on the current page, a fresh page only when less remains (five-line ruling 2026-08-10); a monster stays a one-pager`);
check("no connections, no Connections section", r.connectionsGone,
  "the section exists only when connections do");
check("failed career: Barebones only, labelled", r.careerPass1 && r.careerPass2,
  `2e-hidden=${r.careerPass1} barebones-shown=${r.careerPass2} — "Failed Career:" below the background, setting read shadowed in-page`);

console.log("\nthe monster's page");
check("a monster prints", r.npcPrinted && r.npcSubtitle === r.npcRoleWord,
  `printed=${r.npcPrinted} subtitle="${r.npcSubtitle}" — the role where a PC's background goes`);
check("an npc page has NO mark boxes", r.npcNoCondBoxes,
  "the boxes are character-only; an npc keeps the text status line");
check("statblock prose and numbers", r.npcDesc && r.npcStats,
  `desc=${r.npcDesc} stats=${r.npcStats}`);
check("no PC-only sections", r.npcNoPcSections && r.npcNotesHeader && r.npcCredits,
  `pcSections=${!r.npcNoPcSections} notesHeader=${r.npcNotesHeader} credits=${r.npcCredits} — no Background/Bonds/Omen; Notes header and credits still on`);
check("the monster credits Tlomdev, not Aspeheim", /Tlomdev/.test(r.npcCreditsText)
  && !/Aspeheim/.test(r.npcCreditsText) && /Yochai Gal/.test(r.npcCreditsText),
  "the attribution follows the portrait's gallery");

console.log("\nthe route prefix");
check("a prefixed host keeps its portraits", (r.prefixedSrc ?? "").includes("/pfx-probe/systems/air-bladder/"),
  `src="${r.prefixedSrc}" — abs() goes through getRoute, so ROUTE_PREFIX survives into the print page`);
check("an absolute URL passes through untouched", r.absoluteSrc === "https://example.invalid/zz-remote.png",
  `src="${r.absoluteSrc}" — getRoute must never see a scheme'd URL (it re-joins slashes and mangles it)`);

console.log("\nwhat must not happen");
check("an item name is never parsed as HTML", r.injText?.includes("ZZ Inj <img")
  && r.injTags?.length === 0 && !r.injFired,
  `tags=${JSON.stringify(r.injTags)} fired=${r.injFired} text="${(r.injText ?? "").slice(0, 50)}…"`);
check("black on white, whatever the theme", r.bodyColor === "rgb(0, 0, 0)"
  && r.bodyBg === "rgb(255, 255, 255)",
  `color=${r.bodyColor} bg=${r.bodyBg} opener=${r.openerThemed} — paper is white; the one theming exemption (docs/theming.md)`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async ({ ids, itemIds }) => {
  for (const id of Object.values(ids)) await game.actors.get(id)?.delete();
  for (const id of itemIds) await game.items.get(id)?.delete();
}, { ids: r.ids, itemIds: r.itemIds });

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\nprint e2e FAILED — ${failures}` : "\nprint e2e passed");
process.exit(failures ? 1 : 0);
