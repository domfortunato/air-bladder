#!/usr/bin/env node
/**
 * GLOG Magic as an OVERRIDING setting: generation, and the total conversion.
 *
 *   npm run dev:glog-magic     (needs Foundry running, dev world launched)
 *
 * The ruling this gates (2026-08-05): while `enable-glog-magic` is on, only
 * GLOG and custom spells are used — generation's random pool and named grants
 * exclude canon, every granted spell lands as a SPELLSCROLL — and FLIPPING THE
 * SETTING ON CONVERTS THE WORLD, totally: every canon spellbook anywhere
 * becomes a GLOG spellscroll and every canon scroll's text swaps, uses
 * untouched. The invariant afterwards: no canon spell text exists anywhere.
 * Flipping OFF converts nothing back (accepted at ruling time).
 *
 * Legs:
 *   1. GLOG OFF (the regression direction): a "Spellbook (X)" grant is a real
 *      BOOK carrying the canon wording; random books are books; random scrolls
 *      carry canon text. The setting itself is the control for leg 3 — no
 *      source edit flips behaviour, the switch does.
 *   2. The SWEEP, upgrade-style: plant every migration branch in canon state —
 *      a world item, an owned book, an owned SPENT scroll, an UNLINKED-token
 *      carrier (a delta-only book a game.actors walk cannot reach), a book in
 *      a LOCKED world compendium, one no-counterpart custom spell, and a book
 *      under a canon name whose GLOG counterpart is RENAMED (GLOG_NAME_ALIASES)
 *      — flip the setting, poll, and confirm each planted document was REWRITTEN:
 *      books are scrolls with the GLOG wording and `glog: true`, the spent
 *      scroll swapped text but kept `uses.value` 0, the no-counterpart spell
 *      converted in FORM and kept its own words, the pack was re-locked.
 *      (Prototype tokens carry no items — actor coverage IS their coverage,
 *      so there is no separate prototype leg to plant.)
 *      Control: the invariant checker runs BEFORE the flip and must REPORT the
 *      planted canon documents — proving the detector fires on unconverted
 *      state, so the zero-violations assertion afterwards can fail.
 *   3. Generation under GLOG, while the sweep runs: every random draw resolves
 *      inside GLOG ∪ More Spellbooks with ZERO canon-pack reads (getIndex /
 *      getDocument / getDocuments wrapped and counted), every drawn spell is a
 *      scroll, and the named grant comes back as a scroll wearing the GLOG
 *      wording with `glog: true`.
 *   4. Idempotence: a second, direct `runGlogConversion()` changes nothing —
 *      `_stats.modifiedTime` identical across the planted set.
 *   5. The CREATE seam (2026-08-09 ruling: there are no spellbooks in GLOG):
 *      what ARRIVES after the flip converts too — a canon book created on a
 *      character lands as an unspent scroll wearing the GLOG wording; a
 *      GLOG-pack drag (the reported repro: a dropped Haste stayed a book)
 *      lands as an unspent scroll whether the pack stores books or scrolls;
 *      a no-counterpart book converts in FORM and keeps its own words; a
 *      BOUND page arrives a page (the travel bundle), and the sweep-side
 *      immunity is asserted on `glogConversionDiff` as a PURE FUNCTION —
 *      never by running the world sweep against a defeated skip, which would
 *      be a real write. The off direction is leg 2b's plant itself: created
 *      with the setting off, the plants must ARRIVE as books.
 *   6. The invariant, world-wide: no spellbook item anywhere still carries the
 *      canon wording of a spell whose GLOG counterpart differs (the two
 *      byte-identical spells are skipped — for them "canon text" IS the GLOG
 *      text and the claim would be unfalsifiable).
 *
 * World hygiene, because the flip is DESTRUCTIVE and the dev world is shared
 * with a human: every pre-existing spellbook item in the sweep's coverage is
 * snapshotted to NODE before anything runs and restored by targeted diff in a
 * Node-level finally — restore updates OMIT `system.scroll` when it is not
 * changing, because writing `scroll: true` over a scroll re-enters the
 * transition branch of CairnItem._preUpdate and would REFILL a spent scroll.
 * Planted documents are deleted, names and ids printed at plant time.
 *
 * A world that arrives CONVERTED (the setting already ON — the dev world since
 * the user turned GLOG on to play) is handled, not refused: the probe flips
 * OFF for the canon legs (converting nothing back, by ruling), the mid-run
 * flip re-converts, and teardown leaves the setting ON exactly as found —
 * `withSettings`' snapshot sees no diff, so no teardown flip races cleanup.
 * The item restore above still returns every PRE-EXISTING spellbook to its
 * as-found state, unconverted strays included: fixing user content is the
 * sweep's job on a real flip, never a probe's.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog, withSettings } from "./lib.mjs";

const NS = "air-bladder";
const CANON = "air-bladder.spellbooks";
const GLOG = "air-bladder.spellbooks-glog";
const MORE = "air-bladder.more-spellbooks";

const browser = await chromium.launch();
watchdog(300000, "glog-magic probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
const note = (m) => console.log(`  note  ${m}`);

/**
 * The post-sweep invariant, as a walk over the sweep's own coverage. Reused for
 * the pre-flip control (must report violations) and the post-sweep assertion
 * (must report none) — one detector, so the two runs measure the same thing.
 */
const invariantCheck = async ({ canonByName, swappable }) => {
  const swap = new Set(swappable);
  const violations = [];
  const check = (loc, it) => {
    if (it.type !== "spellbook") return;
    // A bound Grimoire page is legitimately scroll: false — it is past the
    // scroll stage, and the sweep skips it for the same reason (a converted
    // page would violate PAGE_PINNED's flags-never-both-true invariant).
    if (it.system.bound) return;
    const key = String(it.name).toLowerCase();
    // EVERY spellbook converts in form — canon-named or not. Only the ones
    // with a differing (possibly ALIASED) GLOG counterpart must also have
    // shed the canon wording; byte-identical and no-counterpart spells keep
    // their text by design, so a text check there would be unfalsifiable.
    if (!it.system.scroll) { violations.push(`${loc}: "${it.name}" is still a BOOK`); return; }
    if (swap.has(key) && it.system.description === canonByName[key]) violations.push(`${loc}: "${it.name}" still carries the canon wording`);
  };
  for (const it of game.items) check("world", it);
  for (const a of game.actors) for (const it of a.items) check(`actor ${a.name}`, it);
  for (const scene of game.scenes) {
    for (const t of scene.tokens) {
      if (t.actorLink || !t.actor) continue;
      for (const it of t.actor.items) check(`token ${t.name}`, it);
    }
  }
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "world" || pack.metadata.type !== "Item") continue;
    let docs;
    try { docs = await pack.getDocuments(); } catch { continue; }
    for (const it of docs) check(`pack ${pack.collection}`, it);
  }
  return violations;
};

let snapshot = [];
let planted = null;

try {
  await joinAsGM(page);

  await withSettings(page, async () => {
    /* --- 0. preconditions, and the counterpart spell this run keys on ------- */

    const pre = await page.evaluate(async ({ CANON, GLOG, MORE }) => {
      const canonPack = game.packs.get(CANON), glogPack = game.packs.get(GLOG);
      if (!canonPack || !glogPack) return { missing: true };
      const canonByName = {}, glogByName = {}, cased = {};
      for (const d of await canonPack.getDocuments()) {
        if (d.type !== "spellbook") continue;
        canonByName[d.name.toLowerCase()] = d.system.description ?? "";
        cased[d.name.toLowerCase()] = d.name;
      }
      for (const d of await glogPack.getDocuments()) {
        if (d.type !== "spellbook") continue;
        glogByName[d.name.toLowerCase()] = d.system.description ?? "";
      }
      // Warm More Spellbooks too (canon and GLOG were just warmed by the map
      // builds above): the GLOG-on draw legs mostly land here, and a cache-miss
      // draw pays a ~1s single-document server query — the same latency race
      // that timed dev:spell-pool out on 2026-08-05. One bulk load makes the
      // legs measure the draw path's work, not the server's mood.
      await game.packs.get(MORE)?.getDocuments();
      // The GLOG page's 100 is not name-for-name the canon 100: two spells are
      // RENAMED (aliased in module/glog.js) and two have no counterpart at all.
      // Everything below derives from the live packs + the live alias map, so a
      // content edit moves the probe rather than silently invalidating it.
      const { GLOG_NAME_ALIASES } = await import("/systems/air-bladder/module/glog.js");
      const glogTextFor = (key) => (key in glogByName) ? glogByName[key] : glogByName[GLOG_NAME_ALIASES.get(key)];
      const canonKeys = Object.keys(canonByName);
      const withCounterpart = canonKeys.filter((n) => glogTextFor(n) !== undefined);
      const swappable = withCounterpart.filter((n) => glogTextFor(n) !== canonByName[n]);
      const noCounterpart = canonKeys.filter((n) => glogTextFor(n) === undefined).map((n) => cased[n]);
      const pick = swappable.filter((n) => n in glogByName).sort()[0] ?? null;
      let aliasCase = null;
      for (const [from, to] of GLOG_NAME_ALIASES) {
        if (from in canonByName && to in glogByName && canonByName[from] !== glogByName[to]) {
          aliasCase = { name: cased[from], canonText: canonByName[from], glogText: glogByName[to] };
          break;
        }
      }
      return {
        canonSize: canonKeys.length,
        glogSize: Object.keys(glogByName).length,
        moreSize: game.packs.get(MORE)?.index.size ?? 0,
        swappable, identicalCount: withCounterpart.length - swappable.length, noCounterpart,
        pick, pickName: pick ? cased[pick] : null,
        canonText: pick ? canonByName[pick] : null,
        glogText: pick ? glogByName[pick] : null,
        aliasCase,
        canonByName,
        settingOn: game.settings.get("air-bladder", "enable-glog-magic") === true,
      };
    }, { CANON, GLOG, MORE });

    if (pre.missing) { fail("canon or GLOG pack missing — is the pack built?"); return; }
    if (pre.settingOn) {
      // Flipping OFF converts nothing back (the ruling's accepted asymmetry),
      // so this write changes no world content — only which rules generation
      // and the create seam consult. The mid-run flip below turns it back ON,
      // which is the state teardown leaves: withSettings' entry snapshot was
      // ON, so its restore finds no diff and writes nothing.
      await page.evaluate(() => game.settings.set("air-bladder", "enable-glog-magic", false));
      note("world arrived converted (setting ON) — flipped OFF for the canon legs; the mid-run flip re-converts and teardown leaves it ON as found");
    }
    pre.canonSize > 0 && pre.glogSize > 0
      ? ok(`packs: canon ${pre.canonSize}, GLOG ${pre.glogSize}, More ${pre.moreSize} (canon non-empty, so GLOG's exclusion of it is a real claim)`)
      : fail(`a spell pack is empty (canon ${pre.canonSize}, GLOG ${pre.glogSize})`);
    pre.pickName
      ? ok(`counterpart spell for this run: "${pre.pickName}" (${pre.swappable.length} swappable, ${pre.identicalCount} byte-identical — text-skipped, ${pre.noCounterpart.length} with no GLOG counterpart: ${pre.noCounterpart.join(", ")})`)
      : fail("no spell name exists in BOTH packs with differing texts — nothing to key the probe on");
    pre.aliasCase
      ? ok(`alias case for this run: canon "${pre.aliasCase.name}" resolves to a RENAMED GLOG counterpart`)
      : fail("GLOG_NAME_ALIASES resolves to nothing in the live packs — the alias map and the content disagree");
    if (failed) return;

    const NAME = pre.pickName;
    const ALIAS = pre.aliasCase;

    /* --- 1. GLOG OFF — the canon regression direction ----------------------- */

    const off = await page.evaluate(async ({ NAME, ALIAS, canonByName }) => {
      const out = {};
      const gear = await import("/systems/air-bladder/module/gear.js");
      const CG = game.cairn.characterGenerator;
      const grant = await gear.resolveGearItem(`Spellbook (${NAME})`);
      out.grantType = grant?.type;
      out.grantScroll = !!grant?.system?.scroll;
      out.grantCanonText = grant?.system?.description === canonByName[NAME.toLowerCase()];
      // The GLOG rename alias must NOT leak into canon mode: the canon name
      // resolves to the canon book with the canon wording.
      const aliasGrant = await gear.resolveGearItem(`Spellbook (${ALIAS.name})`);
      out.aliasIsCanonBook = aliasGrant?.type === "spellbook" && !aliasGrant?.system?.scroll
        && aliasGrant?.system?.description === ALIAS.canonText;
      const book = await CG.randomSpellbookItem();
      out.bookIsBook = !!book && !book.system?.scroll;
      const scroll = await CG.randomScrollItem();
      out.scrollIsScroll = scroll?.system?.scroll === true;
      out.scrollCanonText = !!scroll && scroll.system.description === canonByName[String(scroll.name).toLowerCase()];
      return out;
    }, { NAME, ALIAS, canonByName: pre.canonByName });

    off.grantType === "spellbook" && !off.grantScroll && off.grantCanonText
      ? ok(`GLOG off: "Spellbook (${NAME})" grants a real BOOK carrying the canon wording`)
      : fail(`GLOG off: grant came back wrong (type ${off.grantType}, scroll ${off.grantScroll}, canonText ${off.grantCanonText})`);
    off.aliasIsCanonBook
      ? ok(`GLOG off: "Spellbook (${ALIAS.name})" is untouched by the rename alias — canon book, canon wording`)
      : fail(`GLOG off: the GLOG rename alias LEAKED into canon-mode resolution of "${ALIAS.name}"`);
    off.bookIsBook
      ? ok("GLOG off: a random spellbook draw is a book, not a scroll")
      : fail("GLOG off: randomSpellbookItem returned a scroll (or nothing) with the setting off");
    off.scrollIsScroll && off.scrollCanonText
      ? ok("GLOG off: a random scroll draw carries the canon wording")
      : fail(`GLOG off: random scroll wrong (scroll ${off.scrollIsScroll}, canonText ${off.scrollCanonText})`);

    /* --- 2a. snapshot every pre-existing spellbook, to Node ----------------- */

    snapshot = await page.evaluate(async () => {
      const out = [];
      const push = (loc, ref, it) => {
        if (it.type !== "spellbook") return;
        out.push({ loc, ...ref, itemId: it.id, name: it.name, img: it.img, system: it.system.toObject() });
      };
      for (const it of game.items) push("world", {}, it);
      for (const a of game.actors) for (const it of a.items) push("actor", { actorId: a.id }, it);
      for (const scene of game.scenes) {
        for (const t of scene.tokens) {
          if (t.actorLink || !t.actor) continue;
          for (const it of t.actor.items) push("token", { sceneId: scene.id, tokenId: t.id }, it);
        }
      }
      for (const pack of game.packs) {
        if (pack.metadata.packageType !== "world" || pack.metadata.type !== "Item") continue;
        let docs;
        try { docs = await pack.getDocuments(); } catch { continue; }
        for (const it of docs) push("pack", { pack: pack.collection }, it);
      }
      return out;
    });
    note(`snapshotted ${snapshot.length} pre-existing spellbook item(s) for restore`);

    /* --- 2b. plant the branch set, all in canon state ----------------------- */

    planted = await page.evaluate(async ({ NAME, canonText, ALIAS }) => {
      const mkBook = (name, desc) => ({ name, type: "spellbook", system: { description: desc, scroll: false, glog: false } });
      const out = {};
      const wi = await Item.create(mkBook(NAME, canonText));
      out.worldItemId = wi.id;
      // The create seam's OFF direction: with the setting off, a created book
      // must ARRIVE a book. If the seam ever fires unswitched, this plant (and
      // with it the 2c control) turns scroll and the run reds here, not there.
      out.worldBookAtPlant = wi.system.scroll;
      const wu = await Item.create(mkBook("zz-glog-unique-spell", "<p>zz unique wording with no GLOG counterpart</p>"));
      out.uniqueId = wu.id;
      // The RENAMED pair: a canon book whose GLOG counterpart lives under a new
      // name — the sweep must still swap its wording, via GLOG_NAME_ALIASES.
      const wa = await Item.create(mkBook(ALIAS.name, ALIAS.canonText));
      out.aliasItemId = wa.id;

      const carrier = await Actor.create({ name: "zz-glog-carrier", type: "character" });
      out.carrierId = carrier.id;
      const [ob] = await carrier.createEmbeddedDocuments("Item", [mkBook(NAME, canonText)]);
      out.ownedBookId = ob.id;
      // A SPENT scroll: explicit uses.value 0 survives _preCreate's pinning.
      const [os] = await carrier.createEmbeddedDocuments("Item", [{
        name: NAME, type: "spellbook",
        system: { description: canonText, scroll: true, glog: false, uses: { value: 0, max: 1 } },
      }]);
      out.ownedScrollId = os.id;
      out.spentAtPlant = os.system.uses.value;

      const base = await Actor.create({ name: "zz-glog-token-base", type: "character", prototypeToken: { actorLink: false } });
      out.baseId = base.id;
      const scene = await Scene.create({ name: "zz-glog-scene" });
      out.sceneId = scene.id;
      const [td] = await scene.createEmbeddedDocuments("Token", [{ name: "zz-glog-token", actorId: base.id, actorLink: false, x: 100, y: 100 }]);
      out.tokenId = td.id;
      // Created on the SYNTHETIC actor only — a delta item the game.actors walk
      // cannot reach. If the sweep's scene walk were missing, this one stays canon.
      const [tb] = await td.actor.createEmbeddedDocuments("Item", [mkBook(NAME, canonText)]);
      out.tokenItemId = tb.id;

      const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ label: "zz-glog-pack", type: "Item" });
      out.packId = pack.collection;
      const pb = await Item.create(mkBook(NAME, canonText), { pack: pack.collection });
      out.packItemId = pb.id;
      await pack.configure({ locked: true });
      out.packLockedAtPlant = game.packs.get(out.packId)?.locked === true;
      return out;
    }, { NAME, canonText: pre.canonText, ALIAS });

    note(`planted: world Item "${NAME}" ${planted.worldItemId}; "zz-glog-unique-spell" ${planted.uniqueId}; ` +
      `renamed-pair Item "${ALIAS.name}" ${planted.aliasItemId}; ` +
      `Actor "zz-glog-carrier" ${planted.carrierId} (book ${planted.ownedBookId}, spent scroll ${planted.ownedScrollId}); ` +
      `Actor "zz-glog-token-base" ${planted.baseId}; Scene "zz-glog-scene" ${planted.sceneId} (token ${planted.tokenId}, delta book ${planted.tokenItemId}); ` +
      `world pack ${planted.packId} (book ${planted.packItemId}, locked ${planted.packLockedAtPlant})`);
    planted.spentAtPlant === 0
      ? ok("planted scroll really is spent (uses 0/1) — the uses-untouched claim below can fail")
      : fail(`planted scroll arrived with uses.value ${planted.spentAtPlant}, not 0 — _preCreate refilled it and the spent-stays-spent leg is vacuous`);
    planted.worldBookAtPlant === false
      ? ok("GLOG off: a spellbook created with the setting off arrives a BOOK — the create seam respects the switch")
      : fail("GLOG off: the create seam fired with the setting OFF — a planted canon book arrived as a scroll");
    if (!planted.packLockedAtPlant) fail("could not lock the planted world pack — the re-lock assertion would be vacuous");

    /* --- 2c. CONTROL: the detector must fire on the unconverted state ------- */

    const before = await page.evaluate(invariantCheck, { canonByName: pre.canonByName, swappable: pre.swappable });
    before.length >= 5
      ? ok(`NEGATIVE CONTROL: pre-flip, the invariant checker reports ${before.length} violation(s) including the planted set — the zero assertion below can fail`)
      : fail(`pre-flip checker saw only ${before.length} violation(s) — it cannot see the planted canon documents, so a green result would be meaningless`);
    if (failed) return;

    /* --- 3. flip, then generation legs while the sweep runs ----------------- */

    await page.evaluate(() => game.settings.set("air-bladder", "enable-glog-magic", true));
    ok("flipped enable-glog-magic ON (the sweep starts on this client — the active GM)");

    const on = await page.evaluate(async ({ NAME, ALIAS, glogText, CANON, GLOG, MORE }) => {
      const out = { canonReads: 0 };
      const proto = foundry.documents.collections.CompendiumCollection.prototype;
      const origs = {};
      for (const m of ["getIndex", "getDocuments", "getDocument"]) {
        origs[m] = proto[m];
        proto[m] = function (...a) {
          if (this.metadata?.id === CANON) out.canonReads++;
          return origs[m].apply(this, a);
        };
      }
      try {
        const gear = await import("/systems/air-bladder/module/gear.js");
        const CG = game.cairn.characterGenerator;
        const glogIds = new Set(game.packs.get(GLOG).index.map((e) => e._id));
        const moreIds = new Set((game.packs.get(MORE)?.index ?? []).map((e) => e._id));
        let inPool = 0;
        const escaped = [];
        for (let i = 0; i < 40; i++) {
          const doc = await CG.randomSpellbookDoc();
          if (!doc) continue;
          if (glogIds.has(doc.id) || moreIds.has(doc.id)) inPool++;
          else escaped.push(doc.name);
        }
        out.inPool = inPool;
        out.escaped = [...new Set(escaped)].slice(0, 5);

        const drawn = [];
        for (let i = 0; i < 5; i++) {
          const b = await CG.randomSpellbookItem();
          const s = await CG.randomScrollItem();
          if (b) drawn.push(b);
          if (s) drawn.push(s);
        }
        out.drawCount = drawn.length;
        out.allScrolls = drawn.every((d) => d.system?.scroll === true && d.system.weightless === true && d.system.uses?.max === 1);

        const grant = await gear.resolveGearItem(`Spellbook (${NAME})`);
        out.grantScroll = grant?.system?.scroll === true;
        out.grantGlogFlag = grant?.system?.glog === true;
        out.grantGlogText = grant?.system?.description === glogText;
        // A grant under the CANON name of a renamed spell resolves through the
        // alias to the GLOG wording — and canon is still never read for it.
        const aliasGrant = await gear.resolveGearItem(`Spellbook (${ALIAS.name})`);
        out.aliasGrantIsGlogScroll = aliasGrant?.system?.scroll === true
          && aliasGrant?.system?.description === ALIAS.glogText;
      } finally {
        for (const [m, f] of Object.entries(origs)) proto[m] = f;
      }
      return out;
    }, { NAME, ALIAS, glogText: pre.glogText, CANON, GLOG, MORE });

    on.inPool === 40 && on.escaped.length === 0
      ? ok("GLOG on: 40/40 random draws resolved inside GLOG ∪ More Spellbooks — canon excluded")
      : fail(`GLOG on: ${on.inPool}/40 draws in pool; escaped: ${JSON.stringify(on.escaped)}`);
    on.canonReads === 0
      ? ok("GLOG on: zero canon-pack reads during the draws and the grant (getIndex/getDocument/getDocuments all counted)")
      : fail(`GLOG on: the canon pack was read ${on.canonReads} time(s) while GLOG was in force`);
    on.drawCount === 10 && on.allScrolls
      ? ok("GLOG on: every random draw — book path included — came out a SCROLL (petty, single-use)")
      : fail(`GLOG on: ${on.drawCount}/10 draws resolved and allScrolls=${on.allScrolls} — the every-granted-spell-is-a-scroll rule leaks`);
    on.grantScroll && on.grantGlogFlag && on.grantGlogText
      ? ok(`GLOG on: "Spellbook (${NAME})" grants a scroll wearing the GLOG wording, glog: true`)
      : fail(`GLOG on: grant wrong (scroll ${on.grantScroll}, glogFlag ${on.grantGlogFlag}, glogText ${on.grantGlogText})`);
    on.aliasGrantIsGlogScroll
      ? ok(`GLOG on: "Spellbook (${ALIAS.name})" resolves through the rename alias to the GLOG wording`)
      : fail(`GLOG on: the canon name "${ALIAS.name}" did not resolve to its renamed GLOG counterpart`);

    /* --- 4. the sweep: poll each planted branch for its rewrite ------------- */

    const readPlanted = async () => page.evaluate(async (p) => {
      const shape = (it) => it ? {
        scroll: it.system.scroll, glog: it.system.glog,
        desc: it.system.description, uses: { ...it.system.uses },
      } : null;
      const pack = game.packs.get(p.packId);
      const packItem = pack ? await pack.getDocument(p.packItemId).catch(() => null) : null;
      return {
        world: shape(game.items.get(p.worldItemId)),
        unique: shape(game.items.get(p.uniqueId)),
        alias: shape(game.items.get(p.aliasItemId)),
        ownedBook: shape(game.actors.get(p.carrierId)?.items.get(p.ownedBookId)),
        ownedScroll: shape(game.actors.get(p.carrierId)?.items.get(p.ownedScrollId)),
        tokenBook: shape(game.scenes.get(p.sceneId)?.tokens.get(p.tokenId)?.actor?.items.get(p.tokenItemId)),
        packBook: shape(packItem),
        packLocked: pack?.locked ?? null,
      };
    }, planted);

    let state = null, waited = 0;
    for (; waited < 90000; waited += 500) {
      state = await readPlanted();
      const done = [state.world, state.ownedBook, state.ownedScroll, state.tokenBook, state.packBook, state.unique, state.alias]
        .every((s) => s && s.scroll === true)
        && state.world.desc === pre.glogText;
      if (done) break;
      await page.waitForTimeout(500);
    }
    note(`sweep settled after ~${waited}ms`);

    const swept = (label, s, { wantGlog, wantDesc, wantUsesValue }) => {
      if (!s) return fail(`${label}: planted document has VANISHED`);
      const bad = [];
      if (s.scroll !== true) bad.push(`scroll ${s.scroll}`);
      if (s.glog !== wantGlog) bad.push(`glog ${s.glog} (want ${wantGlog})`);
      if (wantDesc !== undefined && s.desc !== wantDesc) bad.push("wrong wording");
      if (wantUsesValue !== undefined && s.uses?.value !== wantUsesValue) bad.push(`uses.value ${s.uses?.value} (want ${wantUsesValue})`);
      bad.length ? fail(`${label}: ${bad.join(", ")}`) : ok(`${label}: rewritten as ruled`);
    };
    swept("world item", state.world, { wantGlog: true, wantDesc: pre.glogText, wantUsesValue: 1 });
    swept("owned book", state.ownedBook, { wantGlog: true, wantDesc: pre.glogText, wantUsesValue: 1 });
    swept("owned SPENT scroll (uses untouched)", state.ownedScroll, { wantGlog: true, wantDesc: pre.glogText, wantUsesValue: 0 });
    swept("unlinked-token delta book", state.tokenBook, { wantGlog: true, wantDesc: pre.glogText });
    swept("locked world-pack book", state.packBook, { wantGlog: true, wantDesc: pre.glogText });
    swept("no-counterpart custom spell (form only, own words kept)", state.unique,
      { wantGlog: false, wantDesc: "<p>zz unique wording with no GLOG counterpart</p>" });
    swept(`renamed-pair book "${ALIAS.name}" (swapped via the alias)`, state.alias,
      { wantGlog: true, wantDesc: ALIAS.glogText });
    state.packLocked === true
      ? ok("the world pack was re-LOCKED after its write")
      : fail(`the world pack was left ${state.packLocked === false ? "UNLOCKED" : "missing"} by the sweep`);

    /* --- 5. idempotence: a second pass writes nothing ----------------------- */

    const idem = await page.evaluate(async (p) => {
      const stamp = async () => {
        const pack = game.packs.get(p.packId);
        const packItem = pack ? await pack.getDocument(p.packItemId).catch(() => null) : null;
        return [
          game.items.get(p.worldItemId), game.items.get(p.uniqueId),
          game.items.get(p.aliasItemId),
          game.actors.get(p.carrierId)?.items.get(p.ownedBookId),
          game.actors.get(p.carrierId)?.items.get(p.ownedScrollId),
          game.scenes.get(p.sceneId)?.tokens.get(p.tokenId)?.actor?.items.get(p.tokenItemId),
          packItem,
        ].map((d) => d?._stats?.modifiedTime ?? null);
      };
      const beforeTimes = await stamp();
      const { runGlogConversion } = await import("/systems/air-bladder/module/glog.js");
      await runGlogConversion();
      const afterTimes = await stamp();
      return { unchanged: JSON.stringify(beforeTimes) === JSON.stringify(afterTimes), beforeTimes, afterTimes };
    }, planted);
    idem.unchanged
      ? ok("idempotent: a second runGlogConversion() modified nothing (all _stats.modifiedTime unchanged)")
      : fail(`a second sweep WROTE again — modifiedTimes moved: ${JSON.stringify(idem.beforeTimes)} -> ${JSON.stringify(idem.afterTimes)}`);

    /* --- 5b. the CREATE seam: what ARRIVES after the flip converts too ------ */
    // The sweep converts what EXISTS; CairnItem._preCreate converts what
    // ARRIVES (there are no spellbooks in GLOG — 2026-08-09 ruling, made when
    // a Haste dropped from the GLOG compendium stayed a book). Everything here
    // lands on the planted carrier, so the outer finally sweeps it all.

    const seam = await page.evaluate(async ({ NAME, canonText, glogText, GLOG, carrierId, uniqueWords }) => {
      const out = {};
      const carrier = game.actors.get(carrierId);
      const shape = (it) => ({
        scroll: it.system.scroll, glog: it.system.glog, bound: it.system.bound,
        desc: it.system.description, weightless: it.system.weightless,
        uses: { ...it.system.uses },
      });

      // (a) a canon BOOK arriving on a character — the Create dialog / import
      // / world-drag path. Must land an UNSPENT scroll wearing the GLOG text.
      const [canonArr] = await carrier.createEmbeddedDocuments("Item", [
        { name: NAME, type: "spellbook", system: { description: canonText, scroll: false, glog: false } },
      ]);
      out.canon = shape(canonArr);
      out.canonSwapped = canonArr.system.description === glogText;

      // (b) the reported repro: a GLOG-pack drag, via the same fromCompendium
      // data a real drop builds. This leg pins the OUTCOME, not the mechanism:
      // while the pack stores books the seam converts; once the pack ships
      // scrolls the seam skips — either way an unspent scroll must arrive.
      const pack = game.packs.get(GLOG);
      const entry = pack.index.find((e) => e.name.toLowerCase() === NAME.toLowerCase());
      out.packEntryFound = !!entry;
      if (entry) {
        const src = await pack.getDocument(entry._id);
        const [dropped] = await carrier.createEmbeddedDocuments("Item", [game.items.fromCompendium(src)]);
        out.fromPack = shape(dropped);
      }

      // (c) a book with NO GLOG counterpart converts in FORM only.
      const [uniq] = await carrier.createEmbeddedDocuments("Item", [
        { name: "zz-seam-unique-spell", type: "spellbook", system: { description: uniqueWords, scroll: false, glog: false } },
      ]);
      out.unique = shape(uniq);

      // (d) a BOUND page arriving (the travel bundle copies pages between
      // actors) stays a page — the seam's one exemption.
      const [pg] = await carrier.createEmbeddedDocuments("Item", [
        { name: NAME, type: "spellbook", system: { description: glogText, bound: true, scroll: false } },
      ]);
      out.page = shape(pg);

      // (e) the sweep-side half of that exemption, asserted on the PURE
      // function the sweep calls — running the real sweep against a defeated
      // skip would be a real write against the shared world, so the witness
      // for the skip is the diff itself.
      const glogMod = await import("/systems/air-bladder/module/glog.js");
      const map = await glogMod.glogTextCached();
      out.mapSize = map.size;
      out.pageDiffNull = glogMod.glogConversionDiff(
        { name: NAME, system: { bound: true, scroll: false, glog: false, description: canonText } }, map,
      ) === null;
      return out;
    }, { NAME, canonText: pre.canonText, glogText: pre.glogText, GLOG,
      carrierId: planted.carrierId, uniqueWords: "<p>zz seam unique wording, no counterpart</p>" });

    const unspentScroll = (s) => s && s.scroll === true && s.uses?.value === 1 && s.uses?.max === 1 && s.weightless === true;
    unspentScroll(seam.canon) && seam.canon.glog === true && seam.canonSwapped
      ? ok(`create seam: a canon "${NAME}" book ARRIVING under GLOG lands as an unspent scroll wearing the GLOG wording, glog: true`)
      : fail(`create seam: canon-book arrival wrong — ${JSON.stringify(seam.canon)} (swapped ${seam.canonSwapped})`);
    seam.packEntryFound
      ? (unspentScroll(seam.fromPack) && seam.fromPack.desc === pre.glogText
        ? ok("create seam: the GLOG-pack drag (the reported repro) lands as an unspent scroll, wording intact")
        : fail(`create seam: the GLOG-pack drag still lands wrong — ${JSON.stringify(seam.fromPack)}`))
      : fail(`create seam: no "${NAME}" entry in the GLOG pack index — the repro leg keyed on nothing`);
    seam.unique.scroll === true && seam.unique.glog === false
      && seam.unique.desc === "<p>zz seam unique wording, no counterpart</p>"
      ? ok("create seam: a no-counterpart book converts in FORM and keeps its own words, glog stays false")
      : fail(`create seam: no-counterpart arrival wrong — ${JSON.stringify(seam.unique)}`);
    seam.page.bound === true && seam.page.scroll === false && seam.page.weightless === true
      ? ok("create seam: a BOUND page arriving is left a page — the travel bundle is unharmed")
      : fail(`create seam: a bound page was converted on arrival — ${JSON.stringify(seam.page)}`);
    seam.pageDiffNull && seam.mapSize > 0
      ? ok("sweep immunity: glogConversionDiff(bound page) is null — a flip can never turn a Grimoire page back into a scroll")
      : fail(`sweep immunity: glogConversionDiff returned a diff for a bound page (map size ${seam.mapSize}) — a flip would unbind every Grimoire in the world`);

    /* --- 6. the invariant, world-wide --------------------------------------- */

    const after = await page.evaluate(invariantCheck, { canonByName: pre.canonByName, swappable: pre.swappable });
    after.length === 0
      ? ok("invariant holds: no canon spell wording (and no book) survives anywhere in the sweep's coverage")
      : fail(`${after.length} violation(s) survived the sweep:\n        ${after.slice(0, 8).join("\n        ")}`);
  });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  /* Node-level restore: a throw inside any evaluate cannot skip this. */
  try {
    if (planted) {
      const gone = await page.evaluate(async (p) => {
        const gone = [], left = [];
        const tryDel = async (label, fn) => { try { await fn(); gone.push(label); } catch { left.push(label); } };
        await tryDel("scene(+token)", () => game.scenes.get(p.sceneId)?.delete());
        await tryDel("carrier actor", () => game.actors.get(p.carrierId)?.delete());
        await tryDel("token-base actor", () => game.actors.get(p.baseId)?.delete());
        await tryDel("world item", () => game.items.get(p.worldItemId)?.delete());
        await tryDel("unique item", () => game.items.get(p.uniqueId)?.delete());
        await tryDel("renamed-pair item", () => game.items.get(p.aliasItemId)?.delete());
        await tryDel("world pack", async () => {
          const pk = game.packs.get(p.packId);
          if (!pk) return;
          await pk.configure({ locked: false });
          await pk.deleteCompendium();
        });
        return { gone, left };
      }, planted);
      console.log(`  note  cleanup: removed ${gone.gone.join(", ")}${gone.left.length ? ` — LEFT BEHIND: ${gone.left.join(", ")}` : ""}`);
      if (gone.left.length) failed = true;
    }

    if (snapshot.length) {
      const restored = await page.evaluate(async (snap) => {
        const FIELDS = ["scroll", "glog", "description", "weightless", "equipped", "uses"];
        const resolveDoc = async (s) => {
          if (s.loc === "world") return game.items.get(s.itemId);
          if (s.loc === "actor") return game.actors.get(s.actorId)?.items.get(s.itemId);
          if (s.loc === "token") return game.scenes.get(s.sceneId)?.tokens.get(s.tokenId)?.actor?.items.get(s.itemId);
          if (s.loc === "pack") { const pk = game.packs.get(s.pack); return pk ? await pk.getDocument(s.itemId).catch(() => null) : null; }
          return null;
        };
        // Targeted diff, and system.scroll only when it REALLY changed: writing
        // `scroll: true` over a live scroll re-enters _preUpdate's transition
        // branch, which refills uses.value — a spent user scroll must stay spent.
        const diffOf = (doc, s) => {
          const cur = doc.system.toObject();
          const d = {};
          for (const f of FIELDS) {
            if (JSON.stringify(cur[f]) !== JSON.stringify(s.system[f])) d[`system.${f}`] = s.system[f];
          }
          if (doc.img !== s.img) d.img = s.img;
          return d;
        };
        const fixed = [], stuck = [];
        for (const s of snap) {
          const doc = await resolveDoc(s);
          if (!doc) continue;   // deleted since the snapshot — not ours to recreate
          let d = diffOf(doc, s);
          if (!Object.keys(d).length) continue;
          const pk = s.loc === "pack" ? game.packs.get(s.pack) : null;
          const wasLocked = pk?.locked;
          if (wasLocked) await pk.configure({ locked: false });
          try {
            await doc.update(d);
            d = diffOf(doc, s);
            if (Object.keys(d).length) { await doc.update(d); d = diffOf(doc, s); }
            Object.keys(d).length
              ? stuck.push(`${s.loc}:"${s.name}" (${Object.keys(d).join(", ")})`)
              : fixed.push(`${s.loc}:"${s.name}"`);
          } finally {
            if (wasLocked) await pk.configure({ locked: true });
          }
        }
        return { fixed, stuck };
      }, snapshot);
      if (restored.fixed.length) console.log(`  note  restored ${restored.fixed.length} pre-existing spellbook(s): ${restored.fixed.join(", ")}`);
      if (restored.stuck.length) { console.error(`  FAIL  could NOT fully restore: ${restored.stuck.join(", ")}`); failed = true; }
      if (!restored.fixed.length && !restored.stuck.length) console.log("  note  no pre-existing spellbook needed restoring");
    }
  } catch (e) {
    console.error(`  FAIL  restore itself failed: ${e.message}`);
    failed = true;
  }

  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nGLOG MAGIC PROBE FAILED\n" : "\nglog magic probe passed\n");
process.exit(failed ? 1 : 0);
