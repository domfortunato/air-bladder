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
  `compatibility: {minimum: "14.365", verified: "14.365"}`. Raised from 13 on
  2026-07-29 and pinned to the build on 2026-08-04 (user ruling — docs and
  manifest say "v14.365 or higher" everywhere): the AppV2 sheets use
  `_getFrameButtons`, `_canDetach` and `_onDetach`/`_onAttach`, all confirmed
  against the shipped 14.365 client and none of them verifiable on anything
  older from this machine. A minimum nobody has ever tested is a claim, not a
  fact. The same statement lives in `README.md`, `README.es.md`,
  `CONTRIBUTING.md` and `site/index.html` — change one, change all five.
- Latest release **0.1.12** (2026-08-07). `system.json`'s `version` is rewritten by
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
  The matching `hireling` ROLE went the same day and **CAME BACK on 2026-08-20**
  (user ask). `NPC_ROLES` is SIX entries — `npc`, `hireling`, `monster`,
  `companion`, `transport`, `container` — because the split finally gave the two
  people something to differ about: a hireling has a **Career** off the 2e
  careers catalogue with a day rate, an NPC a **Background** off the Warden's
  Guide table plus Quirk / Goal / Virtue / Vice off that book's NPC tables
  (already shipped in `warden-npcs`; only `Name` and `Faction` had a reader
  before). Two fields, never one relabelled: `profession` and `background`.
  **A generated NPC's statblock is ROLLED — 3d6 and 1d6 HP (2026-08-20, user
  ask, the day after the split).** The plan had it out of scope on the reasoning
  that the Warden's Guide gives NPCs no stats so none should be invented; a
  generator left at the schema's 10/10/10 and 6 has not declined to invent
  numbers, it has invented three identical ones. `Cairn.npcGenerator.ability` /
  `.hitProtection`, beside the Barebones pair they copy.
  Three things about this that WILL bite if forgotten:
  - **`migrateData` no longer converts stored "hireling"** — the key is in the
    enum again. Putting that conversion back would undo every write
    `migrateHirelingSplit` makes, on the next read, silently.
  - **That migration SELECTS, and its siblings cannot.** Nothing rewrites a
    stored "npc", so `_source` reads it honestly — and selecting is the safety
    property, because a real NPC stores "npc" once the migration has run. Its
    marker (`hireling-split`) is the only thing preventing a second pass from
    converting every genuine NPC in the world.
  - **The schema initial is `hireling`.** A document that states no role
    predates the split, and every one of those is a hireling by the same ruling.
    Consequence for probes: a planted document is born already migrated, so the
    migration can only be tested through a raw-socket plant (`dev:role-migration`
    does exactly that).
  `PERSON_ROLES` is the list to reach for when the question is "is this
  somebody" — the biography block, the connection line, the auto-portrait. Ask
  for a role by name only where the two genuinely differ, which is two places:
  which job field shows, and whether the day-rate mechanic is offered at
  all — the For Hire box AND the rate row, which are one question and must be
  asked with one gate (`showForHire`). The box read `isNpcPerson` for a day
  after the split, so an NPC was offered a checkbox whose only effect is a row
  its role never shows.
  The biography sentence is **second person for a character, third for both npc
  roles** (2026-08-20) — one `_wording` call inside `_buildTraitSentence`, which
  the printed page shares. A Spanish client keeps its translated "Eres…" until a
  translator adds the `CAIRN.Bio.*Npc` keys; that is the point of
  `has(key, false)` and must not be "fixed".
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
  sub-types are declared in `system.json` `documentTypes`); 29 compendium packs
  (24 on `master` — the GLOG branch added `spellbooks-glog`, `tables-glog`,
  `journals-glog`, and on 2026-08-10 `journals-2e` and `journals-docs`; this
  count went stale TWICE in one day, both times by the hand that had just
  corrected it — a new pack's commit must carry this line)
- 26 GM-visible settings in `module/settings.js` (34 `register` calls; `roles-restamped`,
  `companion-restamped`, `hireling-split`, `grimoire-keys-stamped`,
  `connections-migrated`, `custom-portrait-list`, `disabled-backgrounds` and
  `connections-ui-enabled` are internal, `config: false`;
  counts have gone stale three times — `allow-player-randomization` outdated them
  (review #13's catch, its third "record claiming what the code does not say"),
  then `enable-glog-magic` rode a topic branch whose cherry-picks never carried
  this line, caught only when the branch merged — so each settings change updates
  them in its own commit, this one dated 2026-08-19 for `max-age`) —
  **registration ORDER is load-bearing**, because Foundry's group headers are
  positional — GATED since 2026-08-19 (review #16): `SETTING_GROUPS` in
  `settings.js` declares the three groups, their anchors and every visible key
  under each, `cairn.js` inserts the headers from it rather than from its own
  copy, and `dev:settings` compares it against the live registration order
  (`game.settings.settings` is a Map, so its key order IS that order). Two went on
  2026-07-31, both because the thing they toggled stopped existing:
  `show-containers-tab` (the Connections tab was structural then — see the
  2026-08-09 parking below — and a display toggle that hides a graph which goes
  on existing behind it is not a setting worth having) and `show-gold-not-cost`
  (it swapped the container sheet's Cost
  box for Gold; that sheet went with the type, and the npc sheet has no Cost box).
  A third went on 2026-08-02 by ruling rather than by obsolescence:
  `show-container-actors` hid plain/worn containers from the Actor Directory, and
  the ruling is that they are ALWAYS listed — a behavior that must never be off is
  not a setting, so the directory hide rule went with it (the grayscale-thumbnail
  rule beside it survives; it never depended on the setting).
  **Three more went on 2026-08-09, all by user ruling:** `show-omens-barebones`
  and `show-bonds-barebones` (the 2e-lending they toggled was removed with them —
  Barebones sheets never show Omen, Barebones generation never mints a bond; a
  legacy lent bond survives as data and keeps displaying) and
  `show-features-section` (the whole Features UI went; the `features` schema
  field STAYS on both actor models so anything recorded survives invisibly, the
  orphaned-`description` precedent).
  **`show-omens` (2026-08-17) is NOT that first removal coming back** — the
  lending setting offered 2e's Omen field TO Barebones; this one withdraws it
  from 2e, for a table that does not use the youngest-member rule. New key, so
  no world's orphaned `show-omens-barebones` row can be mistaken for a value.
  One switch covers BOTH surfaces by ruling — the sheet's row and the printed
  page's section — deliberately not the `show-grant-tags` / `-print` split,
  because a grant tag is an annotation both surfaces legitimately show while
  this says the rule is not in play. Stored omen text is never cleared.
  **The Connections UI is PARKED since 2026-08-09** (`connections-ui-enabled`,
  internal, default false — deliberately NOT a Warden-visible setting, or it
  would re-litigate the `show-containers-tab` removal above): the tab, the NPC
  header attach/detach line and drag-to-connect are hidden for everyone while
  everything underneath keeps working — marketplace transports mint connected,
  generation grants land connected, connected capacity counts, the ownership
  automation and socket brokers run, `flattenConnections` migrates. One flag
  flip restores the UI; probes exercise the enabled state by shadowing the
  settings READ in-page, never by a world write.

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
  Actor). **Scoped 2026-08-09 by the encounter tables' Add-to-scene button:**
  the deviation protects PLAYER-FACING rules prose — what a rule costs a player
  stays theirs to apply. Automating the Warden's LOGISTICS (rolling a quantity
  and minting the tokens a table row names) does not touch that reasoning, so
  it is allowed; a button that applied "Restores 1 STR" still is not.
- **Content translation is a display-only overlay** keyed on the ENGLISH SOURCE
  STRING (`lang/content/<lang>.json`, `module/i18n-content.js`), not on ids.
  Consequence that bites: **editing an English description orphans its
  translation.** Weigh that before "fixing" pack prose.
  **Every list of names a user reads must go through it, or the same token wears
  two names on one screen** (2026-08-14 ruling, review #14 finding 14). For six
  rounds exactly ONE `.entry-name` sweep existed — the compendium browser — so a
  Goblin dragged into the world had an English sidebar row, a Spanish sheet
  header, an English tracker row and a Spanish damage card. World directories,
  the combat tracker and the compendium SIDEBAR's document search are covered
  now (`localizeDirectoryNames` / `worldDisplayName` /
  `wrapCompendiumDocumentSearch` in `cairn.js`, `_prepareTurnContext` in
  `combat.js`). The sidebar one (2026-08-19, review #16) had to WRAP the app
  rather than sweep a render: its rows are rebuilt inside `_onSearchFilter` on
  every keystroke, so no render hook is ever near them, and both halves needed
  covering — the match (typing the translation found nothing) and the row text
  (which read the stored English). "Is there a hook for this?" is the wrong
  first question about a new surface. Two rules travel with any new surface:
  **rewriting names breaks SEARCH** —
  core matches the query against the COLLECTION, never the DOM, so typing the
  Spanish empties the list unless `wrapTranslatedSearch` is applied too — and a
  WORLD list needs a per-DOCUMENT namespace, not a per-collection one, because
  its Actor list holds player characters (**never localized**, the 2026-08-04
  gate) and its Item list mixes backgrounds with gear. Gate:
  `npm run dev:directory-i18n`.
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
  - **The v14 schema fold-in is DONE — do not re-plan it.** The committed YAML
    was written by Foundry 12, and every extract re-derived the v14 shape
    (`flags.core.sourceId` → `_stats.compendiumSource`, the
    `turnMarker`/`hexagonalShape` token fields), which made a ~950-file diff sit
    permanently in front of every build. It was accepted on 2026-08-04 in
    `b2eda4a`, classified line by line first: every change schema normalization
    or an extractor rename, zero Warden content. **This file went on calling it
    a pending decision for two days afterwards**, which is how it kept getting
    raised — a stale to-do reads exactly like a live one.
    **The guard COMPARES MEANING, NOT BYTES (2026-08-13).** It used to hash the
    extracted YAML text, and Foundry rewrites a compendium document merely by
    loading the world — decoding HTML entities (`&#39;` → `'`) and filling schema
    defaults — so the hash moved without a Warden touching anything. It fired on
    five packs twice in one day with nothing but normalization inside them, and a
    guard that cries wolf teaches the `--force` reflex that destroys the work.
    `canonicalDoc` in `tools/packs.mjs` now drops `_stats`/`_key`, drops empty
    containers, decodes entities on both sides, and sorts keys; `.pack-sync.json`
    carries `__format`, and a marker written by an older shape is treated as no
    marker (back up, build, re-stamp) rather than compared. **Bump
    `MARKER_FORMAT` on any change to `canonicalDoc`** — changing one without the
    other reports every pack as drifted, which is the very false alarm it exists
    to end.
    Verified end to end, and the control is the point: a world session alone
    builds clean, while a document created in a pack AND a journal page edited in
    the world make it refuse, naming both packs. Re-run that control if you touch
    the normalization — decoding entities is exactly the sort of change that
    could blind it to a real text edit.
    So drift that survives normalization is a REAL write. Classify it rather than
    assuming churn — and do NOT reach for `extract` when `src/packs` is newer
    than `packs/`, because extract runs packs → src and reverts your own work
    (it did, on the live server, 2026-08-13). Extract to a scratch directory and
    diff instead.
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
  **Encumbered means NO FREE SLOT** — `actor.js` computes `slotsUsed >=
  slotsMax`, so a pack filled to exactly its limit counts, and it clears only by
  dropping or giving something away. **RULED 2026-08-05 and CLOSED: the
  threshold is not changing, do not raise it again.**
  **A character may go OVER the limit, but only where the rules owe it to them**
  — two cases, and the boundary is the whole point:
  - **What generation and a background grant hand them.** Random gear plus
    background gear can add up to more than ten items and the character is owed
    all of it, so they are given everything and land encumbered. The player then
    decides what to keep, hand to someone else, or abandon. This reads like a
    generation bug and is reported as one (issue #5); the answer is that the
    choice is the game. No code enforces this — those paths write with
    `createEmbeddedDocuments` and never reach the guard.
  - **Fatigue, always.** Casting fills a slot whether or not one is free, so
    refusing it does not protect the player, it cancels a cost — and makes
    casting cheapest exactly when the character is most loaded. `createOwnedItem`
    takes `{ ignoreCapacity: true }` for this and nothing else so far.

  **Ordinary acquisition still refuses**, and that is deliberate, not a gap: a
  drop onto a full character (`_onDropItem`), the manual Create Item dialog, and
  **the marketplace** all turn it away. Overflow is owed, never merely allowed.
  The shop was the last holdout — it created the item and warned afterwards,
  which made buying the one way a player could walk past their own limit — and
  was closed the same day (2026-08-05, user ruling). It greys the rows it will
  refuse AND refuses in `acquire`: **the greying is the affordance, the refusal
  is the enforcement**, because a dialog left open while the pack filled must
  not be a way through. Two carve-outs, both because they cost the buyer no
  slot: **petty** items, and **transports** — a transport is a connected Actor,
  and buying a mule is how you FIX being full, so refusing it at the till would
  be perverse.
  Two things this cost, worth not repeating. Add Fatigue refused in **two**
  places — its own guard and `createOwnedItem`'s behind it — so removing either
  alone changed nothing a user could see while looking like a landed fix; that is
  why `dev:enc-damage` clicks the real button rather than calling either layer.
  And `_onDropItem` carried a comment stating the opposite of the line beneath it
  for months. **A correct-sounding comment on contradicting code reads as
  verification**, which is how the disagreement survived two reviews.
- **Coins consume slots** (2e p.9): `ceil(gold/N) - 1` where N is the
  "coins per slot" setting. ONE rule for every actor type.
- **Dice notation overloads `+`.** `2d8` = add (2..16). `d8 + d8` = keep highest
  (1..8). `2d20 + 10` = arithmetic. The keep-highest rewrite applies only when
  every `+`-separated term is a bare die.

## Where intent is recorded

Commit messages. They are long and they explain *why* — treat `git log` as the
design record. `docs/` holds the durable plans (i18n, custom backgrounds,
translating). `README.md` carries credits and licensing.

**`docs/*.md` is CANONICAL for documentation — edit there, never in a journal
(user ruling 2026-08-10).** The Warden-facing guides mirror into the "System
Docs" journal pack (`journals-docs`), generated by
`tools/import/system-docs.mjs` from the markdown: after editing a mirrored
guide, rerun that importer and rebuild packs, or the two copies drift and the
in-game one — the one a Warden actually reads — is the stale one. The
importer's ROSTER names which docs mirror; contributor documents (plans,
design-of-record files, release-testing, theming, i18n process) stay
repo-side on purpose.

**Journals are TRANSLATABLE, but only the player-facing ones** (user ruling
2026-08-14). `journals-2e` and `journals-glog` reach the content overlay;
`journals-docs` deliberately does not, because its pages are REGENERATED from
`docs/*.md` by the importer above — a translation keyed to that English would
be orphaned by the routine step this very section tells you to take, which is
worse than offering none. The list is `TRANSLATABLE_JOURNAL_PACKS` in
`tools/i18n/content-strings.mjs`; a new journal pack must be added there or it
silently reaches no translator. Split at PARAGRAPH level, not page level: a
page is one `text.content` string of up to 14,000 characters, so a page-level
key would hand a translator a rulebook page in one spreadsheet cell and orphan
all of it on any English edit. Two consequences worth knowing before you touch
journal prose — **a block containing an `@UUID` link is NOT translatable at
all** (Foundry enriches it into `<a class="content-link">` before it reaches
the DOM, so its key can never match; the extractor skips it rather than
promising a row that cannot land), and **`BLOCK_TAGS` in the extractor and
`JOURNAL_BLOCKS` in `module/cairn.js` must stay identical** — a tag in one and
not the other is a key nothing ever asks for. `npm run dev:journal-i18n` is
what holds all of this honest: it imports the real extractor from Node, renders
the real journals in Chromium, and asserts the two agree key for key.

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

**`docs/release-testing.md` is the full list — 96 probes (`check:probes` states
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
- **`check:fields` also holds shipped pack PROVENANCE clean, and it checks all
  three fields together on purpose.** `toCompendium`'s `clearSource` clears
  `_stats.compendiumSource`, `duplicateSource` AND `exportSource` in one go
  (`client-document.mjs:1117`) under a docstring reading "Remove any features of
  the data which are world-specific" — but `compilePack` builds straight from
  YAML and never runs it, so the YAML has to be clean itself. The gate originally
  checked only `compendiumSource`, and a spellbook consequently shipped for
  months stamped `exportSource: {worldId: cairn, coreVersion: 0.7.5}` — someone
  else's world, on a Foundry six majors dead, and the last `coreVersion` in this
  repo's content that was not 14.365 (fixed 2026-08-06). **Checking one member of
  a set the framework clears atomically is how the other members ship.**
  The gate covers **`ownership`** for the same reason: `clearOwnership` strips it
  in the same breath, and 586 documents shipped a per-user key naming a User id
  from the fork-era worlds they were authored in (stripped 2026-08-06; only
  `default` is allowed now). **"Unreadable" was briefly argued as a reason to
  LEAVE them, and that is backwards.** They are unreadable —
  `getUserLevel` short-circuits on `if (this.pack)` before ownership is
  consulted (`common/abstract/document.mjs:388`, docstring: "Compendium content
  ignores the ownership field in favor of User role-based ownership"), and
  `fromCompendium` clears it again on the way out. That makes removing them a
  zero-behaviour edit, which is what makes it SAFE — not what makes it
  unnecessary. Data nothing will ever surface is data nothing will ever correct.
- **Three rules paid for the hard way.** A new test must be confirmed to FAIL with
  its fix removed. A test's precondition must not be satisfiable by stale world
  state — several assertions here once passed by reading an actor a previous
  aborted run had left behind. And a probe that fails once then passes on re-run is
  a **race, not a flake**; do not re-run and call it green.
