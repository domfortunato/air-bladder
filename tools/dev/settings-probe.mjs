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

  console.log(`  values now: ${JSON.stringify(r.sample)}`);
  console.log(`  stored (old cairn.*): ${r.storedOld.length} | stored (air-bladder.*): ${r.storedNew.length}`);

  // A player account in the dev world, so permission-dependent behaviour can be
  // exercised as a non-GM rather than assumed.
  const hasPlayer = r.users.some((u) => u.endsWith("(role 1)"));
  hasPlayer ? ok(`a player account exists: ${r.users.filter((u) => u.endsWith("(role 1)")).join(", ")}`)
            : fail("no player-role account in this world");
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nSETTINGS PROBE FAILED\n" : "\nsettings probe passed\n");
process.exit(failed ? 1 : 0);
