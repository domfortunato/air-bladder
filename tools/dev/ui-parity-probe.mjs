#!/usr/bin/env node
/**
 * The character sheet's HEADER and STAT-BLOCK layout, measured in the browser.
 *
 * Every item here was reported as a visual defect against a live sheet, so every
 * one is checked as GEOMETRY or COMPUTED STYLE — never by reading the stylesheet
 * back, which only proves a rule was written, not that it applied or won.
 *
 * Rolls a real character (the Gold counter only exists on a generated one) and
 * deletes it afterwards.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  // The Connections tab needs no setup any more: `show-containers-tab` is gone
  // and the tab is structural (everything but a Monster and an unlinked token's
  // actor shows it). This block used to set the setting and RELOAD, because it
  // was registered requiresReload:true and flipping it at runtime painted the
  // nav item over an uninitialised tab — a coin flip for every check that
  // clicked into it. With no setting there is nothing to flip and no reload to
  // sequence.

  const r = await page.evaluate(async (hadTab) => {
    const NS = "air-bladder";
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const out = { made: [] };
    const was = game.settings.get(NS, "show-generate-header");
    await game.settings.set(NS, "show-generate-header", true);

    const pack = game.packs.get("air-bladder.backgrounds-2e");
    const bg = (await pack.getDocuments())[0];
    const c = await gen.generate2eCharacter(bg);
    const actor = await gen.createActorWithCharacter(c);
    out.made.push(actor.id);
    await actor.sheet.render(true);
    await new Promise((res) => setTimeout(res, 1200));

    const root = actor.sheet.element;
    const box = (sel) => {
      const el = root.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const style = (sel, prop) => {
      const el = root.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };

    // The sheet's custom checkboxes must be ONE box, not two. `appearance: none`
    // removes the native widget only -- Foundry draws the whole control with
    // pseudo-elements (::before is a Font Awesome square, swapped for a
    // check-square when checked), so its glyph renders INSIDE ours unless it is
    // switched off, giving a smaller checkbox stacked on the larger one. It
    // renders, it toggles, it logs nothing; it just looks wrong.
    out.checkboxes = [".deprived-check", ".panicked-check"].map((sel) => {
      const el = root.querySelector(sel);
      if (!el) return { sel, missing: true };
      return {
        sel,
        before: getComputedStyle(el, "::before").content,
        size: Math.round(el.getBoundingClientRect().width),
      };
    });

    // The Notes tab's name, read off the rendered nav rather than the context.
    out.notesTabLabel = root.querySelector('.tabs .item[data-tab="notes"]')?.textContent?.trim() ?? null;
    // Gold uses the 70/30 long-counter split, matching Armor/Deprived beneath it.
    const goldLabel = root.querySelector(".character-sheet-section-name .deprived-counter label");
    const goldBox = root.querySelector(".character-sheet-section-name .deprived-counter");
    out.goldLabelRatio = goldLabel && goldBox
      ? Math.round((goldLabel.getBoundingClientRect().width / goldBox.getBoundingClientRect().width) * 100)
      : null;
    const armorLabel = root.querySelector(".armor-counter label");
    const armorBox = root.querySelector(".armor-counter");
    out.armorLabelRatio = armorLabel && armorBox
      ? Math.round((armorLabel.getBoundingClientRect().width / armorBox.getBoundingClientRect().width) * 100)
      : null;

    out.hp = box(".hp-counter");
    out.gold = box(".character-sheet-section-name .deprived-counter");
    out.str = box(".STR-counter");
    out.dex = box(".DEX-counter");
    out.wil = box(".WIL-counter");
    out.armor = box(".armor-counter");
    out.deprived = box(".character-sheet-section-others .deprived-counter");

    out.dexRadius = style(".DEX-counter", "borderTopLeftRadius");
    out.strRadius = style(".STR-counter", "borderBottomLeftRadius");
    // The three header buttons were reverted to Foundry's own chrome on
    // 2026-07-28 (they had carried a cream fill + 2px black border). "Foundry's
    // default" is MEASURED, not hardcoded: a bare button appended to the same
    // container inherits our sizing rules but none of our colour ones, so it is
    // the reference. Hardcoding a colour would fail the day Foundry repaints its
    // buttons, which is exactly the kind of stale assertion this file collected.
    const chrome = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return `${s.backgroundColor} | ${s.borderTopWidth} ${s.borderTopColor}`;
    };
    out.restBg = chrome(root.querySelector("#rest-button"));
    out.restoreBg = chrome(root.querySelector("#restore-abilities-button"));
    out.fateBg = chrome(root.querySelector("#die-of-fate-button"));
    const refHost = root.querySelector(".character-sheet-section-buttons");
    let ref = null;
    if (refHost) {
      ref = document.createElement("button");
      ref.type = "button";
      ref.textContent = "probe";
      refHost.appendChild(ref);
      out.defaultBtn = chrome(ref);
      ref.remove();
    }
    out.fateGlow = style("#die-of-fate-button", "textShadow");

    // The header buttons used to be asserted here: Roll Character and the
    // Randomization toggle, each found by a per-actor class on markup the sheet
    // painted into the title bar itself. The ApplicationV2 port deleted all of
    // that -- they are `window.controls` entries now, rendered by core into the
    // ⋮ menu, and there is no per-actor class to select. The coverage was not
    // lost, it MOVED: `npm run dev:dialogs` drives the real menu and asserts the
    // same five things (both entries present, the toggle flips the mode, Roll
    // Character disappears, the label reads "Randomization: Off", it comes back).
    // Duplicating it here would mean two probes to update for one behaviour.

    // --- Description tab: the background description moved to the HEADER, and
    // the Cairn-compatible badge sits at the foot.
    out.descInHeader = !!root.querySelector(".character-sheet-section-name .background-description");
    out.descInTab = !!root.querySelector('.tab[data-tab="description"] .background-description');
    const badge = root.querySelector(".cairn-compat-footer img");
    // naturalWidth is the only honest test that the file actually resolved --
    // a broken src still yields an <img> element with a bounding box.
    if (badge && !badge.complete) await new Promise((res) => { badge.onload = badge.onerror = res; });
    out.badge = badge ? { natural: badge.naturalWidth, src: badge.getAttribute("src") } : null;
    out.badgeCredit = root.querySelector(".cairn-compat-caption")?.textContent?.trim() ?? null;

    // --- Connections tab: empty state + the custom-container escape hatch.
    // PARKED since 2026-08-09: the tab renders only under the in-page settings
    // shadow (never a world write — the parked DEFAULT is asserted in the
    // settings block below, beside the internal-flag check). These legs keep
    // covering the RESTORED state, so the UI is known-good on the day it is
    // unparked.
    const origSettingsGet = game.settings.get;
    game.settings.get = function (ns, key) {
      if (key === "connections-ui-enabled") return true;
      return origSettingsGet.call(this, ns, key);
    };
    try {
      actor.prepareData();
      await actor.sheet.render(true);
      await new Promise((res) => setTimeout(res, 600));
      const cRoot = actor.sheet.element;
      out.containerEmpty = !!cRoot.querySelector(".container-empty");
      // The market link is REMOVED from this tab by design (docs/npc-roles-plan.md)
      // — the tab is relationships, not shopping. Asserted absent below. The
      // "Custom container…" escape hatch followed it out (2026-08-01): asserted
      // absent too, because a template copy could quietly resurrect either.
      out.containerShop = !!(cRoot.querySelector(".container-empty-shop") || cRoot.querySelector(".container-shop"));
      out.containerCustom = !!cRoot.querySelector(".container-custom");

      // Presence is NOT enough -- a copied template can render a link that has no
      // handler behind it. CLICK Add Connection and assert its dialog opens,
      // offering the connectable npc seeded here for exactly that purpose.
      //
      // Open the tab as a player would, then click the control.
      cRoot.querySelector('.tabs .item[data-tab="containers"]')?.click();
      await new Promise((res) => setTimeout(res, 400));
      out.tabActive = cRoot.querySelector('.tab[data-tab="containers"]')?.classList.contains("active") ?? null;

      const connectable = await CONFIG.Actor.documentClass.create({
        name: "ZZ Parity Connectable", type: "npc", system: { role: "npc" },
      });
      const addLink = cRoot.querySelector(".connection-add");
      // Report the action NAME: a link with no data-action reaches no handler,
      // whatever is bound to it (ApplicationV2 dispatches through `actions`).
      out.addLinkAction = addLink?.dataset.action ?? null;
      addLink?.click();
      let dlg = null;
      for (let i = 0; i < 40 && !dlg; i++) {
        await new Promise((res) => setTimeout(res, 250));
        dlg = document.querySelector("dialog select[name=connectionTarget]");
      }
      out.connectionDialogOpens = !!dlg;
      out.connectionOffersSeed = dlg
        ? [...dlg.options].some((o) => o.textContent === "ZZ Parity Connectable")
        : false;
      // On failure, say what WAS on screen — "opens nothing" is not a diagnosis.
      out.openDialogTitles = [...document.querySelectorAll(".application")]
        .map((d) => d.querySelector(".window-title")?.textContent?.trim() ?? "(untitled)");
      dlg?.closest("dialog")?.querySelector('button[data-action="cancel"], button[data-action="close"]')?.click();
      await new Promise((res) => setTimeout(res, 400));
      // A settled DialogV2 outlives its promise in the DOM — wait it out before
      // anything else opens one.
      for (let i = 0; i < 40 && document.querySelector("dialog.dialog"); i++) await new Promise((res) => setTimeout(res, 100));
      await connectable.delete();
    } finally {
      // Back to the parked default for every leg below.
      game.settings.get = origSettingsGet;
      actor.prepareData();
      await actor.sheet.render(true);
      await new Promise((res) => setTimeout(res, 400));
    }

    // A background sheet lists its starting gear WITH tags resolved from the
    // editable pool (the background doc itself stores only names).
    const bgDoc = await fromUuid(actor.system.backgroundUuid);
    if (bgDoc) {
      // getData() became _prepareContext(options) at the ApplicationV2 port.
      const ctx = await bgDoc.sheet._prepareContext({});
      out.bgGearRows = (ctx.startingGearRows ?? []).map((r) => `${r.name}: ${r.tags.join("|")}`);
      out.bgGearTagged = (ctx.startingGearRows ?? []).filter((r) => r.tags.length).length;
      out.bgGearTotal = (ctx.startingGearRows ?? []).length;
    }

    // --- Fatigue rows carry the teal class.
    await actor.createEmbeddedDocuments("Item", [
      { name: "Fatigue", type: "item", system: { isFatigue: true } },
    ]);
    await actor.sheet.render(true);
    await new Promise((res) => setTimeout(res, 600));
    const fatigueEl = actor.sheet.element.querySelector(".fatigue-row");
    out.fatigueRow = !!fatigueEl;
    out.fatigueGlow = fatigueEl ? getComputedStyle(fatigueEl).boxShadow : null;

    // Dialogs used to be checked here for a black title bar and white buttons.
    // f00e72c (2026-07-23) deliberately reverted every non-sheet surface --
    // dialogs included -- to Foundry's own theme-aware chrome, and the CSS that
    // themed them was deleted. These assertions outlived it by five days only
    // because the probe crashed on a missing import before reaching them. There
    // is nothing of ours left on a dialog to assert, so they are gone rather
    // than inverted: a test that we did NOT style something is not worth its
    // upkeep. If dialogs are ever themed again, re-add checks HERE.

    // --- No untranslated keys anywhere on either sheet. A missing lang entry
    // renders the raw "CAIRN.Foo" key as visible text, which is easy to ship
    // unnoticed -- this sweeps every tab of a 2e AND a Barebones character.
    out.rawKeys = [];
    const sweep = async (a) => {
      await a.sheet.render(true);
      await new Promise((res) => setTimeout(res, 700));
      const el = a.sheet.element;
      for (const tab of ["items", "containers", "description", "notes"]) {
        el.querySelector(`.tabs .item[data-tab="${tab}"]`)?.click();
        await new Promise((res) => setTimeout(res, 250));
        for (const m of (el.innerText ?? "").matchAll(/CAIRN\.[A-Za-z.]+/g)) out.rawKeys.push(m[0]);
      }
    };
    await sweep(actor);

    const wasBB = game.settings.get(NS, "content-source-barebones");
    const wasCareer = game.settings.get(NS, "barebones-failed-career");
    await game.settings.set(NS, "content-source-barebones", true);
    await game.settings.set(NS, "barebones-failed-career", true);
    const bbBgs = await gen.getBarebonesBackgrounds();
    const bbActor = await gen.createActorWithCharacter(
      await gen.generateBarebonesCharacter(bbBgs[0])
    );
    out.made.push(bbActor.id);
    await sweep(bbActor);
    out.rawKeys = [...new Set(out.rawKeys)];

    // --- The three Barebones header lines size as ONE block (ruling
    // 2026-08-08: all at .background-name's size; the 15px/13px quieting is
    // overruled). Asserted as EQUALITY across all six halves, not a literal
    // 17px, so a future resize ruling moves one number in cairn.css and this
    // leg follows. Collected here, before the settings restore below --
    // showFailedCareer is derived from barebones-failed-career, so restoring
    // the setting can re-render the block away.
    out.bbHeaderSizes = Object.fromEntries(
      ["background-label", "background-name",
       "failed-career-label", "failed-career-name",
       "failed-career-item-label", "failed-career-item-name"].map((cls) => {
        const node = bbActor.sheet.element.querySelector(`.${cls}`);
        return [cls, node ? getComputedStyle(node).fontSize : null];
      })
    );
    await game.settings.set(NS, "content-source-barebones", wasBB);
    await game.settings.set(NS, "barebones-failed-career", wasCareer);

    // --- Settings sheet: grouped headers + compact rows.
    const cfg = new foundry.applications.settings.SettingsConfig();
    await cfg.render(true);
    await new Promise((res) => setTimeout(res, 900));
    const cfgEl = cfg.element;
    out.settingHeaders = [...cfgEl.querySelectorAll(".cairn-settings-header")].map((h) => h.textContent);
    out.compactRows = cfgEl.querySelectorAll(".cairn-setting-compact").length;
    out.settingsUnmapped = /Unmapped/i.test(cfgEl.textContent);

    // Which group each setting ACTUALLY lands under. The headers are positional
    // -- inserted before an anchor setting -- so a register() call in the wrong
    // place silently files a setting under the wrong heading. Walk the rendered
    // rows in order and attribute each to the last header seen.
    out.grouped = {};
    let current = null;
    for (const el of cfgEl.querySelectorAll(".cairn-settings-header, .form-group")) {
      if (el.classList.contains("cairn-settings-header")) { current = el.textContent; continue; }
      const input = el.querySelector(`[name^="${NS}."]`);
      if (!input || !current) continue;
      (out.grouped[current] ??= []).push(input.name.slice(NS.length + 1));
    }

    // Every registered setting must be reachable on this tab -- a key that is
    // registered but never rendered is invisible to a Warden.
    const settings = await import("/systems/air-bladder/module/settings.js");
    // Only settings registered with `config: true` appear on this tab. One is
    // hidden by design (custom-portrait-list, an internal cache written by a GM
    // scan), so comparing against the raw key list reads a deliberate omission as
    // a missing setting.
    out.declaredKeys = settings.SETTING_KEYS.filter(
      (k) => game.settings.settings.get(`${NS}.${k}`)?.config
    );
    out.hiddenKeys = settings.SETTING_KEYS.filter(
      (k) => game.settings.settings.has(`${NS}.${k}`) && !game.settings.settings.get(`${NS}.${k}`)?.config
    );
    out.renderedKeys = [...cfgEl.querySelectorAll(`[name^="${NS}."]`)].map((i) => i.name.slice(NS.length + 1));
    await cfg.close();

    // Warden title: the GM role label is overridden, and the default account
    // renamed. Both are gated on use-warden-title.
    out.wardenSetting = game.settings.get(NS, "use-warden-title");
    out.roleLabel = game.i18n.localize("USER.RoleGamemaster");
    out.assistantLabel = game.i18n.localize("USER.RoleAssistant");
    out.gmNames = game.users.filter((u) => u.role === CONST.USER_ROLES.GAMEMASTER).map((u) => u.name);

    // The Connections tab is PARKED (2026-08-09): the internal
    // `connections-ui-enabled` flag defaults false and no UI writes it, so an
    // ordinary character's derived flag reads false and the tab is absent.
    // The Warden-visible setting this block used to flip
    // (`show-containers-tab`) no longer exists; a `game.settings.get` for it
    // would THROW, which is the honest way for this probe to notice if it
    // ever comes back. The parked flag must never become Warden-visible
    // either — that removal's reasoning covers it.
    out.settingIsGone = !game.settings.settings.has(`${NS}.show-containers-tab`);
    out.parkedFlagInternal = game.settings.settings.get(`${NS}.connections-ui-enabled`)?.config === false;
    // Same shape, same reason: `show-gold-not-cost` swapped the retired
    // container sheet's Cost box for Gold, and both the box and the sheet are
    // gone. Asserted here rather than only by the grouping list above, because
    // a re-registration in the WRONG group would fail two assertions instead of
    // one and neither would name the real problem.
    out.goldNotCostGone = !game.settings.settings.has(`${NS}.show-gold-not-cost`);
    actor.prepareData();
    out.derivedOffByDefault = actor.system.showContainersTab === false;
    await actor.sheet.render(true);
    await new Promise((res) => setTimeout(res, 400));
    out.tabAbsentByDefault = !actor.sheet.element.querySelector('.tabs .item[data-tab="containers"]');

    await game.settings.set(NS, "show-generate-header", was);
    return out;
  });

  const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

  // Second flip, and the two are not the same decision. Until 2026-08-01 the tab
  // renamed ITSELF once a background was attached, so a generated character and a
  // hand-made one read differently; that dynamic rename died with
  // `showBackgroundNotesLabel`. Since 2026-08-02 the name is STATIC PER ROLE —
  // every character reads "Background & Notes", generated or not, and only the
  // non-person NPC roles say plain "Notes". This leg asserts the generated case
  // agrees with the hand-made one, which is what both flips were about.
  r.notesTabLabel === "Background & Notes"
    ? ok(`the Notes tab reads one name on a GENERATED character too ("${r.notesTabLabel}")`)
    : fail(`Notes tab reads "${r.notesTabLabel}", expected "Background & Notes" — the label is data-driven again`);
  r.goldLabelRatio && Math.abs(r.goldLabelRatio - r.armorLabelRatio) <= 2
    ? ok(`Gold uses the same label/value split as Armor below it (${r.goldLabelRatio}% / ${r.armorLabelRatio}%)`)
    : fail(`Gold's split (${r.goldLabelRatio}%) does not match Armor's (${r.armorLabelRatio}%)`);

  // Layout: HP above STR, Gold above Armor, and the two rows evenly spaced.
  r.hp && r.str && near(r.hp.x, r.str.x)
    ? ok(`HP sits directly above STR (x ${r.hp.x} vs ${r.str.x})`)
    : fail(`HP is not above STR: HP x=${r.hp?.x} STR x=${r.str?.x}`);
  r.gold && r.armor && near(r.gold.x, r.armor.x)
    ? ok(`Gold sits directly above Armor (x ${r.gold.x} vs ${r.armor.x})`)
    : fail(`Gold is not above Armor: Gold x=${r.gold?.x} Armor x=${r.armor?.x}`);
  r.hp && r.gold && near(r.hp.y, r.gold.y)
    ? ok(`HP and Gold share one row (y ${r.hp.y} / ${r.gold.y})`)
    : fail(`HP and Gold are on different rows: y=${r.hp?.y} vs ${r.gold?.y}`);

  // The HP->STR gap must match the STR->DEX gap (row-gap 2px, not 8px).
  const gapToStr = r.str && r.hp ? r.str.y - (r.hp.y + r.hp.h) : null;
  const gapStrDex = r.dex && r.str ? r.dex.y - (r.str.y + r.str.h) : null;
  gapToStr !== null && near(gapToStr, gapStrDex)
    ? ok(`the HP/STR gap matches the STR/DEX gap (${gapToStr}px vs ${gapStrDex}px)`)
    : fail(`uneven vertical spacing: HP->STR ${gapToStr}px, STR->DEX ${gapStrDex}px`);

  // Corners.
  r.dexRadius && parseFloat(r.dexRadius) > 0
    ? ok(`DEX has rounded corners (${r.dexRadius})`)
    : fail(`DEX corners are square (border-radius ${r.dexRadius})`);
  r.strRadius && parseFloat(r.strRadius) > 0
    ? ok(`STR is rounded on every corner (${r.strRadius})`)
    : fail(`STR's lower corners are square (${r.strRadius})`);

  // The three portrait buttons: Foundry's chrome, and ONLY Die of Fate's glow
  // is ours. Until 2026-07-28 all three took a cream fill and a 2px black
  // border; the fill/border went, the teal text glow stayed.
  r.defaultBtn && r.restBg === r.defaultBtn && r.restoreBg === r.defaultBtn && r.fateBg === r.defaultBtn
    ? ok(`Rest / Restore / Die of Fate use Foundry's own button chrome (${r.defaultBtn})`)
    : fail(`buttons deviate from Foundry's default (${r.defaultBtn}):\n        rest=${r.restBg}\n        restore=${r.restoreBg}\n        fate=${r.fateBg}`);
  r.fateGlow && r.fateGlow !== "none"
    ? ok(`Die of Fate keeps its teal text glow (${r.fateGlow})`)
    : fail("Die of Fate has no text glow");

  // One box per checkbox: core's own glyph must be off inside our custom ones.
  const doubled = (r.checkboxes ?? []).filter((c) => c.missing || c.before !== "none");
  (r.checkboxes ?? []).length && !doubled.length
    ? ok(`the custom checkboxes draw one box each (${r.checkboxes.map((c) => `${c.size}px`).join(", ")})`)
    : fail(`a core checkbox glyph is rendering inside ours: ${JSON.stringify(doubled)}`);

  // (The header generation controls are asserted by `npm run dev:dialogs` now —
  // see the note in the page context.)

  // Description: background blurb belongs in the header, not the tab.
  r.descInHeader && !r.descInTab
    ? ok("the background description renders in the sheet header")
    : fail(`background description misplaced: header=${r.descInHeader} tab=${r.descInTab}`);
  r.badge?.natural > 0
    ? ok(`the Cairn-compatible badge loads (${r.badge.natural}px from ${r.badge.src})`)
    : fail(`badge did not load: ${JSON.stringify(r.badge)}`);
  /Yochai Gal/.test(r.badgeCredit ?? "") && /CC BY-SA/.test(r.badgeCredit ?? "")
    ? ok("the badge carries its CC BY-SA attribution to Yochai Gal")
    : fail(`badge credit line wrong: "${r.badgeCredit}"`);

  // Connections tab.
  r.containerEmpty && !r.containerShop
    ? ok("the empty Connections tab has no market link (relationships, not shopping)")
    : fail(`connections empty state wrong: empty=${r.containerEmpty} shopStillThere=${r.containerShop}`);
  !r.containerCustom
    ? ok("the custom-container escape hatch is gone (removed 2026-08-01)")
    : fail("a .container-custom link is back on the Connections tab");
  r.connectionDialogOpens && r.connectionOffersSeed
    ? ok("Add Connection opens its picker, offering the seeded npc")
    : fail(`Add Connection opened nothing usable. data-action=${r.addLinkAction} `
         + `opens=${r.connectionDialogOpens} offersSeed=${r.connectionOffersSeed} `
         + `tabActive=${r.tabActive} dialogs=[${r.openDialogTitles?.join(" | ")}]`);

  r.bgGearTotal > 0 && r.bgGearTagged === r.bgGearTotal
    ? ok(`the background sheet resolves gear tags from the pool (${r.bgGearRows?.join("; ")})`)
    : fail(`background gear tags unresolved: ${r.bgGearTagged}/${r.bgGearTotal} tagged — ${r.bgGearRows?.join("; ")}`);

  // Fatigue.
  r.fatigueRow && r.fatigueGlow && r.fatigueGlow !== "none"
    ? ok(`fatigue rows carry the teal glow (${r.fatigueGlow})`)
    : fail(`fatigue row not styled: present=${r.fatigueRow} shadow=${r.fatigueGlow}`);

  // (Dialogs are Foundry's own chrome now -- see the note in the page context.)

  r.rawKeys?.length === 0
    ? ok("no untranslated CAIRN.* keys render on either the 2e or Barebones sheet")
    : fail(`untranslated keys visible: ${r.rawKeys?.join(", ")}`);

  // Barebones header lines: one size across all three lines (both halves each).
  {
    const sizes = Object.values(r.bbHeaderSizes ?? {});
    const allPresent = sizes.length === 6 && sizes.every((s) => s);
    allPresent && new Set(sizes).size === 1
      ? ok(`the three Barebones header lines share one size (${sizes[0]})`)
      : fail(`Barebones header sizes unequal or missing: ${JSON.stringify(r.bbHeaderSizes)}`);
  }

  // Settings sheet.
  r.settingHeaders?.length === 3
    ? ok(`settings are grouped under 3 headers (${r.settingHeaders.join(" / ")})`)
    : fail(`expected 3 settings group headers, got ${JSON.stringify(r.settingHeaders)}`);
  r.compactRows === r.declaredKeys?.length
    ? ok(`all ${r.compactRows} settings render as compact rows`)
    : fail(`expected ${r.declaredKeys?.length} compact setting rows, got ${r.compactRows}`);
  r.settingsUnmapped === false
    ? ok("no settings land in Foundry's \"Unmapped\" bucket")
    : fail("some settings are still Unmapped");

  // Every registered key is reachable on the tab.
  const missingFromTab = (r.declaredKeys ?? []).filter((k) => !r.renderedKeys?.includes(k));
  missingFromTab.length === 0
    ? ok(`every configurable setting (${r.declaredKeys.length}) is reachable on the Configure Settings tab`
        + (r.hiddenKeys?.length ? ` (${r.hiddenKeys.length} hidden by design: ${r.hiddenKeys.join(", ")})` : ""))
    : fail(`registered but not rendered: ${missingFromTab.join(", ")}`);

  // Each setting under the RIGHT heading, not merely under some heading. Group
  // headers are POSITIONAL — Foundry renders them in registration order — so this
  // is the guard against a new setting silently landing under the wrong one.
  //
  // Brought back in step 2026-07-28: three settings had been added since these
  // lists were written, and the probe could not report it because it crashed on a
  // missing import before ever reaching here (see lib.mjs / dismissChrome).
  // `content-source-custom` and `custom-portrait-folder` are correctly inside the
  // Character Generation block.
  //
  // `min-age` moved from the end of General to the end of Character Generation on
  // 2026-07-28. It is a parameter of the character being generated, and grouping is
  // positional, so the fix was to move the register() call. The cost once feared —
  // "reordering SETTING_KEYS breaks the migration" — was not real: that loop is
  // order-independent, and the stored key string never changed, so no configured
  // value was disturbed.
  const EXPECTED = {
    // `show-gold-not-cost` sat between use-gold-threshold and the late
    // `show-container-actors` until 2026-07-31 (it swapped a CONTAINER SHEET's
    // Cost box for a Gold box, and that sheet went with the `container` type).
    // `show-container-actors` followed it out on 2026-08-02, by ruling: the
    // directory always lists container actors, so a toggle for hiding them
    // governed nothing a Warden should switch. Both removed rather than left
    // registered, exactly as `show-containers-tab` was.
    // The three Warden switches of the 2026-08-08 batch: allow-player-marketplace
    // beside the inventory limit it polices, allow-player-generate beside the
    // Generate-header toggle (directory button and sheet button, side by side),
    // change-log at the end of General. This table went stale-red for that batch
    // because dev:ui-parity was not on its run list — the probe-orphan lesson.
    "Inventory & Encumbrance": ["max-equip-slots", "character-inventory-limit", "allow-player-marketplace",
      "use-gold-threshold", "enable-inventory-reorder"],
    // show-omens-barebones and show-bonds-barebones left this list 2026-08-09:
    // the Barebones lending they toggled was removed outright (user ruling),
    // Barebones sheets never show Omen and generation never mints a bond.
    "Character Generation": ["content-source-2e", "content-source-custom", "content-source-barebones",
      "barebones-failed-career", "show-generate-header",
      "allow-player-generate", "allow-player-randomization", "show-generation-rolls",
      "custom-portrait-folder", "min-age"],
    // show-features-section left this list 2026-08-09: the Features UI it
    // toggled was removed outright (user ruling); the field survives, orphaned.
    "General Settings": ["use-panic", "use-cairn-dice-notation", "use-item-icons", "show-grant-tags",
      "use-warden-title", "change-log", "auto-record-scars"],
  };
  for (const [group, keys] of Object.entries(EXPECTED)) {
    const got = r.grouped?.[group] ?? [];
    const same = got.length === keys.length && keys.every((k, i) => got[i] === k);
    same ? ok(`"${group}" holds exactly its ${keys.length} settings, in order`)
         : fail(`"${group}" mis-grouped:\n        expected ${keys.join(", ")}\n        got      ${got.join(", ")}`);
  }

  // Warden title.
  r.wardenSetting === true
    ? ok("use-warden-title is registered and on by default")
    : fail(`use-warden-title reads ${r.wardenSetting}`);
  r.roleLabel === "Warden" && r.assistantLabel === "Assistant Warden"
    ? ok(`the GM role is relabelled ("${r.roleLabel}" / "${r.assistantLabel}")`)
    : fail(`GM role labels not overridden: "${r.roleLabel}" / "${r.assistantLabel}"`);
  !r.gmNames?.some((n) => /^game ?master$/i.test(n.trim()))
    ? ok(`no GM account is still named "Gamemaster" (${r.gmNames?.join(", ")})`)
    : fail(`a default GM account survived the rename: ${r.gmNames?.join(", ")}`);

  // The Connections tab is parked behind the internal flag (2026-08-09).
  r.settingIsGone
    ? ok("show-containers-tab is no longer registered")
    : fail("show-containers-tab is registered again — the parked flag is internal, not a display toggle");
  r.parkedFlagInternal
    ? ok("connections-ui-enabled is registered config:false")
    : fail("connections-ui-enabled is missing or Warden-visible — the show-containers-tab removal's reasoning forbids a visible toggle");
  r.goldNotCostGone
    ? ok("show-gold-not-cost is no longer registered")
    : fail("show-gold-not-cost is registered again — it has no Cost box left to govern");
  r.derivedOffByDefault
    ? ok("system.showContainersTab is false while the Connections UI is parked")
    : fail("the derived flag is true with the Connections UI parked — a gate is missing");
  r.tabAbsentByDefault
    ? ok("the Connections tab is absent in the parked default")
    : fail("the Connections tab renders while parked");

  // --- Deprived: Rest/Restore stay disabled, but the tooltip must say WHY.
  // The complaint (2026-08-08, a live Warden on actor "Lisbeth"): the buttons
  // grey out under Deprived and their tooltips went on describing how resting
  // WORKS — nothing on the sheet said why they were off. While deprived the
  // tooltip swaps to DeprivedTip (through deprivedTipKey, so npc sheets get
  // the …Npc wording). The hover leg drives a REAL pointer because it also
  // guards the assumption underneath: a disabled control still receives
  // pointerenter — TooltipManager's activation event — in Chromium AND Firefox
  // (both verified live 2026-08-08). If an engine or core ever stops
  // delivering it, this leg is what notices, and the fix that day is
  // aria-disabled plus a mirrored grey.
  const dep = await page.evaluate(async (ids) => {
    // Anything else this probe rendered may cover the character sheet — the
    // hover below is a real pointer, so the button must be topmost.
    for (const id of ids.slice(1)) game.actors.get(id)?.sheet?.close();
    const actor = game.actors.get(ids[0]);
    const out = {};
    const read = (sel) => {
      const b = actor.sheet.element.querySelector(sel);
      return b ? { disabledAttr: b.hasAttribute("disabled"), tooltip: b.dataset.tooltip } : null;
    };
    out.restBefore = read("#rest-button");
    // abNoStatusCard: a probe write must not post the Deprived status card or
    // an audit line into the dev world's chat.
    await actor.update({ "system.deprived": true }, { abNoStatusCard: true });
    await actor.sheet.render(true);
    await new Promise((res) => setTimeout(res, 700));
    out.rest = read("#rest-button");
    out.restore = read("#restore-abilities-button");
    out.deprivedTip = game.i18n.localize("CAIRN.DeprivedTip");
    out.restTip = game.i18n.localize("CAIRN.RestTip");
    const rct = actor.sheet.element.querySelector("#rest-button").getBoundingClientRect();
    out.center = { x: rct.x + rct.width / 2, y: rct.y + rct.height / 2 };
    return out;
  }, r.made ?? []);

  !dep.restBefore?.disabledAttr && dep.rest?.disabledAttr && dep.restore?.disabledAttr
    ? ok("Rest/Restore are disabled while deprived, enabled otherwise")
    : fail(`deprived disable wrong: before=${JSON.stringify(dep.restBefore)} after=${JSON.stringify(dep.rest)}`);
  dep.restBefore?.tooltip === dep.restTip && dep.rest?.tooltip === dep.deprivedTip && dep.restore?.tooltip === dep.deprivedTip
    ? ok("the tooltip swaps to DeprivedTip while deprived, RestTip otherwise")
    : fail(`tooltip not swapped: before="${dep.restBefore?.tooltip?.slice(0, 40)}" deprived="${dep.rest?.tooltip?.slice(0, 40)}"`);

  await page.mouse.move(dep.center.x - 180, dep.center.y - 120);
  await page.waitForTimeout(200);
  await page.mouse.move(dep.center.x, dep.center.y, { steps: 6 });
  await page.waitForTimeout(1400);
  const hover = await page.evaluate(() => {
    const t = document.getElementById("tooltip");
    return { active: t?.classList.contains("active") ?? false, text: t?.textContent ?? "" };
  });
  const strip = (s) => (s ?? "").replace(/<[^>]+>/g, "").trim();
  hover.active && strip(hover.text).startsWith(strip(dep.deprivedTip).slice(0, 30))
    ? ok("hovering the disabled Rest button really shows the Deprived tooltip")
    : fail(`hover tooltip wrong on the disabled button: active=${hover.active} text="${strip(hover.text).slice(0, 60)}"`);

  await page.screenshot({ path: "tools/dev/out/ui-parity.png" });
  console.log("\n  screenshot: tools/dev/out/ui-parity.png");

  await page.evaluate(async (ids) => {
    for (const id of ids) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
  }, r.made ?? []);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nUI PARITY PROBE FAILED\n" : "\nui parity probe passed\n");
process.exit(failed ? 1 : 0);
