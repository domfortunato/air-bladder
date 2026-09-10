#!/usr/bin/env node
/**
 * The Warden's Dashboard opens, rolls, and keeps core's table card.
 *
 *   npm run dev:warden-dashboard     (needs Foundry running, world launched)
 *
 * THE ASSERTION THAT BITES is leg 3, and it is the reason this file exists.
 * A dashboard is easy to write as "post my own pretty card", and that version
 * passes every obvious test: a card appears, it names the table, it says what
 * was rolled. What it silently destroys is `module/encounters.js` — the
 * Add-to-scene button reads `flags.core.RollTable` and the message's roll,
 * which ONLY core's `RollTable#toMessage` stamps, and it hangs itself inside
 * `.table-draw`, which only core's card markup has. Nothing errors. Nine
 * encounter and event tables just quietly stop offering to place their
 * monsters, and nobody notices until a session.
 *
 * So: leg 3 asserts the card is core's, leg 4 asserts the button really
 * attaches to it, and leg 6 asserts the ONE card we do build for ourselves is
 * not core's — because if a combined draw ever started carrying
 * `flags.core.RollTable` it would offer to spawn a monster off an NPC's quirk.
 *
 * Leg 5 asserts the speaker POSITIVELY (it IS the table's name). The obvious
 * negative — "the speaker is not the Warden's assigned character" — stayed
 * green with the fix reverted the last time this trap was probed, because
 * `getSpeaker()` had resolved to some other controlled token.
 *
 * Creates chat messages and one actor, and deletes exactly the ids it added.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? `  ${d}` : ""}`); failed = true; };
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? `  ${d}` : ""}`);
const note = (m) => console.log(`  note  ${m}`);

try {
  await joinAsGM(page);
  await dismissChrome(page);

  // Everything this probe creates is deleted at the end by ID DIFFERENCE, so
  // a world with its own messages and actors is never swept.
  const before = await page.evaluate(() => ({
    messages: game.messages.contents.map((m) => m.id),
    actors: game.actors.contents.map((a) => a.id),
    journals: game.journal.contents.map((j) => j.id),
  }));

  /* ---- 1. the control, and the window ---------------------------------- */

  const opened = await page.evaluate(async () => {
    const btn = document.querySelector('button.tool[data-tool="abWardenDashboard"]');
    const out = { control: !!btn };
    if (btn) btn.click();
    for (let i = 0; i < 40 && !document.querySelector("#cairn-warden-dashboard"); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const app = document.querySelector("#cairn-warden-dashboard");
    out.rendered = !!app;
    if (app) {
      out.tabs = [...app.querySelectorAll('.tabs [data-action="tab"]')].map((a) => a.dataset.tab);
      out.buttons = app.querySelectorAll('button[data-action="rollTable"]').length;
      out.sets = app.querySelectorAll('button[data-action="rollSet"]').length;
      out.creates = app.querySelectorAll('button[data-action="generate"]').length;
      out.damage = app.querySelectorAll('button[data-action="wardenDamage"]').length;
      out.isForm = app.tagName === "FORM" || !!app.querySelector("form");
      // Every button must be type=button: the application element IS a form,
      // so a submit button would submit the window instead of rolling.
      out.notButtons = [...app.querySelectorAll("button")].filter((b) => b.type !== "button").length;
    }
    return out;
  });

  opened.control ? ok("the Token controls carry the dashboard tool")
    : fail("the Token controls carry the dashboard tool", "no button.tool[data-tool=abWardenDashboard]");
  opened.rendered ? ok("clicking it opens the window") : fail("clicking it opens the window");
  opened.tabs?.length === 6
    ? ok("six tabs", opened.tabs.join(", "))
    : fail("six tabs", JSON.stringify(opened.tabs));
  // 41 shipped tables plus however many the world has of its own.
  opened.buttons >= 41
    ? ok("every shipped table has a button", `${opened.buttons} table buttons`)
    : fail("every shipped table has a button", `only ${opened.buttons}`);
  opened.sets === 4 ? ok("four combined draws") : fail("four combined draws", String(opened.sets));
  opened.creates === 4 ? ok("four generator buttons") : fail("four generator buttons", String(opened.creates));
  opened.damage === 1 ? ok("the damage tool is on the window too") : fail("the damage tool is on the window too");
  opened.notButtons === 0
    ? ok("every button is type=button, so none submits the form")
    : fail("every button is type=button", `${opened.notButtons} would submit`);

  /* ---- 2. a table button rolls ----------------------------------------- */

  const drew = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const btn = app.querySelector('button[data-action="rollTable"][data-table="Warden: NPC - Quirk"]');
    if (!btn) return { clicked: false };
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 40 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const m = game.messages.contents.at(-1);
    return {
      clicked: true,
      id: m?.id,
      tableFlag: foundry.utils.getProperty(m?.flags ?? {}, "core.RollTable") ?? null,
      rolls: m?.rolls?.length ?? 0,
      alias: m?.speaker?.alias ?? null,
      wantedAlias: (await game.packs.get("air-bladder.warden-npcs").getIndex())
        .find((e) => e.name === "Warden: NPC - Quirk")?.name ?? null,
    };
  });

  drew.clicked ? ok("a table button is wired") : fail("a table button is wired", "no Quirk button found");

  /* ---- 3. THE RULE: it is core's card ---------------------------------- */

  drew.tableFlag && drew.rolls === 1
    ? ok("the card is CORE'S — it carries flags.core.RollTable and its roll", drew.tableFlag)
    : fail("the card is CORE'S — it carries flags.core.RollTable and its roll",
      JSON.stringify({ flag: drew.tableFlag, rolls: drew.rolls }));

  const markup = await page.evaluate((id) => {
    const el = document.querySelector(`.chat-message[data-message-id="${id}"]`);
    return { found: !!el, tableDraw: !!el?.querySelector(".table-draw") };
  }, drew.id);
  markup.tableDraw
    ? ok("...and it renders core's .table-draw block, which the button hangs on")
    : fail("...and it renders core's .table-draw block", JSON.stringify(markup));

  /* ---- 4. the encounter button really attaches ------------------------- */

  // 5 of the Dungeon table's 6 rows are spawnable, so ten draws missing every
  // one of them is a 1-in-60-million event, not a flake. If this ever reds,
  // the injection is broken, not unlucky.
  const spawn = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="encounters"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="rollTable"][data-table="Warden: Encounters - Dungeon"]');
    if (!btn) return { found: false };
    for (let attempt = 0; attempt < 10; attempt++) {
      const had = game.messages.size;
      btn.click();
      for (let i = 0; i < 40 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
      const m = game.messages.contents.at(-1);
      // The button is injected on render, so give the card a beat to paint.
      await new Promise((r) => setTimeout(r, 300));
      const el = document.querySelector(`.chat-message[data-message-id="${m.id}"]`);
      if (el?.querySelector(".encounter-spawn")) return { found: true, attempt: attempt + 1 };
    }
    return { found: false, attempt: 10 };
  });
  spawn.found
    ? ok("an encounter card still grows its Add-to-scene button", `after ${spawn.attempt} draw(s)`)
    : fail("an encounter card still grows its Add-to-scene button", "ten draws, no button");

  /* ---- 5. the speaker is the TABLE, asserted positively ---------------- */

  drew.alias && drew.alias === drew.wantedAlias
    ? ok("the card speaks as the table, not the Warden's character", drew.alias)
    : fail("the card speaks as the table", JSON.stringify({ got: drew.alias, want: drew.wantedAlias }));

  /* ---- 6. a combined draw is OURS, and is not core's ------------------- */

  const set = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="people"]').click();
    await new Promise((r) => setTimeout(r, 200));
    // BY KEY, not "the first rollSet button": querySelector searches the whole
    // application, not the visible tab, so the bare selector found Travel's
    // Complete Path — three tables — and this leg redded on a correct system.
    const btn = app.querySelector('button[data-action="rollSet"][data-key="CAIRN.Dashboard.Set.CompleteNpc"]');
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 80 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const made = game.messages.size - had;
    const m = game.messages.contents.at(-1);
    return {
      made,
      tableFlag: foundry.utils.getProperty(m?.flags ?? {}, "core.RollTable") ?? null,
      rows: (m?.content.match(/cairn-set-row/g) ?? []).length,
      hasScript: /<script|onerror=|javascript:/i.test(m?.content ?? ""),
      // The Complete Path bug, reported the day it shipped: the travel tables
      // carry <strong>, and escaping the drawn value posted a card reading
      // "&lt;strong&gt;Trails&lt;/strong&gt;" as literal text. Assert no
      // escaped tag survives anywhere in the card, and that real markup does.
      escapedTags: /&lt;\/?[a-z]/i.test(m?.content ?? ""),
      rendersMarkup: /<(strong|em)>/i.test(m?.content ?? ""),
    };
  });

  set.made === 1
    ? ok("a combined draw posts ONE card", `${set.rows} rows`)
    : fail("a combined draw posts ONE card", `${set.made} messages`);
  set.rows === 6 ? ok("...carrying all six of its tables") : fail("...carrying all six of its tables", String(set.rows));
  set.tableFlag === null
    ? ok("...and does NOT carry flags.core.RollTable, so it offers no spawn")
    : fail("...and does NOT carry flags.core.RollTable", String(set.tableFlag));
  set.hasScript === false && set.escapedTags === false
    ? ok("...with its values ENRICHED, so no tags show as text")
    : fail("...with its values enriched, not escaped",
      JSON.stringify({ script: set.hasScript, escapedTags: set.escapedTags }));

  // Complete Path specifically, because the TRAVEL tables are the ones whose
  // rows carry <strong> and <em>. This is the leg that would have caught the
  // shipped bug; the NPC set above has no markup to lose.
  const marked = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="travel"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="rollSet"][data-key="CAIRN.Dashboard.Set.CompletePath"]');
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 80 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const c = game.messages.contents.at(-1)?.content ?? "";
    // COUNT the <strong>s, never merely detect them: this card wraps every row
    // LABEL in <strong> of its own, so "does it contain <strong>" is true even
    // when every drawn value has been escaped to text. All three travel rows
    // open with their own <strong>, so enriched is 6 and escaped is 3, and the
    // first version of this leg was green under the very bug it was written
    // for.
    return {
      strongs: (c.match(/<strong>/gi) ?? []).length,
      rows: (c.match(/cairn-set-row/g) ?? []).length,
      escapedTags: /&lt;\/?[a-z]/i.test(c),
    };
  });
  marked.strongs > marked.rows && !marked.escapedTags
    ? ok("Complete Path renders the travel tables' own markup",
      `${marked.strongs} <strong> across ${marked.rows} rows`)
    : fail("Complete Path renders the travel tables' own markup", JSON.stringify(marked));

  /* ---- 7. the visibility dropdown reaches the message ------------------ */

  const whispered = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const select = app.querySelector("[name=messageMode]");
    const restore = select.value;
    select.value = "self";
    app.querySelector('[data-action="tab"][data-tab="travel"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="rollTable"][data-table="Warden: Weather - Spring"]');
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 40 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const m = game.messages.contents.at(-1);
    select.value = restore;
    return { whisper: m?.whisper ?? [], me: game.user.id, modes: [...select.options].map((o) => o.value) };
  });
  whispered.whisper.length === 1 && whispered.whisper[0] === whispered.me
    ? ok("choosing a private mode whispers the card to the Warden alone")
    : fail("choosing a private mode whispers the card", JSON.stringify(whispered.whisper));
  whispered.modes.includes("public") && whispered.modes.includes("gm")
    ? ok("the dropdown is built from v14 message modes", whispered.modes.join(", "))
    : fail("the dropdown is built from v14 message modes", JSON.stringify(whispered.modes));

  /* ---- 8. a generator mints exactly one document ----------------------- */

  const made = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="people"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="generate"][data-gen="npc"]');
    const had = game.actors.size;
    btn.click();
    for (let i = 0; i < 100 && game.actors.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));   // catch a second create, if any
    return { added: game.actors.size - had };
  });
  made.added === 1
    ? ok("Generate NPC mints exactly one actor")
    : fail("Generate NPC mints exactly one actor", `${made.added} created`);

  /* ---- 9. Pop Out, and re-docking ------------------------------------- */

  const detach = await page.evaluate(() => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const btn = app.querySelector('.window-header button[data-action="detach"]');
    return {
      present: !!btn,
      // Core's own action, surfaced rather than reimplemented.
      action: btn?.dataset.action ?? null,
      hiddenNow: btn?.classList.contains("cairn-header-hidden") ?? null,
      // Core's own predicate, which #syncPopOut keys the button's visibility
      // to. Docked, it must read true or the button would be hidden on open.
      canDetach: foundry.applications.instances.get("cairn-warden-dashboard")?._canDetach() ?? null,
    };
  });
  detach.present && detach.action === "detach"
    ? ok("Pop Out is in the title bar, using core's own detach action")
    : fail("Pop Out is in the title bar", JSON.stringify(detach));
  detach.hiddenNow === false && detach.canDetach === true
    ? ok("...and is visible while docked, matching core's own _canDetach")
    : fail("...and is visible while docked, matching core's _canDetach",
      JSON.stringify({ hidden: detach.hiddenNow, canDetach: detach.canDetach }));

  /* ---- 10. narrow it: the body scrolls, the chrome stays --------------- */

  const narrow = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const inst = foundry.applications.instances.get("cairn-warden-dashboard");
    await inst.setPosition({ width: 320, height: 400 });
    await new Promise((r) => setTimeout(r, 300));
    const body = app.querySelector(".cairn-dashboard-body");
    const nav = app.querySelector(".cairn-dashboard-tabs");
    const foot = app.querySelector(".cairn-dashboard-footer");
    const content = app.querySelector(".window-content");
    const out = {
      resizable: !!app.querySelector(".window-resize-handle"),
      bodyScrolls: body.scrollHeight > body.clientHeight,
      // The chrome must NOT be scrolled away with the panel.
      navVisible: nav.getBoundingClientRect().height > 0,
      footVisible: foot.getBoundingClientRect().height > 0,
      // Nothing may spill sideways out of the window.
      noHorizontalSpill: content.scrollWidth <= content.clientWidth + 1,
    };
    await inst.setPosition({ width: 520, height: 620 });
    return out;
  });
  narrow.resizable ? ok("the window has a resize handle") : fail("the window has a resize handle");
  narrow.bodyScrolls
    ? ok("narrowed to 320px the panel scrolls rather than clipping")
    : fail("narrowed to 320px the panel scrolls", "body did not overflow, so nothing proves it scrolls");
  narrow.navVisible && narrow.footVisible
    ? ok("...while the tabs and the damage button stay put")
    : fail("...while the tabs and the damage button stay put", JSON.stringify(narrow));
  narrow.noHorizontalSpill
    ? ok("...and nothing spills sideways")
    : fail("...and nothing spills sideways");

  /* ---- cleanup --------------------------------------------------------- */

  const swept = await page.evaluate(async (b) => {
    foundry.applications.instances.get("cairn-warden-dashboard")?.close();
    const msgs = game.messages.contents.filter((m) => !b.messages.includes(m.id)).map((m) => m.id);
    const actors = game.actors.contents.filter((a) => !b.actors.includes(a.id)).map((a) => a.id);
    const journals = game.journal.contents.filter((j) => !b.journals.includes(j.id)).map((j) => j.id);
    if (msgs.length) await ChatMessage.deleteDocuments(msgs);
    if (actors.length) await Actor.deleteDocuments(actors);
    if (journals.length) await JournalEntry.deleteDocuments(journals);
    return { msgs: msgs.length, actors: actors.length, journals: journals.length };
  }, before);
  note(`cleaned up ${swept.msgs} message(s), ${swept.actors} actor(s), ${swept.journals} journal(s)`);

  errors.length === 0 ? ok("zero console errors") : fail("console errors", JSON.stringify(errors).slice(0, 400));
} finally {
  await browser.close();
}

console.log(failed ? "\nwarden dashboard probe FAILED" : "\nwarden dashboard probe passed");
process.exit(failed ? 1 : 0);
