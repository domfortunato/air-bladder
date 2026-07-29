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
| `npm run check:refs` | every compendium reference in every shipped table resolves, and resolves to a document with the *right name* |
| `npm run check:fields` | pack documents match the data model, **and `system.json` `documentTypes.*.htmlFields` matches the `HTMLField`s in the schemas, both directions**. That second half is a security check, not tidiness: the Foundry server never loads the data models, so an `HTMLField` missing from the manifest is never sanitized — see `dev:sanitize` |
| `npm run check:traits` | the trait-sentence parser |
| `npm run i18n:check` | translation coverage, placeholder/HTML mismatches, stale keys — language files **against each other** |
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
| `npm run dev:i18n-render` | that the localized surfaces come out **localized**, which neither offline check can see: a string routed through `game.i18n` still renders English if the value fed into it is a raw stored token, or if a guard compares a stored English name against a translated one. It swaps `game.i18n.translations` for a copy carrying **unique sentinels** and asserts the sentinel reaches the DOM — so every assertion is its own negative control, since the pre-fix code emitted the English literal and no sentinel matches it. Covers the ability-save label, the Critical Damage banner, the spellbook display prefix (both directions), the equipment-limit tooltip, the delete confirmation, the archetype dropdown and the shop chips |
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
| `npm run dev:content-overlay` | the content-translation overlay |
| `npm run check:warden` | Warden-facing settings |
| `npm run dev:kw-traits` | Kettlewright import — traits and age |
| `npm run dev:kw-reroll` | Kettlewright import — re-rollable grants |
| `npm run dev:kw-guards` | Kettlewright import — refusals and guards |
| `npm run dev:site` | the landing page renders from `file://` with no broken images |

Not tests, but useful: `dev:actors` and `dev:players` create fixtures, `unpause.mjs`
unpauses a world.

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

**Count live documents, do not trust file size.** LevelDB keeps deleted records until
compaction, so an 80 KB `actors.db` can mean zero actors — and a run against that world
passes while exercising nothing.

---

## Reading the results

**A probe that fails once and passes on re-run is a race, not a flake.** Do not re-run
and call it green. Find out what the first run raced against.

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
