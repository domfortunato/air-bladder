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
  `CONTRIBUTING.md`, `site/index.html` and `docs/testing-dev-branch.md` —
  change one, change all six (the sixth was written after this list said
  "five" and nobody added it; review #19).
- Latest release **0.1.20** (2026-09-07). `system.json`'s `version` is bumped by
  `npm run release` in the release commit on `master` (CI substitutes the same
  tag into the manifest URLs), so on `dev` it lags until the post-release sync
  — read the tag, not the file. This line said 0.1.12 through five releases
  (flagged open in review #15, fixed in #18), then went stale a THIRD time the
  very release after that rule was written (0.1.19, caught in review #23):
  a version in prose is a copy that drifts, so update it in the post-release
  master→dev SYNC — which is usually a merge, but when `dev` has nothing of
  its own it FAST-FORWARDS, no merge commit, and a rule hung on "the merge"
  never fires. The sync is the trigger, however it lands.
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
~13,100 lines of hand-written JS across `module/` — about 31,000 physical, but 57% of
that is comment prose. This line said "~7,500" for weeks and was measuring
nothing anybody had counted, then "~13,600" from a looser count than the
string-aware one behind the figure now; `wc -l` is not the number, and the
difference matters to anyone estimating how much there is to learn. Everything
else is content. **`docs/architecture.md` is the map** (written 2026-09-11):
the import graph in NINE tiers, the six spine files nothing else works without,
the FOURTEEN leaf features that only the boot file or a sheet imports, and the
five places where "explain it" is a real test. **It names functions, never line
numbers** — a line in prose is a copy that drifts, and this file records
several stale-number cases of exactly that. `docs/provenance.md` is the
companion record of who authored what.

- `CairnActor` (`module/actor/actor.js`) — types `character`, `npc`, `hireling`.
  `hireling` is an ALIAS of npc (same model, same sheet), kept because a type is
  immutable and retiring it would recreate every hireling with a new id. **It is
  HIDDEN from the Create Actor dialog since 2026-08-01** — today by
  `CairnActor.createDialog`, which replaces core's picker with the role
  switchboard so no type list renders at all (the `abHideHirelingType` DOM hook
  that first did this is GONE since 2026-08-02; the comment at its old site in
  `cairn.js` records why, and this line named the dead hook as the live
  mechanism for a month — review #22) — a registered subtype is otherwise
  always offered, and
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
  **And it arrives CARRYING something (2026-08-20, user ask):**
  `Cairn.npcGenerator.backgroundGear` maps each d20 Background to its nearest
  BAREBONES background — the only background list here whose entries hold gear —
  and `buildNpcItems` resolves it through the shared `resolveStartingGear`, NOT
  `resolveRefs`: nine Barebones backgrounds write a row as an INSTRUCTION
  ("Random Additional Gear") that a plain lookup drops in silence, which left a
  generated Peddler holding a Sack and nothing else. **Lord and Politician map to
  nothing on purpose** — all 100 Barebones backgrounds are occupations, so rank
  and office have no counterpart, which is the same reason those two words are
  on a Warden's table and not in character creation. **And since 2026-08-21
  they GENERATE with no items at all, kit included** (user ruling, reversing
  "the kit does not care what you do for a living"). This was GENERATION-scoped
  for a few hours — "a new station does not unpack the bag" — and the user
  REVERSED that the same day: the Background die or picker landing Lord or
  Politician on an existing NPC now WIPES the granted items, kit included
  (`applyNpcBackground`), so after any swap an NPC holds what GENERATING the
  new Background grants. The Warden's own untagged items always stay. **Containers are NOT
  granted** (the Merchant's Wagon, the Peddler's Cart): a transport is a second
  Actor the directory always lists, and a hireling's career grants none either.
  **A KIT rides alongside — the WHOLE Barebones equipment procedure since
  2026-08-21** (user ruling; it was Rations, Torch and one Additional Gear roll
  for a day): rations, torch, a rolled weapon and armor both equipped, and the
  Additional Gear roll(s) with the no-armor compensation roll, via the same
  `rollBarebonesEquipment` the Barebones character generator runs — one routine,
  not a copy — because a Background alone left an NPC on three items where a
  hireling arrives with six. Consequence accepted with eyes open: a generated
  NPC can land ENCUMBERED (derived HP 0), the same overflow-is-owed rule a
  generated PC lives under — probes reading a generated NPC's HP must read
  `_source`, never derived. It is tagged **`npc-kit`, deliberately not `background`**: two
  sources, two lifetimes — the Background die replaces only `background` (and
  REPACKS a kit when none survives, so a Politician swapped to Peddler matches
  a generated Peddler — presence is the test, never the old Background's name),
  a full regenerate replaces both, and `grantSourceLabel` maps an unknown source to ""
  so rations never wear a "Background" chip. **Everything a generator gives an
  NPC must be tagged**, mundane items included: untagged is how a Warden's own
  gift is recognised, so an untagged grant survives every re-roll and piles up.
  **PRONOUNS ARE NEVER ROLLED (2026-08-20, user ruling), on BOTH person
  generators.** They were a uniform pick of he/him, she/her, they/them from
  2026-08-01, justified in a comment as "a generated stranger needs an answer
  on arrival". They do not: there is no table for pronouns and no die should
  decide them. Stated `pronouns: ""` rather than omitted, so a full re-roll —
  a whole new person — clears the last one's. Note the asymmetry with the
  statblock above: numbers are a starting point a Warden edits, a person's
  pronouns are not something to be given a placeholder.
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
  **Three player-facing rulings landed 2026-08-21.** (1) A generated NPC stamps
  `ownership.default` LIMITED explicitly — though `CairnActor._preCreate` has
  defaulted every unconnected person-npc there since 2026-08-01, hirelings
  included — and the npc sheet gained a LIMITED VIEW: portrait, name,
  description, nothing else, and NO Print button (print's "shows nothing the
  sheet does not" claim went false the day the sheet started withholding).
  That rendering is what the ruling actually added: LIMITED used to open the
  full sheet, so the level was a label with no wall behind it. (2) **The randomization surface on npc-type sheets is the
  Warden's alone** — `_mayRandomize` refuses any player on type npc/hireling
  regardless of `allow-player-randomization`, which now governs player
  CHARACTERS only. (3) **Pickers** (pick-list button, `fa-list-ul` since
  2026-09-02 — it was a magnifier) beside Career, Background
  and Faction — they landed that morning deliberately OUTSIDE the
  `generationEnabled` template gate ("available when Randomization is off" was
  the ask), and the user REVERSED that the same evening: `canPickGeneration`
  is now `generationEnabled` narrowed to person roles, so pickers and dice
  ride ONE toggle, which is where the PC sheet's pickers always sat. They
  share one apply with the dice (`applyHirelingCareer` / `applyNpcBackground`),
  so a picked career and a rolled one are the same event, and both re-arrange
  the whole inventory (`reorderInventory`) so a swap reads like a fresh person.
  (4, 2026-08-21 pm) **A fresh person-role sheet OPENS on Items**, the PC's
  default, while the nav still leads with Description (the 2026-08-01 order
  ruling stands) — `initialTabId` in `actor-sheet.js`, role-aware because a
  list-head initial cannot say two different things for one type. **The
  CONTAINER joined Items on 2026-08-31** (user ask — a container is opened
  for its contents, and Description-first buried the only list anyone came
  for); monsters and transports still open on Description. The set is
  `ITEMS_FIRST_ROLES`, a named list rather than a person-predicate-plus-one,
  because a role predicate that quietly grows is this split's
  thrice-repeated bug.
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
- **A token's name follows its actor's on rename — only where it still matched
  the OLD name** (2026-08-23, user ruling after a player's rename left their
  token stale on every map: "preserve custom token names"). Core copies the
  name onto a token once, at placement, and never again
  (common/documents/actor.mjs:96,155 seed only an EMPTY prototype name). The
  rule is core's own prototype-token convention applied to placed tokens on
  EVERY scene: `CairnActor._preUpdate` stashes the former name and rewrites the
  prototype in the same write, `_onUpdate` batches one Token update per scene
  from the writer's client (a token's permission level is its actor's, so a
  player needs no relay). An UNLINKED token renamed through its own sheet
  takes the SAME path: the backend runs the pre-update phase on the synthetic
  Actor first and only then rewrites the request into an ActorDelta operation
  (client-backend.mjs `_updateDocuments` → `#adjustActorDeltaRequest`), so the
  stash travels and the synthetic actor's `_onUpdate` renames its one token —
  a `preUpdateActorDelta` hook, the obvious shape, never fires for it and was
  the first attempt. The three re-roll paths that used to rename the ACTIVE
  scene's tokens by hand, unconditionally, ride this instead. Gate:
  `npm run dev:token-names`.
- **Token LINKING is decided by role at creation: a PERSON is linked, a monster
  is not.** `_preCreate` stamps `actorLink: true` for `character` and for any
  npc in `PERSON_ROLES` — including a role-less one, which the schema initial
  makes a hireling — while monster, companion, transport and container fall
  through to Foundry's own `false`. **RULED 2026-09-10 and the default is NOT
  changing**, after a player reported a session of enemies sharing one HP bar:
  linked is what a Warden's Guide NPC and a hireling both want (unlinked people
  were twice fixed here as defects, HP typed on a token never reaching the
  sheet), Mythic Bastionland links its own npc type too, and the crowd case
  already has the Monster route plus the bestiary's `Bandit` and `Brigand`. The
  fix was SIGNPOSTING, not behaviour: a hint under the Create Actor dropdown
  (`CAIRN.CreateActorHint`) and `docs/tokens-and-sheets.md`, the roster guide
  that explains both routes and where **Link Actor Data** lives. Core's
  **Prototype Token Overrides** setting cannot express this and was tested:
  its schema carries sight, ring, turn marker, display name, display bars,
  disposition and lock rotation, and DROPS `actorLink` on construction — it
  also tabs by TYPE, so an override aimed at NPCs lands on every monster too.
  Gates: `npm run dev:token-defaults` for the defaults, `dev:dialogs` for the
  hint.
- **The Warden's Dashboard** (`module/warden-dashboard.js`, 2026-09-10, user
  ask after the Mythic Bastionland fork's Gamemaster Dashboard) — a GM-only
  ApplicationV2 on the Token controls beside the damage tool, putting all 45
  Warden tables on a button, six tabs, resizable and detachable. A LAUNCHER:
  everything on it is reachable another way and it owns no rules.
  **THE RULE, and it is not cosmetic: a single-table draw posts CORE'S OWN
  table card, always.** `encounters.js` grows its Add-to-scene button by
  reading `flags.core.RollTable` and the message's roll, which only
  `RollTable#toMessage` stamps, and hangs it inside `.table-draw`, which only
  core's markup has. A card of our own kills that button on nine tables in
  silence. Only the four COMBINED draws build a card, none of them touch an
  encounter table, and every drawn value in one is ESCAPED (review #24's class
  of per-viewer card rebuilds; this would be the fifth). Posting takes TWO
  calls — `draw({displayChat:false})` then `toMessage` — because `draw`
  forwards only `messageOptions` and never `messageData`, which is the defect
  that made a monster's Scar post under the attacking player's name.
  Button labels are UI KEYS, not the tables' names, per the ruling already at
  `actor-sheet.js`'s trait rows: "Warden: NPC - Quirk" is a name a Warden
  browses by and a terrible label. The Your Tables tab is the exception, since
  those names are the Warden's content and go through the overlay's
  `table.name` namespace. The generators and the damage tool on it are SECOND
  call sites into the Actor Directory's own functions, never copies — and the
  damage tool KEEPS its Token-controls button, because its targets come from
  the aiming gesture and that is a token-layer operation. One more trap worth
  the line: an AppV2 part must render exactly ONE root element, so the whole
  window lives inside one wrapper div. Gate: `npm run dev:warden-dashboard`.
  **The single-table draw card is REBUILT PER VIEWER too (2026-09-12, review
  #27).** Core's card, still — but its sender and flavor were composed on the
  Warden's client and STORED, so a Spanish player read "Path Difficulty" over
  Spanish rows on all 45 buttons; review #26 had fixed this window's other two
  cards and missed its most-used one. `postTableDraw` stamps
  `flags.air-bladder.dashboardDraw` with the table's BARE uuid (the reveal
  card's shape), and `localizeDashboardCard` relabels `.message-sender` and
  `.flavor-text` through `labelForTable` on each client. `toMessage` merges
  that over its own `flags.core.RollTable`, so the encounter button's flag
  survives beside it.
  **SHOWING a table to the players (2026-09-10, user ask the same day).** Every
  table button is a PAIR — the name rolls, an eye SHOWS — and Foundry cannot do
  this itself: `Journal.show` and `_showEntry` both return early for anything
  that is not a JournalEntry or JournalEntryPage. So it is a broadcast on the
  system socket plus a popup plus a chat card. **The payload is a BARE UUID and
  nothing renderable ever crosses the wire** — every client resolves it and
  renders from the real document, which is what keeps this out of review #24's
  argument entirely; a crafted emit can at worst name a table that exists.
  `senderId` is the guard (the one field the server authenticates) and its
  removal is probe-covered. It works on a player's client only because pack
  ownership `PLAYER: NONE` is sidebar concealment and not a read wall. The card
  is PUBLIC regardless of the visibility dropdown, by ruling: a reveal that
  whispers to the Warden is nonsense. Two traps: an AppV2 element id is stamped
  at CONSTRUCTION from `options.id` with `{id}` filled from `uniqueId`
  (`application.mjs:40`), so a `get id()` override is ignored and the window
  renders as `app-59` where nothing can find it — override
  `_initializeApplicationOptions` instead; and `labelForTable` maps a table's
  browse name to its button's UI key on EACH client, so the popup, the card and
  the roll card's speaker all read "Path Difficulty" rather than "Warden:
  Travel - Path Difficulty" without any label travelling.
- **Keeping time** (`module/game-time.js`, `module/watch-clock.js`, 2026-09-10,
  user ask) — **THIS SYSTEM'S FIRST USE OF `game.time`.** Two things live here
  and they are NOT the same thing, which is the whole shape of the feature.
  **WATCHES ARE CORE CAIRN 2e AND ARE NEVER GATED**: the Player's Guide
  procedures say a day is three watches (morning, afternoon, night) of eight
  hours each, the shipped travel tables already price a journey in them, and
  gating a 2e unit behind a setting-specific switch would be a category error.
  **THE VALD CALENDAR IS A HACK**, behind `enable-vald-calendar`. The user's
  ruling split it exactly there.
  Foundry 14 ships a real calendar (`client/data/calendar.mjs`), so Vald is a
  CONFIGURATION rather than a clock we wrote, and world time is server-synced
  and persisted in `core.time` for free. **Everything reads the LIVE
  `game.time.calendar`, never our own config literal**, so the watch maths stays
  right under Foundry's default, under Vald, and under a calendar module we have
  never heard of.
  **The hack CONVERTS NOTHING, and that is the contrast with `enable-glog-magic`
  worth keeping.** `core.time` is a fixed count of seconds that a calendar merely
  READS, so switching REINTERPRETS the clock rather than rewriting it and
  switching back restores the old reading exactly — no marker, no sweep, no
  onChange. The visible date DOES jump, which is why it `requiresReload` (one
  consistent state on every client at one moment) and why the hint says to set
  the date afterwards.
  Six things that will bite if forgotten:
  - **A BUG IN THE SHIPPED CLIENT.** `CalendarData#_decomposeTimeYears`
    (`calendar.mjs:391-403`) runs its remainder-years walk in BOTH branches, so
    the days a leap year has on top of a standard one decompose as day 0 of the
    following year — for Vald that is the entire six-day Reclamation week, and
    on core's own Gregorian it is the 31st of December. `ValdCalendar` overrides
    the method core's own docstring nominates for exactly this ("factored out so
    calendars which require advanced leap year handling can override"). Found by
    an offline replica of core's arithmetic; the witness is a
    `timeToComponents → componentsToTime` round trip, and `dev:vald-time` runs
    2000 of them.
  - **`leapStart` MUST be 0.** Core's two leap paths disagree for any other
    value: `_decomposeTimeYears` measures the pre-leap run as
    `Math.max(leapStart - 1, 0)` while `isLeapYear` compares against `leapStart`.
  - **Seasons are DAY-OF-YEAR, not month.** Vald's boundaries are mid-month and
    core tries `dayStart`/`dayEnd` FIRST, matching them against day of year
    (`calendar.mjs:275-289`). A **Reclamation season entry is listed first** and
    is load-bearing: without it the leap days match nothing, `components.season`
    comes back one past the end, and core does not guard the lookup.
  - **`yearZero: 7728` is read as an OFFSET** and core reads that field nowhere,
    so the meaning was ours to pick. **7728 is therefore itself a Reclamation
    year — OUR invention, the SRD gives no anchor, and it is FROZEN**: changing
    it re-dates every world that has run on it.
  - **TWO UPSTREAM ERRATA, RECORDED NOT FIXED.** The Warden's Guide says every
    season lasts 72 days while its own "season begins" rows give Wet 69 and
    Harvest 75; and it puts "the end of the Dead season" nineteen days before
    Dry begins. We encode the dated rows. `docs/keeping-time.md` says so where a
    Warden reads it, before somebody reports the arithmetic as our bug.
  - **`#ui-left-column-1` is STATIC markup** in core's `templates/views/game.hbs`.
    The scene controls and the player list replace their own `<template>`
    placeholders once and thereafter rewrite only their own innerHTML, so a
    sibling there survives both re-rendering and needs NO re-attach hook — which
    is the answer to "is there a hook for this?", the question these notes
    already record as the wrong one to ask first. The clock goes in BEFORE
    `#players` with `margin-top: auto`, because the column is
    `justify-content: space-between` with exactly two children and a third would
    push the player list into the middle of the screen.
  The DASHBOARD band is a SECOND AppV2 part so it can redraw alone.
  `parts: ["time"]` is load-bearing, not an optimisation: `_syncPartState`
  restores no field VALUES, so a bare `render()` silently resets the Warden's
  visibility dropdown to Public on every tick — measured, and probe-covered. Two
  parts also means two children of `.window-content`, so the restored
  `> * { flex: 1 }` would give the band half the window; the pin needs a
  selector that BEATS that rule's specificity, and the probe measures the height
  rather than trusting the rule to apply.
  **There is no Make Camp button, by ruling.** Make Camp is a Wilderness Action
  the PLAYERS choose, and the no-automation deviation protects player-facing
  rules; the Warden moves the calendar and the party decides whether they
  camped. "To Next Morning" is the same jump without the claim, and nothing is
  posted to chat. **Vald's weather REPLACES Cairn's on the Dashboard —
  Weather Difficulty included** (user ruling 2026-09-11, REVERSING the previous
  day's "alongside, never replacing", which this file argued at length and
  `VALD_WEATHER_GROUP` still records). The old reasoning was that Cairn's are a
  severity ladder feeding `Warden: Weather - Difficulty` while Vald's are
  descriptive, so a Vald table wants both. What it missed is what a Warden does
  with two sets of weather buttons on one tab: rolls both, and gets answers that
  contradict each other on the same day — the user's own example, "Cold and
  clear" arriving as Vald Dead 1 and as Weather Difficulty 5. All nine tables
  still SHIP; only the buttons swap, so a severity roll is still in the
  compendium browser. `weatherTableForToday` had already made exactly this
  choice for the band's own button; the tabs now agree with it. The clock is also the
  first surface here that is Foundry CHROME rather than a sheet, so it is the
  one place that reads core's colour variables instead of the `--ab-*` palette
  (`docs/theming.md`; `dev:theme` measures it). Gate: `npm run dev:vald-time`.
  **THE CALENDAR ON THE WALL** (`module/vald-calendar.js`, 2026-09-10, user
  ask: "a calendar where they can see the current day as well as the rest of
  the days in the month, like a calendar you would put on your refrigerator").
  VALD ONLY, by ruling — a grid needs month names, and under Foundry's own
  calendar those are January and a year like 0, which would contradict the
  clock's deliberately honest "Day 12". The clock is the DOOR: with Vald on its
  panel is a button, and anyone may open the window. Browsing can never move
  the world — the Warden sets the date from a button INSIDE the day panel and
  never by clicking a day.
  **A LICENCE BOUNDARY DECIDED THE ARCHITECTURE, not a technical one.**
  `LICENSE.txt` declares `module/ templates/ css/ tools/ lang/` to be MIT "and
  only these", while every word of Cairn's text is CC BY-SA and lives in
  `packs/`. So the Warden's Guide's 24 festival descriptions may NOT go in
  `lang/en.json` — that would make the inventory's own sentence false, and
  `check:licence` compares README against LICENSE.txt so nothing would catch
  it. They ship as a second JournalEntry generated by `tools/import/vald.mjs`,
  which means one copy of the text, still upstream's, with the content overlay
  and the existing credit for free. **Ask this question of any new content
  before choosing where to put it.**
  Four more things that will bite:
  - **THE IMPORTER'S PARSE CHECKS ITSELF.** Every holiday row NAMES its
    weekday, so the importer recomputes the weekday for the day number it
    parsed and throws on a mismatch — and for a span, the last day too. A
    misread day cannot pass. Proven by control: swapping two entries in
    `WEEKDAYS` reds it on Sunrise 14.
  - **The calendar finds its festivals by FLAGS, never by name.** An entry or
    page name goes through the content overlay, so a name lookup finds nothing
    on a Spanish client — the exact failure the overlay's own rule exists to
    prevent.
  - **Browsing state lives on the INSTANCE and is never re-derived.**
    `updateWorldTime` re-renders every open calendar, so a `_prepareContext`
    that started from today would snap a Warden reading next month back to this
    one the moment anybody advanced a watch. It looks right until the clock
    moves.
  - **`JOURNAL_BLOCKS` and `localizeJournalBlocks` MOVED to `i18n-content.js`**
    (out of `cairn.js`), because the journal sheet and the calendar are now two
    readers of journal prose and the "must stay identical to the extractor"
    contract needs ONE home. `dev:journal-i18n` still gates it.
  **A WEATHER LOG AND THE WARDEN'S OWN DAYS** (`module/weather-log.js`,
  `module/calendar-events.js`, 2026-09-11, both asked as "is it possible…").
  The log writes one journal line every time the weather is rolled or set —
  date, watch, season, whatever the calendar marks, the weather — one page per
  month, readable by the whole table (user ruling), behind `weather-log`,
  default off. The Warden's events are JOURNAL PAGES carrying the same
  `flags.air-bladder` a festival does plus `valdYear`, `valdWatch` and
  `wardenEvent`, so one reader serves both and editing an event is editing a
  page. Five things that will bite:
  - **NEITHER JOURNAL IS FOUND BY A STORED ID, and that is not a style
    choice.** Awaiting `game.settings.set` does NOT guarantee the next
    `game.settings.get` returns the new value — measured, intermittently — so
    an identity that must be written and read back is missing for a few hundred
    milliseconds, and the calendar renders inside that window. Both are found
    by their own FLAG. Two internal settings were designed, built, and deleted
    again over exactly this.
    **AND A FLAG ALONE IS NOT IDENTITY (2026-09-12, review #27).** A flag sits
    on a document any TRUSTED player may create (`JOURNAL_CREATE` defaults to
    that role, and the creator lands OWNER), so a player's journal flagged like
    ours and sorting first captured every line the Warden wrote — the weather
    log's pages, the next "Add an event…" — into a document the player edits,
    and its pages flagged `wardenEvent` drew on the Warden's own calendar. Both
    finders now also require `lastWrittenByWarden` (`calendar-events.js`):
    `_stats.lastModifiedBy` is stamped by the SERVER from the requesting user
    and a client cannot forge it, the same field `syncPendingOwnership` leans
    on. A journal nobody can vouch for is not ours, and the module makes its
    own. **LAST writer, because 14.365 HAS NO `_stats.createdBy`** — the
    review named that field, the first cut of the fix trusted it unmeasured,
    and a guard on an absent field was false for every journal including ours:
    a fresh log on every write, twelve `dev:vald-time` legs red in the green
    phase of the red-first batch, which is the batch earning its keep. Measure
    a field before trusting a reviewer's name for it.
    Two smaller things from the same review: a page's visibility is its
    ENTRY's ownership, so the calendar's refresh list carries
    `updateJournalEntry` — raising the hidden journal through core's ownership
    dialog fires on the entry and on no page, and a player's open calendar
    gained nothing until the next tick — and every button on the calendar and
    the time band carries a STABLE id, because core restores keyboard focus
    across a part replacement only to an element it can name by `#id` or
    `[name]` (handlebars-application.mjs `_preSyncPartState`); without one,
    Enter three times on Advance Watch advanced one watch and stranded the
    focus on `<body>`, which made the template's "reachable from the keyboard"
    line a lie.
  - **A PROBE THAT SHADOWS `game.settings.get` MUST FORWARD EVERY ARGUMENT.**
    `#setWorld` asks `this.get(ns, key, {document: true})` for the Setting
    DOCUMENT (client-settings.mjs:294); a two-argument shadow hands it a plain
    value, `current?._id` is undefined, and core CREATES A SECOND Setting
    document instead of updating the first. The write then silently does
    nothing and the duplicate outlives the probe. The dev world had **131** of
    them, across `core.time`, `custom-portrait-list` and more, from probes that
    have shadowed this way for weeks. **This line then said "every shadow in
    `tools/dev` forwards `...rest` now" for a day while EIGHTEEN of them, in
    eight probes, still called `origGet.call(this, ns, key)`** — and a
    nineteenth (`portrait-probe`) forwarded the argument but answered the
    document request with `[]`, which is the same trap in a second shape.
    Four more duplicates of `custom-portrait-list` accumulated in a day, one
    per sweep, every one from the portrait-folder scan writing its cache while
    one of those shadows was installed (2026-09-12). Every function-form
    shadow now forwards AND passes any `{document: true}` request straight to
    `ClientSettings.prototype.get`, and `check:probes` refuses a shadow that
    does either half wrong — a claim about probe hygiene is a copy that
    drifts unless a gate holds it.
  - **DialogV2 REFUSES a content element with ANY attribute** — "config.content
    element must have no attributes" (dialog.mjs:189), thrown from the
    constructor, so the dialog never opens and the button does nothing. A
    single `class` is enough. THREE dialogs here had one and shipped broken on
    `dev`: Set the Date…, Set the Weather… and the new Add an event…. The class
    goes on a wrapper INSIDE the bare `<div>`.
  - **"Hidden" is CONCEALMENT, not a secret.** A JournalEntry with
    `ownership.default: NONE` is still SENT to every player — it resolves on
    their client, pages and text included. NONE buys `visible: false` and a
    failing permission test, which keeps it off their sidebar and their
    calendar. Same family as `foundry-pack-ownership-none`; the claim was
    written as a wall first, measured second, and corrected. `docs/keeping-time.md`
    tells a Warden the truth.
  - **The log is written from the `cairnWeatherChanged` hook, by the ACTIVE GM
    alone.** That hook fires on every client, so without the guard a table with
    two Wardens logs every line twice. And the line is stored in the writing
    GM's language, deliberately: it is a record, not a rendered surface, so the
    content overlay does not apply.
  **The Dashboard's readability pass rode the same batch** (user: "very crowded
  and difficult to read"). CENTRED TEXT WAS THE DEFECT, not the gap size: a
  glyph column with a LEFT-ALIGNED label makes every label start at the same x,
  so the eye runs down the column instead of reading each of 45 buttons. A
  table entry gained a third member, the glyph, so `PANELS` stays the one
  description of a button. Vald's four weather buttons READ `SEASON_ICONS`
  rather than restating it (user ask: "the same buttons used in the calendar
  display"), and Today's Weather wears the glyph of the season it will actually
  roll. A MISSPELLED FA CLASS RENDERS AN EMPTY BOX WITH NO ERROR, so the
  probe reads `getComputedStyle(el, "::before").content`, never the class list.
  **THE PALETTE IS FONT AWESOME 7 PRO, not Free** — measured 2026-09-11, after
  this file and the code had both claimed Free for a day and narrowed the
  choice for nothing. Foundry 14.365 BUNDLES the Pro fonts
  (`app/public/fonts/fontawesome/`, Pro LICENSE.txt, solid/light/thin/duotone/
  sharp) and the client loads "Font Awesome 7 Pro" at four weights, so
  `fa-sunrise`, `fa-sun-dust` and the rest resolve. Verify a glyph by RENDERING
  it, never by finding the class in `all.min.css` — that file names glyphs
  whether or not the font carries them.
  **A GLYPH MEANS ONE THING PER WINDOW** (user ask 2026-09-11, "suggestions on
  avoiding duplicate icons"). A season's mark belongs to the season and nothing
  else may wear it; `fa-sun` was Dry AND To Next Morning, one row apart, so for
  seventy-two days a year the band showed one mark for two things. Dry is
  `fa-sun-dust` now and that button is `fa-sunrise`. THREE repeats are
  deliberate and declared rather than discovered: the eye is always "show to
  the players", the pen is always "type a value", and Today's Weather wears its
  season's glyph on purpose. `dev:vald-time` gates the rule in the band.
  **A SECOND PASS RODE 2026-09-11, off a screenshot.** The Dead season wears a
  SKULL now, not a snowflake, and one edit to `SEASON_ICONS` moved five
  surfaces because every one of them reads that map. **"Roll the lot" is gone
  as a phrase** (user: "I do not like that phrase, let's remove it wherever we
  can"), and the heading was deleted rather than renamed: each tab's combined
  draw joined the grid at the top of its tab, wearing the tooltip the heading
  used to be. **The two EVENT tables moved into the time band**, which renders
  on every tab — and that exposed a defect worth the line: `labelForTable`
  walked `PANELS` only, so anything declared elsewhere showed a PLAYER its
  browse name. The Vald weather four had never been in `PANELS`, so a reveal
  had always put "Warden: Vald - Weather (Dead)" on their screens. It walks
  every declaration now. **Who sees the result opens PRIVATE** (`gm`, not
  core's Public) and moved ABOVE the tab strip, where its scope is visible —
  sitting under the strip made a window-wide control read as Travel's own. The
  eye and Roll Today's Weather still post publicly by their own earlier
  rulings. Type: the band's date and the calendar's day statement are both
  22px, the clock 14/18px, all MEASURED by probe because a rule that stops
  applying leaves no other trace. **And a third pass the same day, from a
  screenshot of both windows open: THE BAND STACKS LIKE THE CALENDAR'S DAY
  PANEL** (user: "the top three lines of the Warden's dashboard should look
  like the lines in the calendar") — the long date as a headline, then the
  watch, the season and the weather as quiet glyph-led lines, no middle dots
  and no tooltip, because every word it carried is now on screen. The WATCH
  gets a line of its own by ruling, which is why the band has four where the
  panel has three: this is the surface where the clock is moved. The band and
  the panel now show the SAME STRING for a day (`describeTime().dateLong`),
  and the probe compares the two surfaces rather than measuring each.
- Data models in `module/data-models.js` (TypeDataModel; `template.json` is gone,
  sub-types are declared in `system.json` `documentTypes`); 30 compendium packs
  (30 on `master` too since 0.1.18 shipped `journals-vald`, the Warden's Guide
  setting chapter as one nine-page book, on 2026-08-23 — and since 2026-09-10 a
  SECOND entry in the same pack, "Festivals of Vald", 24 pages the calendar
  window reads by their `flags.air-bladder` and never by name; this count went stale
  TWICE in one day, both times by the hand that had just corrected it, and its
  "N on master" parenthetical went stale a THIRD way by surviving two releases
  — a new pack's commit must carry this line, and so must the release that
  moves the master count, which is what this post-release merge is doing)
- 28 Warden-facing settings in `module/settings.js` (38 `register` calls + 4 `registerMenu` menus from ONE call site,
  ALL `config: false` since 2026-08-22 — see the submenu paragraph below; `roles-restamped`,
  `companion-restamped`, `hireling-split`, `grimoire-keys-stamped`,
  `connections-migrated`, `art-migration-generation` (2026-08-21, review #17 —
  the art sweep's generation marker), `custom-portrait-list`,
  `disabled-backgrounds` and
  `connections-ui-enabled` and `vald-weather-today` are internal, `config: false`;
  counts have gone stale three times — `allow-player-randomization` outdated them
  (review #13's catch, its third "record claiming what the code does not say"),
  then `enable-glog-magic` rode a topic branch whose cherry-picks never carried
  this line, caught only when the branch merged — so each settings change updates
  them in its own commit, this one dated 2026-09-11 for `weather-log` (General,
  default OFF — switching it on makes this system CREATE a document in
  somebody's world, which an update must never start doing by itself; see the
  Keeping time paragraph) and before it 2026-09-10 for the TIME pair plus the
  internal `vald-weather-today` (the day's weather, `{day, text}` keyed on the
  ABSOLUTE day so yesterday's goes stale by itself — and the ONE setting here
  that NEEDS an `onChange`, because three surfaces are already on screen when
  it changes and a world setting reaches other clients through its own handler
  or not at all) —
  `show-watch-clock` (General, world-scoped on show-omens' reasoning: whether
  the table tracks watches at all is the Warden's call) and
  `enable-vald-calendar` (Hacks; see the Keeping time paragraph below for why
  it must be ONE key and why it needs a reload). The update before that was
  2026-09-07 for `show-traits` (rolled
  traits + age hidden from every person sheet AND print, one switch both
  surfaces per the show-omens ruling; pronouns stay; General, beside
  show-omens). The previous update was 2026-08-21 for `age-formula`, which
  REPLACED `min-age` and `max-age` two days after the ceiling landed: Malecho's
  cap-of-30 test came out all 30s, because clamping 2d20+10 piles ~57% of rolls
  onto that bound — the cap worked as coded and the DESIGN was the defect, so
  the Warden edits the dice now. The default is RAW `2d20 + 10` (user ruling,
  same day): a `{2d20 + 10, 21}kh` default briefly preserved the retired
  min-age's 21 floor and was REVERSED within hours — rules as written win,
  the floor was an override, and ages 12–20 are possible again out of the
  box; the pool form survives as the hint's example and the user's own
  preference. `docs/dice-formulas.md` (roster guide, site card, both
  READMEs) explains the notation, and the hint names it BY TITLE — renaming
  the journal entry breaks a pointer no gate checks. The Kettlewright
  importer's clamp on PARSED ages retired too, an imported age lands
  verbatim) —
  **Since 2026-08-22 the 25 live behind FOUR `registerMenu` SUBMENUS** (user
  ruling, "one submenu per group" — General, Character Generation, Inventory
  & Encumbrance, and GLOG & Other Hacks, the fourth asked for the same day to
  hold the GLOG toggle and the Barebones failed career): every one is
  registered `config: false`, the main Configure Settings window shows four
  buttons under Air Bladder and no loose rows, and each button opens a small
  ApplicationV2
  (`module/settings-menus.js`, modelled on core's own `DiceConfig`) that
  renders its group's rows with core's `formGroup` helper and saves the way
  `SettingsConfig` does — `reloadConfirm` included, with one departure and one
  addition (review #18): values switched ON are written before values switched
  OFF, so the content-source floor's `onChange` never fires on a mid-save state
  the Warden did not ask for; and each app carries its own Reset Defaults,
  because core's skips `config: false` settings, which is every one of ours
  now. `SETTING_GROUPS` in
  `settings.js` is the ONE declaration (id, title, button — the text ON the
  button names what it opens, "Configure Inventory" not a shared "Configure",
  user ruling 2026-08-22 after Dice So Nice's per-menu buttons — hint, icon,
  keys, and the
  per-group decorations: the Barebones sub-option disable — whose master
  checkbox lives in ANOTHER app, so Hacks greys it from the STORED value at
  render, not live — and the bolded product names), consumed by the menu
  registration and by `dev:settings`,
  `dev:ui-parity` and `dev:age-override`. Consequences: **registration ORDER
  is no longer load-bearing** — until this it was, because the grouping was
  positional `<h3>` headers inserted into the flat list, gated since review
  #16 with its own order leg, and that whole apparatus (headers, a
  MutationObserver following core's search, compact rows, hint tooltips)
  went with it; the gate is MEMBERSHIP now (every Warden-facing key in
  exactly one group, `INTERNAL_SETTING_KEYS` the only exemption). **Hints
  render beneath every row that registers one**, natively — the compact-row
  CSS had hidden every air-bladder hint from the first commit until
  2026-08-21, when the Age formula's hint was the first to need reading; the
  submenus end the tooltip workaround that bridged the day. And `hint` is
  OPTIONAL: the same day, ten hints that merely restated their label were
  dropped (user ruling) — a label that says it all needs no hint, and
  `dev:settings` asserts hint-per-REGISTRATION, never hint-per-row. The
  search trade-off is dissolved
  rather than accepted: core's settings search matches `[data-searchable]`
  text inside a row (category-browser.mjs:228-232), so the one remaining
  `renderSettingsConfig` hook stamps each button row with its settings'
  labels and hints, and typing a setting's name still surfaces its button —
  probed with an in-page control that strips the index. Two went on
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
  **And `enable-inventory-reorder` went on 2026-08-22** (user ruling:
  drag-to-reorder "should not be optional and just be an always-on setting")
  — it gated whether the sheet read each item's `sort` and honoured a
  same-actor drop as a reorder; both are unconditional now, and `dev:ui-parity`
  asserts it unregistered like its two predecessors.
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

**AN EMPTY SHEET IS A THIRD ROUTE (2026-09-11, user ask relaying a Warden's).**
Every creation route — Generate PC, NPC, Hireling, Monster, and the Create Actor
switchboard — opens one dialog carrying a ticked **"Use random generation."**
Clear it and the actor arrives with nothing rolled, for a table that deals
characters on paper and wants to transcribe one.
**IT IS NOT THE CHARACTER BUILDER THIS PROJECT DECLINED**, and the difference is
the reason it was allowed: no build flow, no wizard, not one new picker. It lets
an existing sheet start empty and leans on pickers that already ship, whose
documented purpose is already "recreate a character you rolled with the book,
paper and dice". `docs/generating-characters.md` still opens with "not built —
dealt", and now says outright that if you have no character, you roll one.
Six things that will bite:
- **THE PROMPT LIVES IN ONE WRAPPER, `createActorInteractive`, and the four
  generators underneath stay NON-INTERACTIVE.** `createCharacter`, `createNpc`,
  `createHireling` and `createMonster` open no dialog at all. Twenty probe call
  sites across eleven files call them directly, and putting the prompt inside
  them left every one waiting on a modal nobody would answer — found by running
  them, not by reading. `createMonster` therefore STOPPED prompting for a tier:
  it takes one, and `promptMonsterCreation` asks.
- **HP is 3, abilities keep the schema's 10/10/10** (user ruling). ZEROS were
  asked for first and REVERSED on measurement: the sheet derives Dead from STR
  0, Paralyzed from DEX 0 and Delirious from WIL 0, so an empty character would
  have opened wearing three status banners — the state `_computeStatContext`
  already documents for a crate.
- **Character Creation Mode arrives ON**, against the 2026-08-02 "a sheet opens
  quiet" default, which was about a GENERATED character. The mode is the only
  thing that renders the pickers, and a bond and a question answer are
  read-only prose, so a picker is the ONLY hand-entry path to either.
- **The background die and picker had to be added to the NO-BACKGROUND branch**
  of `character-sheet.html`. They hung off the generated branch alone, so a
  character with no background stored had a text box and no way to reach the
  table. Invisible while every character arrived generated.
- **A HAND-BUILT SHEET IS HANDED NOTHING** (user ruling, same day, reversing
  this feature's first cut — which granted gear on a picked background and was
  documented as doing so). `HAND_BUILT_FLAG` is stamped by `createBlankActor`,
  and while it is set a **background, a question answer, a bond and the
  Barebones failed career** all record the choice and grant no items, no
  containers and no coins. The empty sheet exists to transcribe a character
  already rolled on paper: its owner knows what it carries, and granting means
  deleting a pack's worth of gear nobody asked for.
  **IT COVERS ALL FOUR KINDS SINCE REVIEW #26, and for a fortnight it did
  not.** The flag was stamped by `createBlankActor` on character, npc, hireling
  and monster from the first commit and READ only on the character paths, so a
  blank NPC's Background picker — the feature's whole point — handed over the
  background gear AND the entire `npc-kit`, enough to land it encumbered at
  derived HP 0. `applyNpcBackground` and `applyHirelingCareer` ask now. **A
  CAREER ALSO SUPPRESSES ITS STATBLOCK**, which the character-side ruling never
  had to say because a background carries none: adopting one used to overwrite
  the STR/DEX/WIL and HP the Warden had just typed off the paper sheet, and
  those numbers are the transcription, not defaults to re-derive. **The way out
  exists on every kind too** — `regenerateNpc`, `regenerateHireling` and
  `regenerateMonster` clear the mark, where before nothing on the npc side ever
  did and a fully re-rolled blank NPC claimed to be hand-built for the life of
  the document.
  **DURABLE, not "while the sheet is still empty"** — the ruling chose between
  exactly those two, because an emptiness test changes behaviour the moment the
  first item is typed and nothing on screen says why.
  **The way out is Roll Character with Background checked** (the checklist's own
  default). It clears the mark AFTER `changeBackground` returns true, passing
  `ignoreHandBuilt` so the re-deal is not suppressed by a mark about to stop
  being true — clearing FIRST was the obvious order and shipped for a
  fortnight, and it broke on that function's own two refusals, both of which
  fire before any write: an aborted gesture left a character that had silently
  stopped being hand-built (review #26). **Ticking Starting gear is a second
  way out** and must be, since it asks for the loadout in as many words; it
  used to grant while LEAVING the mark set, which is worse than either
  alternative, because the next background pick then deleted the lot and
  granted nothing back. A bare background die does NOT clear it — pressing that
  die is still choosing a background.
  **THERE ARE FOUR FAILED-CAREER WRITERS AND THE SHEET'S IS NOT THE ONE THAT
  MATTERS:** `replaceFailedCareerKeepsake` is called from inside
  `changeBackground` itself, so the same call that had just suppressed every
  grant ended by creating a keepsake. Only the sheet's `_grantFailedCareerItem`
  had the term. **And that helper now takes `handBuilt` FROM its caller
  (review #27)** rather than re-reading the flag: `changeBackground` computes
  it as `isHandBuilt && !ignoreHandBuilt`, and the way-out gesture clears the
  mark only after the call returns, so a helper reading the flag itself saw a
  sheet still hand-built and, on the one branch where it runs — a fresh
  Barebones background colliding with the stored failed career — deleted the
  keepsake and granted none. Same shape as the finding it was fixing.
  **The hireling's `critical: false` rides INSIDE the hand-built gate too
  (review #27):** it is the statblock-reset half of a new career, and a
  hand-built hireling in Critical Damage had the one status the sheet wears as
  a banner wiped by picking a Career, under `abNoStatusCard` so no card said so.
  **THERE ARE THREE BOND-GRANTING PATHS AND THE OBVIOUS ONE IS NOT ENOUGH:**
  `_applyBond`, the sheet's Add-a-bond handler (which creates items DIRECTLY,
  not through the applier) and `rerollAllBonds`. Suppressing only the first
  looked like a landed fix; the probe leg that clicks the real Add-a-bond
  control is what found the gap, and a witness reds that leg alone.
  A question row's stored `gold` is zeroed too, not merely withheld: a later
  swap REFUNDS each row's recorded gold, so a row remembering a grant that never
  happened would pay out coins the character never had.
- **THE BOX IS WITHHELD FROM ANYONE IT WOULD STRAND** (review #26).
  `createBlankActor` sets `generationEnabled` because the mode is the only
  thing that renders the pickers — but the SHEET derives that as the actor's
  flag AND `_mayRandomize`, which for a non-GM reads
  `allow-player-randomization` on a character and is flatly false on every npc
  type. With generation allowed and randomization off, a supported
  combination, a player who cleared the box got a character with no background,
  no gear and no control on the sheet that could enter either, recoverable only
  by the Warden deleting the actor. `blankIsFillableBy` answers on the CLICKING
  client, the relay included. **The callback must ask it too**: with the
  control absent `!undefined?.checked` is TRUE, so a missing checkbox read as a
  cleared one and delivered the very sheet the gate exists to prevent.
  **And the BROKER asks it too (review #27)** — withholding the box is the
  affordance, the answering GM client is the enforcement, and it coerced
  `blank` for type only, so a crafted or stale client emitting `blank: true`
  past the withheld box got exactly the stranded sheet. The broker's own
  comment already said a player's request must be refused THERE; now it is.
- **THE WARDEN IS ASKED NOW**, reversing 2026-08-08's "the Warden's own button
  keeps rolling instantly". That ruling was about an accidental click, which
  only ever threatened a player; this dialog is where the choice is MADE. One
  extra click on the most frequent action, accepted with eyes open.
- **The choice crosses the relay wire** (`blank`, coerced `=== true` on the
  receiving side). Get it wrong and a player who cleared the box is handed a
  rolled character by a client that never saw it. Gate: `npm run dev:blank-actor`,
  plus the relay leg in `dev:playergen`.

**A generated loadout arrives ARRANGED (2026-08-21, user ask).** Six bands, top
to bottom: weapons, armor, **spellbooks and spellscrolls together** (one band
because they are one TYPE — a scroll is a flag), everything else in the order
it was granted, light sources with each one's fuel directly beneath it,
Rations. `orderGrantedItems` (`module/gear.js`) writes it as each item's `sort`
at all four generators plus `regenerateNpc` — the one full regenerate that
keeps items — and a career/Background swap (die or picker) re-arranges the
whole inventory too, or its replacement gear would append in career-list order
with Rations on top. Four things that will bite:

- **`sort` is ALWAYS read (since 2026-08-22).** It used to be read only while
  `enable-inventory-reorder` was on — with it off `_sortItemsForDisplay` sorted
  equipped-first alphabetical and the arrangement was invisible, correctly for
  a Warden who had asked for an automatic order. That toggle was retired by
  user ruling ("should not be optional"), so manual order is the only order.
- **It is a one-time state, not a standing rule** (user ruling). A later
  acquisition APPENDS — `CairnItem.#appendSort` gives any sort-less item on an
  actor `max + DENSITY`. That is a fix in its own right, not just support:
  core gives a new embedded item `sort: 0`, which is ABOVE every numbered row,
  so buying one thing put it at the top of the pack over the sword. Already true
  before any of this, since the first drag renormalises every sibling to
  positive values. Every partial re-roll and the marketplace ride that seam and
  needed no change of their own.
- **A BOUND GRIMOIRE PAGE is deliberately left at 0.** `groupPagesUnderBooks`
  lifts every page out of the flat list and re-files it under its book, so a
  page's own position is never used and only its order among SIBLING pages
  survives — alphabetical, via the display-name tie-break. Numbering pages
  changed that to transmute order, which `dev:print` caught and nobody asked
  for.
- **"Light source" is a NAME, not a field**, and the two halves are asymmetric
  on purpose: sources are a keyword regex (right for the Wisp Lantern and the
  Torch Fungus too), fuel is an exact map, because `\boil\b` would swallow Fire
  Oil and Miracle Oil. `isMundaneGear` asks the same classification
  rather than keeping its own overlapping copy, which leaves a granted
  Candle without a Background chip — intended, and what that rule always said
  it meant. **Since 2026-09-02 mundane grants are TAGGED
  `background-mundane`** (user ruling, review #21 finding 2 — reversing
  "left untagged on purpose"): the chip stays off via `grantSourceLabel`'s
  unknown→"" (the npc-kit precedent), but the tag gives the re-deal sweep
  identity — the untagged name-matcher ate a player's BOUGHT Rations on the
  second re-deal and let an instruction row's resolved item pile up. The
  name-matcher survives for LEGACY pre-tagging characters only, skipping any
  ref a tagged claim already satisfies; `BG_GRANT_SOURCES` is the pair every
  background-gear sweep must ask for.

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
  `combat.js`) — and since 2026-08-23 (review #19) the CHAT CARD HEADER:
  core prints the raw speaker alias in `.message-sender` while the attack
  line beneath it was translated, so a Mule's card read "Mule" over a sheet
  reading "Mula". `localizeSpeakerName` in `cairn.js` follows the token's
  name where the message was spoken as one (a Warden's "Goblin A" stays)
  and the world actor's otherwise (a PC never localizes); a speaker nothing
  resolves — a compendium sheet's roll — keeps core's text. The GLOG cast
  flavor resolves the same name per viewer, so it agrees with the header
  above it. The sidebar one (2026-08-19, review #16) had to WRAP the app
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
  **A STORED CHAT LINE composed on one client is rebuilt per viewer from a
  flag that carries a KIND or an ENGLISH source string, never text (rule
  restated 2026-09-12, review #27, after four more surfaces turned up).** The
  status bar (`postStatusCard` stores a kind; `localizeStatusCard` rebuilds
  the line, `hasOwn`-guarded so a crafted kind finds no spec), the encounter
  quantity roll (the English monster label; `localizeEncounterQty`), the scar
  card (its own flag; the flavor rebuilt from the key inside
  `localizeTableResults`), and core's OWN draw flavor, which stamps the
  table's raw browse name and which `localizeTableResults` now rebuilds
  through the `table.name` namespace from the message's table — resolved by
  core's id flag, never parsed out of the stored sentence. Every one had a
  translated row under a composer-language line. Review #26 had fixed the
  Dashboard's cards under this rule and the older cards sat beside them
  unnoticed; the sweep after a fix in this class should grep every
  `flavor:` and every `content:` a card stores.
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
    takes `{ ignoreCapacity: true }` for this and for accepted gifts (below),
    nothing else.
  - **An accepted GIFT (2026-09-06, user ask).** The player-to-player hand-off
    (`module/item-offer.js`) creates the recipient's half past a full pack —
    but only after the recipient's own click on a confirm that names the cost
    (HP 0 until a slot frees). An informed yes is the player deciding what to
    carry, the same choice the generation case protects; refusing it would
    cancel a gift, not protect anyone. The OFFER flow is also what a drop on
    an unowned character sheet becomes — before this, that drop silently died
    on core's owner wall.
    **WIDENED 2026-09-10 (user ask) past character-to-character: a PC may now
    offer to anything they can SEE** — a Limited innkeeper, a crate, a mule, a
    companion. **Expressed as NO ROLE LIST**, deliberately (`canReceiveOffer`):
    the three walls that decide who really can are already generic — the picker
    shows only what this user can see, the card offers Accept only to an OWNER
    or the Warden, and delivery runs on a client that owns the target — and a
    role predicate that quietly grows is this codebase's thrice-repeated bug.
    That is also the entire answer for MONSTERS: ownership NONE keeps them out
    of a player's picker, and a Warden who wants one offerable raises it to
    Limited. The probe's control is two-sided (raise it, it appears; drop it, it
    goes), which is the only thing that tells this design apart from a hardcoded
    monster exclusion. Two exclusions are about the DOCUMENT, not the role:
    `.pack` (an index entry has no permission API) and **`.isToken`** — a
    synthetic actor's uuid resolves only while its token exists, and the card is
    a permanent message rebuilt per viewer FROM that uuid, so a token deleted
    after the fight turns every past card into "? offers ? to ?".
    **AND THE OVERFLOW RULE DOES NOT TRAVEL WITH IT.** `capacityVerdict`
    (`module/gear.js`, one test now where three spellings used to live) returns
    `overburden` only for a PERSON; a thing, a companion or a monster gets
    `full`, which NOBODY may buy on EITHER route. "Overflow is owed" is a rule
    about a person being handed what the rules give them — a crate has no Hit
    Protection to pay the cost with, so there is nothing to consent to. It is
    also the only answer that stops an offer disagreeing with the drop
    handler's own `ContainerFull`, which it did: `deliverItem` passed
    `ignoreCapacity: true` unconditionally and would have ended a 2-slot crate
    at 4/2 while the identical drag was refused.
    Three more things worth the lines. **`_canDragDrop` was a THIRD gate nobody
    had counted** (`actor-sheet.js`): while it read `type === "character"`,
    drag-drop never BOUND on an unowned npc or container sheet, so `_onDropItem`
    was never reached and the type test inside `offerFromDrop` was dead code for
    exactly the targets this change was about. **The card's waiting line is
    DERIVED, never stored** — "waiting for {target}'s player" is false when
    nobody owns the target, and a stored "the Warden answers this" marker would
    be review #24's class exactly, since the flag is written by the giver's own
    client; live `Actor#ownership` is server-walled and is read instead. And
    **giving to something you already own settles in ONE click**
    (`settleOwnOffer`), through the ordinary accept rather than a second
    transfer path, because waiting for yourself to press Accept is theatre and
    the Connections UI is parked.
    **AND THE GIVER SIDE REVERSED ON 2026-09-10** (user ask: "whoever owns the
    NPC should be able to open it and give items without having to drag"). This
    section stated the opposite asymmetry in as many words — "giving FROM an NPC
    is the Warden's own drag and needs no card" — and that is now history.
    `canGive` and `canOfferItem` both swap `type === "character"` for `isOwner`,
    and NOTHING ELSE CHANGES, because `templates/parts/items-list.html` is one
    partial every role's sheet renders: the button appears on npc, monster,
    container, transport and companion sheets the moment the gate says yes, and
    the picker, the card, the capacity verdict and delivery are untouched. A
    player who owns a hireling or a connected mule gets it too, which is the ask
    read literally.
    **THE ONE-CLICK SHORTCUT HAD TO TIGHTEN IN THE SAME BREATH, and this is the
    trap worth remembering: a shortcut written for a player is not safe the day
    a GM inherits it.** `settleOwnOffer` fired on `target.isOwner`, which was
    exactly right while only a character could give — a player owning both ends
    really was the only person with a say. A GM owns EVERY actor, so the moment
    the Warden could give, that same line delivered straight into a player's
    pack with no card and no confirm, past the very over-burden dialog that
    exists to make them consent to Hit Protection 0. The user ruled the player
    answers. The trigger is now `ownersOf(target).some(u => u !== game.user)` —
    "nobody ELSE could answer" — so a player stowing a rope in their own crate
    is still one click and the Warden handing one to Alice's character is not.
    Probe-covered with a control that lands the item early.
    **An unlinked token CAN give**, deliberately: monsters are unlinked by
    ruling, so "open the dead goblin and hand the sword to Alice" is the
    commonest case there is, and excluding token actors the way they are
    excluded as TARGETS would make the feature miss its main use. The reason
    for that exclusion still stands — a synthetic actor's uuid resolves only
    while its token exists and the card is permanent — so a card whose GIVER no
    longer resolves reads `CAIRN.Offer.HiddenGiver` ("Someone"): its OWN key
    since review #27, not the hidden target's `HiddenTarget` ("someone") it
    reused for a day, because this word opens the sentence and that one sits
    in the middle of it, and one string id cannot be capitalised in one slot
    and not the other in any language. Deliberately NOT
    `message.speaker.alias`, which would be friendlier and is a stored name
    written by the giver's own client: review #24's class exactly.
    **THE PICKER'S CHECK FOLLOWS ITS FILTER (review #27).** Row one is
    pre-checked so the radio group is never indeterminate, and the search box
    hid rows by class and never moved the check — so typing "Car" showed only
    Carol's row while Offer, which reads the checked radio and nothing else,
    sent the item to Alice. The checked radio is now a VISIBLE one or none,
    Offer is disabled when none is, and Enter in the field is guarded the way
    the marketplace's and the art picker's already were: every DialogV2 button
    is `type="submit"` and implicit submission fires the FIRST one.

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

## Licensing — seven regimes, and the traps

**The inventory lives in `README.md` (canonical) and `LICENSE.txt`, and
`check:licence` holds them in step.** It is not repeated here any more. This section
used to carry a third copy under the heading "Four licences, not one", listing five
regimes while six shipped — the OFL fonts were missing, and their clause 2 requires
the notice travel with every copy. Nothing checked it, because the gate compares the
two files that matter and had no reason to know about a list in the working notes.
**A third copy of a list is a third thing to drift**; if something here needs a
regime named, name the file that holds it.

What belongs here is what those two files do not say:

- **`module/npc-careers-2e.json` is GAME TEXT under the MIT path list, and
  both clauses say so (2026-09-12, review #27, user ruling).** The Code clause
  names `module/` "and only these"; that file is the SRD's twelve example
  hirelings, extracted by `tools/import/npc-careers-2e.mjs` and read by the
  hireling generator at runtime, and it had sat there since the first commit,
  before the Vald-festival rule about where Cairn text may live existed. So the
  only licence document in the zip told a fork the statblocks were MIT. Named
  now as a carve-out in both clauses, the mirror of the macros carve-out, and
  in both READMEs' game-text bullet. The importer's path is deliberately NOT in
  LICENSE.txt: `check:licence`'s check 3 treats every path there as a pointer
  that must ship, and `tools/` does not. Ask the licence question of any file
  under `module/` that holds Cairn's words, not only of packs.
- **The Air Bladder logo is NOT Creative Commons.** All rights reserved, Lydia Comer,
  by bespoke grant. Do not treat it as CC, and do not reach for it as the manifest's
  cover image — that is the reason `media` is deliberately absent from `system.json`.
  **Her GALLERIES are a different regime: CC BY-NC-SA 4.0 since 2026-09-07**,
  the artist's own relicence of everything non-logo, so one folder holds two
  regimes and `art/lydia-comer/license.txt` states both — SHE writes that
  file, and it changed FIRST, before any code (the standing order of
  operations). Her word has moved three times and the latest governs:
  2026-09-05 CC BY for a few hours, BY-SA the same evening, then NC added
  2026-09-07 with ShareAlike kept on her explicit say. Copies taken in each
  window keep that window's licence, irrevocably — the BY/BY-SA exposure was
  dev-mirror-only, since NO TAG has ever shipped the galleries under CC (the
  17 monsters shipped in releases under the old bespoke grant); the first
  release carrying CC Lydia art ships BY-NC-SA. NC consequence, eyes open:
  the system as a WHOLE cannot be sold or go premium while her galleries
  ship in it (aggregation stays fine — each work keeps its own licence; a
  BY-NC-SA work cannot be REMIXED with BY-SA material at all, the SA
  clauses conflict). `art/lydia-comer/CREDITS.md` and
  `module/lydia-manifest.json` are GENERATED — the licence lines live in
  `tools/import/lydia-comer.mjs`, and a hand edit to either output is
  reverted by the next no-src rerun. TWO SETS: her
  MONSTERS under `art/lydia-comer/portraits-monsters|tokens-monsters/`
  (offered on Monster sheets; they lived in the plain folders from 2026-08-04
  until the character batch arrived) and her CHARACTERS under
  `art/lydia-comer/portraits|tokens/` (femme and non-binary faces, offered on
  PC, NPC and Hireling sheets — picker-only, user ruling: generation pools
  unchanged). Both are growing sets, so do not state a count here; the
  `LYDIA_COUNT_SITES` regexes in `tools/dev/licence-check.mjs` name every
  prose site that DOES state the two counts, and gate them.
  They ship as WebP q95, tokens sized for the canvas (400×400, user ruling
  2026-08-04 — a map token draws at ~100px; portraits keep the artist's full
  1000×1000 because they are sheet art). **The grant went through two versions
  in one day (2026-08-04), then the CC relicence superseded both for the
  galleries** — the first extended "may not be modified" just far enough to
  permit format conversion, the second bounded USE instead, and the logo alone
  still sits under that use-bounded grant. So `tools/import/lydia-comer.mjs`
  touching only the format and the token size — never cropping, recolouring or
  redrawing — is HOUSE PRACTICE, not a licence term. Keep it; just do not cite
  the licence as the reason.
  **The licence text is the artist's to write, not this project's** — she is
  reachable and she rewrites it herself, so amend `art/lydia-comer/license.txt`
  BEFORE any code that depends on what it says, and never edit it to match code
  that already shipped.
  The 17-monster move out of the plain folders is `LYDIA_MOVED_MONSTERS` in
  `cairn.js`, generation 2 of the art migration, and its rules are pinned to
  the 17 FILENAMES — never the folder prefix, because the vacated folders
  refilled with character art in the same change and a player can pick a
  character portrait before the first post-update GM load runs the sweep.
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

**`docs/release-testing.md` is the full list — what each probe covers, and what to
run before tagging vs after publishing. Keep it in step with `package.json`; a
probe not listed there runs only when someone remembers it.** For the COUNT run
`npm run check:probes`, which computes it. A figure used to sit in this
sentence; it said 106 against a real 109 (review #26), the fourth number in this
file to drift, and the parenthetical naming the gate as the authority did not
save it — a number in prose is a copy whether or not it apologises for itself.

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
  **A fourth, and it is the second rule wearing a different face: SELECT A
  PLANTED DOCUMENT BY ID DIFFERENCE, NEVER BY NAME.** `dev:directory-buttons`
  read its mount clone with `getName("Heavy Destrier")`, and the 2026-09-12
  sweep found a leftover of that name in the world: the leg read ITS statblock
  (identical — same pack document), reported its missing `compendiumSource` as
  the product's, deleted it, and left the clone it had just minted for the
  next run to trip on. One red in 112, and the probe was wrong, not the code.
  Snapshot the ids before the click; find the one that is new.
