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
 *
 * Since 2026-08-22 "reachable" means something more specific: every
 * Warden-facing setting is registered `config: false` and lives behind one of
 * `registerMenu` submenus (module/settings-menus.js; four since the GLOG &
 * Other Hacks ruling), so the flat list shows one button per group and no
 * air-bladder rows. A setting that is registered, in SETTING_KEYS and in no
 * group is registered, migrated — and unreachable. The declaration is
 * SETTING_GROUPS; this probe checks membership against it, then opens every
 * app and reads what it actually renders.
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
    // Since the submenus (2026-08-22) EVERY air-bladder setting is config:false —
    // the grouped ones because their rows live in the apps, the internal ones
    // because nothing shows them. So these two must both be zero: a key that
    // reads config:true has escaped back onto the flat list.
    out.flatVisible = mod.SETTING_KEYS.filter(
      (k) => game.settings.settings.get(`${mod.SETTINGS_NS}.${k}`)?.config
    );
    // The REVERSE walk (review #9): every registered air-bladder key must be
    // in SETTING_KEYS or be one of the named migration markers. The forward
    // walk alone let `disabled-backgrounds` — Warden configuration, which
    // must ride the namespace migration — register unlisted and stay
    // invisible to this probe, because a config:false key is absent from
    // both sides of the visible-count compare. Markers are exempt on
    // purpose: losing one only re-runs an idempotent migration.
    // `grimoire-keys-stamped` joined 2026-08-17 — it registered 2026-08-16
    // (issue #17's page-key stamp) and this list did not follow, so the reverse
    // walk had been reporting a deliberately-unlisted marker as a misfiled
    // setting: a RED probe with nothing wrong behind it. A marker added without
    // its line here fails exactly like the defect this leg exists to catch.
    // `hireling-split` joined 2026-08-20 (the NPC/Hireling split). Note the
    // exemption's stated reason — "losing one only re-runs an idempotent
    // migration" — is NOT true of that one: re-running it would convert every
    // real NPC in the world into a hireling. It is exempt because it postdates
    // the namespace move and so has no old value to carry, which is the reason
    // that actually applies to all six.
    // `art-migration-generation` joined 2026-08-21 (review #17's generation
    // gate on the art sweep — a Number, not a boolean, so a new rule in the
    // art tables can invalidate old stamps by bumping the constant).
    const MARKERS = ["roles-restamped", "companion-restamped", "connections-migrated",
      "grimoire-keys-stamped", "hireling-split", "art-migration-generation"];
    out.unlisted = [...game.settings.settings.keys()]
      .filter((k) => k.startsWith(`${mod.SETTINGS_NS}.`))
      .map((k) => k.slice(mod.SETTINGS_NS.length + 1))
      .filter((k) => !mod.SETTING_KEYS.includes(k) && !MARKERS.includes(k));

    // MEMBERSHIP against SETTING_GROUPS (2026-08-22). Until the submenus this
    // was an ORDER gate (review #16): the grouping was positional headers in
    // the flat list, so a moved register() call re-filed a setting silently.
    // Order is not load-bearing any more — each app renders its group's keys
    // in the declared order, wherever they were registered — so what can go
    // wrong now is membership: a Warden-facing key in no group (registered,
    // migrated, unreachable), a group naming a key that is not registered, a
    // key in two groups, or an INTERNAL key that a group exposes.
    out.menus = [...game.settings.menus.keys()].filter((k) => k.startsWith(`${mod.SETTINGS_NS}.`));
    out.groups = mod.SETTING_GROUPS.map((g) => ({ id: g.id, title: g.title, keys: g.keys }));
    out.expectedMenus = mod.SETTING_GROUPS.map((g) => `${mod.SETTINGS_NS}.${g.id}`);
    out.grouped = mod.SETTING_GROUPS.flatMap((g) => g.keys);
    out.duplicates = out.grouped.filter((k, i) => out.grouped.indexOf(k) !== i);
    out.groupPhantoms = out.grouped.filter((k) => !game.settings.settings.has(`${mod.SETTINGS_NS}.${k}`));
    out.internal = mod.INTERNAL_SETTING_KEYS;
    out.ungrouped = mod.SETTING_KEYS.filter(
      (k) => !out.grouped.includes(k) && !mod.INTERNAL_SETTING_KEYS.includes(k)
    );
    out.internalGrouped = mod.INTERNAL_SETTING_KEYS.filter((k) => out.grouped.includes(k));

    out.systemId = game.system.id;
    out.knownPackage = !!(game.system.id === "air-bladder");

    // what a value reads as now (bonds left this sample 2026-08-09 with the
    // retired show-bonds-barebones — an unregistered get THROWS)
    out.sample = {
      panic: game.settings.get("air-bladder", "use-panic"),
      goldThreshold: game.settings.get("air-bladder", "use-gold-threshold"),
      failedCareer: game.settings.get("air-bladder", "barebones-failed-career"),
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
  !r.missing.length
    ? ok(`all ${r.declared} declared settings are registered under "air-bladder" — Foundry can map them`)
    : fail(`declared settings missing from the registry: ${r.missing.join(", ")}`);
  mine === 0 && !r.flatVisible.length
    ? ok("no air-bladder setting is config-visible on the flat list — every one lives behind a submenu")
    : fail(`${mine} air-bladder setting(s) still render as loose rows on the flat list: ${r.flatVisible.join(", ")}`);
  stale === 0 ? ok(`nothing left under the unmappable "cairn" namespace`)
              : fail(`${stale} setting(s) still under "cairn" — they render as Unmapped`);
  !r.unlisted.length
    ? ok("every registered key is in SETTING_KEYS (markers exempt) — the migration carries it")
    : fail(`registered but NOT in SETTING_KEYS (namespace migration would drop them): ${r.unlisted.join(", ")}`);

  /* ---- membership: SETTING_GROUPS is the declaration, the apps render it -- */
  JSON.stringify(r.menus) === JSON.stringify(r.expectedMenus)
    ? ok(`the ${r.groups.length} submenus are registered, in group order (${r.groups.map((g) => g.id).join(", ")})`)
    : fail(`registered menus ${JSON.stringify(r.menus)}, expected ${JSON.stringify(r.expectedMenus)}`);
  !r.groupPhantoms.length
    ? ok(`all ${r.grouped.length} grouped keys are registered settings`)
    : fail(`SETTING_GROUPS names key(s) that are not registered: ${r.groupPhantoms.join(", ")}`);
  !r.duplicates.length
    ? ok("no key sits in two groups")
    : fail(`key(s) declared in more than one group: ${[...new Set(r.duplicates)].join(", ")}`);
  !r.ungrouped.length
    ? ok(`every Warden-facing setting belongs to a group (${r.internal.length} internal keys exempt: ${r.internal.join(", ")})`)
    : fail("Warden-facing setting(s) in no group — registered, migrated, and unreachable from any settings UI: "
        + r.ungrouped.join(", "));
  !r.internalGrouped.length
    ? ok("no internal key is exposed by a group")
    : fail(`INTERNAL_SETTING_KEYS exposed in a submenu: ${r.internalGrouped.join(", ")}`);

  console.log(`  values now: ${JSON.stringify(r.sample)}`);
  console.log(`  stored (old cairn.*): ${r.storedOld.length} | stored (air-bladder.*): ${r.storedNew.length}`);

  // A player account in the dev world, so permission-dependent behaviour can be
  // exercised as a non-GM rather than assumed.
  const hasPlayer = r.users.some((u) => u.endsWith("(role 1)"));
  hasPlayer ? ok(`a player account exists: ${r.users.filter((u) => u.endsWith("(role 1)")).join(", ")}`)
            : fail("no player-role account in this world");

  /* ---- the main settings window: a button per group, searchable by contents */
  // Core's settings search matches a row's label and hint plus any
  // [data-searchable] text inside it (category-browser.mjs:228-232). A submenu
  // button knows only its own name, so cairn.js stamps each button row with a
  // hidden span of the labels and hints of the settings inside — a Warden
  // typing a setting's name still finds the button that holds it.
  const ui = await page.evaluate(async () => {
    const out = {};
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const mod = await import("/systems/air-bladder/module/settings.js");
    const NS = mod.SETTINGS_NS;
    const app = new foundry.applications.settings.SettingsConfig();
    await app.render(true);
    await sleep(800);
    const root = app.element;
    const buttons = [...root.querySelectorAll(`button[data-action="openSubmenu"][data-key^="${NS}."]`)];
    out.buttonKeys = buttons.map((b) => b.dataset.key);
    out.looseRows = [...root.querySelectorAll(`[name^="${NS}."]`)].map((i) => i.name);
    out.indexed = buttons.map((b) => !!b.closest(".form-group")?.querySelector("[data-searchable]"));
    const search = root.querySelector("input[type=search]");
    out.hasSearch = !!search;
    if (!search || !buttons.length) { await app.close(); return out; }

    const rowOf = (id) => root.querySelector(`button[data-key="${id}"]`)?.closest(".form-group");
    const hiddenMap = () => Object.fromEntries(out.buttonKeys.map((k) => [k.slice(NS.length + 1), !!rowOf(k)?.hidden]));
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

    // 1. A query matching nothing hides every button.
    q("zzqx-no-such-setting");
    await settled(() => out.buttonKeys.every((k) => rowOf(k)?.hidden));
    out.noMatch = hiddenMap();

    // 2. A setting's own LABEL — read from its registration, so a relabel
    //    cannot silently break the leg — surfaces only the button holding it.
    const goldLabel = game.i18n.localize(game.settings.settings.get(`${NS}.use-gold-threshold`).name);
    q(goldLabel);
    await settled(() => rowOf(`${NS}.inventory`) && !rowOf(`${NS}.inventory`).hidden && rowOf(`${NS}.general`)?.hidden);
    out.oneGroup = { label: goldLabel, hidden: hiddenMap() };

    // 3. Clearing the query brings everything back.
    q("");
    await settled(() => out.buttonKeys.every((k) => !rowOf(k)?.hidden));
    out.cleared = hiddenMap();

    // CONTROL, in-page and DOM-only: strip the searchable index and the same
    // label query hides every button — which is what the leg above would read
    // on a build without the hook, so it is demonstrably load-bearing. The
    // buttons are all VISIBLE going in (the clear above), so the hide is a
    // real transition to wait on — a query whose end state is already true
    // would let the close race core's debounced filter, which then dereferences
    // the closed app's null element.
    root.querySelectorAll("[data-searchable]").forEach((el) => el.remove());
    q(goldLabel);
    await settled(() => out.buttonKeys.every((k) => rowOf(k)?.hidden));
    out.control = hiddenMap();
    q("");
    await settled(() => out.buttonKeys.every((k) => !rowOf(k)?.hidden));

    await app.close();
    return out;
  });

  const ids = (r.groups ?? []).map((g) => g.id);
  JSON.stringify(ui.buttonKeys) === JSON.stringify(r.expectedMenus) && ui.hasSearch
    ? ok(`settings window renders the ${r.expectedMenus.length} submenu buttons in group order + a search box`)
    : fail(`expected buttons ${JSON.stringify(r.expectedMenus)} + search, got ${JSON.stringify(ui.buttonKeys)} (search: ${ui.hasSearch})`);
  ui.looseRows?.length === 0
    ? ok("...and no loose air-bladder row beside them")
    : fail(`loose air-bladder rows on the main window: ${ui.looseRows?.join(", ")}`);
  ui.indexed?.every(Boolean)
    ? ok("each button row carries a [data-searchable] index of its settings")
    : fail(`button rows without a searchable index: ${JSON.stringify(ui.indexed)}`);
  ui.noMatch && Object.values(ui.noMatch).every(Boolean)
    ? ok("no-match query hides every button")
    : fail(`buttons survive a no-match search: ${JSON.stringify(ui.noMatch)}`);
  ui.oneGroup && ui.oneGroup.hidden.inventory === false && ids.filter((id) => id !== "inventory").every((id) => ui.oneGroup.hidden[id] === true)
    ? ok(`a setting's own label surfaces only the button holding it — "${ui.oneGroup.label}" → Inventory`)
    : fail(`expected only inventory visible for "${ui.oneGroup?.label}", got ${JSON.stringify(ui.oneGroup?.hidden)}`);
  ui.cleared && Object.values(ui.cleared).every((h) => h === false)
    ? ok("clearing the search restores the buttons")
    : fail(`buttons still hidden after clearing: ${JSON.stringify(ui.cleared)}`);
  ui.control && Object.values(ui.control).every(Boolean)
    ? ok("control: without the searchable index the same label query hides every button")
    : fail(`control failed — the leg is not load-bearing: ${JSON.stringify(ui.control)}`);

  /* ---- every app: rows in declared order, hints per registration, nothing lost */
  const apps = await page.evaluate(async () => {
    const out = { groups: [] };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const mod = await import("/systems/air-bladder/module/settings.js");
    const NS = mod.SETTINGS_NS;
    for (const g of mod.SETTING_GROUPS) {
      const menu = game.settings.menus.get(`${NS}.${g.id}`);
      const rec = { id: g.id, registered: !!menu, keys: g.keys };
      if (!menu) { out.groups.push(rec); continue; }
      const app = new menu.type();
      await app.render(true);
      await sleep(600);
      const root = app.element;
      rec.title = app.title;
      rec.rendered = [...root.querySelectorAll(`[name^="${NS}."]`)].map((i) => i.name.slice(NS.length + 1));
      // Hint per REGISTRATION: a row whose setting registers a hint shows it
      // beneath (computed display off the hint element itself, so a hidden
      // ancestor cannot fake the state — the compact-row lesson); a row whose
      // setting registers none shows none. `hint` is optional, and ten that
      // merely restated their label were dropped 2026-08-22 (user ruling).
      rec.hints = g.keys.map((k) => {
        const hint = root.querySelector(`[name="${NS}.${k}"]`)?.closest(".form-group")?.querySelector(".hint");
        const shown = !!hint && getComputedStyle(hint).display !== "none" && !!hint.textContent.trim();
        const expected = !!game.settings.settings.get(`${NS}.${k}`)?.hint;
        return { key: k, shown, expected };
      });
      rec.tooltipText = root.querySelectorAll("[data-tooltip-text]").length;
      rec.hasSave = !!root.querySelector('button[type="submit"]');
      // A rule beneath every row but the last (user ask, 2026-08-22): with
      // hints under some rows and not others the group read as one run of
      // text. Computed border width off each row, so a dropped CSS rule —
      // or a token the app element cannot resolve — reads as 0.
      rec.rules = [...root.querySelectorAll(".ab-settings-rows > .form-group")]
        .map((fg) => parseFloat(getComputedStyle(fg).borderBottomWidth) > 0);
      await app.close();
      out.groups.push(rec);
    }
    return out;
  });

  for (const g of apps.groups) {
    if (!g.registered) { fail(`submenu "${g.id}" is not registered — its ${g.keys.length} settings are unreachable`); continue; }
    const same = JSON.stringify(g.rendered) === JSON.stringify(g.keys);
    same ? ok(`"${g.title}" renders exactly its ${g.keys.length} settings, in declared order`)
         : fail(`"${g.title}" rows:\n        expected ${g.keys.join(", ")}\n        got      ${g.rendered.join(", ")}`);
    const wrongHints = g.hints.filter((h) => h.shown !== h.expected);
    const withHint = g.hints.filter((h) => h.expected).length;
    !wrongHints.length
      ? ok(`...each "${g.title}" row shows its hint beneath exactly when one is registered (${withHint} of ${g.hints.length})`)
      : fail(`"${g.title}" hint mismatch: ${wrongHints.map((h) => `${h.key} (shown ${h.shown}, registered ${h.expected})`).join(", ")}`);
    g.tooltipText === 0 && g.hasSave
      ? ok(`...no data-tooltip-text carriers, and a Save button`)
      : fail(`"${g.title}": ${g.tooltipText} data-tooltip-text carrier(s), save button ${g.hasSave}`);
    const ruled = g.rules.slice(0, -1).every(Boolean) && g.rules.at(-1) === false;
    ruled && g.rules.length === g.keys.length
      ? ok(`...a rule beneath every row but the last (${g.rules.length - 1} of ${g.rules.length})`)
      : fail(`"${g.title}" row rules: ${JSON.stringify(g.rules)} (expected all true but the last)`);
  }

  /* ---- saving through the REAL form: set, close, reopen shows it, restore - */
  // `show-grant-tags-print` is the one row whose save has no other effect: no
  // onChange, no requiresReload (a reload prompt would block the probe). The
  // restore goes through the same form, and is asserted — a world setting
  // left flipped would change what the NEXT probe's characters print.
  const save = await page.evaluate(async () => {
    const out = {};
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const mod = await import("/systems/air-bladder/module/settings.js");
    const NS = mod.SETTINGS_NS;
    const KEY = "show-grant-tags-print";
    const before = game.settings.get(NS, KEY);
    out.before = before;
    const menu = game.settings.menus.get(`${NS}.general`);
    const open = async () => {
      const app = new menu.type();
      await app.render(true);
      await sleep(600);
      return app;
    };
    try {
      const app = await open();
      const box = app.element.querySelector(`[name="${NS}.${KEY}"]`);
      out.boxShowsBefore = box?.checked;
      box.checked = !before;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      app.element.requestSubmit();           // the app IS the <form> (tag: "form")
      await sleep(1200);
      out.after = game.settings.get(NS, KEY);
      out.closedOnSubmit = !app.rendered;
      const app2 = await open();
      const box2 = app2.element.querySelector(`[name="${NS}.${KEY}"]`);
      out.reopenedShows = box2?.checked;
      box2.checked = before;
      box2.dispatchEvent(new Event("change", { bubbles: true }));
      app2.element.requestSubmit();
      await sleep(1200);
      out.restored = game.settings.get(NS, KEY);
    } finally {
      if (game.settings.get(NS, KEY) !== before) await game.settings.set(NS, KEY, before);
      out.finalValue = game.settings.get(NS, KEY);
    }
    return out;
  });

  save.boxShowsBefore === save.before
    ? ok(`the General submenu shows the stored value (show-grant-tags-print = ${save.before})`)
    : fail(`the row shows ${save.boxShowsBefore}, the setting reads ${save.before}`);
  save.after === !save.before && save.closedOnSubmit
    ? ok("Save through the real form writes the setting and closes the app")
    : fail(`after save: setting ${save.after} (expected ${!save.before}), closed ${save.closedOnSubmit}`);
  save.reopenedShows === !save.before
    ? ok("reopening shows the saved value")
    : fail(`reopened row shows ${save.reopenedShows}, expected ${!save.before}`);
  save.restored === save.before && save.finalValue === save.before
    ? ok("restored through the same form, and asserted")
    : fail(`restore failed: via form ${save.restored}, final ${save.finalValue}, expected ${save.before}`);

  /* ---- the Barebones sub-option greys from its master's STORED value ----- */
  // The failed-career row lives in GLOG & Other Hacks while its master
  // checkbox ("Offer Barebones sheets") is Character Generation's, so the
  // Hacks app decides from the stored value at render. Both states are
  // exercised by SHADOWING the read in-page — never a world write — with the
  // wrapper lifted in a finally and asserted lifted.
  const subs = await page.evaluate(async () => {
    const out = {};
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const mod = await import("/systems/air-bladder/module/settings.js");
    const NS = mod.SETTINGS_NS;
    const MASTER = "content-source-barebones";
    const stored = game.settings.get(NS, MASTER);
    const menu = game.settings.menus.get(`${NS}.hacks`);
    const origGet = game.settings.get;
    const renderWith = async (forced) => {
      game.settings.get = function (ns, key, ...rest) {
        if (ns === NS && key === MASTER) return forced;
        return origGet.call(this, ns, key, ...rest);
      };
      try {
        const app = new menu.type();
        await app.render(true);
        await sleep(600);
        const sub = app.element.querySelector(`[name="${NS}.barebones-failed-career"]`);
        const state = {
          masterInApp: !!app.element.querySelector(`[name="${NS}.${MASTER}"]`),
          subPresent: !!sub,
          disabled: !!sub?.disabled,
          greyed: !!sub?.closest(".form-group")?.classList.contains("cairn-setting-disabled"),
          // The hint must NAME the master it follows, by the master's own
          // label (user ask, 2026-08-22): the row greys out with no word of
          // why, and the checkbox that un-greys it is in another app.
          hint: sub?.closest(".form-group")?.querySelector(".hint")?.textContent ?? "",
          masterLabel: game.i18n.localize(game.settings.settings.get(`${NS}.${MASTER}`).name),
        };
        await app.close();                // nothing submitted
        return state;
      } finally {
        game.settings.get = origGet;
      }
    };
    out.on = await renderWith(true);
    out.off = await renderWith(false);
    out.shadowLifted = game.settings.get === origGet;
    out.untouched = game.settings.get(NS, MASTER) === stored;
    return out;
  });

  subs.on?.subPresent && !subs.on.masterInApp
    ? ok("the Barebones failed-career row lives in GLOG & Other Hacks, its master checkbox elsewhere")
    : fail(`failed-career row present=${subs.on?.subPresent}, master in the Hacks app=${subs.on?.masterInApp}`);
  subs.on && !subs.on.disabled && !subs.on.greyed
    ? ok("with Barebones sheets offered (stored value, read-shadowed) the row is live")
    : fail(`master on: disabled=${subs.on?.disabled}, greyed=${subs.on?.greyed}`);
  subs.off?.disabled && subs.off?.greyed
    ? ok("with Barebones sheets NOT offered the row is disabled and greyed")
    : fail(`master off: disabled=${subs.off?.disabled}, greyed=${subs.off?.greyed}`);
  subs.shadowLifted && subs.untouched
    ? ok("...the read shadow is lifted and nothing was written")
    : fail(`shadow lifted=${subs.shadowLifted}, setting untouched=${subs.untouched}`);
  subs.on?.masterLabel && subs.on.hint.includes(subs.on.masterLabel)
    ? ok(`the failed-career hint names its master by label — "${subs.on.masterLabel}"`)
    : fail(`the failed-career hint does not name "${subs.on?.masterLabel}": "${subs.on?.hint}"`);

  /* ---- boldPhrase bolds the LOCALIZED product name ------------------------ */
  // The phrase used to be an English literal, so any language whose label
  // translates or reorders the product name silently lost the bold (review #6:
  // Spanish "Ofrecer trasfondos personalizados de 2e" ≠ "Custom 2e"). Plant a
  // sentinel label + sentinel phrase translation — an English world cannot see
  // this defect otherwise (foundry-localization-internals) — and expect the
  // <strong> to land on the sentinel phrase. All page-local, restored in-page;
  // a fresh probe launches a fresh browser either way. The rows live in the
  // Character Generation submenu since 2026-08-22, so that is what renders.
  const bold = await page.evaluate(async () => {
    const out = {};
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const cfg = game.settings.settings.get("air-bladder.content-source-custom");
    const origName = cfg.name;
    const origPhrase = foundry.utils.getProperty(game.i18n.translations, "CAIRN.ContentSourceCustom");
    try {
      cfg.name = "Sentinel offering ZZQX custom sheets";
      foundry.utils.setProperty(game.i18n.translations, "CAIRN.ContentSourceCustom", "ZZQX custom");
      const app = new (game.settings.menus.get("air-bladder.generation").type)();
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

  /* ---- the SHIPPED label against the SHIPPED phrase ---------------------- */

  // The leg above plants BOTH halves — a sentinel label and a sentinel phrase
  // built to match each other — so it proves boldPhrase works and is
  // structurally blind to the only thing that can actually go wrong: the real
  // label and the real phrase disagreeing. They did. `CAIRN.ContentSourceCustom`
  // was "Custom 2e" while its label read "Offer custom Cairn 2e backgrounds",
  // so `indexOf` missed, boldPhrase took its `i < 0` exit, and that setting
  // rendered with no emphasis at all for months. Nothing failed; the degradation
  // is silent by design.
  //
  // This is the same lesson the omen round paid for: a probe that plants a
  // consistent state tests the renderer, not the product. So: no stubs, no
  // sentinels — open the real submenu and read the real labels.
  const real = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const app = new (game.settings.menus.get("air-bladder.generation").type)();
    await app.render(true);
    await sleep(800);
    const read = (key, phraseKey) => {
      const label = app.element.querySelector(`[name="air-bladder.${key}"]`)
        ?.closest(".form-group")?.querySelector("label");
      return {
        key,
        phrase: game.i18n.localize(phraseKey),
        text: label?.textContent?.trim() ?? null,
        bolded: label?.querySelector("strong")?.textContent ?? null,
      };
    };
    const out = [
      read("content-source-2e", "CAIRN.ContentSourceCanon2e"),
      read("content-source-custom", "CAIRN.ContentSourceCustom"),
      read("content-source-barebones", "CAIRN.ContentSourceBarebones"),
    ];
    await app.close();
    return out;
  });

  for (const r of real) {
    // This probe's ok() takes ONE argument — a second is silently dropped, and a
    // passing leg that prints nothing is how "it matched" and "it matched the
    // wrong thing" look identical in a log. The strings go in the label.
    r.bolded === r.phrase && r.phrase && r.text?.includes(r.phrase)
      ? ok(`${r.key} bolds its real phrase — "${r.bolded}" inside "${r.text}"`)
      : fail(`${r.key}: shipped label and shipped phrase disagree — `
          + `phrase ${JSON.stringify(r.phrase)}, bolded ${JSON.stringify(r.bolded)}, label ${JSON.stringify(r.text)}`);
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nSETTINGS PROBE FAILED\n" : "\nsettings probe passed\n");
process.exit(failed ? 1 : 0);
