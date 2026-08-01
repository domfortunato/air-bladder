#!/usr/bin/env node
/**
 * Listener-count probe: re-rendering a sheet must not accumulate listeners.
 *
 * This is the gate review #2 said was missing ("no probe counts event
 * listeners"). The bug class is real and shipped here once: the click-away
 * editor save was bound to `this.element` inside `_onRender`, and AppV2 keeps
 * the frame element across re-renders, so every committed keystroke added one
 * more copy of the handler (fixed in d46b9c3 by moving it to `_onFirstRender`).
 * Nothing has counted since — a rebind leak renders correctly, logs nothing,
 * and only shows as work growing per edit.
 *
 * How it counts: `EventTarget.prototype.addEventListener`/`removeEventListener`
 * are wrapped IN-PAGE before the sheets open, keeping a registry of adds minus
 * removes. The number that must stay flat across re-renders is the LIVE count —
 * entries whose target is window/document/body or a still-connected element
 * inside the sheet frame. Listeners on re-render-replaced content nodes fall
 * out of that count on their own (the node disconnects), which is correct:
 * per-render listeners on fresh content are the normal pattern, and only
 * listeners piling up on SURVIVING targets are a leak.
 *
 * The negative control shadows `_onRender` on the sheet INSTANCE to add one
 * anonymous frame listener per render — the d46b9c3 bug shape exactly — and
 * the count must grow by exactly the number of renders. If it does not, the
 * counter cannot see the bug it exists to catch, and green means nothing.
 *
 * Usage: npm run dev:listeners
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const stage = (name) => console.log(`  stage ${name}`);

const browser = await chromium.launch();
watchdog(240000, "listener probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const sweepLitter = async () => {
  await page.evaluate(async () => {
    for (const a of game.actors.filter((x) => x.name?.startsWith("ZZ Listener"))) await a.delete();
    for (const i of game.items.filter((x) => x.name?.startsWith("ZZ Listener"))) await i.delete();
  });
};

try {
  await sweepLitter();

  stage("instrument addEventListener/removeEventListener");
  await page.evaluate(() => {
    const REG = (globalThis.__abListeners = []);
    const origAdd = EventTarget.prototype.addEventListener;
    const origRemove = EventTarget.prototype.removeEventListener;
    globalThis.__abListenersOrig = { origAdd, origRemove };
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      REG.push({ t: this, type, fn });
      return origAdd.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
      const i = REG.findIndex((e) => e.t === this && e.type === type && e.fn === fn);
      if (i >= 0) REG.splice(i, 1);
      return origRemove.call(this, type, fn, opts);
    };
    globalThis.__abLiveCount = (frame) =>
      globalThis.__abListeners.filter((e) => {
        const t = e.t;
        if (t === window || t === document || t === document.body) return true;
        return t instanceof Element && t.isConnected && (t === frame || frame.contains(t));
      }).length;
  });

  const settle = () => page.waitForTimeout(300);

  stage("actor sheet: live count flat across re-renders");
  const actor = await page.evaluate(async () => {
    const a = await CONFIG.Actor.documentClass.create({ name: "ZZ Listener Char", type: "character" });
    await a.sheet.render(true);
    return a.id;
  });
  await page.waitForSelector(".cairn.sheet.actor", { timeout: 15000 });
  await settle();
  // Warm up past first-render work (frame listeners, lazy chrome), then measure.
  await page.evaluate(async (id) => { await game.actors.get(id).sheet.render(false); }, actor);
  await settle();
  const a1 = await page.evaluate((id) => globalThis.__abLiveCount(game.actors.get(id).sheet.element), actor);
  await page.evaluate(async (id) => {
    const s = game.actors.get(id).sheet;
    await s.render(false); await s.render(false); await s.render(false);
  }, actor);
  await settle();
  const a2 = await page.evaluate((id) => globalThis.__abLiveCount(game.actors.get(id).sheet.element), actor);

  stage("negative control: a per-render frame bind must be visible");
  const control = await page.evaluate(async (id) => {
    const s = game.actors.get(id).sheet;
    const before = globalThis.__abLiveCount(s.element);
    // Instance-property shadow — the d46b9c3 bug shape, one anonymous frame
    // listener per render. `delete` restores the prototype's method.
    s._onRender = async function (...args) {
      await Object.getPrototypeOf(this)._onRender.apply(this, args);
      this.element.addEventListener("mousedown", () => {});
    };
    try {
      await s.render(false);
      await s.render(false);
    } finally {
      delete s._onRender;
    }
    return { before, after: globalThis.__abLiveCount(s.element) };
  }, actor);

  stage("item sheet (background authoring — the listener-densest): flat across re-renders");
  const item = await page.evaluate(async () => {
    const i = await getDocumentClass("Item").create({ name: "ZZ Listener Bg", type: "background" });
    await i.sheet.render(true);
    return i.id;
  });
  await page.waitForSelector(".cairn.sheet.item", { timeout: 15000 });
  await settle();
  await page.evaluate(async (id) => { await game.items.get(id).sheet.render(false); }, item);
  await settle();
  const i1 = await page.evaluate((id) => globalThis.__abLiveCount(game.items.get(id).sheet.element), item);
  await page.evaluate(async (id) => {
    const s = game.items.get(id).sheet;
    await s.render(false); await s.render(false); await s.render(false);
  }, item);
  await settle();
  const i2 = await page.evaluate((id) => globalThis.__abLiveCount(game.items.get(id).sheet.element), item);

  console.log("\nlistener counts");
  const checks = [
    ["actor sheet live listeners flat across 3 re-renders", a2 === a1, `${a1} -> ${a2}`],
    ["negative control: 2 leaky renders grow the count by exactly 2",
      control.after - control.before === 2, `${control.before} -> ${control.after}`],
    ["item sheet live listeners flat across 3 re-renders", i2 === i1, `${i1} -> ${i2}`],
  ];
  for (const [label, pass, detail] of checks) {
    if (pass) ok(`${label} — ${detail}`);
    else fail(`${label} — ${detail}`);
  }

  if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }
} finally {
  await page.evaluate(() => {
    const o = globalThis.__abListenersOrig;
    if (o) {
      EventTarget.prototype.addEventListener = o.origAdd;
      EventTarget.prototype.removeEventListener = o.origRemove;
      delete globalThis.__abListenersOrig;
      delete globalThis.__abListeners;
    }
  }).catch(() => {});
  await sweepLitter().catch((e) => console.error(`  note  sweep failed: ${e.message}`));
}

console.log(`\n${failed ? "LISTENER PROBE FAILED" : "listener probe passed"}`);
await browser.close();
process.exit(failed ? 1 : 0);
