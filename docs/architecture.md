# How Air Bladder is put together

A map of the code, for anyone who needs to see the shape of the system before
touching it — a contributor sizing up a change, a reviewer deciding whether a
claim is plausible, or the maintainer working through it a piece at a time.

It is a map, not a specification. It says where things are, which parts depend
on which, and which parts are genuinely hard. It does not restate what the code
says; the code and its comments do that at length.

Two companion documents: [`provenance.md`](provenance.md) records who authored
what, and [`release-testing.md`](release-testing.md) lists every automated check
and when to run it. `CLAUDE.md` in the repository root is the working notes —
candid, dated, and argumentative, and the best record of *why* anything is the
way it is.

**This document names files and functions, not line numbers.** A line number in
prose is a copy that goes stale on the next commit, and a guide that sends you
to the wrong line is worse than one that sends you to the right file. Function
names here are greppable and stable. When you want a line, ask the repository:

```
git grep -n "_prepareContext" -- module/
```

---

## The one-paragraph version

`system.json` names exactly one JavaScript file, `module/cairn.js`. Everything
that runs in the browser is reachable from that file's imports; nothing else in
the repository executes at all. It imports 26 of the system's 36 JavaScript
files, registers the document classes, sheets and settings, subscribes about
nineteen Foundry hooks and one socket channel, and then gets out of the way.
Play happens inside two document classes, two sheet classes, a combat tracker,
and a set of feature files that mostly do not know about each other.

---

## How big it actually is

| | |
|---|---|
| `module/`, physical lines | **30,840** |
| `module/`, code lines | **~13,100** |
| Comment and blank share | **~57%** |
| JavaScript files | 36 |
| Handlebars templates | 21 files, 3,144 lines |
| Stylesheet | 1 file, 4,454 lines |
| Compendium source documents | 1,355 YAML files across 30 packs |
| Interface translations | 7 languages, plus 1 content overlay |
| Development tooling | ~59,800 lines, none of it shipped to a browser |

**Do not size a job here with `wc -l`.** More than half of `module/` is prose.
`connections.js` is 237 physical lines of which 67 are code; `compendium.js` is
188 of which 54; `art-picker.js` is 603 of which 159. The ratio is not uniform,
either, so scaling a page count by half is also wrong.

The code figure counts non-blank lines outside comments, with quotes and
template literals handled so that a `//` inside a string is not mistaken for a
comment. Different tools will give slightly different answers. The ratio is the
point, not the third digit.

---

## The boot, in four moments

Foundry loads a system by reading its manifest and then firing a fixed sequence
of hooks. Air Bladder does something at each of them, and *which* moment a thing
happens in is load-bearing more often than it looks.

**The manifest.** `system.json` declares one entry point (`module/cairn.js`),
one stylesheet, 30 compendium packs, a socket channel, and the document subtypes
— three for Actor (`character`, `npc`, `hireling`) and seven for Item. It also
declares each subtype's `htmlFields`, which is a security control rather than
metadata: the Foundry *server* never loads the data models, so a rich-text field
missing from the manifest is never sanitized. `npm run check:fields` holds the
manifest and the models in step.

**`init`** — before any world data exists. Everything structural happens here:
the document classes and their data models are attached to `CONFIG`, the sheets
are registered, the settings are registered, the Handlebars helpers are
installed, and the socket listener is attached. Nothing may read a document at
`init`, because there are none yet.

**`setup`** — settings are readable, no interface has rendered. Exactly one
thing uses this window, and it needs it: when the "Warden" title is switched on,
the localized Game Master role labels are overwritten before any panel that
reads them draws.

**`ready`** — the world is loaded and the interface exists. This is where the
world migrations run, where the clock is attached to the interface, and where
anything that has to read or write a document lives. Several `ready` callbacks
are guarded to the *active* GM alone, so that a table with two Wardens does not
run a migration twice.

Two traps recorded in the code and worth carrying into any new work:

- **Hook callbacks are never awaited.** Foundry calls them inside a synchronous
  try/catch, so registration order is not execution order past the first
  `await`. Where one `ready` callback must observe another's result, the code
  shares a promise between them rather than relying on order.
- **A world setting reaches other clients only through its own `onChange`.**
  Writing a setting on one client does not notify the others by itself.

---

## The import graph, in tiers

Sorting the 36 files by the longest chain of internal imports beneath each one
gives this. Tier says **how much has to exist before a file can load** — not how
complicated it is. `art-picker.js` sits at tier 7 and is 159 lines of code.

| Tier | Files |
|---|---|
| **0** — no internal imports at all | `compendium.js`, `config.js`, `damage.js`, `i18n-content.js`, `icons.js`, `settings-menus.js` |
| **1** | `settings.js`, `data-models.js`, `combat.js`, `faction-generator.js`, `spell-tables.js` |
| **2** | `utils.js`, `game-time.js`, `connections.js` |
| **3** | `glog.js`, `macros.js`, `marketplace.js`, `warden-damage.js`, `calendar-events.js` |
| **4** | `gear.js`, `item/item.js`, `vald-calendar.js`, `weather-log.js` |
| **5** | `actor/actor.js`, `grimoire.js`, `item-offer.js`, `watch-clock.js`, `warden-dashboard.js` |
| **6** | `character-generator.js` |
| **7** | `monster-generator.js`, `kettlewright-import.js`, `encounters.js`, `art-picker.js` |
| **8** | `actor/actor-sheet.js`, `item/item-sheet.js` |
| **9** | `cairn.js` |

The other measure worth having is the reverse one — how many files import each
file. It identifies the shared vocabulary, which is the part you cannot avoid
learning:

| Imported by | File | What it is |
|---|---|---|
| 19 | `i18n-content.js` | the content-translation overlay; every displayed name goes through it |
| 16 | `settings.js` | every behavioural switch |
| 11 | `utils.js` | dice formulas, damage helpers, drag-and-drop plumbing |
| 8 | `compendium.js` | every lookup into a compendium pack |
| 8 | `icons.js` | the class-art table |
| 7 | `character-generator.js` | also called from four other features |
| 6 | `game-time.js` | watches and the calendar |
| 6 | `item/item.js` | the Item document class |

Two files are imported by nothing: `cairn.js`, because it is the entry point,
and `weather-log.js`, which `cairn.js` reaches through a dynamic `import()` so
that a player's client never fetches it.

---

## The spine

Six things carry roughly half the logic, and nothing routes around them.

1. **`module/cairn.js` — the boot and the switchboard.** Registration, about
   nineteen hook subscriptions, the socket handler, and seven one-shot world
   migrations. It is the third-largest file in the system, and it is really
   four unrelated jobs sharing an address.

2. **`module/settings.js` — the switches.** 38 setting registrations, grouped
   into four submenus by one declaration (`SETTING_GROUPS`) that both the
   registration code and the tests read. Sixteen files import it. If a
   behaviour has an "unless the Warden turned it off" clause, it is here.

3. **`module/data-models.js` — what a document *is*.** Nine schema classes over
   a shared base, built from seventeen small field factories (`str`, `int`,
   `bool`, `vitals`, `capacity`…). Two-thirds of the file is prose explaining
   the choices. This replaced Foundry's older `template.json`, which is gone.

4. **`module/actor/actor.js` — the Actor lifecycle.** Creation defaults,
   derived data, the rename that follows an actor onto its placed tokens, and
   the role switchboard that replaces Foundry's Create Actor dialog. This is
   where Foundry's document model has to be understood properly rather than
   worked around.

5. **`module/actor/actor-sheet.js` — the character sheet.** 2,216 code lines,
   about 17% of all the logic in the system, in one class. It is the largest
   single thing to learn and the one most changes touch.

6. **`module/i18n-content.js` and `module/compendium.js` — content in and out.**
   Every compendium lookup goes through one; every user-visible *content* name
   goes through the other. Between them they are imported by more files than
   anything else, and both are small. `compendium.js` is 54 lines of code with
   no classes, no interface and no state, which makes it the best first real
   file in the repository.

---

## The leaf features

Fourteen files are imported only by the boot file or by a sheet, which means
**no other feature depends on them**. Each can be read, understood and changed
on its own once the spine is familiar:

`art-picker.js` · `combat.js` · `encounters.js` · `faction-generator.js` ·
`grimoire.js` · `item-offer.js` · `kettlewright-import.js` · `macros.js` ·
`marketplace.js` · `monster-generator.js` · `spell-tables.js` ·
`warden-dashboard.js` · `watch-clock.js` · `weather-log.js`

Three more form a small cluster of their own around timekeeping —
`vald-calendar.js`, `calendar-events.js` and `warden-damage.js` are imported by
the dashboard and the clock as well as by the boot file — and
`settings-menus.js` is a leaf of `settings.js` rather than of the system.

This is the practical consequence: **a change to a leaf feature cannot break
another feature except through the spine**. That is worth checking before
estimating the blast radius of any change.

---

## Long is not the same as hard

Several of the biggest files are repetitive rather than complex, and reading
them line by line wastes days.

- **`settings.js`** is 38 near-identical registration calls. Read two of them
  and you have read the file; the interesting part is `SETTING_GROUPS` at the
  top and the menu registration at the bottom.
- **`data-models.js`** is nine schemas assembled from the same handful of field
  factories, and two-thirds prose.
- **`config.js` and `icons.js`** are lookup tables with no logic at all.
- **Declarative blocks inside otherwise-logical files** should be skimmed, not
  studied: `PANELS` in `warden-dashboard.js` is a 147-line table declaring
  most of the dashboard's 45 buttons, and `VALD_CALENDAR_CONFIG` in
  `game-time.js` is a calendar written out as data.

The inverse also holds. `item-offer.js` is only 463 code lines and is one of
the hardest things here.

---

## The five places where "explain it" is a real test

1. **`_prepareContext` in `actor/actor-sheet.js`** — the sheet's whole context
   object, over 400 lines, re-run on *every* committed keystroke because
   `submitOnChange` is on. That is why the pack-document cache exists near the
   top of the same file: without it, every keystroke would re-read compendium
   packs.

2. **`#fillPrintPage` in `actor/actor-sheet.js`** — about 350 lines that open a
   browser window and write a whole document into it. Self-contained, and
   unlike anything else in the system.

3. **The socket handler and the migrations in `cairn.js`** — one 348-line
   listener that dispatches every cross-client message, and seven one-shot
   world migrations (`migrateIconsToSvg`, `migrateArtPaths`,
   `migrateScrollsToSpellbooks`, `migrateNpcRoles`, `migrateHirelingSplit`,
   `migrateMountToCompanion`, `migrateGrimoirePages`). The migrations have the
   highest consequence per line in the repository: they rewrite documents in
   somebody's world, once, with no undo.

4. **The document lifecycle in `actor/actor.js`** — in particular the rename
   that propagates to placed tokens. An unlinked token's rename travels through
   a request rewrite inside Foundry's own backend, so the obvious hook for it
   never fires. Understanding *why* is understanding Foundry's document model.

5. **`_decomposeTimeYears` in `game-time.js`** — 49 lines that reimplement
   Foundry's leap-year arithmetic in order to fix a bug in the shipped client.
   Its correctness argument is a round-trip property test over 2,000 dates, not
   a reading of the code. The hardest pure logic here.

Add `item-offer.js` to that list. It is a two-client protocol with a
single-writer state machine, and it has the lowest comment ratio of the large
files. Its automated probe also has a recorded intermittent failure that was
investigated, left unattributed, and written down rather than papered over —
the header of `tools/dev/e2e-item-offer.mjs` records what was tried and what
each attempt did.

---

## What is not hand-written logic

Worth knowing before anyone counts lines and draws a conclusion.

- **Five JSON manifests live inside `module/`** and look like source: the
  game-icons manifest alone is 2,471 lines. All five are generated by
  `tools/import/` and fetched at runtime. Together, 3,584 lines.
- **Everything under `src/packs/` and `packs/`** is game content — 1,355 YAML
  documents compiled into 30 compendium packs.
- **`lang/`** is translation data.
- **`art/` and `icons/`** are images: roughly 2,900 gallery images plus 25
  interface icons. Provenance for every set is in
  [`provenance.md`](provenance.md).
- **`tools/`** never reaches a browser. It holds 108 automated probes, 26
  importer scripts, and the translation tooling — around 59,800 lines, more
  than the system itself. [`release-testing.md`](release-testing.md) lists what
  each probe covers.

---

## How to read this repository's comments

Fifty-seven per cent of `module/` is prose, and it is not written in the usual
way. It is a running argument the project has had with itself, with dates, and
much of it is **history rather than specification**: "this was true for a day
and was reversed", "this comment claimed the opposite of the line beneath it for
months".

So read in this order: **the code, then the comment, then check the comment
against the code.** A correct-sounding comment sitting on contradicting code
reads as verification, which is exactly how such disagreements survive review.
There is at least one recorded case here of a stale comment naming a mechanism
that had been deleted a month earlier.

The same applies to `CLAUDE.md`, which is 85 KB of the same material and has
carried stale claims for weeks at a time. Both are valuable precisely because
they record reversals, but neither is authoritative about the current state. The
code is.

Where a comment cites Foundry itself, the order of authority is fixed: **the
shipped client outranks the documentation.** Only the client states deprecation
and removal versions. The published API pages carry no version boundaries at
all, and Foundry's GitHub repository is an issue tracker with no source in it.

---

## Where to start

Not file order, and deliberately not size order:

1. `system.json` and the `init` hook in `cairn.js` — what a system *is*.
2. `compendium.js` — no classes, no interface, no state.
3. `settings.js` — read two registrations, then `SETTING_GROUPS`.
4. `data-models.js` — what a character and an item are made of.
5. `item/item-sheet.js` — a small sheet is a gentler introduction to Foundry's
   object model than the document lifecycle is.
6. `item/item.js` and `actor/actor.js` — the documents themselves.
7. `damage.js` and `gear.js` — the rules in play.
8. `actor/actor-sheet.js` — the big one, last of the spine.

Then the leaf features in any order, and the migrations in `cairn.js` last,
because they are the highest consequence per line.

One thing worth reading early for its own sake: the two guard wrappers near the
top of `actor-sheet.js`, `mayRandomize` and `owned`. Each takes a function and
returns a wrapped one, and between them they are applied about seventy-five
times in the file, forty-nine of those in a single action table just below.
They are ordinary functions rather than arrow functions, deliberately, because
the wrapped call needs Foundry's `this`. That one pattern explains a large
amount of the file.

---

## Keeping this document honest

Every count here was measured on the working tree, not estimated, and every
function named was opened. Counts drift; the structural claims drift more
slowly. If you are relying on a number, re-measure it — the commands are short
enough that no number here is worth trusting over the repository.

What should be corrected rather than tolerated: a named function that no longer
exists, a file listed as a leaf that something else has started importing, or a
tier that a new import has moved. Those are the claims that mislead.
