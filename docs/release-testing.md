# Release testing

The single list of what to run, and when. `RELEASE.md` is the release *procedure*; this
is the *testing*.

**Keep this file in step with `package.json`.** Adding a probe without adding it here
means it runs only when someone remembers it. That is not hypothetical: before this file
existed, 21 test scripts were spread across three partial lists — `CLAUDE.md` named 4,
`RELEASE.md` named 4, the release skill named 7, and no list was complete.

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
| `npm run check:fields` | pack documents match the data model |
| `npm run check:traits` | the trait-sentence parser |
| `npm run i18n:check` | translation coverage, placeholder/HTML mismatches, stale keys |

### With Foundry running on :30000

Start the dev server first (see `CLAUDE.md`). These load the working tree through the
junction, so no build step is needed — except `npm run build:packs` if `src/packs/`
changed, which **fails while a world is open**, so stop the server for it.

| Command | Checks |
|---|---|
| `npm run dev:smoke` | system loads, shipped packs non-empty, a character sheet renders, zero console errors |
| `npm run dev:data-model` | the TypeDataModel schemas |
| `npm run dev:icons` | no document left on a `.png` icon; every icon 200s, is really SVG, and rasterises at full size |
| `npm run dev:icon-canvas` | the icon migration reaches scene tokens and the canvas ends correct after a reload |
| `npm run dev:enc-damage` | the damage flow, including a real canvas draw |
| `npm run dev:container-link` | container linking **as a real player** — a GM passes every ownership check, so only this catches permission bugs |
| `npm run dev:sheet-ids` | per-window DOM ids, via a real label click |
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

**A test that cannot fail is worse than none** — it reports success. When adding one,
confirm it fails with its fix removed. `dev:icon-canvas` is the pattern: it plants a
document holding the *old* state and watches it get rewritten, because asserting "nothing
is in the old state" passes trivially on an already-migrated world.

**Expect noise, not failures, from software rendering.** Headless Chromium here has no
GPU; the canvas runs on SwiftShader at roughly 3–4 FPS. `dev:smoke` filters Foundry's
hardware-acceleration warning and the viewport warning. Canvas probes are slow rather
than broken — `dev:icon-canvas` uses a known-good control token precisely so a rendering
hiccup reports as *inconclusive* rather than as a defect.

**`npm run lint` rewrites files.** It has `--fix` baked in, so it mutates `module/`
in place rather than reporting. Do not run it casually mid-change.
