#!/usr/bin/env node
/**
 * Are the system settings REACHABLE by a Warden?
 *
 * Foundry groups the settings sheet by package id, so a namespace naming no
 * installed package renders every setting under a bucket called "Unmapped" —
 * present in the data, invisible in the UI, and unreachable. This system shipped
 * that way: 16 settings registered under "cairn", inherited from the system it
 * descends from, while the package id is "air-bladder".
 *
 * Nothing else catches it. The settings still register, still read, still take
 * their defaults, and every other probe passes — the only symptom is a GM who
 * cannot configure anything.
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
    const out = {};
    // every registered setting, grouped by namespace
    const ns = {};
    for (const [key, cfg] of game.settings.settings) {
      const [namespace] = key.split(".");
      if (!cfg.config) continue;
      (ns[namespace] ??= []).push(key);
    }
    out.namespaces = Object.fromEntries(Object.entries(ns).map(([k, v]) => [k, v.length]));

    // Expected count comes from the module's own key list, not a magic number —
    // adding a setting should not fail this probe, only a MISFILED one should.
    const mod = await import("/systems/air-bladder/module/settings.js");
    out.declared = mod.SETTING_KEYS.length;
    out.missing = mod.SETTING_KEYS.filter((k) => !game.settings.settings.has(`${mod.SETTINGS_NS}.${k}`));
    // `ns` above counts CONFIG-VISIBLE settings, so compare like with like: a
    // setting registered with `config: false` is deliberately absent from the UI
    // (custom-portrait-list is an internal cache) and must not read as misfiled.
    out.declaredVisible = mod.SETTING_KEYS.filter(
      (k) => game.settings.settings.get(`${mod.SETTINGS_NS}.${k}`)?.config
    ).length;
    out.hidden = mod.SETTING_KEYS.filter(
      (k) => game.settings.settings.has(`${mod.SETTINGS_NS}.${k}`) &&
        !game.settings.settings.get(`${mod.SETTINGS_NS}.${k}`)?.config
    );
    // The REVERSE walk (review #9): every registered air-bladder key must be
    // in SETTING_KEYS or be one of the named migration markers. The forward
    // walk alone let `disabled-backgrounds` — Warden configuration, which
    // must ride the namespace migration — register unlisted and stay
    // invisible to this probe, because a config:false key is absent from
    // both sides of the visible-count compare. Markers are exempt on
    // purpose: losing one only re-runs an idempotent migration.
    const MARKERS = ["roles-restamped", "connections-migrated"];
    out.unlisted = [...game.settings.settings.keys()]
      .filter((k) => k.startsWith(`${mod.SETTINGS_NS}.`))
      .map((k) => k.slice(mod.SETTINGS_NS.length + 1))
      .filter((k) => !mod.SETTING_KEYS.includes(k) && !MARKERS.includes(k));
    out.systemId = game.system.id;
    out.knownPackage = !!(game.system.id === "air-bladder");

    // what a value reads as now
    out.sample = {
      panic: game.settings.get("air-bladder", "use-panic"),
      goldThreshold: game.settings.get("air-bladder", "use-gold-threshold"),
      bonds: game.settings.get("air-bladder", "show-bonds-barebones"),
    };

    // stored world documents, old namespace vs new
    const store = game.settings.storage.get("world");
    out.storedOld = store.filter((s) => s.key.startsWith("cairn.")).map((s) => s.key);
    out.storedNew = store.filter((s) => s.key.startsWith("air-bladder.")).map((s) => s.key);

    out.users = game.users.map((u) => `${u.name} (role ${u.role})`);
    return out;
  });

  console.log(`  system id: ${r.systemId}`);
  console.log(`  config-visible settings by namespace: ${JSON.stringify(r.namespaces)}`);

  const mine = r.namespaces["air-bladder"] ?? 0;
  const stale = r.namespaces["cairn"] ?? 0;
  mine === r.declaredVisible && !r.missing.length
    ? ok(`all ${r.declared} declared settings registered under "air-bladder" — Foundry can map them`
        + (r.hidden.length ? ` (${r.hidden.length} hidden by design: ${r.hidden.join(", ")})` : ""))
    : fail(`${mine} config-visible vs ${r.declaredVisible} expected${r.missing.length ? `; missing: ${r.missing.join(", ")}` : ""}`);
  stale === 0 ? ok(`nothing left under the unmappable "cairn" namespace`)
              : fail(`${stale} setting(s) still under "cairn" — they render as Unmapped`);
  !r.unlisted.length
    ? ok("every registered key is in SETTING_KEYS (markers exempt) — the migration carries it")
    : fail(`registered but NOT in SETTING_KEYS (namespace migration would drop them): ${r.unlisted.join(", ")}`);

  console.log(`  values now: ${JSON.stringify(r.sample)}`);
  console.log(`  stored (old cairn.*): ${r.storedOld.length} | stored (air-bladder.*): ${r.storedNew.length}`);

  // A player account in the dev world, so permission-dependent behaviour can be
  // exercised as a non-GM rather than assumed.
  const hasPlayer = r.users.some((u) => u.endsWith("(role 1)"));
  hasPlayer ? ok(`a player account exists: ${r.users.filter((u) => u.endsWith("(role 1)")).join(", ")}`)
            : fail("no player-role account in this world");

  /* ---- rendered UI: the injected group headers follow core's search ------- */
  // Core's settings search (CategoryBrowser._onSearchFilter) toggles `hidden`
  // on .form-group elements ONLY, so the system's injected <h3> headers used to
  // hover over whatever rows other packages' settings left visible (review #6).
  // cairn.js now mirrors the filter onto the headers with a MutationObserver.
  const ui = await page.evaluate(async () => {
    const out = {};
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const app = new foundry.applications.settings.SettingsConfig();
    await app.render(true);
    await sleep(800);
    const root = app.element;
    const headers = [...root.querySelectorAll(".cairn-settings-header")];
    out.headerCount = headers.length;
    const search = root.querySelector("input[type=search]");
    out.hasSearch = !!search;
    if (!search || !headers.length) { await app.close(); return out; }

    const rowOf = (key) => root.querySelector(`[name="air-bladder.${key}"]`)?.closest(".form-group");
    const q = (text) => {
      search.value = text;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // SearchFilter debounces, so POLL for the transition; on timeout the
    // assertion still runs on the truth, it just fails on it.
    const settled = async (test) => {
      const deadline = Date.now() + 6000;
      while (!test() && Date.now() < deadline) await sleep(150);
      return test();
    };

    out.initialVisible = headers.map((h) => !h.hidden);

    // 1. A query matching nothing of ours hides every system row — and must
    //    now hide every header with them.
    q("zzqx-no-such-setting");
    await settled(() => ["use-panic", "content-source-2e", "max-equip-slots"].every((k) => rowOf(k)?.hidden));
    out.noMatch = {
      rowsHidden: ["use-panic", "content-source-2e", "max-equip-slots"].map((k) => !!rowOf(k)?.hidden),
      headersHidden: headers.map((h) => h.hidden),
    };

    // 2. A query matching exactly one Inventory row keeps that group's header
    //    and drops the other two. The query is the row's own full label, read
    //    from the DOM, so a relabel cannot silently break the leg.
    const goldLabel = rowOf("use-gold-threshold")?.querySelector("label")?.textContent?.trim() ?? "";
    q(goldLabel);
    await settled(() => rowOf("use-gold-threshold") && !rowOf("use-gold-threshold").hidden && rowOf("use-panic")?.hidden);
    out.oneGroup = { label: goldLabel, headersHidden: headers.map((h) => h.hidden) };

    // 3. Clearing the query brings everything back.
    q("");
    await settled(() => !rowOf("use-panic")?.hidden && headers.every((h) => !h.hidden));
    out.cleared = headers.map((h) => h.hidden);

    await app.close();
    return out;
  });

  ui.headerCount === 3 && ui.hasSearch
    ? ok("settings window renders 3 injected group headers")
    : fail(`expected 3 headers + a search box, got ${ui.headerCount} (search: ${ui.hasSearch})`);
  ui.noMatch?.rowsHidden.every(Boolean)
    ? ok("precondition: core's filter hides the system's rows")
    : fail(`core filter never hid the anchor rows: ${JSON.stringify(ui.noMatch?.rowsHidden)}`);
  ui.noMatch?.headersHidden.every(Boolean)
    ? ok("no-match query hides all three headers")
    : fail(`headers float over a no-match search: ${JSON.stringify(ui.noMatch?.headersHidden)}`);
  JSON.stringify(ui.oneGroup?.headersHidden) === JSON.stringify([true, true, false])
    ? ok("one-group query keeps only that group's header", `"${ui.oneGroup.label}"`)
    : fail(`expected [true,true,false] (only Inventory shown), got ${JSON.stringify(ui.oneGroup?.headersHidden)}`);
  ui.cleared?.every((h) => h === false)
    ? ok("clearing the search restores the headers")
    : fail(`headers still hidden after clearing: ${JSON.stringify(ui.cleared)}`);

  /* ---- boldPhrase bolds the LOCALIZED product name ------------------------ */
  // The phrase used to be an English literal, so any language whose label
  // translates or reorders the product name silently lost the bold (review #6:
  // Spanish "Ofrecer trasfondos personalizados de 2e" ≠ "Custom 2e"). Plant a
  // sentinel label + sentinel phrase translation — an English world cannot see
  // this defect otherwise (foundry-localization-internals) — and expect the
  // <strong> to land on the sentinel phrase. All page-local, restored in-page;
  // a fresh probe launches a fresh browser either way.
  const bold = await page.evaluate(async () => {
    const out = {};
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const cfg = game.settings.settings.get("air-bladder.content-source-custom");
    const origName = cfg.name;
    const origPhrase = foundry.utils.getProperty(game.i18n.translations, "CAIRN.ContentSourceCustom");
    try {
      cfg.name = "Sentinel offering ZZQX custom sheets";
      foundry.utils.setProperty(game.i18n.translations, "CAIRN.ContentSourceCustom", "ZZQX custom");
      const app = new foundry.applications.settings.SettingsConfig();
      await app.render(true);
      await sleep(800);
      const label = app.element.querySelector('[name="air-bladder.content-source-custom"]')
        ?.closest(".form-group")?.querySelector("label");
      out.labelText = label?.textContent ?? null;
      out.bolded = label?.querySelector("strong")?.textContent ?? null;
      await app.close();
    } finally {
      cfg.name = origName;
      if (origPhrase === undefined) delete game.i18n.translations?.CAIRN?.ContentSourceCustom;
      else foundry.utils.setProperty(game.i18n.translations, "CAIRN.ContentSourceCustom", origPhrase);
    }
    return out;
  });

  bold.bolded === "ZZQX custom"
    ? ok("boldPhrase bolds the localized product name", `"${bold.bolded}" inside "${bold.labelText}"`)
    : fail(`sentinel label was not bolded — label "${bold.labelText}", strong ${JSON.stringify(bold.bolded)}`
        + " (an English literal cannot match a translated label)");
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nSETTINGS PROBE FAILED\n" : "\nsettings probe passed\n");
process.exit(failed ? 1 : 0);
