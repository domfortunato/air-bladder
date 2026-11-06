# Air Bladder — a Cairn 2e game system for Foundry VTT

> Slimmed working notes. The full narrative — every reversal, date, review and
> measurement — lives in this file's git history and in `git log`. Nothing is lost.

**Tracked, and this repo is public** — so read it as candid working notes, not as
documentation. It records deliberate deviations and what each mistake cost, so the
same ground is not re-argued. Anything a *user* needs belongs in `README.md`;
anything a contributor needs to follow a process belongs in `docs/` or
`CONTRIBUTING.md`.

A Foundry VTT **game system** (not a module) implementing Cairn 2e, an OSR TTRPG by
Yochai Gal. Published at `domfortunato/air-bladder`, installed from the release
manifest. Descends architecturally from a private fork of
`yochaigal/Cairn-FoundryVTT` (still at `c:\Users\domin\code\Cairn-FoundryVTT`), but
is an independent system with its own `id`, content and history — **not** a git fork.

## Version reality

- **Minimum Foundry 14.368, `verified` 14.369.** `system.json`:
  `compatibility: {minimum: "14.368", verified: "14.369"}`. 14.365 was dropped on
  2026-11-02: nothing tested it any more, and a minimum nobody has tested is a
  claim, not a fact. **THE TEST WINDOW (user ruling 2026-11-02): the newest stable
  Foundry build and the two before it**, each installed on every probe box and
  tested there, never from the workstation (today 14.368 and 14.369). A new stable
  build joins; a fourth pushes the oldest out: 14.370 → test 14.368–14.370; 14.371
  → drop 14.368. The minimum is the window's oldest build and moves up with it.
- **The minimum is stated in six places** — `README.md`, `README.es.md`,
  `CONTRIBUTING.md`, `site/index.html`, `docs/testing-dev-branch.md` and here.
  Change the minimum, change all six. Moving `verified` alone does NOT touch them
  (they state the floor, "or higher").
- **`verified` = the newest build actually proven green** (14.369, via `dev:upgrade`
  0.1.24→0.1.25 then `dev:smoke` on `foundry/app-14369` — the upgrade leg never
  leaves Setup, so the world launch is smoke's — and the whole probe suite on the
  fleet), never whatever Foundry has released since. It is
  submitted by `npm run publish:foundry` and shown on the Marketplace listing.
- Latest release **0.1.25**. `system.json`'s `version` is bumped by `npm run
  release` on `master` only, so on `dev` it lags — read the tag, not the file.
  Update this line in the post-release master→dev sync, however that sync lands
  (merge or fast-forward).
- Node 24.x. `npm run release X.Y.Z` is the whole release — see `RELEASE.md`.
- **THE `id` IS `air-bladder` AND IS NOT CHANGING (CLOSED). Do not re-raise it or
  re-derive the cost.** Changing it publishes a different system: `world.json`'s
  `"system"`, the settings namespace (`SETTINGS_NS` — losing the `hireling-split`
  marker would convert every NPC into a hireling), flag scopes (every `grantSource`
  tag) and stored paths/uuids are all keyed on it in every existing world. What the
  question usually wants is the TITLE, which is free.

## Git: two branches, one direction

**`master` is the released state. `dev` is everything in progress.** All work goes
on `dev`. `master` only receives a merge from `dev` plus the release commit. `dev`
is permanent. Full model in `docs/git-flow.md`; summary in `CONTRIBUTING.md`.

- **No hotfixes, by policy.** Fixes ride the next release. When an urgent fix is
  asked for, **check `git log master..dev` first** — if `dev` holds only the fix,
  the ordinary release ships it. It is only hard when `dev` carries work that must
  NOT ship.
- **Topic branches off `dev`** only for work that outlasts the release cadence AND
  is broken in the middle. Lowercase-kebab, merge `dev` in regularly. CodeQL does
  not scan them.
- **Merge `master` into `dev` after every release** (the release commit bumps
  `system.json` on `master` only). This is the only master→dev sync.
- **`npm run release` refuses to run off `master`** and prints what it ships.
- CodeQL scans `dev`; Pages is master-only. Queue: `/compare/master...dev`.
- **Never tag or release on GitHub.** `origin` (Gitea) push-mirrors to GitHub and
  force-syncs; a GitHub-only ref is pruned. Tag on `origin`. Merge PRs locally,
  never with GitHub's button (`docs/i18n-maintainer.md`).
- **Release notes ride in the TAG.** `CHANGELOG.md` holds a `## X.Y.Z` section;
  `npm run release` refuses without one, writes it as the annotated tag body
  (`--cleanup=verbatim` is load-bearing), and `main.yml` creates the release from it.
  A Gitea release would not work — the mirror moves git refs only.
- **The user signs off every edit to `CHANGELOG.md` personally** — draft it in chat,
  land it on their word, never inside another commit.
- `npm run release X.Y.Z -- --dry-run` prints the body and runs on `dev`. **The `--`
  is npm's**; without it npm eats `--dry-run`. (`npm_config_dry_run` is honoured too.)
- **TWO ADDRESSES, ON PURPOSE (CLOSED).** `https://domfortunato.github.io/air-bladder/`
  is canonical (`system.json` `url`, READMEs). `airbladder.xyz` redirects to it and
  is used only where a person types it by hand (printed sheet footer
  `CAIRN.PrintCreditGenerated`, the age-formula hint). Not drift; do not raise.

## Architecture

Entry point `module/cairn.js` (registers document classes and sheets on `init`).
Hand-written JS in `module/`. **`docs/architecture.md` is the map** (its size
table, the import graph in tiers, spine files, leaf features) and the one place
those counts are kept. It names functions, never
line numbers — a number or line in prose is a copy that drifts; that lesson applies
to every count in this file. `docs/provenance.md` records who authored what.

**One system, two generators.** Cairn 2e and Barebones differ ONLY in how a
character is MADE. `content-source-2e` gates generation and nothing else: **a branch
on the content source outside character generation is a bug.** Barebones content
goes into the same type packs 2e uses.

### Subsystem notes — read the one you are touching

The detail that used to sit here moved, word for word, into
`docs/working-notes/`. Read a subsystem's file before changing it:

- `documents-and-roles.md` — actor and item types, `NPC_ROLES`/`PERSON_ROLES`, the
  hireling split, generated NPCs, token linking and renames, containers and transports
- `damage-attacks-dice.md` — the damage flow, the two Scars tables, Improvised Attack,
  damage-row dice, optional combat rules
- `party-pile.md` — the Party folder and the Dropped Item Pile
- `dashboard-time-calendar.md` — the Dashboard, watches, the Vald calendar, the weather
  log and event journals
- `tables-marketplace-take-over.md` — world-first tables, the marketplace, the take-over
  doors, the table banner
- `sheets-creation-offers.md` — GLOG sheet flags, creation routes and hand-built sheets,
  item offers
- `settings.md` — the submenus, registration order, PC dice settings
- `content-translation-chat-cards.md` — the content overlay and per-viewer chat cards
- `packs.md` — the pack-build guard in full
- `licensing-and-art.md` — read before adding, moving or crediting art

## Deliberate deviations from Foundry practice

Listed so a review does not re-litigate them. Argue against the reason, not the fact.

- **Sheets are AppV2, no jQuery.** AppV2 lacks `.window-content` scrolling, 8px
  padding and `> * { flex: 1 }` — restored at the top of `css/cairn.css`; do not
  simplify away (`dev:sheet-layout`). `submitOnChange` is declared; `submitOnClose`
  no longer exists. Sheets follow the viewer's colour scheme — read
  `docs/theming.md` before touching a colour (`dev:theme`).
- **Containers and transports are Actors, not Items** — "+8 slots" cannot live on an
  Item. Expect bugs to cluster here.
- **No automation of mechanical text.** "Restores 1 STR" stays prose. Scoped to
  PLAYER-FACING rules; automating Warden logistics (e.g. encounter Add-to-scene) is
  allowed.
- **Content translation is a display-only overlay** keyed on English
  (`docs/working-notes/content-translation-chat-cards.md`).
- **Pack YAML in `src/packs/` is the source of truth**; `packs/` is generated
  LevelDB, gitignored. Never edit `packs/`. `npm run build:packs` refuses while
  Foundry has the world open (an unreadable pack is unknown, and unknown refuses).
  - **EXTRACT BEFORE YOU BUILD.** Once a Warden edits a compendium in Foundry,
    `packs/` holds the only copy; build rmSyncs it (5 hours of work lost once).
    `tools/packs.mjs` refuses a build when `packs/` changed since the last sync.
  - The rest of the guard (`canonicalDoc`, drift, extract): `docs/working-notes/packs.md`.
- **`npm run backup`** snapshots `packs/` and both worlds to
  `foundry/backups/<stamp>/` (24 kept). Run it before anything that writes packs or
  world documents.
- **A negative control must never be a real write.** Defeat a fix IN-PAGE against
  planted documents, never by editing code that mutates a world on load.

## Foundry sources, in order of authority

- **The shipped client `C:\Users\domin\foundry\app\client\**` outranks everything**;
  it alone states removal versions (`logCompatibilityWarning {since, until}`). Cite
  file and line.
- Docs: `foundryvtt.com/api/`, `foundryvtt.com/article/`; `foundryvtt.com/releases/`
  for when an API landed.
- `github.com/foundryvtt/foundryvtt` is the ISSUE TRACKER — cite for known core
  bugs, never for intended API behaviour.
- `@foundryvtt/foundryvtt-cli` (`compilePack`/`extractPack`) is a devDependency.
- **Target is v14 and nothing older.** Deleting a v13 shim is in scope.
- Measure a field or key before trusting a reviewer's name for it (14.365 has no
  `_stats.createdBy`; the server stamps the creator as OWNER).

## Rules encoded — these are the game, not bugs

- Damage minus armor hits HP; overflow spills into STR, then forces a STR save. STR
  0 is death.
- Armor is hard-capped at 3.
- Slot inventory: bulky = 2, weightless = 0, times quantity (`itemSlotCost`, one copy
  shared with `calcSlotsUsed`).
- **Every Fatigue fills a slot.** Do not rebuild the free-first-Fatigue rule
  (`freeFatigueId`, `fatigueToClear`, `nextFatigueCost`). Gate `dev:enc-damage`.
- **Rest follows Cairn as written.** HP to MAX, no cost, a Deprived character
  cannot. PC and NPC identical: Cairn's `RestTip` on the tooltip and the confirm
  (`_wording` gives an NPC its own question). The ration house rule (0.1.24, a Rest
  ate a ration and refused without one) was REMOVED 2026-11-06 (user: "compliant with
  Cairn's rules as written"). Rations are eaten at Make Camp, which has no button.
  Gates `dev:rest`, `dev:changelog`.
- **Encumbered = no free slot** (`slotsUsed >= slotsMax`) → HP 0. So does panic.
  **CLOSED: the threshold is not changing.** A hit on that 0 is judged against
  it — the damage goes to STR — and stored HP is not written while the rule
  zeroes it (review #34 F046, user ruling 2026-10-31, reversing review #1's
  stored-HP judgement; gate `dev:enc-damage`).
- **Overflow is owed, never merely allowed.** A character may exceed the limit only
  for: generation and background grants; Fatigue (`ignoreCapacity: true`); an
  accepted gift after the recipient's informed confirm. A thing/companion/monster
  never overflows. Ordinary acquisition refuses (drop, Create Item, marketplace —
  greying is the affordance, `acquire` refusal is the enforcement). Marketplace
  carve-outs: petty items and transports.
- **Coins consume slots** (2e p.9): `ceil(gold/N) - 1`, N = coins-per-slot setting.
  One rule for every actor type.
- **Dice notation overloads `+`.** `2d8` = add. `d8 + d8` = keep highest.
  `2d20 + 10` = arithmetic. Keep-highest only when every term is a bare die.
- **A correct-sounding comment on contradicting code reads as verification.** Fix
  the comment with the code.

## Where intent is recorded

Commit messages — long, explaining *why*; treat `git log` as the design record.
`docs/` holds durable plans; `README.md` carries credits and licensing.

- **`docs/*.md` is canonical for documentation — never edit a journal.** Guides
  mirror into `journals-docs` via `tools/import/system-docs.mjs` (ROSTER names which);
  after editing a mirrored guide, rerun the importer and rebuild packs. Hints that
  name a journal by title break if it is renamed.
- **Journals are translatable only if player-facing**: `journals-2e`,
  `journals-glog`; not `journals-docs`. List: `TRANSLATABLE_JOURNAL_PACKS` in
  `tools/i18n/content-strings.mjs` (a new journal pack must be added). Split at
  paragraph level; blocks with `@UUID` are not translatable; `BLOCK_TAGS` and
  `JOURNAL_BLOCKS` must stay identical. Gate `dev:journal-i18n`.
- Interface keys with markup (`<strong>`) are set with `innerHTML`; `dev:dialogs`
  asserts the element.

## Licensing

**The inventory lives in `README.md` (canonical) and `LICENSE.txt`; `check:licence`
holds them in step.** Do not copy the list here.

- **Cairn's game text is ALWAYS CC BY-SA 4.0, wherever it sits (CLOSED).** The Code
  clause's path list says where this project's own code lives; it does not relicense
  Cairn text inside it. No per-file exception lists; do not raise "file X under a
  code path holds game text".
- **The Air Bladder logo is NOT Creative Commons** — all rights reserved, Lydia
  Comer, bespoke grant. Not the manifest cover (`media` absent on purpose).
- Art galleries, art moves, icon credits and portraits: `docs/working-notes/licensing-and-art.md`.
- **`lang/` is split by provenance**: inherited interface files MIT; Malecho's
  `lang/es.json` and `lang/content/es.json` CC BY-SA. **Those files are Malecho's —
  never edit them.** Placeholder parity is gated by `i18n:check`. Drift baselines
  are advanced by hand, never `--force`.

## No generated text a player or a Warden reads (ABSOLUTE)

No model-written table rows, flavour prose, or anything a die deals at the table —
in any file, `lang/` and `tools/` included. It is Cairn's, licensed from someone
else, or the maintainer's own. AI-assisted code is a separate, stated fact.
**Reach for the official Cairn table first**; if none exists, that is a
conversation, not a drafting exercise. **Rewording someone's list is copying it.**
The Stranger/Oddments generator was rolled back — do not rebuild it.

## Testing

**`docs/release-testing.md` is the full list** — keep it in step with
`package.json`. For the probe count run `npm run check:probes`. **The whole suite
on the cluster's probe fleet (~4 min) and where it stands: `docs/fleet-probes.md`.**

- `npm run dev:smoke` — headless Chromium against the dev world; packs non-empty,
  a sheet renders, zero console errors.
- Offline: `check:refs`, `check:fields`, `check:traits`, `i18n:check`,
  `check:package` (artifact shape, with `--self-test`).
- `npm run dev:upgrade` installs the previous release and presses Update; it
  refuses port 30000 (that install is a symlink to this tree).
- **`system.json` `htmlFields` is a SECURITY control** — an `HTMLField` missing
  there is never sanitized. `check:fields` cross-checks; `dev:sanitize` proves it;
  the server reads `system.json` only at startup.
- `check:fields` holds pack provenance clean: `_stats.compendiumSource`,
  `duplicateSource`, `exportSource` together, and `ownership` only `default`.
  Check every member of a set the framework clears atomically. It also refuses a
  `_stats.coreVersion` newer than `compatibility.minimum` — an extract on a newer
  dev server stamps its build, and older servers then fail to migrate the record.
- A probe that shadows `game.settings.get` must forward every argument and pass
  `{document: true}` to `ClientSettings.prototype.get` (`check:probes` enforces).
- **Probe rules, paid for:**
  1. A new test must FAIL with its fix removed.
  2. A precondition must not be satisfiable by stale world state.
  3. Fails once then passes = a **race**, not a flake.
  4. **Select a planted document by id difference, never by name.**
  5. On a timeout or a doubled write, check for orphaned `chrome-headless-shell`
     processes first — a kill from outside leaves Warden sessions parked.
  6. **A probe's cleanup runs from its catch**; stamp fixtures (`probeFixture`) and
     read a leg's own result by id difference.
- A probe's random range or single font size is a claim about the input space.
- Walk the Warden's view of a result; a passing probe is not that check.

## CLOSED — do not raise

- The `id` rename (`air-bladder` stays).
- Two site addresses (github.io canonical, `airbladder.xyz` redirect).
- Encumbrance threshold (no free slot = encumbered).
- Token linking default (persons linked, monsters not).
- Cairn game text is CC BY-SA wherever it sits.
- The v14 schema fold-in in pack YAML (done).
- Removed settings and the retired `container` type stay gone.
- Do not rebuild: Crawler Combat Mode master and its rules, maneuver choice buttons,
  free first Fatigue, Reseed a Spell Table, `more-spellbooks`, the Stranger
  generator, the Rest that eats a ration.
