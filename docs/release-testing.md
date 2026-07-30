# Release testing

The single list of what to run, and when. `RELEASE.md` is the release *procedure*; this
is the *testing*.

**Keep this file in step with `package.json`.** Adding a probe without adding it here
means it runs only when someone remembers it. That is not hypothetical: before this file
existed, 21 test scripts were spread across three partial lists — `CLAUDE.md` named 4,
`RELEASE.md` named 4, the release skill named 7, and no list was complete.

Nor was it hypothetical the second time. Three probes — `ui-parity`, `parity`,
`grant-hint` — were never given an `npm` script and so were never on this list, and all
three quietly rotted against ApplicationV1 internals until the AppV2 port. `ui-parity`
alone carries 30 assertions, including the only geometry checks in the suite. **A probe
without a script name is a probe nobody runs.** (Wired up 2026-07-29.)

---

## Why there are two passes

They test genuinely different things, and neither substitutes for the other.

**Before tagging** runs against your **working tree** on `:30000`, through the directory
junction. It catches what you just wrote.

**After publishing** runs against the **downloaded release zip** on `:30001`, in a world
created from scratch. It catches what the *build* did — a file missing from the zip, a
pack that did not get built, a manifest pointing at the wrong version. None of that is
visible from the working tree, where every file is present by definition.

Concrete proof this split matters: `dev:smoke` was asserting that *every* pack in
`game.packs` is non-empty, including world compendia. `world.custom-backgrounds` is
created on demand and empty until a Warden authors a background — so the check failed on
long-lived worlds and passed on fresh ones. Post-release validation always uses a fresh
world, so it could never have caught it. (Fixed 2026-07-28.)

---

## Before tagging

Run from `c:\Users\domin\code\air-bladder`, on the branch you are about to merge.

### Offline — no Foundry needed

| Command | Checks |
|---|---|
| `npm run check:refs` | every compendium reference in every shipped table resolves, and resolves to a document with the *right name*. Also asserts it found **at least `EXPECTED_REFS` (198) references at all** — because this gate reads a schema, and a schema rename turns it into a gate that checks nothing while still printing "passed". That is not hypothetical: v13 renamed the row type `pack`→`document` and replaced `documentCollection`+`documentId` with `documentUuid`, so its `if (r.type !== "pack") continue` skipped every row in every table. 198 references one run, 0 the next, green both times. Raise the constant deliberately when content adds references |
| `npm run check:fields` | pack documents match the data model, **and `system.json` `documentTypes.*.htmlFields` matches the `HTMLField`s in the schemas, both directions**. That second half is a security check, not tidiness: the Foundry server never loads the data models, so an `HTMLField` missing from the manifest is never sanitized — see `dev:sanitize` |
| `npm run check:traits` | the trait-sentence parser |
| `npm run i18n:check` | translation coverage, placeholder/HTML mismatches, stale keys — language files **against each other** |
| `npm run check:probes` | that **every probe under `tools/dev/` is reachable as an npm script**. A probe with no script is a probe nobody runs, and an unrun probe rots silently — it keeps passing in the imagination while testing nothing. This gate exists because on 2026-07-29 there were **18** of them; see "The 18 orphans" below for what they were hiding |
| `npm run check:licence` | that **`LICENSE.txt` has not shrunk back to a bare MIT file**, which is what it was until 2026-07-30 — 21 lines of unqualified MIT over six regimes, naming Yochai Gal as a copyright holder *of the software* and purporting to grant sublicensing over CC BY art, CC BY-SA game text, OFL fonts and an all-rights-reserved logo. `README.md` was right the whole time; the two had simply drifted, and the wrong one is the one that ships in the zip and that GitHub reads for the repo's licence badge. Asserts the file does not *open* as a single-licence template, that the MIT grant is present and scoped to the code, that both files name the same six regimes (README is canonical), and that every per-asset notice it delegates to still exists — a rotted pointer there is a broken licence, not a broken link |
| `npm run i18n:source` | the code **against `lang/en.json`**: a key referenced but missing (the user sees `CAIRN.Whatever`), a key nothing references (dead weight a translator is still asked to translate), and user-visible English that never reaches `game.i18n` at all. That last class is invisible to `i18n:check` by construction — an unlocalized string is identical in every language file because it is in none of them, which is how `title="Double click to change limit"` shipped as the only hint that feature existed |

### With Foundry running on :30000

Start the dev server first (see `CLAUDE.md`). These load the working tree through the
junction, so no build step is needed — except `npm run build:packs` if `src/packs/`
changed, which **fails while a world is open**, so stop the server for it.

| Command | Checks |
|---|---|
| `npm run dev:smoke` | system loads, shipped packs non-empty, a character sheet renders, zero console errors |
| `npm run dev:data-model` | the TypeDataModel schemas |
| `npm run dev:icons` | no document left on a `.png` icon; every icon 200s, is really SVG, and rasterises at full size. Its list comes from the **`icons/` directory**, not from icons in use by documents — it used to be the latter, so it checked 15 of 17 files and a newly added icon stayed invisible to it until content pointed at one |
| `npm run dev:sanitize` | that the server actually strips scripts from a system `HTMLField`. Writes a payload **as a real player** (Alice) to their own character's `system.notes` and to an owned weapon's description, and asserts both come back cleaned with their benign content intact. Needed alongside `check:fields` because the manifest declaration only takes effect at server STARTUP — an un-restarted edit is indistinguishable from no edit |
| `npm run dev:feature-xss` | the OTHER half of the sanitization threat, which `dev:sanitize` cannot reach. `htmlFields` addresses top-level schema paths, and `system.features` is an `ArrayField(ObjectField)` — the server has no schema for an ObjectField's interior, so **no manifest edit can ever make it clean what is stored there** (`check:fields` is blind for the same reason, and says so). The defence is the sink, so this asserts the sink: Alice writes a payload to a feature on her **own** character, the GM expands it, and nothing executes. Three positive controls, all load-bearing — the payload must reach storage verbatim, the panel must actually render with its benign tail intact, and the sanitized `<img>` must still 404 (which is the proof it was live in the DOM at the moment `onerror` would have fired) |
| `npm run dev:roll-npc` | that Roll NPC **asks first**. It routes an npc to `regenerateHireling`, which deletes every embedded Item and overwrites the statblock, and it used to do that on one click — harmless for a hireling, which is what it was written for, and a one-click no-undo wipe of any of the 205 shipped monsters after the Hireling→NPC fold. Asserts the dialog opens, that declining leaves the statblock *and* `_stats.modifiedTime` alone, and — the assertion that makes the other two mean anything — that accepting really does regenerate. The decline check waits **8s**, because regeneration takes ~5s and an earlier version waited 1.5s and reported the destructive behaviour absent |
| `npm run dev:forhire` | the `forHire` migration, i.e. that a hireling upgraded from 0.1.7 keeps its day rate on screen. Seeds a pre-migration actor and **reloads**, so the real `ready`-hook path runs; a fresh-world validation cannot see this class of defect by construction. Asserts the flag flips, the rate survives, the sheet renders the row again, the migration **names itself in the log** as the writer — and that a plain monster is left alone, because an over-broad migration passes every other check while putting a day-rate row on every wolf |
| `npm run dev:token-defaults` | who arrives **friendly and linked** and who does not. A hireling should behave like a character (friendly ring, `actorLink` so token HP reaches the sheet); a monster must be the opposite — and the Hireling→NPC fold made both `type: "npc"`, so `system.forHire` is the discriminator and the two cases are one keystroke apart. The monster case is the important one: widening the branch to plain `npc` fixes the hireling and quietly turns all 205 shipped monsters friendly and linked. Creates through **`CONFIG.Actor.documentClass`**, never the global `Actor` — they are not the same class, and the global skips the system's `static create` entirely, so a probe using it would pass no matter what the override said. Also asserts an explicitly-supplied disposition still wins, which is how it caught `mergeObject` being passed a **non-existent option name** |
| `npm run dev:bg-drop-guard` | that **only a player character accepts a background**. Dropping one is not an inventory add — it *changes* the background, deleting everything the old one granted — so on any other type it must be refused outright, with a warning rather than silently. Covers all four routes a background can arrive by (compendium, world item, another character's inventory, and an unlinked token's delta) across npc, hireling and container, asserts a refused transfer takes nothing from the donor, and ends on a positive control: a character must still accept one, or every refusal above is satisfied by a handler that refuses everything |
| `npm run dev:i18n-render` | that the localized surfaces come out **localized**, which neither offline check can see: a string routed through `game.i18n` still renders English if the value fed into it is a raw stored token, or if a guard compares a stored English name against a translated one. It swaps `game.i18n.translations` for a copy carrying **unique sentinels** and asserts the sentinel reaches the DOM — so every assertion is its own negative control, since the pre-fix code emitted the English literal and no sentinel matches it. Covers the ability-save label, the Critical Damage banner, the spellbook display prefix (both directions), the equipment-limit tooltip, the delete confirmation, the archetype dropdown and the shop chips |
| `npm run dev:npc-wording` | that the NPC wording **never discards a translation that exists**. `_wording()` prefers a `…Npc` variant on a non-player sheet, and resolved it with `game.i18n.has(npcKey)` — whose `fallback` parameter defaults to **true**, so it consults the English strings too. Every variant exists in `en.json`, so the test was unconditionally true in every language and the NPC sheet served English over a base key the translator had already done. An English world cannot reproduce it (`translations` holds every key), so the probe **builds** the situation: variants deleted from `translations`, sentinels on the base keys, and the variants planted in `_fallback` under a *different* sentinel — so each assertion names the path that produced it rather than merely checking "not English". Ends on a positive control: a language that *does* have the variant must still get the NPC wording |
| `npm run dev:table-results` | that **no deprecated `TableResult` member survives**, and that a row pointing at a WORLD document really resolves. Five members this system used are shims removed in **v15** — `#text`, `#documentId`, `#documentCollection`, `getChatText()` and `CONST.TABLE_RESULT_TYPES.COMPENDIUM` — and all five still *work* on the 14.365 target, so nothing was going to catch this until it broke. So the probe sets `CONFIG.compatibility.mode = FAILURE`, which makes `logCompatibilityWarning` **throw** (and throw unconditionally, ignoring the `once: true` these getters pass), scopes it to TableResult with `includePatterns`, then exercises every path that reads a table: the shop, the eight 2e trait draws, bonds, name rolls, Barebones generation, and the sheet's trait/scar pick-lists. A surviving read throws and the message names the member — so this cannot rot the way a grep would the next time someone writes `r.text`. Then it builds a table mixing a world row, a compendium row and a text row, and asserts all three land correctly. **Both halves carry their own control**, in-page: a deliberately deprecated read must throw under that config (or every green line in phase 1 is vacuous), and the OLD resolution algorithm must still drop the world row on the same table (or the bug was never reproduced) |
| `npm run dev:compendium` | the shared name→document lookup in `module/compendium.js`. **Counts** full pack loads while opening the shop, because the catalog is correct either way and the entire defect is how much work happens — a functional assertion cannot fail. Also that a missing table degrades to `undefined`/`""` instead of throwing, and that adding a *row* to a shipped table invalidates the sheet's pack cache |
| `npm run dev:icon-canvas` | the icon migration reaches scene tokens and the canvas ends correct after a reload |
| `npm run dev:enc-damage` | the damage flow, including a real canvas draw |
| `npm run dev:container-link` | container linking **as a real player** — a GM passes every ownership check, so only this catches permission bugs |
| `npm run dev:item-pile` | the container class label and Item Piles. Walks **every** shipped transport asserting its label and its art agree (they come from one classifier, so drift shows as "Horse" beside a picture of a cart), then makes a pile: class art on creation, re-arting on a type change, hand-picked art left alone, the sheet's Type control, directory visibility, and — **as Alice** — that a pile refuses a player with no rights and works once granted them |
| `npm run dev:sheet-ids` | per-window DOM ids, via a real label click |
| `npm run dev:sheet-basics` | that editing a field commits with no save button (text, number, `<select>`, `<textarea>`), that one change makes exactly one update, and that each tab shows one panel and only one |
| `npm run dev:dialogs` | the four sheet dialogs (add item, add/edit feature, regenerate confirm) — that `button.form` reaches the right fields, the content templates carry no nested `<form>`, the confirm still defaults to No, that Add Item **opens on** the right type, and that editing a feature leaves it where it was in the list |
| `npm run dev:theme` | that the sheets stay readable in **both** colour schemes: every text and border colour measured against its real backdrop, in light and dark. Light is the baseline, so it only fails on something dark breaks. `-- --shots` also writes the four screenshots |
| `npm run dev:sheet-layout` | that no two regions of a sheet grid overlap, on all four actor types. Generates **six** characters, because whether the layout fits depends on how long that background's description happens to be — one sample passes where six catch it |
| `npm run dev:notes-editor` | that the Notes editor can be **typed into** and saves, on all four actor types, plus the empty-field placeholder. It types with the keyboard and touches no button, because the regression it exists for left the editor present, upgraded, `contenteditable="true"` and holding the right value — while being 0px tall and therefore unclickable. Also covers three **item** sheets, typing into the toggled description editor and then closing the sheet — the actor loop had left every item sheet untested |
| `npm run dev:header-buttons` | the inline title-bar buttons — Roll Character, the Randomization toggle, and Pop Out: labels, state (the toggle hides Roll Character and relabels itself), that an unrelated re-render leaves them alone, that no label is clipped or escapes the header, and that ⋮ sits to their right. Pop Out is clicked **for real**: it must open a browser window, move the sheet into it, hide itself, and come back on re-dock — the settle time varies 1–2.5s, so every wait polls the condition rather than sleeping |
| `npm run dev:ui-parity` | the character sheet's stat-block **geometry** and computed styles — counter alignment and spacing, corner radii, button chrome measured against a reference button, that the custom checkboxes draw **one** box (core draws its checkbox with pseudo-elements, which `appearance: none` does not remove, so its glyph renders inside ours), the Cairn badge, the container market link, the settings sheet's positional grouping, and a sweep for untranslated `CAIRN.*` keys on every tab of a 2e *and* a Barebones character |
| `npm run dev:parity` | the failed-career field (re-roll, live setting) and the Barebones omens gate |
| `npm run dev:grant-hint` | the grant-source tags footer hint follows its setting |
| `npm run dev:portrait-folder` | the custom-portrait setting takes effect with no reload |
| `npm run dev:directory-buttons` | the Actor Directory buttons, docked **and** popped out |
| `npm run dev:warden-rename` | the GM rename cycle across page reloads |
| `npm run dev:content-overlay` | the content-translation overlay — chat cards, marketplace headings, and the background picker. **Polls** for the picker rather than sleeping at it: it waited a flat 700ms, `promptBackground` grew to ~1.1s before it renders anything, and the miss was swallowed by an optional-chained `?.click()`, so the dialog was never dismissed and the probe HUNG instead of failing. Opens on a `picker rendered` assertion for that reason — a probe that reads an element that is not there yet reports every field as `undefined`, which is indistinguishable from a translation bug |
| `npm run check:warden` | Warden-facing settings |
| `npm run dev:kw-traits` | Kettlewright import — traits and age |
| `npm run dev:kw-reroll` | Kettlewright import — re-rollable grants |
| `npm run dev:kw-guards` | Kettlewright import — refusals and guards |
| `npm run dev:site` | the landing page renders from `file://` with no broken images |
| `npm run dev:gear` | that **every gear name any grant path can hand a character resolves to a real pool item** — starting gear, choice-table options, bond payloads, hireling loadouts, harvested from the shipped packs in the running world. `tools/import/README.md` names this as the *only* protection the hand-maintained gear pool has, in place of an importer |
| `npm run dev:phase2` | that a generated character's gear is a live **copy of the editable pool item** — edit the pool, regenerate, see the change |
| `npm run dev:marketplace` | the shop is a **reference catalog** over that same pool, plus the buy/take flows |
| `npm run dev:transports` | transports are editable documents the shop references; buying mints a keeper-linked container Actor; the worn/mount slot distinction |
| `npm run dev:barebones` | Barebones generation follows the SRD procedure **and** goes through the same editable pool 2e uses |
| `npm run dev:hireling` | a generated hireling matches its book statblock exactly, and its gear is a live copy of the pool rather than a second inlined loadout |
| `npm run dev:portrait` | generation assigns a shipped portrait **and its paired token**, a regenerate disturbs neither, and the picker's swap keeps the two in step |
| `npm run dev:settings` | that the settings are **reachable by a Warden** — a namespace naming no installed package renders them under "Unmapped": present in the data, invisible in the UI. Every other probe passes while that is broken |
| `npm run dev:age-override` | the minimum-age floor binds in generation **and** in the sheet re-roll |
| `npm run dev:bg-picker` | the background picker across both editions, and that the swap is surgical |
| `npm run dev:content-sources` | that the content-source toggles govern **generation**, not just the picker. Creates a real custom background in a world pack and walks all four toggle combinations, asserting *which background the generated character came out with* — because asserting pool size passes in 3 of 4 cases whichever code is in place, and asserting "a character appeared" passes in all 4. Also that homebrew-only with nothing authored yet does **not** quietly refill from the shipped pack |
| `npm run dev:bg-containers` | background-granted beasts and vehicles — minted as container Actors, replaced on regenerate, and a player's own container left alone |
| `npm run dev:bg-author` | the custom-background authoring sheet: array edits persist, drag-to-snapshot, and generation resolves a snapshot in no canonical pack |
| `npm run dev:bg-tools` | "Test ×10" preview/linter and "Duplicate into my backgrounds" |
| `npm run dev:kw-import` | the Kettlewright importer end to end, through the real options dialog and file chooser |
| `npm run dev:kw-import-data` | the same importer at the data level — field mapping without the UI |
| `npm run dev:directory-ui` | the Actor Directory's generate-character icon and grayscale container thumbnails |
| `npm run check:item-usage` | (offline) which pool items are actually referenced by a consumer, and which are orphans |

Not tests, but useful: `dev:actors` and `dev:players` create fixtures, `unpause.mjs`
unpauses a world.

### The 18 orphans

Everything from `dev:gear` down was written, worked, and then **had no npm script**, so
none of it was in this document and none of it ran. Swept 2026-07-29. What eighteen unrun
probes were holding:

- **One real content defect.** `dev:gear` was red: `Hawk` and `Robes` — gear for Cairn 2e's
  Animal Handler and Scholar hirelings — resolved to nothing, so both generated a piece
  short. The pool has no importer *by design*; this probe is the invariant that replaces
  one, and it was not wired.
- **Four probes rotted by the ApplicationV2 port**, each failing in a way that reads as
  "no result" rather than "error". Handlers are now private statics reachable only through
  the `actions` map, so a probe must **click the element carrying the `data-action`** the
  way a user does — `sheet._onRollAge(...)` and friends no longer exist.
- **Two probes asserting a skin that was deliberately reverted.** `f00e72c` moved every
  non-sheet surface back to Foundry's own colours so they would be theme-aware. Asserting
  Alegreya on a chat card asserts a bug. Deleted one, trimmed the other, and wrote *why*
  into its header so nobody restores them.
- **One probe hanging the renderer.** A bare `generateCharacter()` falls through to
  `promptContentSource()`, a `DialogV2.wait()` that blocks for a human. Inside
  `page.evaluate` that never returns and Playwright eventually reports **"Target crashed"** —
  naming neither the dialog nor the wait. Pass the source explicitly.

Two traps worth carrying forward:

- **`el?.[0] ?? el` is wrong on ApplicationV2, and fails silently.** The compat idiom for
  "jQuery or HTMLElement" must be `el instanceof HTMLElement ? el : el?.[0]`. An AppV2 sheet
  root is a `<form>`, and **`HTMLFormElement` is indexed by its own controls** — so `el[0]`
  is not `undefined`, it is the first `<input>`. The reversed order hands back an input
  whose `querySelector` matches nothing, and every DOM assertion reads false with no error.
- **A probe that changes the world must restore it from NODE, not from inside
  `page.evaluate`.** `age-override-probe` set `min-age` to 99 to test the age floor and
  threw on the next line; its restore sat after the throw, inside the same evaluate, and
  never ran. The dev world kept a floor of 99, so **every character generated afterwards
  was aged 99 and the age re-roll looked broken** — it was flooring to 99 too, so the value
  never appeared to change. It surfaced hours later as a bug report against the system.
  An exception inside `page.evaluate` propagates into Node, so a Node-level `finally` runs
  where an in-page one is skipped: use `withSettings(page, fn)` from `lib.mjs`, which
  snapshots every world setting, restores whatever drifted, and prints what it put back.
  **Still unguarded** (top-level scripts, no enclosing try): `e2e-dialogs`,
  `e2e-directory-buttons`, `e2e-portrait-folder`, `probe-bg-tools`.
- **A probe can pass having exercised nothing.** `age-override` asserted the re-rolled age
  obeyed a floor of 99 — but generation obeys the same floor, so had the click done nothing
  the assertion would still have been true. It now asserts the control *exists* first. When
  a probe's precondition and its assertion share a cause, green means nothing.

---

## After publishing

Full procedure in `RELEASE.md` and the `/release` skill. In summary:

1. Install the **published** zip from the manifest URL into the `:30001` environment —
   not a local build. The point is to test what a user downloads.
2. Create a fresh world, boot it, and run `FOUNDRY_URL=http://localhost:30001 npm run dev:smoke`.
3. **Always** `npm run dev:players`. A test world must never be left GM-only, and
   ownership behaviour is only exercised with real player accounts.
4. Unpause.

### If the release carries a migration

Any `Hooks.once("ready")` migration, any change to shipped image paths, any pack rename.
A fresh world has no legacy documents, so it cannot exercise a migration at all — install
the **previous** version first, seed real content (characters with inventories, an NPC, a
container, a world item, an **unlinked scene token** — five distinct branches), then
install the new build over it and boot the same world.

Add a branch to that list for whatever the release's own migration touches. For the
`forHire` one, that is **a hireling with a day rate** — `npm run dev:forhire` covers it on
`:30000`, but the seeded upgrade world should carry one too, because that is the document
whose sheet quietly loses a row.

**A new field whose default contradicts what existing documents should have needs a
migration.** Adding it to the schema is not enough, and this pass is the only one that can
tell the difference.

**Count live documents, do not trust file size.** LevelDB keeps deleted records until
compaction, so an 80 KB `actors.db` can mean zero actors — and a run against that world
passes while exercising nothing.

---

## Reading the results

**A probe that fails once and passes on re-run is a race, not a flake.** Do not re-run
and call it green. Find out what the first run raced against.

**And the rule runs in both directions: a probe reporting NOTHING HAPPENED is making the
same kind of claim, and deserves the same suspicion.** Both probes written for the
2026-07-30 review returned a clean negative on their first run, and both negatives were
artifacts of the probe — one waited 1.5s for a 5s operation, the other hand-built a
document without the `id` its lookup keys on, so the code under test bailed before
reaching the line being tested. Taken at face value either would have killed a real
defect, one of them a live player→GM XSS.

So: **a negative result from a probe you just wrote is evidence about the probe until you
have shown it can go positive.** Give every negative assertion a positive control in the
same run — `dev:sanitize`'s benign tail and `dev:roll-npc`'s accept-path are exactly this,
and they are why neither can be fooled by "the write never landed".

**A precondition a previous run left behind is not a precondition.** `dev:dialogs` set
`show-containers-tab`, slept 1s and clicked the tab — but that setting is registered
`requiresReload: true`, so it never appears on an already-open sheet. It only ever worked
because an earlier run had left the setting on; the first run against a world where it was
off timed out, and every run after that passed. When a probe changes a setting, either
reload or check how that setting is registered. (Found 2026-07-29 by the "failed once,
passed on re-run" rule below.)

**Two derived artifacts compared to each other cannot show a defect in what they
were derived from.** `i18n:check` compares `es.json` to `en.json`, which makes it
structurally blind to a string that was never localized at all — such a string is
identical in both files because it is in neither. That is how a hardcoded
`title="Double click to change limit"` shipped as the only hint its feature existed.
`i18n:source` closes it by comparing the **code** to `en.json`, and `dev:i18n-render`
closes the runtime half. The shape generalises: whenever a gate diffs two outputs of
the same pipeline, ask what a defect in the pipeline itself would look like to it.

**A probe with no `npm` script is a probe nobody runs — and it rots silently.**
`spellbook-prefix-probe.mjs` had none, and had decayed to selecting
`actor.sheet.element?.[0]`, an ApplicationV1 idiom that returns `undefined` on an
AppV2 sheet; every assertion read `null`. Its unique assertion was folded into
`dev:i18n-render` and the file deleted. **18 more probes under `tools/dev/` still
have no script** (`npm run` them by path to see which still work) — assume each has
rotted until it is run.

**A test that cannot fail is worse than none** — it reports success. When adding one,
confirm it fails with its fix removed. `dev:icon-canvas` is the pattern: it plants a
document holding the *old* state and watches it get rewritten, because asserting "nothing
is in the old state" passes trivially on an already-migrated world.

**…and prove that INSIDE the run, not by editing source and running again.** Stubbing the
fix in `module/`, relaunching, then restoring costs a browser launch per direction and
leaves the stub in the working tree if anything kills the run mid-flight. Both happened on
2026-07-29: ~11 minutes across two runs, one of which died to a hang and left
`if (true) return;` in `module/cairn.js`. In-page fault injection does the same job in
**seconds**, in the run you were making anyway:

| the fix is | switch it off with |
| --- | --- |
| a hook | `Hooks.off` — `Hooks.events` is a public `{hook, id, fn}` registry; `lib.mjs` `withHookOff(page, hook, fnName, fn)` wraps it, restoring in a Node-level `finally`. Register the handler as a **named** function expression so the probe can find it |
| a document override (`_preUpdate`, `prepareData`) | reassign the prototype method to the base class's for the duration |
| a CSS rule | walk `document.styleSheets`, blank the property, put it back |
| a translated string | `dev:i18n-render`'s trick — swap `game.i18n.translations` for a copy carrying unique **sentinels**, so a pre-fix code path emitting the English literal cannot match. Every assertion becomes its own negative control and no second run exists at all |

`dev:spellscroll` shows the shape: it asserts the Create-Item dialog offers "Spellscroll",
then switches the hook off, asserts the option is **gone**, and switches it back — 5.2s
inside an 80s run, versus 11 minutes and a dirty tree.

**A hang is the worst failure mode, and dialogs are how you get one.** `DialogV2` is modal
and its promise settles only on a button press, so a probe path that returns without
pressing anything waits forever: it burns the whole harness timeout and reports nothing.
Cancelling is not the escape either — a cancelled `DialogV2.prompt` *rejects*, so an
uncaught `await` throws past the assertions. Press a button on **every** path, `.catch()`
the promise, and call `lib.mjs` `watchdog(ms, label)` after launching the browser so any
future hang dies with a message instead of a timeout.

**When the defect is how much WORK happens, count it — an assertion on the output cannot
fail.** `findCompendiumItem` loaded a whole pack per lookup, so opening the shop did 78
full pack loads to resolve 77 items. The catalog was correct before and after; there was
no wrong value to assert on. `dev:compendium` instruments the call and discriminates on
the query (empty = a full pack load, `{_id}` = the cheap single fetch), which fails at 78
and passes at 1. The same shape fits any fix whose whole effect is cost: round-trips,
renders, listeners, document writes.

**Expect noise, not failures, from software rendering.** Headless Chromium here has no
GPU; the canvas runs on SwiftShader at roughly 3–4 FPS. `dev:smoke` filters Foundry's
hardware-acceleration warning and the viewport warning. Canvas probes are slow rather
than broken — `dev:icon-canvas` uses a known-good control token precisely so a rendering
hiccup reports as *inconclusive* rather than as a defect.

**`npm run lint` rewrites files.** It has `--fix` baked in, so it mutates `module/`
in place rather than reporting. Do not run it casually mid-change.
