#!/usr/bin/env node
/**
 * The four chat-requested UI changes, each measured in the browser:
 *   1. The actor-directory "Generate character" button uses the d6 icon.
 *   2. Chat messages + dice rolls read as the black-and-white sheet.
 *   3. Container/transport actor thumbnails are grayscale in the directory.
 *   4. Spellbook inventory items are prefixed "Spellbook — ".
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const NS = "air-bladder";
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const out = { made: [] };

    // 1. Generate-character button icon (rendered into the actor directory).
    const genBtnIcon = document.querySelector(".create-character-generator-button i");
    out.genBtnIconClass = genBtnIcon ? genBtnIcon.className : null;

    // A 2e character to hang the spellbook + directory checks on.
    const pack = game.packs.get("air-bladder.backgrounds-2e");
    const bg = (await pack.getDocuments())[0];
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(bg));
    out.made.push(actor.id);

    // 4. Spellbook prefix in the inventory list.
    await actor.createEmbeddedDocuments("Item", [{ name: "Magic Missile", type: "spellbook" }]);
    await actor.sheet.render(true);
    for (let i = 0; i < 20 && !actor.sheet.element?.[0]; i++) await new Promise((res) => setTimeout(res, 200));
    await new Promise((res) => setTimeout(res, 600));
    const sRoot = actor.sheet.element?.[0];
    const titles = sRoot ? [...sRoot.querySelectorAll(".cairn-item-title")].map((t) => t.textContent.trim()) : [];
    out.spellbookTitle = titles.find((t) => /Magic Missile/.test(t)) ?? null;

    // 2. Post a dice roll to chat and read its computed styling.
    await new Roll("1d6").toMessage({ flavor: "Die Of Fate" });
    await new Promise((res) => setTimeout(res, 900));
    const msg = [...document.querySelectorAll(".chat-message")].pop();
    if (msg) {
      const cs = getComputedStyle(msg);
      out.chatFont = cs.fontFamily;
      out.chatBg = cs.backgroundColor;
      const header = msg.querySelector(".message-header");
      out.chatHeaderBg = header ? getComputedStyle(header).backgroundColor : null;
      const total = msg.querySelector(".dice-total");
      out.diceTotalBg = total ? getComputedStyle(total).backgroundColor : null;
      out.diceTotalBorder = total ? getComputedStyle(total).borderTopWidth : null;
    }

    // A message carrying the system's injected chat controls (apply-damage card
    // + a mark-critical-damage button), to confirm they take the sheet look.
    await ChatMessage.create({
      content:
        '<div class="flavor-dice-roll"><div>Damage taken</div>' +
        '<div class="icon-action"><a class="btn apply-dmg"><i class="fas fa-user-minus"></i></a></div></div>' +
        '<button type="button" class="mark-critical-damage">Mark Critical Damage</button>',
    });
    await new Promise((res) => setTimeout(res, 500));
    const btnMsg = [...document.querySelectorAll(".chat-message")].pop();
    const critBtn = btnMsg?.querySelector(".mark-critical-damage");
    out.critBtnBg = critBtn ? getComputedStyle(critBtn).backgroundColor : null;
    out.critBtnBorder = critBtn ? getComputedStyle(critBtn).borderTopWidth : null;

    // Expand the earlier dice roll's tooltip so the per-die styling is on screen
    // for the screenshot.
    msg?.querySelector(".dice-roll")?.click();
    await new Promise((res) => setTimeout(res, 400));

    // 3. A container (transport) actor, checked in the directory.
    const wagon = await Actor.create({
      name: "Probe Wagon", type: "container",
      img: "icons/environment/settlement/wagon.webp",
      system: { transportKind: "vehicle" },
    });
    out.made.push(wagon.id);
    await game.settings.set(NS, "show-container-actors", true);
    const dir = ui.actors ?? ui.sidebar?.tabs?.actors;
    await dir?.render(true);
    await new Promise((res) => setTimeout(res, 900));
    const row = document.querySelector(`.actor[data-entry-id="${wagon.id}"]`);
    out.wagonRowFound = !!row;
    out.wagonHasGrayClass = row?.classList.contains("cairn-grayscale-portrait") ?? false;
    const img = row?.querySelector("img");
    out.wagonImgFilter = img ? getComputedStyle(img).filter : null;
    // A character row must NOT be grayed.
    const charRow = document.querySelector(`.actor[data-entry-id="${actor.id}"]`);
    out.charImgFilter = charRow?.querySelector("img")
      ? getComputedStyle(charRow.querySelector("img")).filter : null;

    return out;
  });

  // Screenshots for the eyeball check.
  await page.screenshot({ path: "tools/dev/out/ui-batch-chat.png" });

  r.genBtnIconClass?.includes("fa-dice-d6")
    ? ok(`Generate-character button uses the d6 icon (${r.genBtnIconClass})`)
    : fail(`Generate-character icon is "${r.genBtnIconClass}", expected fa-dice-d6`);

  r.spellbookTitle && r.spellbookTitle.startsWith("Spellbook —")
    ? ok(`spellbook items are prefixed ("${r.spellbookTitle}")`)
    : fail(`spellbook title was "${r.spellbookTitle}", expected a "Spellbook —" prefix`);

  const isLight = (c) => /rgb\(\s*245,\s*245,\s*245\s*\)/.test(c ?? "");
  const isBlack = (c) => /rgb\(\s*0,\s*0,\s*0\s*\)/.test(c ?? "");
  const isWhite = (c) => /rgb\(\s*255,\s*255,\s*255\s*\)/.test(c ?? "");
  /Alegreya/.test(r.chatFont ?? "")
    ? ok(`chat messages use the Alegreya sheet font (${r.chatFont})`)
    : fail(`chat font is "${r.chatFont}", expected Alegreya`);
  isLight(r.chatBg)
    ? ok(`chat card background matches the sheet (${r.chatBg})`)
    : fail(`chat background is "${r.chatBg}", expected the sheet's #f5f5f5`);
  isBlack(r.chatHeaderBg)
    ? ok(`the chat header is the sheet's black name-bar (${r.chatHeaderBg})`)
    : fail(`chat header background is "${r.chatHeaderBg}", expected black`);
  isWhite(r.diceTotalBg) && parseFloat(r.diceTotalBorder) >= 2
    ? ok(`dice totals read as the sheet's white/black counters (${r.diceTotalBg}, ${r.diceTotalBorder} border)`)
    : fail(`dice total styling off: bg=${r.diceTotalBg} border=${r.diceTotalBorder}`);

  isWhite(r.critBtnBg) && parseFloat(r.critBtnBorder) >= 2
    ? ok(`injected chat buttons take the sheet's white/black look (${r.critBtnBg}, ${r.critBtnBorder} border)`)
    : fail(`injected chat button styling off: bg=${r.critBtnBg} border=${r.critBtnBorder}`);

  r.wagonHasGrayClass
    ? ok("the container actor row is tagged for grayscale")
    : fail("the container actor row has no grayscale class");
  /grayscale\(1\)|grayscale\(100%\)/.test(r.wagonImgFilter ?? "")
    ? ok(`the container thumbnail is grayscale (${r.wagonImgFilter})`)
    : fail(`container thumbnail filter is "${r.wagonImgFilter}", expected grayscale(1)`);
  !/grayscale/.test(r.charImgFilter ?? "") || r.charImgFilter === "none"
    ? ok(`a character thumbnail is left in colour (${r.charImgFilter})`)
    : fail(`a character thumbnail was greyed too: ${r.charImgFilter}`);

  await page.evaluate(async (ids) => {
    for (const id of ids) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
    for (const m of [...game.messages].slice(-4)) { try { await m.delete(); } catch { /* gone */ } }
  }, r.made);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nUI BATCH PROBE FAILED\n" : "\nui batch probe passed\n");
process.exit(failed ? 1 : 0);
