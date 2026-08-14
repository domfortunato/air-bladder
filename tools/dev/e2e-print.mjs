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
 * keeps the text status line instead. The boxes sit BELOW the stats grid
 * (user ruling 2026-08-11, reversing the previous day's header move — under
 * the Background line they read badly); the row they cost the left column
 * at the Notes boundary is accepted with eyes open.
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
      // Armor 2, NOT the schema's initial 1 — the annotation leg must read
      // the VALUE, or it stays green printing every armor as "(1 Armor)".
      { name: "ZZ Print Vest", type: "armor", system: { armor: 2 } },
      // Carries a grant-source flag for the printed-tag legs — "background"
      // is the commonest source and its label localizes.
      { name: "Rations", type: "item", system: { uses: { value: 3, max: 3 } },
        flags: { "air-bladder": { grantSource: "background" } } },
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
  // A 0-slot companion carrying nothing. It used to be the Connections
  // section's job to carry its stat line and prose; with that section gone
  // (2026-08-13) it must print NOWHERE — and in particular must still not
  // print as an empty inventory heading, which was the original defect.
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
  // The browser paints its own print header/footer (title/date up top,
  // about:blank/page numbers below) INTO the @page top/bottom margins, and
  // only when they are tall enough to hold the text — the template starves
  // it of the room. 5mm was tried first and the user's Chromium still
  // painted page numbers (2026-08-11); 0 is the only value known to work.
  // The rule itself is all a probe can see; the visual absence is eyeballed
  // in the print preview, recorded in this probe's docs/release-testing.md
  // row.
  const sheetRules = [...(doc?.styleSheets?.[0]?.cssRules ?? [])];
  const pageRule = sheetRules.find((r) => r.constructor?.name === "CSSPageRule");
  out.pageMargins = pageRule
    ? [pageRule.style.marginTop, pageRule.style.marginBottom,
      pageRule.style.marginLeft, pageRule.style.marginRight]
    : null;
  // The credits are PINNED to the printed page bottom (user ask 2026-08-11):
  // print-only position: fixed, which Chromium repeats at the bottom of
  // every page, with a white background so a full page's last line passes
  // under it rather than through it. Print-context rules never apply to the
  // on-screen popup, so this is read off the STYLESHEET like @page above.
  const printMedia = sheetRules.find((r) => r.constructor?.name === "CSSMediaRule"
    && /print/.test(r.media?.mediaText ?? ""));
  const footRule = printMedia
    ? [...printMedia.cssRules].find((r) => r.selectorText === "footer.credits") : null;
  out.creditsPinned = footRule
    ? { position: footRule.style.position, bottom: footRule.style.bottom,
      bg: footRule.style.backgroundColor }
    : null;
  // The running page frame (user report 2026-08-11: with the @page margins
  // at 0, BONDS moved whole to page 2 and sat flush on the paper's top
  // edge). A real <table> wraps the content — Chromium repeats its thead
  // (a small name strip) at the top of every printed page and its tfoot (a
  // blank spacer reserving the credits zone) at the bottom. Repetition
  // itself is not DOM-observable, so these legs read the structure and the
  // print-media rules; the visual truth stays with the preview row.
  out.frameHead = doc?.querySelector("table.page-frame > thead .page-head")?.textContent.trim() ?? null;
  out.frameSpacer = !!doc?.querySelector("table.page-frame > tfoot .page-foot-space");
  const mpRules = printMedia ? [...printMedia.cssRules] : [];
  const headRule = mpRules.find((r) => r.selectorText === ".page-head");
  const spacerRule = mpRules.find((r) => r.selectorText === ".page-foot-space");
  out.frameShownInPrint = headRule?.style.display === "block"
    && spacerRule?.style.display === "block";
  out.frameHeadHeight = headRule?.style.height ?? null;
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
  // The boxes sit BELOW the stats grid (user ruling 2026-08-11, reversing
  // 2026-08-10's header move — under the Background line they read badly).
  // The row they cost the left column is accepted with eyes open: at the
  // boundary it can push Notes to a fresh page, the very report that
  // motivated the header placement. Both halves asserted — in the stats
  // section AND out of the header — or a duplicate would pass.
  out.condBelowStats = !!doc?.querySelector(".stats + .cond-marks")
    && !doc?.querySelector("header.pc .cond-marks");
  // The atomic-entry policy: an entry prints whole or moves whole, and a
  // heading never strands apart from its section.
  const csOf = (sel) => (doc?.querySelector(sel) ? popup.getComputedStyle(doc.querySelector(sel)) : null);
  out.invLiBreak = csOf("ul.inv li")?.breakInside ?? null;
  out.plainLiBreak = csOf("ul.plain li")?.breakInside ?? null;
  out.qaPairBreak = csOf(".qa-pair")?.breakInside ?? null;
  out.h2BreakAfter = csOf("h2")?.breakAfter ?? null;
  out.invHeadBreakAfter = csOf(".inv-head")?.breakAfter ?? null;
  // The personal inventory's heading says what the count IS, not KW's
  // "Main" (user ruling 2026-08-11): "Main" named the body-vs-bag split
  // inside Kettlewright's app and meant nothing on paper. New key, so es
  // falls back to English instead of showing the stale "Inicio".
  out.mainHead = doc?.querySelector(".inv-head")?.textContent.replace(/\s+/g, " ").trim() ?? null;
  out.slotsUsedLabel = game.i18n.localize("CAIRN.PrintSlotsUsed");
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
  out.bandRightWanted = ["CAIRN.Traits", "CAIRN.Background"].map((k) => game.i18n.localize(k));
  out.bandIsGrid = doc ? popup.getComputedStyle(doc.querySelector(".band")).display : null;
  out.qOutsideBand = !doc?.querySelector(".band p.q")
    && h2s.includes(game.i18n.localize("CAIRN.PrintQuestions"));
  // Connections was a right-column section until 2026-08-13 and is now gone by
  // ruling. Asserted WITH both a companion and a container connected — this is
  // the pass where they exist, so "no heading" is a real absence and not the
  // vacuous truth pass 2 would give.
  out.connHeaderGone = !h2s.includes(game.i18n.localize("CAIRN.Connections"))
    && !doc?.querySelector("li.conn");
  // The falcon has 0 slots and carries nothing, so with Connections gone it has
  // no place on the page at all: no stat line, no description, and — the older
  // defect — no bare inventory heading either.
  out.falconAbsent = !doc?.querySelector(".inv-head, .conn")
    || ![...(doc?.querySelectorAll(".inv-head, li.conn") ?? [])]
      .some((h) => h.textContent.includes("ZZ Print Falcon"));
  out.falconProseGone = !body.includes("ZZ COMPANION MARKER");
  // The sack DOES still print — as its own inventory section, which is what
  // Connections was redundant against.
  out.sackInventory = [...(doc?.querySelectorAll(".inv-head") ?? [])]
    .some((h) => h.textContent.includes("ZZ Print Sack"));
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
  // The book's own notation — "Brigandine (1 Armor)" — via the whole-string
  // key, so the leg survives a translation reordering the words.
  out.armorPointsWanted = game.i18n.format("CAIRN.PrintArmorPoints", { armor: 2 });
  out.vestNote = bodyOne.includes(`ZZ Print Vest (${out.armorPointsWanted})`);
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
  // Empty Notes prints NOTHING — heading included (user ruling 2026-08-11,
  // retiring 2026-08-08's pencil-room exception: the always-printed header
  // kept generating fresh-page moves that read as defects, three threshold
  // shrinks in two days). Notes now takes the same empty-sections-are-
  // OMITTED rule as everything else. Both readings, heading and section.
  out.emptyNotesGone = !h2s2.includes(game.i18n.localize("CAIRN.Notes"))
    && !doc2?.querySelector("section.notes-section");
  // Breaking the links takes the sack's inventory section with them. (This once
  // also asserted the Connections heading was gone; that section no longer
  // exists in either pass, and the assertion that means something now runs in
  // pass 1, where connections are PRESENT.)
  out.connectionsGone = !body2.includes("ZZ Print Sack");
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

  // Things print too (user ruling 2026-08-11, superseding 2026-08-08's "a
  // cart prints on its keeper's page" — the Warden had forgotten containers
  // hold gear worth handing across the table). A thing's page is its CARGO:
  // no statblock (the schema's 10/10/10 on a sack is noise, not
  // information), the role where a PC's background goes, and the standalone
  // Items section takes the connected-section rule — the slot fraction only
  // where slots are AUTHORED (derived slotsMax floors at the world setting,
  // the falcon trap), no empty heading on a slotless creature carrying
  // nothing. Both fixtures were disconnected in pass 2, so these are
  // genuine standalone pages.
  await sack.sheet.render(true);
  await sleep(600);
  const calls6 = [];
  let popup6 = null;
  window.open = (...a) => {
    popup6 = origOpen.apply(window, a);
    Object.defineProperty(popup6, "print", { configurable: true, value: () => calls6.push(1) });
    return popup6;
  };
  sack.sheet.element?.querySelector('[data-action="printSheet"]')?.click();
  for (let i = 0; i < 60 && !calls6.length; i++) await sleep(150);
  window.open = origOpen;
  const doc6 = popup6?.document;
  out.sackPageGear = (doc6?.body?.innerText ?? "").includes("ZZ Sack Item");
  out.sackPageHead = doc6?.querySelector(".inv-head")?.textContent.replace(/\s+/g, " ").trim() ?? null;
  out.sackPageNoStats = !!doc6 && !doc6.querySelector(".stats");
  out.sackPageSubtitle = doc6?.querySelector("header.pc .background")?.textContent.replace(/\s+/g, " ").trim() ?? null;
  out.containerRoleLabel = game.i18n.localize("CAIRN.RoleContainer");
  popup6?.close();
  await sack.sheet.close();

  await falcon.sheet.render(true);
  await sleep(600);
  const calls7 = [];
  let popup7 = null;
  window.open = (...a) => {
    popup7 = origOpen.apply(window, a);
    Object.defineProperty(popup7, "print", { configurable: true, value: () => calls7.push(1) });
    return popup7;
  };
  falcon.sheet.element?.querySelector('[data-action="printSheet"]')?.click();
  for (let i = 0; i < 60 && !calls7.length; i++) await sleep(150);
  window.open = origOpen;
  const doc7 = popup7?.document;
  out.falconPageStats = !!doc7?.querySelector(".stats");
  out.falconPageNoInvHead = !!doc7 && !doc7.querySelector(".inv-head");
  popup7?.close();
  await falcon.sheet.close();

  // Grant-source tags on the printed page, under their OWN switch (user ask
  // 2026-08-11): three prints of the same pc, every setting READ shadowed
  // in-page both ways — the world's value is the user's, never trusted and
  // never written. The third print is the drift guard: the INVENTORY switch
  // (show-grant-tags) is shadowed OFF and the items RE-PREPARED under it,
  // which empties system.grantLabel — so a print that reads grantLabel
  // instead of the ungated grantLabelRaw loses its tag exactly there.
  await pc.sheet.render(true);
  await sleep(600);
  const printWithShadow = async (shadow) => {
    const origGet2 = game.settings.get;
    game.settings.get = function (ns, key) {
      if (key in shadow) return shadow[key];
      return origGet2.call(this, ns, key);
    };
    let popup8 = null;
    window.open = (...a) => {
      popup8 = origOpen.apply(window, a);
      Object.defineProperty(popup8, "print", { configurable: true, value: () => {} });
      return popup8;
    };
    try {
      pc.items.contents.forEach((i) => i.reset());
      pc.sheet.element?.querySelector('[data-action="printSheet"]')?.click();
      for (let i = 0; i < 60 && !popup8?.document?.querySelector("footer.credits"); i++) await sleep(150);
      const text = (popup8?.document?.body?.innerText ?? "").replace(/\s+/g, " ");
      popup8?.close();
      return text;
    } finally {
      game.settings.get = origGet2;
      window.open = origOpen;
      pc.items.contents.forEach((i) => i.reset());
    }
  };
  const wantTag = `Rations (3 uses) [${game.i18n.localize("CAIRN.GrantBackground")}]`;
  out.grantTagWanted = wantTag;
  out.grantTagOn = (await printWithShadow({ "show-grant-tags-print": true })).includes(wantTag);
  out.grantTagOff = !(await printWithShadow({ "show-grant-tags-print": false })).includes(wantTag);
  out.grantTagInvOff = (await printWithShadow({ "show-grant-tags-print": true, "show-grant-tags": false })).includes(wantTag);
  await pc.sheet.close();

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
check("on EVERY sheet — things and companions too", r.pcHasButton && r.npcHasButton && r.sackHasButton,
  `pc=${r.pcHasButton} monster=${r.npcHasButton} container=${r.sackHasButton} — the third ruling in the chain (2026-08-11, superseding "a cart prints on its keeper's page"): a Warden prints a container's cargo list`);
check("to the RIGHT of Pop Out", r.printAfterPopOut === true,
  "the title-bar order is a ruling, not an accident");
check("says the word Print", r.printLabelVisible === true,
  "visible text beside the printer glyph, the Pop Out treatment");
check("print() fires once, on a BUILT page", r.printCalls.length === 1
  && r.printCalls[0].sections >= 5 && r.printCalls[0].imgComplete === true,
  `${JSON.stringify(r.printCalls)} — sections and the settled portrait recorded AT CALL TIME`);
check("the page is titled", r.title === "ZZ Print Hero", `"${r.title}"`);
check("the @page margins starve the browser's header/footer",
  JSON.stringify(r.pageMargins) === JSON.stringify(["0px", "0px", "1.6cm", "1.6cm"]),
  `${JSON.stringify(r.pageMargins)} — Chromium only paints the title/date and about:blank/page-number lines when the top/bottom margins can hold them; 5mm was tried and the user's Chromium still painted page numbers, so 0 it is, dead-band cost on continuation pages accepted (user report 2026-08-11)`);
check("a BLANK strip heads every printed page",
  r.frameHead === "" && r.frameHeadHeight === "9mm"
  && r.frameSpacer === true && r.frameShownInPrint === true,
  `head="${r.frameHead}" h=${r.frameHeadHeight} spacer=${r.frameSpacer} print-shown=${r.frameShownInPrint} — thead/tfoot repetition is the one page-top mechanism margin-0 leaves (user report 2026-08-11: BONDS rode the paper's top edge); the strip prints NOTHING by ruling (the name was tried and rejected the same hour), and the tfoot spacer reserves the zone the fixed credits paint into`);
check("the credits pin to the printed page bottom",
  r.creditsPinned?.position === "fixed" && r.creditsPinned?.bottom === "4mm"
  && r.creditsPinned?.bg === "rgb(255, 255, 255)",
  `${JSON.stringify(r.creditsPinned)} — print-only fixed, 4mm above the paper edge (the dead band), white-masked; on screen the popup keeps the in-flow footer (user ask 2026-08-11)`);

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
check("and they sit BELOW the stats, out of the header", r.condBelowStats,
  "user ruling 2026-08-11, reversing the 2026-08-10 header move — under the Background they read badly; the row they cost at the Notes boundary is accepted");
check("entries are ATOMIC — whole on a page or moved whole",
  r.invLiBreak === "avoid" && r.plainLiBreak === "avoid" && r.qaPairBreak === "avoid",
  `inv=${r.invLiBreak} plain=${r.plainLiBreak} qa-pair=${r.qaPairBreak} — a question never strands apart from its answer (ruling 2026-08-10)`);
check("headings keep their content", r.h2BreakAfter === "avoid" && r.invHeadBreakAfter === "avoid",
  `h2=${r.h2BreakAfter} inv-head=${r.invHeadBreakAfter} — no heading alone at a page bottom`);
check("KW's item annotations", r.knifeNote && r.rationsNote && r.pettyNote,
  `(d6)=${r.knifeNote} (3 uses)=${r.rationsNote} (Petty)=${r.pettyNote} — Petty as the translator wrote it, uses via formatCount`);
check("an armor row states its Armor points", r.vestNote === true,
  `wanted "ZZ Print Vest (${r.armorPointsWanted})" — the book's own notation (user ask 2026-08-11); armor 2 on the fixture, not the schema's initial 1, so the leg reads the VALUE`);
check("spellbook rows print their prefixes", r.bookPrefixed && r.scrollPrefixed,
  `book=${r.bookPrefixed} scroll=${r.scrollPrefixed} — the same helper the inventory uses, so the two surfaces cannot drift`);
check("a stored prefix is not doubled", r.prefixNotDoubled,
  "the idempotence case — a name already carrying \"Spellbook (\" gets no second prefix");
check("the personal inventory is headed \"Slots used\", not KW's \"Main\"",
  r.mainHead !== null && r.mainHead.startsWith(`${r.slotsUsedLabel} (`)
  && / \( \d+ \/ \d+ \)$/.test(` ${r.mainHead}`),
  `"${r.mainHead}" vs label "${r.slotsUsedLabel}" — "Main" named KW's body-vs-bag split and meant nothing on paper (user ruling 2026-08-11); read via the localized key, so it survives a translation`);
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
check("NO Connections section, with connections present", r.connHeaderGone,
  "removed 2026-08-13 by ruling — a companion and a container are both connected in this pass, "
  + "so an absent heading is a real absence, not pass 2's vacuous one");
check("a 0-slot companion carrying nothing prints nowhere", r.falconAbsent && r.falconProseGone,
  `absent=${r.falconAbsent} prose-gone=${r.falconProseGone} — no stat line, no description, `
  + "and no bare inv-head either (the older defect)");
check("a connected container still prints its inventory", r.sackInventory,
  "Connections was redundant against this section, not a replacement for it");
check("credits match the art ON the page", /Yochai Gal/.test(r.creditsText)
  && /Aspeheim/.test(r.creditsText) && !/Tlomdev/.test(r.creditsText)
  && r.creditsSmall !== null && r.creditsSmall < 10,
  `${r.creditsSmall}px — an Aspeheim portrait credits Aspeheim and NEVER Tlomdev; the text credit always prints`);
check("empty Notes prints NOTHING — heading included", r.emptyNotesGone === true,
  "user ruling 2026-08-11, retiring the pencil-room exception — Notes takes the empty-sections-are-OMITTED rule like every other section");
check("Notes takes the MIN-ROOM rule (PC only)",
  // BOUNDED both ways: 2.2cm ≈ 83px (heading + TWO 12pt/1.45 lines — the
  // two-line ruling of 2026-08-11, shrinking 2026-08-10's five-line rule
  // after its boundary bit: the mark-box row shifted a real character just
  // past the 4cm threshold, gap on page 1, a lone NOTES heading on page 2).
  // The lower bound catches the rule vanishing; the upper catches a
  // regression to the roomier thresholds — 4cm (151px) and 10cm (378px)
  // both fail it.
  r.notesBreak !== "page" && r.notesBreakInside === "avoid"
  && r.notesMinHeight > 70 && r.notesMinHeight < 110
  && r.npcNotesBreak !== "page" && !(r.npcNotesMinHeight > 60),
  `pc break-inside=${r.notesBreakInside} min=${r.notesMinHeight}px npc min=${r.npcNotesMinHeight} — heading + two lines (~2.2cm) on the current page, a fresh page only when less remains (two-line ruling 2026-08-11); a monster stays a one-pager`);
check("breaking a link removes its inventory section", r.connectionsGone,
  "the sack's section exists only while the sack is connected");
check("failed career: Barebones only, labelled", r.careerPass1 && r.careerPass2,
  `2e-hidden=${r.careerPass1} barebones-shown=${r.careerPass2} — "Failed Career:" below the background, setting read shadowed in-page`);

console.log("\nthe monster's page");
check("a monster prints", r.npcPrinted && r.npcSubtitle === r.npcRoleWord,
  `printed=${r.npcPrinted} subtitle="${r.npcSubtitle}" — the role where a PC's background goes`);
check("an npc page has NO mark boxes", r.npcNoCondBoxes,
  "the boxes are character-only; an npc keeps the text status line");
check("statblock prose and numbers", r.npcDesc && r.npcStats,
  `desc=${r.npcDesc} stats=${r.npcStats}`);
check("no PC-only sections", r.npcNoPcSections && !r.npcNotesHeader && r.npcCredits,
  `pcSections=${!r.npcNoPcSections} notesHeader=${r.npcNotesHeader} credits=${r.npcCredits} — no Background/Bonds/Omen; a note-less monster gets no Notes header either (2026-08-11), credits still on`);
check("the monster credits Tlomdev, not Aspeheim", /Tlomdev/.test(r.npcCreditsText)
  && !/Aspeheim/.test(r.npcCreditsText) && /Yochai Gal/.test(r.npcCreditsText),
  "the attribution follows the portrait's gallery");

console.log("\nthe thing's page");
check("a container prints its cargo with the AUTHORED slot fraction",
  r.sackPageGear && r.sackPageHead === `${r.slotsUsedLabel} ( 1 / 4 )`,
  `gear=${r.sackPageGear} head="${r.sackPageHead}" — the point of printing a sack is what's in it (user ruling 2026-08-11); the fraction reads authored slots, the falcon trap's standalone corollary`);
check("and no statblock — a thing's page is its cargo",
  r.sackPageNoStats && r.sackPageSubtitle === r.containerRoleLabel,
  `stats-gone=${r.sackPageNoStats} subtitle="${r.sackPageSubtitle}" — the schema's 10/10/10 on a sack is noise; the role prints where a PC's background goes`);
check("a slotless companion keeps its statblock, gains no empty inventory heading",
  r.falconPageStats && r.falconPageNoInvHead,
  `stats=${r.falconPageStats} noInvHead=${r.falconPageNoInvHead} — a companion is a creature, not a thing (authored slots 0, derived slotsMax 10)`);

console.log("\ngrant-source tags on the page");
check("a granted item prints its tag, italic in brackets", r.grantTagOn === true,
  `wanted "${r.grantTagWanted}" — the tag rides the .notes span, which is already italic; the brackets are the ask (user ruling 2026-08-11, default ON)`);
check("the print switch turns them off", r.grantTagOff === true && r.grantTagOn === true,
  `off-hidden=${r.grantTagOff} (precondition on-shown=${r.grantTagOn}, or absence passes for the wrong reason)`);
check("independent of the INVENTORY switch", r.grantTagInvOff === true && r.grantTagOn === true,
  `inv-off-still-shown=${r.grantTagInvOff} — items re-prepared under the shadow so system.grantLabel is EMPTY; only the ungated grantLabelRaw can print this tag`);

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

/* --------------------------------------------------- pagination, on paper --
 * The only leg here that renders a real PDF, because page COUNT is not
 * DOM-observable — every other pagination claim in this file reads CSS and
 * takes it on trust. A user reported a character whose sheet fits printing a
 * blank second page (2026-08-13): content 1043px on a 1056px US Letter page,
 * pushed over by the running frame's own furniture. A4 (1123px) never showed
 * it, which is why it read as intermittent.
 *
 * The fixture is that character's shape — nine items, two questions, one bond,
 * no notes, no description, no omen, no scars — because the defect lives in a
 * ~70px band near the page bottom and a fixture outside it proves nothing. The
 * control says so out loud: restoring the body's print padding in-page must
 * bring the blank page BACK, or this leg is not looking at the right document.
 * ------------------------------------------------------------------------- */
console.log("\npagination, rendered to paper");
const ZERO_MARGIN = { top: "0", bottom: "0", left: "0", right: "0" };
const pdfPages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

const pagerId = await page.evaluate(async () => {
  const bg = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())
    .find((d) => d.name === "Prowler");
  const actor = await CONFIG.Actor.documentClass.create({
    name: "ZZ Print Pager", type: "character",
    system: {
      background: "Prowler", backgroundUuid: bg?.uuid ?? "", contentSource: "2e",
      abilities: { STR: { value: 10, max: 10 }, DEX: { value: 16, max: 16 }, WIL: { value: 16, max: 16 } },
      hp: { value: 3, max: 3 }, gold: 5, age: "23",
      traits: { physique: "Lanky", skin: "Oily", hair: "Wispy", face: "Rakish",
        speech: "Whispery", clothing: "Bloody", vice: "Craven", virtue: "Merciful" },
      bonds: [{ id: "zzpager0000000001", gold: 0,
        description: "You inherited a Single Gem (500gp, cold and brittle) from a long-dead relative. It arrived with a warning: squander your newfound riches, and a debt long thought forgotten would be called." }],
      questions: [
        { question: "What did you last hunt?", gold: 0,
          answer: "A silver marsh crawler that killed someone close to you. You now carry its Tooth (petty) on a chain around your neck as a warning to others of its kind. The tooth hums softly when something is stalking you." },
        { question: "What tool is always in your pack?", gold: 0,
          answer: "Spike and Cord: For traversing difficult terrain or for creating makeshift traps and structures." },
      ],
      omenEnabled: false, scars: [], description: "", notes: "",
    },
  });
  await actor.createEmbeddedDocuments("Item", [
    { name: "ZZ Single Gem", type: "item", system: { description: "You inherited a Single Gem (500gp, cold and brittle) from a long-dead relative. It arrived with a warning: squander your newfound riches, and a debt long thought forgotten would be called." } },
    { name: "ZZ Rations", type: "item", system: { description: "Preserved trail food.", uses: { value: 3, max: 3 } } },
    { name: "ZZ Torch", type: "item", system: { description: "A pitch-soaked brand.", uses: { value: 3, max: 3 } } },
    { name: "ZZ Tarp", type: "item", system: { description: "A large waterproof sheet for shelter, cover, or hauling a load." } },
    { name: "ZZ Boiled Leather", type: "armor", system: { description: "Hardened leather armor.", armor: 1, equipped: true } },
    { name: "ZZ Short sword", type: "weapon", system: { description: "A plain, reliable blade.", damageFormula: "d6", equipped: true } },
    { name: "ZZ Spring-Loaded Trap", type: "item", system: { description: "4 STR damage" } },
    { name: "ZZ Tooth", type: "item", system: { description: "The Tooth of a Silver Marsh Crawler, carried as a warning to others of its kind. Hums softly when something is stalking you.", weightless: true } },
    { name: "ZZ Spike and Cord", type: "item", system: { description: "For traversing difficult terrain or for creating makeshift traps and structures." } },
  ], { render: false });
  await actor.sheet.render(true);
  return actor.id;
});
await page.waitForSelector('[data-action="printSheet"]', { state: "visible", timeout: 15000 });

const renderPaper = async (restorePadding) => {
  const popped = page.waitForEvent("popup", { timeout: 20000 });
  await page.click('[data-action="printSheet"]');
  const pop = await popped;
  await pop.waitForLoadState("domcontentloaded").catch(() => null);
  await new Promise((res) => setTimeout(res, 1500));
  if (restorePadding) {
    await pop.evaluate(() => {
      const s = document.createElement("style");
      s.textContent = "@media print{body{padding-top:2rem!important;padding-bottom:2rem!important}}";
      document.head.appendChild(s);
    });
  }
  const out = {
    letter: pdfPages(await pop.pdf({ format: "Letter", printBackground: true, margin: ZERO_MARGIN })),
    a4: pdfPages(await pop.pdf({ format: "A4", printBackground: true, margin: ZERO_MARGIN })),
  };
  await pop.emulateMedia({ media: "print" });
  const roof = await pop.evaluate(() => {
    const th = document.querySelector(".page-frame thead");
    const rect = th?.getBoundingClientRect();
    return rect ? { top: Math.round(rect.top + window.scrollY), h: Math.round(rect.height) } : null;
  });
  await pop.close();
  return { ...out, roof };
};

const paper = await renderPaper(false);
const paperControl = await renderPaper(true);
await page.evaluate(async (id) => { await game.actors.get(id)?.sheet.close(); }, pagerId);

check("a character that FITS prints on ONE page", paper.letter === 1 && paper.a4 === 1,
  `Letter=${paper.letter} A4=${paper.a4} — no page holding nothing but the frame's furniture`);
check("control: the body's print padding brings the blank page back", paperControl.letter === 2,
  `Letter=${paperControl.letter} A4=${paperControl.a4} — if this is 1, the fixture drifted out of the `
  + "~70px band where the defect lives and the leg above proves nothing");
check("the 9mm roof still lands on page 1", paper.roof?.top === 0 && paper.roof?.h > 30,
  `${JSON.stringify(paper.roof)} — the frame's thead is what replaced the body padding, so it must be `
  + "the first thing on the paper, not merely present on continuation pages");

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async ({ ids, itemIds, pagerId: pid }) => {
  for (const id of Object.values(ids)) await game.actors.get(id)?.delete();
  for (const id of itemIds) await game.items.get(id)?.delete();
  await game.actors.get(pid)?.delete();
}, { ids: r.ids, itemIds: r.itemIds, pagerId });

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\nprint e2e FAILED — ${failures}` : "\nprint e2e passed");
process.exit(failures ? 1 : 0);
