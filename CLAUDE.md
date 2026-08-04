# Air Bladder — a Cairn 2e game system for Foundry VTT

**Tracked, and this repo is public** — so read it as candid working notes, not as
documentation. It records deliberate deviations, things that turned out wrong, and
what each mistake cost, because that is what stops the same ground being re-argued.
Anything a *user* needs belongs in `README.md`; anything a contributor needs to
follow a process belongs in `docs/` or `CONTRIBUTING.md`.

It was untracked until 2026-07-29, on the reasoning that candid notes should not be
published. Tracking it wins on two counts: it was backed up nowhere, and a
contributor could not see the decisions their PR would run into.

A Foundry VTT **game system** (not a module) implementing Cairn 2e, an OSR TTRPG
by Yochai Gal. Published at `domfortunato/air-bladder`, installed from the release
manifest. Descends architecturally from a private fork of
`yochaigal/Cairn-FoundryVTT` (still on this machine at
`c:\Users\domin\code\Cairn-FoundryVTT`), but is an independent system with its own
`id`, content and history — **not** a fork in git terms.

## Version reality

- **Deploy target is Foundry 14.365.** `system.json` declares
  `compatibility: {minimum: "14", verified: "14"}`. Raised from 13 on 2026-07-29:
  the AppV2 sheets use `_getFrameButtons`, `_canDetach` and `_onDetach`/`_onAttach`,
  all confirmed against the shipped 14.365 client and none of them verifiable on
  v13 from this machine. A minimum nobody has ever tested is a claim, not a fact.
- Latest release **0.1.9** (2026-08-03). `system.json`'s `version` is rewritten by
  CI from the git tag; don't trust the checked-in value.
- Node 24.x. `npm run release X.Y.Z` is the whole release — see `RELEASE.md`.

## Git: two branches, one direction

**`master` is the released state. `dev` is everything in progress.** All work —
features, fixes, docs, typos — goes on `dev`. `master` only ever receives a merge
from `dev` plus the release commit. `dev` is permanent: never renamed, never
deleted. Full model in `docs/git-flow.md`; contributor-facing summary in
`CONTRIBUTING.md`.

- **No hotfixes, by policy.** A released version is never patched; fixes ride the
  next release. That deletes this model's classic failure — a fix on `master` that
  never gets merged back.
- **Topic branches off `dev`** are for work that outlasts the release cadence *and*
  is broken in the middle — otherwise it holds every release hostage. Lowercase-kebab,
  merge `dev` in regularly, merge back at each releasable milestone, delete when done.
  Note CodeQL does not scan them.
- **Merge `master` into `dev` after every release.** The release commit bumps
  `system.json` on `master` only, so `dev` is behind by that line every time and the
  next merge conflicts on it. This is the only master→dev sync there is.
- **`npm run release` refuses to run off `master`** and prints the commits it is
  about to ship.
- **CodeQL scans `dev`** (`codeql-analysis.yml` triggers on both branches), so
  findings arrive while the code is still unreleased. *Pages* is master-only, so a
  site change on `dev` has no preview until the merge. To see what is queued:
  `/compare/master...dev`.
- **Never tag or release on GitHub.** `origin` (Gitea) push-mirrors to GitHub and
  force-syncs, so a GitHub-only ref is pruned and its release silently becomes a
  draft. Tag on `origin`. Same reason PRs are merged locally, never with GitHub's
  button — see `docs/i18n-maintainer.md`.
- Why bother: docs and the website track `master` while users install the tag, so
  work on `master` would publish documentation for features nobody can install. And
  `dev` mirrors to GitHub in seconds, so people can clone it and test unreleased
  code.

## Architecture

Entry point `module/cairn.js`, registering document classes and sheets on `init`.
~7,500 lines of JS across `module/`; everything else is content.

- `CairnActor` (`module/actor/actor.js`) — types `character`, `npc`, `hireling`.
  `hireling` is an ALIAS of npc (same model, same sheet), kept because a type is
  immutable and retiring it would recreate every hireling with a new id. **It is
  HIDDEN from the Create Actor dialog since 2026-08-01** (`abHideHirelingType`, the
  inverse of the spellscroll hook) — a registered subtype is always offered, and
  the `container` type proved what happens when a retired one stays on the menu.
  The matching `hireling` ROLE is gone the same day: being for hire is a
  `forHire` boolean beside the day rate it gates, so `NPC_ROLES` is five entries
  and `migrateData` converts every stored "hireling" on read.
  **`container` was a fourth type and is GONE (2026-07-31)** — a container is an
  npc with `role: container`, and leaving the retired model registered meant the
  Create Actor dialog went on offering it (Foundry lists every registered
  subtype; there is no manifest flag to hide one), so a Warden could still mint a
  document against it, with the retired sheet and no Connections tab
- `CairnItem` (`module/item/item.js`) — types `item`, `weapon`, `armor`,
  `spellbook`, `object`, `background`, `transport`
- `module/actor/actor-sheet.js` is the largest file
- `module/damage.js` holds Cairn's damage flow
- Data models in `module/data-models.js` (TypeDataModel; `template.json` is gone,
  sub-types are declared in `system.json` `documentTypes`); 22 compendium packs
- 20 GM-visible settings in `module/settings.js` (23 `register` calls; `roles-restamped`,
  `connections-migrated` and `custom-portrait-list` are internal, `config: false`) —
  **registration ORDER is load-bearing**, because Foundry's group headers are positional. Two went on
  2026-07-31, both because the thing they toggled stopped existing:
  `show-containers-tab` (the Connections tab is structural now, and a display
  toggle that hides a graph which goes on existing behind it is not a setting
  worth having) and `show-gold-not-cost` (it swapped the container sheet's Cost
  box for Gold; that sheet went with the type, and the npc sheet has no Cost box).
  A third went on 2026-08-02 by ruling rather than by obsolescence:
  `show-container-actors` hid plain/worn containers from the Actor Directory, and
  the ruling is that they are ALWAYS listed — a behavior that must never be off is
  not a setting, so the directory hide rule went with it (the grayscale-thumbnail
  rule beside it survives; it never depended on the setting)

**One system, two generators.** Cairn 2e and Barebones differ ONLY in how a
character is MADE. Every rule after a character exists — damage, slots, saves,
scars, the sheets — is identical by design. So `content-source-2e` gates
generation and nothing else: **a branch on the content source outside character
generation is a bug**, not a feature, and Barebones content goes into the same
editable type packs 2e uses rather than a parallel set. Three code sites cite
this rule (`module/settings.js`, `module/actor/actor-sheet.js`,
`tools/import/barebones.mjs`); they cited this file for it before it said so.

## Deliberate deviations from Foundry practice

Listed so a review does not re-litigate them. If you disagree with one, argue
against the reason, not against the fact.

- ~~**Sheets are AppV1**~~ — **NO LONGER TRUE as of 2026-07-29.** Both sheets are
  ApplicationV2 (`HandlebarsApplicationMixin(ItemSheetV2 / ActorSheetV2)`), merged to
  `dev`; there is no AppV1 left in `module/`. **And since 2026-07-30, no jQuery
  either** — the last call (`damage.js:55`, the chat Apply-damage button) was
  converted only after `dev:enc-damage` grew a section that clicks the real button,
  because this file had claimed "no jQuery left" once before while it was never
  true; this time the claim is grep-verified and probe-covered. This was the ONLY
  deviation with an externally-set expiry (AppV1 removal in **v16**, per the shipped
  client `appv1/api/application-v1.mjs:59-64` — not v15, which this file used to say), and
  it is now closed. Kept here only so nobody re-plans it.
  **Three things the port established that still govern the code:**
  - **Dark mode. The sheets follow the viewer's colour scheme** (settled 2026-07-28), and
    `css/cairn.css` opens with a light+dark token palette rather than literal colours
    assuming parchment. Gated by `npm run dev:theme`. Read **`docs/theming.md`** before
    touching a colour.
  - **AppV2 supplies neither `.window-content` scrolling nor AppV1's 8px padding nor
    `.window-content > * { flex: 1 }`**, and every sheet grid here was laid out against
    all three. They are restored explicitly at the top of `css/cairn.css` — do not
    "simplify" that block away. `npm run dev:sheet-layout` is the gate; it exists because
    losing them made the HP/Gold counters render on top of STR and Armor while the sheet
    still rendered, persisted every field, and logged zero console errors.
  - **`submitOnChange` must be declared and `submitOnClose` no longer exists.** AppV1's
    sheets set both; `DocumentSheetV2` defaults `submitOnChange: false`
    (`applications/api/document-sheet.mjs:65-68`) and has no `submitOnClose` at all. So
    "edit a field and it saves" is asked for explicitly, and closing a sheet no longer
    commits an un-blurred edit. The pack cache at the top of `actor-sheet.js` exists
    because `submitOnChange` re-runs `_prepareContext` on every committed keystroke.
  Traps, and what each cost: memory `air-bladder-appv2-migration`.
- **Containers and transports are Actors, not Items**, linked to their keeper by
  a single `uuid` field on the CHILD called `connectedTo`. Against Foundry's
  grain. The reason is capacity: "+8 slots" cannot live on an Item — nothing
  reads `system.slots` on one. Expect bugs to cluster here.
  The link used to be TWO writes — a `keeper` uuid on the child (named to dodge a
  Foundry collision on `owner`) plus a `containers` array on the keeper — and
  nearly every container bug came from one half landing without the other. Both
  the array and `keeper` were retired with the `container` type on 2026-07-31;
  the keeper's list is DERIVED from the children. If you find either name in a
  comment, it is history.
  **Since 2026-08-01 the graph is FLAT (only a character keeps, ten at most) and
  connection DRIVES OWNERSHIP** (`module/connections.js`): connected = the
  keeper's players own it, broken = default LIMITED — transitions only, never a
  re-enforcement sweep, monsters never touched. A player's connect/break cannot
  write ownership (server wall), so it sets `ownershipSyncPending` and the
  active GM's client answers; the flag, not the message, is the authorization.
- **No automation of mechanical text.** "Restores 1 STR" stays prose. Trust
  players; no macros, no buttons. House style, and it dissolves the hardest
  content cases (a background granting a statted homunculus is text, not a spawned
  Actor).
- **Content translation is a display-only overlay** keyed on the ENGLISH SOURCE
  STRING (`lang/content/<lang>.json`, `module/i18n-content.js`), not on ids.
  Consequence that bites: **editing an English description orphans its
  translation.** Weigh that before "fixing" pack prose.
- **Pack YAML in `src/packs/` is the source of truth**; `packs/` is generated
  LevelDB, gitignored. Never edit `packs/`. `npm run build:packs` fails while
  Foundry has the world open (LevelDB EPERM) — stop the server first.
  **EXTRACT BEFORE YOU BUILD, ALWAYS.** "Generated output" is true only until a
  Warden edits a compendium inside Foundry; from that moment `packs/` holds the
  ONLY copy of that work, and `build` rmSyncs each pack and recompiles it from
  YAML. On **2026-08-04 that destroyed roughly five hours** of monster art
  assignment plus a description fix, with no recovery: `packs/` is gitignored,
  LevelDB keeps no history, Foundry writes no automatic backups, and the newest
  Volume Shadow Copy was two days stale. `tools/packs.mjs` now REFUSES a build
  when `packs/` has changed since the last build or extract.
  - **The guard compares against a SYNC MARKER** (`.pack-sync.json`, gitignored),
    not against `src/packs`. Two earlier designs were wrong and both looked
    right: **mtime** fires on every clean tree, because LevelDB rewrites
    `CURRENT`/`MANIFEST`/`.log` merely because Foundry opened the world — and a
    guard that always fires just teaches you to reach for `--force`.
    **Comparing `packs/` to `src/packs` directly** has no DIRECTION: editing YAML
    then building is the normal workflow and differs exactly as much as a
    compendium edit does, so it would block ordinary content work.
  - **Opening a world mutates pack CONTENT**, not just its housekeeping files —
    v12-era documents migrate to the v14 schema on load (`flags.core.sourceId` →
    `_stats.compendiumSource`, the `turnMarker`/`hexagonalShape` token fields).
    So the guard legitimately fires after a world open. Folding that in with
    `extract:packs` is a ~950-file diff; it is a real decision, not noise.
  - **`extract` RENAMES files to `<Name>_<id>.yml`.** Committed files whose name
    lacks the id suffix (`marketplace/Market_Armor.yml`) are deleted and rewritten
    under the new name, so an extract you want to undo needs BOTH halves, in this
    order: `git checkout -- src/packs` to bring the originals back, THEN
    `git clean -fd src/packs` to drop the new ones. Doing it the other way round
    removes the replacement while the original is still gone — 62 table files
    vanished that way on 2026-08-04, which showed up as `check:refs` reporting
    **0 of 198 compendium references**. That gate's own message is what caught
    it: "if content did not shrink, it has stopped looking." Content HAD shrunk.
    Always finish with `git status src/packs` showing nothing.
- **`npm run backup` snapshots `packs/` AND both worlds** to
  `foundry/backups/<stamp>/`, pruned to 24 (`tools/dev/backup.mjs`, `--list`).
  It skips files it cannot read rather than aborting — Foundry holds an
  exclusive handle on each pack's zero-byte `LOCK`, and `fs.cpSync` over the
  tree dies with EPIPE on the first one, which would mean backups only worked
  while the server was stopped. Run it before anything that writes packs or
  world documents.
- **A negative control must never be a real write.** Proving the `art/` path
  migration's control was load-bearing by giving it an over-broad prefix rule
  ran that migration against the dev world and mis-pathed **149 real documents**
  the same day. Defeat a fix IN-PAGE against planted documents, the way
  `dev:relic-tab` and `dev:art-picker` do — never by editing the source of
  something that mutates a world on load.

## Foundry sources, in order of authority

- **The shipped client, `C:\Users\domin\foundry\app\client\**`, outranks
  everything.** It is the only source that states deprecation and removal
  versions: `logCompatibilityWarning` calls carry literal `{since, until}`.
  The web API pages carry NO version boundaries at all, which is how this file
  once claimed AppV1 dies in v15 (it is v16, `appv1/api/application-v1.mjs:59-63`).
  Cite file and line the way you would cite a URL.
- **Docs**: `foundryvtt.com/api/` and `foundryvtt.com/article/`.
  `foundryvtt.com/releases/` is the only version-aware doc — use it for when a
  replacement API landed, not for when the old one dies.
- **`github.com/foundryvtt/foundryvtt` is the ISSUE TRACKER, not source and not
  documentation** — Foundry is closed-source and that repo holds no code. Cite an
  issue to establish "this is a known core bug"; never as evidence of how an API
  is meant to behave. Its `releases/` folder stops at 11.308 — three majors stale.
- **`github.com/foundryvtt/foundryvtt-cli`** — `@foundryvtt/foundryvtt-cli` is a
  real devDependency; `tools/packs.mjs` uses its `compilePack`/`extractPack`.

**Target is v14 and nothing older.** No compatibility shims for v13 and below —
if you find one, deleting it is in scope, not a separate decision.

## Rules encoded — these are the game, not bugs

- Damage minus armor hits HP; overflow spills into STR, then forces a STR save.
  STR at 0 is death.
- Armor is hard-capped at 3.
- Slot inventory: bulky = 2, weightless = 0, times quantity.
- **Being encumbered sets HP to 0 outright. So does panic.** Intentional.
- **Coins consume slots** (2e p.9): `ceil(gold/N) - 1` where N is the
  "coins per slot" setting. ONE rule for every actor type.
- **Dice notation overloads `+`.** `2d8` = add (2..16). `d8 + d8` = keep highest
  (1..8). `2d20 + 10` = arithmetic. The keep-highest rewrite applies only when
  every `+`-separated term is a bare die.

## Where intent is recorded

Commit messages. They are long and they explain *why* — treat `git log` as the
design record. `docs/` holds the durable plans (i18n, custom backgrounds,
translating). `README.md` carries credits and licensing.

## Licensing — six regimes, and the traps

**The inventory lives in `README.md` (canonical) and `LICENSE.txt`, and
`check:licence` holds them in step.** It is not repeated here any more. This section
used to carry a third copy under the heading "Four licences, not one", listing five
regimes while six shipped — the OFL fonts were missing, and their clause 2 requires
the notice travel with every copy. Nothing checked it, because the gate compares the
two files that matter and had no reason to know about a list in the working notes.
**A third copy of a list is a third thing to drift**; if something here needs a
regime named, name the file that holds it.

What belongs here is what those two files do not say:

- **The Air Bladder logo is NOT Creative Commons.** All rights reserved, Lydia Comer,
  by bespoke grant. Do not treat it as CC, and do not reach for it as the manifest's
  cover image — that is the reason `media` is deliberately absent from `system.json`.
  **Since 2026-08-04 the same grant also covers her MONSTERS** under
  `art/lydia-comer/portraits|tokens/`, offered in the picker on NPC and Monster
  sheets — a growing set, so do not state a count here.
  They ship as WebP q95, and since 2026-08-04 the `tokens/` half is sized for
  the canvas (400×400, user ruling — a map token draws at ~100px; portraits
  keep the artist's full 1000×1000 because they are sheet art): 15.7 MB at
  delivery, 4.6 MB shipped. **The grant went through two versions in one day
  (2026-08-04) and the second is the one in force.** The first extended the original
  "may not be modified" wording just far enough to permit format conversion;
  the artist then replaced the whole notice with a shorter one that drops the
  modification bar entirely and bounds USE instead — to Air Bladder, its forks,
  and representing and promoting the project. So `tools/import/lydia-comer.mjs`
  touching only the format and the token size — never cropping, recolouring or
  redrawing — is HOUSE PRACTICE, not a licence term. Keep it; just do not cite
  the licence as the reason.
  **The licence text is the artist's to write, not this project's** — she is
  reachable and she rewrites it herself, so amend `art/lydia-comer/license.txt`
  BEFORE any code that depends on what it says, and never edit it to match code
  that already shipped.
  The halves used to be told apart by extension (`.jpg` square, `.png` circle);
  both are `.webp` now and only the FOLDER separates them, so an extension
  migration (`ART_REENCODED` in `cairn.js`) carries existing worlds across.
- **All four picker galleries live under `art/`** (moved 2026-08-04):
  `art/jon-aspeheim/portraits|tokens/` (was the split `character_portraits/` +
  `character_tokens/`), `art/lydia-comer/`, `art/tlomdev/`, `art/game-icons/`.
  **`icons/` did NOT move** — it is class art stamped onto documents, not a
  gallery anyone browses. **Moving art is never cosmetic**: an image path is
  COPIED onto a document at creation and never re-read from the system, so every
  existing world points at the old location. `migrateArtPaths` in `cairn.js`
  rewrites by PREFIX, which is what carries hand-picked art across too. It was
  written without the `lydia-comer/` prefix on the reasoning that the gallery had
  never shipped in a release — `dev:smoke` then found a dev-world token still on
  it. **`dev` mirrors to GitHub in seconds so people can test unreleased code, so
  "it never shipped" is only ever true of tags.**
- **`icons/CREDITS.md` must stay in step with the `ICONS` table in
  `tools/import/icons.mjs`** — add a row to one, add a row to the other. Hand-adding
  an SVG instead of running the importer is how `stack.svg` shipped with no intrinsic
  size, rasterising at 150×150.
- **The character portraits are confirmed human-made** (no AI). That is what makes the
  system eligible under Foundry's content policy, so keep the credit if the art ships.
- **`lang/` is split between two regimes by PROVENANCE, not by content** (settled
  2026-07-30): the five inherited interface files travel under upstream's MIT, while
  Malecho's `lang/es.json` and `lang/content/es.json` are CC BY-SA as derivatives of
  the game text. So two files of the same kind sit under different licences on
  purpose. `check:licence` now also asserts every directory the release zip ships is
  named by some clause — `lang/` had been named by none, which the "these and only
  these" wording makes an exclusion rather than an oversight.

## Testing

**`docs/release-testing.md` is the full list — 81 probes (`check:probes` states
the current count), what each covers, and what to run before tagging vs after
publishing. Keep it in step with `package.json`; a probe not listed there runs
only when someone remembers it.**

- `npm run dev:smoke` — headless Chromium against the local dev world on :30000,
  which loads this working tree via a directory junction. Asserts the system
  loads, SHIPPED packs are non-empty (world packs are excluded — one of them is
  legitimately empty), a sheet renders, zero console errors.
- Offline, no Foundry: `check:refs`, `check:fields`, `check:traits`, `i18n:check`.
- **`system.json` `documentTypes.<Doc>.<subtype>.htmlFields` is a SECURITY control,
  not metadata.** The Foundry server never loads `module/data-models.js`, so an
  `HTMLField` missing from the manifest is never sanitized and a player can XSS the
  GM through their own character's notes. `check:fields` cross-checks the two, and
  `npm run dev:sanitize` proves it takes effect — the server reads `system.json`
  only at STARTUP, so an un-restarted edit looks exactly like no edit.
- **Three rules paid for the hard way.** A new test must be confirmed to FAIL with
  its fix removed. A test's precondition must not be satisfiable by stale world
  state — several assertions here once passed by reading an actor a previous
  aborted run had left behind. And a probe that fails once then passes on re-run is
  a **race, not a flake**; do not re-run and call it green.
