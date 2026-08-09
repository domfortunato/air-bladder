#!/usr/bin/env node
/**
 * The localized surfaces actually RENDER localized.
 *
 * `i18n:check` compares language files to each other and `i18n:source` compares
 * the code to en.json. Neither can see the third failure: a string that IS routed
 * through game.i18n and still comes out English, because the value fed into it is
 * a raw stored token, or because a guard compares stored English against a
 * translated string. Every finding below was that shape, and all of them were
 * invisible in an English world — which is the only world any probe ran in.
 *
 * Method: swap `game.i18n.translations` for a copy carrying UNIQUE SENTINELS for
 * the keys under test, render, and assert the sentinel is what reaches the DOM.
 * A sentinel makes each assertion a real negative control — the pre-fix code
 * emitted the English literal, which no sentinel matches. Restored in a finally.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
const is = (got, want, what) =>
  got === want ? ok(`${what} (${JSON.stringify(got)})`) : fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// The sentinels are deliberately un-English so a fallback cannot pass by accident.
const S = {
  str: "ZZ-FUE",
  save: "ZZ-salvación de {key}",
  crit: "ZZ-daño crítico — {key}",
  spellbook: "ZZ-hechizo — ",
  // EN dash U+2013, deliberately, and not interchangeable with the line above.
  // The prefix guard derives the parenthesised form by stripping the trailing
  // separator, and it used to do that with a hand-written list of punctuation
  // ([\s—:(-]) that included the EM dash and not the EN dash — which is visually
  // near-identical and is the conventional dash in several of the languages this
  // system ships files for. With both sentinels on an em dash the probe could not
  // see that: it tested the one separator the list happened to contain. One of
  // each is what makes this assertion about separators at all.
  spellscroll: "ZZ-pergamino – ",
  del: "ZZ-¿eliminar {name}?",
  limit: "ZZ-doble clic para cambiar el límite",
  wizard: "ZZ-mago",
  uses: "ZZ-{n} usos",
  // The SINGULAR form, which only Intl.PluralRules can reach. Distinct from
  // the plural sentinel on purpose: "1 uses" passed every check there was.
  usesOne: "ZZ-{n} uso",
  slotOne: "ZZ-{n} espacio",
  edition: "ZZ-Cairn 2ª ed.",
};

let out = {};
try {
  await joinAsGM(page);

  out = await page.evaluate(async (S) => {
    const r = { cleanup: {} };
    const original = game.i18n.translations;
    game.i18n.translations = foundry.utils.mergeObject(
      foundry.utils.deepClone(original),
      {
        STR: S.str,
        "CAIRN.Save": S.save,
        "CAIRN.CriticalDamageStatusFor": S.crit,
        "CAIRN.SpellbookPrefix": S.spellbook,
        "CAIRN.SpellscrollPrefix": S.spellscroll,
        "CAIRN.EquipmentLimitTip": S.limit,
        "CAIRN.Archetype.Wizard": S.wizard,
        "CAIRN.ContentSource2e": S.edition,
        "CAIRN.NUses": S.uses,
        "CAIRN.NUses_one": S.usesOne,
        "CAIRN.NSlot_one": S.slotOne,
        "CAIRN.Notify": { ConfirmDeleteNamed: S.del },
      },
      { inplace: false }
    );

    const settle = (ms = 400) => new Promise((res) => setTimeout(res, ms));
    const rendered = async (app) => {
      await app.render(true);
      for (let i = 0; i < 30 && !app.element; i++) await settle(150);
      await settle(400);
      return app.element;
    };

    const NS = "air-bladder";
    const limitWas = game.settings.get(NS, "character-inventory-limit");
    try {
      // The equipment-limit tooltip only exists while the limit feature is on.
      // Set it BEFORE the sheet renders: prepareData reads the setting live, but
      // an already-open sheet would never pick it up.
      await game.settings.set(NS, "character-inventory-limit", true);

      // ---- character sheet: ability saves, crit banner, spellbook rows -------
      const gen = await import("/systems/air-bladder/module/character-generator.js");
      const bg = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())[0];
      const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(bg));
      r.cleanup.actorId = actor.id;

      // Critical Damage shows only while STR is damaged and the character alive.
      //
      // abNoStatusCard: since 2026-08-07 crossing into Critical Damage posts a
      // chat card, and this probe only wants the SHEET banner. Without the flag
      // every run of it drops a bar into the dev world's log, which nothing here
      // would clean up.
      await actor.update({
        "system.abilities.STR.value": Math.max(1, actor.system.abilities.STR.max - 2),
        "system.critical": true,
      }, { abNoStatusCard: true });
      await actor.createEmbeddedDocuments("Item", [
        { name: "Magic Missile", type: "spellbook" },
        { name: "Spellbook — Hempen Hoop", type: "spellbook" },
        // The doubling guard has to cope with a name that is ALREADY in the
        // display language, which is what the content overlay hands the row for
        // every shipped grant spelled "Spellbook (X)" (Bonekeeper, Half-Witch,
        // Hexenbane, Mountebank, Foundling). Stored translated here rather than
        // driven through an overlay because the helper only ever sees the display
        // string — this is byte-for-byte the input the overlay would give it.
        // Written out, NOT derived from S.spellbook by re-running the strip the
        // helper performs. Re-deriving would make the probe agree with the
        // implementation by construction — the expected string has to come from
        // somewhere the code under test cannot influence, and the assertions
        // further down already compare against these same literals.
        { name: "ZZ-hechizo (Aro de Cáñamo)", type: "spellbook" },
        { name: "ZZ-pergamino (Adherir)", type: "spellbook", system: { scroll: true } },
        { name: "ZZ Probe Torch", type: "item", system: { uses: { value: 3, max: 3 } } },
      ]);

      const root = await rendered(actor.sheet);
      if (!root) throw new Error("character sheet did not render");

      r.saveLabel = root.querySelector('[data-action="rollAbility"][data-ability="STR"]')?.dataset.label ?? null;
      r.abilityText = root.querySelector('[data-action="rollAbility"][data-ability="STR"]')?.textContent.trim() ?? null;
      // Matched out of the sheet text rather than by selector: the banner markup
      // has moved before, and a container selector picks up the neighbouring
      // Overburdened banner too.
      // The template joins label and text with "<strong>{label}:</strong>", so
      // stop at the colon.
      r.critBanner = root.textContent.replace(/\s+/g, " ").match(/ZZ-daño crítico — [^\s:]+/)?.[0] ?? null;
      const titles = [...root.querySelectorAll(".cairn-item-title")].map((t) => t.textContent.trim());
      r.spellbookBare = titles.find((t) => /Magic Missile/.test(t)) ?? null;
      r.spellbookPrefixed = titles.find((t) => /Hempen Hoop/.test(t)) ?? null;
      r.spellbookParen = titles.find((t) => /Aro de Cáñamo/.test(t)) ?? null;
      r.spellscrollParen = titles.find((t) => /Adherir/.test(t)) ?? null;
      r.limitTitle = root.querySelector("#set-equipment-limit")?.getAttribute("title") ?? null;
      r.sheetEdition = root.querySelector(".content-source-label")?.textContent.trim() ?? null;
      // The prefix is a DISPLAY affordance: generation must never bake it into a
      // stored name, or a second one gets bolted on at render time forever after.
      // (Folded in from the old spellbook-prefix-probe, which had no npm script
      // and had rotted against AppV1's `sheet.element[0]`.)
      r.storedSpellbookNames = actor.items.filter((i) => i.type === "spellbook").map((i) => i.name);

      // ---- delete confirmation ---------------------------------------------
      const torch = actor.items.find((i) => i.name === "ZZ Probe Torch");
      const pending = actor.deleteOwnedItem(torch.id);
      for (let i = 0; i < 30; i++) {
        const dlg = [...foundry.applications.instances.values()].find((a) => a.constructor.name === "DialogV2");
        // .dialog-content only — the window text also carries the Yes/No labels.
        const body = dlg?.element?.querySelector(".dialog-content") ?? dlg?.element;
        if (body) { r.deleteContent = body.textContent.replace(/\s+/g, " ").trim(); dlg.close(); break; }
        await settle(100);
      }
      await pending;

      // ---- background authoring sheet: the archetype dropdown ---------------
      const [bgItem] = await Item.implementation.create([
        { name: "ZZ Probe Background", type: "background", system: { source: "2e" } },
      ]);
      r.cleanup.bgItemId = bgItem.id;
      const bgRoot = await rendered(bgItem.sheet);
      r.archetypeOptions = bgRoot
        ? [...bgRoot.querySelectorAll("select option")].map((o) => o.textContent.trim()).filter(Boolean)
        : [];
      // The SAME edition label as the character sheet above. It was a second
      // hardcoded map that had already drifted — one sheet said "Cairn Barebones",
      // the other "Barebones" — so both surfaces are read here and compared.
      r.bgEdition = bgRoot?.querySelector(".bg-source-fixed")?.textContent.trim() ?? null;

      // ---- shop chips: a unit noun, not the sheet's field label -------------
      // CAIRN.Uses is "Available uses", the LABEL above the uses input. Borrowed
      // as a unit it read "3 Available uses" — wrong in English, and unfixable in
      // any language where the count does not lead.
      const market = await import("/systems/air-bladder/module/marketplace.js");
      await market.openMarketplace(actor);
      for (let i = 0; i < 30 && !document.querySelector(".marketplace"); i++) await settle(150);
      await settle(500);
      const shop = document.querySelector(".marketplace");
      r.chips = shop
        ? [...shop.querySelectorAll("*")]
            .map((e) => e.textContent.trim())
            .filter((t) => t.startsWith("ZZ-") && t.length < 40)
        : [];
      shop?.closest(".application")?.querySelector('[data-action="close"]')?.click();

      // ---- and the singular, which no chip in the shop happens to exercise ---
      // "{n} uses" rendered "1 uses" on 55 shipped items. The count is chosen by
      // Intl.PluralRules at runtime, so the SINGULAR key is reachable only
      // through formatCount -- read it here, under the same sentinel swap, so a
      // regression cannot hide behind whatever the catalogue happens to stock.
      const utils = await import("/systems/air-bladder/module/utils.js");
      r.usesOne = utils.formatCount("CAIRN.NUses", 1);
      r.usesMany = utils.formatCount("CAIRN.NUses", 3);
      r.slotOne = utils.formatCount("CAIRN.NSlot", 1);

      // ---- the gold row's TAG rides formatCount too (review #13 #12) ---------
      // items-list.html hardcoded `localize 'CAIRN.NSlot_one' n=1`, which only
      // works in a language shipping the "_one" form: a base-key-only
      // translation rendered the literal key text in the tag, and a language
      // whose plural rules map 1 to "other" (ja, zh) was asked for a key its
      // translator was never told exists. Simulated by deleting the _one form
      // and sentinelling the base key (the shadow is this probe's own clone,
      // so mutating it is safe and the finally restores the original), then
      // giving the actor exactly one filled coin row — the first N coins stay
      // petty, so 2N gold is one row — and reading the RENDERED tag. The
      // derived coinRowSlotTag re-prepares under the mutated shadow on update.
      delete game.i18n.translations.CAIRN.NSlot_one;
      game.i18n.translations.CAIRN.NSlot = "ZZ-{n} base-slot";
      const perSlot = actor.system.coinsPerSlot;
      await actor.update({ "system.gold": perSlot * 2 }, { abNoStatusCard: true });
      const goldRoot = await rendered(actor.sheet);
      r.goldRowTag = goldRoot?.querySelector(".gold-slot-row .cairn-item-tag")?.textContent.trim() ?? null;
    } finally {
      game.i18n.translations = original;
      await game.settings.set(NS, "character-inventory-limit", limitWas);
    }
    return r;
  }, S);

  is(out.saveLabel, S.save.replace("{key}", S.str), "the STR save label localizes the ability name");
  out.abilityText?.includes(S.str)
    ? ok(`the sheet's own STR label matches it (${JSON.stringify(out.abilityText)})`)
    : fail(`sheet STR label is ${JSON.stringify(out.abilityText)}, expected to contain ${JSON.stringify(S.str)}`);
  is(out.critBanner, S.crit.replace("{key}", S.str), "the Critical Damage banner localizes STR");
  is(out.spellbookBare, `${S.spellbook}Magic Missile`, "a bare spellbook name gets the localized prefix");
  is(out.spellbookPrefixed, "Spellbook — Hempen Hoop", "a name already carrying the STORED English prefix is left alone");
  // The guard knew four STORED English forms but only the em-dash LOCALIZED one,
  // so a translated name in the parenthesised shape — the shape every shipped
  // spellbook grant uses — was not recognised and got a second prefix bolted on.
  is(out.spellbookParen, "ZZ-hechizo (Aro de Cáñamo)",
    "a name carrying the LOCALIZED prefix in its parenthesised form is left alone too");
  is(out.spellscrollParen, "ZZ-pergamino (Adherir)", "and the same for a scroll");
  is(out.limitTitle, S.limit, "the equipment-limit tooltip comes from i18n");
  // Edition names were literals on the argument that they are proper names — but
  // CAIRN.ContentSource2e already existed for the source picker and is already in
  // es.json, so a language that adapted it got a picker and a sheet naming the same
  // edition two different ways. Whether to adapt it is the translator's one call.
  out.sheetEdition?.includes(S.edition)
    ? ok(`the character sheet's source line localizes the edition (${JSON.stringify(out.sheetEdition)})`)
    : fail(`character sheet source line is ${JSON.stringify(out.sheetEdition)}, expected to contain ${JSON.stringify(S.edition)}`);
  is(out.bgEdition, S.edition, "and the background sheet names it the SAME way, from the same key");
  const doubled = (out.storedSpellbookNames ?? []).filter((n) => (n.match(/Spellbook —/g) ?? []).length > 1);
  doubled.length === 0
    ? ok(`no STORED spellbook name carries a doubled prefix (${JSON.stringify(out.storedSpellbookNames)})`)
    : fail(`stored spellbook name(s) doubled: ${JSON.stringify(doubled)}`);
  is(out.deleteContent, S.del.replace("{name}", "ZZ Probe Torch"), "the delete confirmation is one translatable sentence");
  out.archetypeOptions?.includes(S.wizard)
    ? ok(`the archetype dropdown localizes its labels (${JSON.stringify(out.archetypeOptions)})`)
    : fail(`archetype options were ${JSON.stringify(out.archetypeOptions)}, expected one to be ${JSON.stringify(S.wizard)}`);
  const usesChip = out.chips?.find((c) => /ZZ-\d+ usos/.test(c));
  usesChip
    ? ok(`shop uses-chips read as a unit, not as a field label (${JSON.stringify(usesChip)})`)
    : fail(`no shop chip matched the CAIRN.NUses sentinel; saw ${JSON.stringify(out.chips)}`);
  is(out.usesOne, "ZZ-1 uso", "a single-use item takes the SINGULAR form (55 shipped items read \"1 uses\")");
  is(out.usesMany, "ZZ-3 usos", "and more than one still takes the plural");
  is(out.slotOne, "ZZ-1 espacio", "the same for slots, whose plural key the gold rows share");
  is(out.goldRowTag, "ZZ-1 base-slot",
    "the gold row's TAG rides formatCount — a base-key-only language gets the base form, never the literal key text");
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  await page.evaluate(async (c) => {
    try { await game.actors.get(c?.actorId)?.delete(); } catch { /* gone */ }
    try { await game.items.get(c?.bgItemId)?.delete(); } catch { /* gone */ }
  }, out.cleanup ?? {});
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nI18N RENDER PROBE FAILED\n" : "\ni18n render probe passed\n");
process.exit(failed ? 1 : 0);
