# Warden's Dashboard, time, calendar

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- `module/warden-dashboard.js` — GM-only launcher; owns no rules. **A single-table
  draw posts CORE's own card** (`draw({displayChat:false})` then `toMessage`), or the
  encounter Add-to-scene button dies. Combined draws build their own, escaped.
  Button labels are UI keys; `labelForTable` walks every declaration. Draw cards
  carry `flags.air-bladder.dashboardDraw` and are relabelled per viewer
  (`localizeDashboardCard`). Showing a table: bare uuid over the socket, `senderId`
  guard, public card. AppV2 id: override `_initializeApplicationOptions`, not
  `get id()`. One root element per part. Gate `dev:warden-dashboard`.
- Review #36 on the Dashboard: the BODY redraws when a world table is made,
  renamed or deleted (`refreshDashboardTables`, three named hooks), so Your
  Tables never offers a button for a table that's gone. That's safe only
  because the body now carries the visibility dropdown across its own render
  (`_preSyncPartState` / `_syncPartState`; core restores no field values, and
  the template stamps the default, so a redraw used to put the Warden back on
  Private under them). The time band still redraws alone. A batch Add to scene
  creates numbered tokens ONE AT A TIME (encounters.js): core's `appendNumber`
  reads the tokens already on the scene, so a batch gave six "Goblin (1)".
- **ONE WINDOW, THREE PAGES** (2026-11-21, user ask, reversing the morning's
  "its own window" ruling for the Party sheet): the Dashboard hangs the sheets'
  rail (`tab-rail.html`, `cairn-railed`, `placeRail` on move/render/detach/
  attach) with a `page` tab group: **Party** (party-sheet.js's data and
  `PartyPage`), **Damage** (warden-damage.js's `buildForm`, rolled by
  `rollWardenDamage`) and **Tables** (the time band and body, both wearing
  its tab; the band is on Tables only, user ruling), then a chat button. User
  rulings: each page keeps its own size (`PAGE_SIZE`, a resize remembered for
  the session in `pageSizes`, written in `changeTab`); ONE "Warden's Dashboard"
  button opens it (the same evening, user ask after db-mythic, reversing "keep
  all three tools": `placeDashboardButton`, a GM-only labelled `ui-control`
  prepended to core's static `#ui-left-column-2`, above the scene navigation,
  id-guarded, hung on `renderSceneNavigation` and `ready`; it opens on the page
  it was left on, and the skull, clipboard and people tools are gone); the
  chat button opens core's chat pop-out (core keeps
  the log in the sidebar and ONE pop-out only; a third copy gets no new
  messages and no input). Traps paid for:
  - core's inactive-`.tab` hide is in an earlier CSS layer, so our
    `display: flex` on a page's root beat it and every page showed: our own
    `.cairn.cairn-dashboard > .window-content > .tab[data-group="page"]:not(.active)`.
  - with two tab groups core stops filling `context.tabs`; `_prepareContext`
    prepares both, and the rail part gets its own context.
  - each page's listeners bind to that PART's element on that part's render,
    never the whole window, which renders its other parts alone.
  - the button pressed on an open window redraws every part but Damage (it
    still refreshes the tables) and brings the window forward.
  - the Damage page's "who takes it" redraws its part alone
    (`refreshDashboardDamage`, debounced) on `canvasReady` and on a token on the
    viewed scene made, deleted, renamed or hidden; fields and ticks ride
    `_preSyncPartState`.
  - the Damage page's fields are built in `_onRender`, after core's part sync,
    so `_preSyncPartState` holds their values until then.
  - the old window classes (`cairn-party-sheet`, `cairn-warden-damage`) ride
    the Dashboard so their CSS blocks still reach their pages.
- The Damage page's tab is a red splat (`fa-burst` in `--ab-peril`, the sheets'
  Attack burst), and Roll damage's burst is red too (2026-11-21, user ask;
  replaced the skull). Gate `dev:warden-dashboard` leg 9c.
- **The Party page** (`module/party-sheet.js`, 2026-11-21, user ask; the Party
  sheet's own window until the merge the same day): the Warden's table of the
  party, one row each, in marching order. Warden only (the tool is hidden and
  `openWardenDashboard` refuses a player).
  - **Bulk conditions** (user ask + rulings): a tick per row and a select-all;
    Add/Remove Fatigue, Mark/Clear Panicked (only with `use-panic` on), Mark/
    Clear Deprived act on the ticked rows, greyed until a tick. Marking and
    Remove Fatigue confirm once, naming only those they change; clearing does
    not ask (the sheet's own split). Fatigue goes through `CairnActor#addFatigue`
    / `#removeFatigue`, which the sheet's + also calls. Ticks live in
    `PartyPage#picks` and survive the page's redraws.
  - **Drop to give** (user ask): an Item dropped on a row runs that member's
    sheet's own `_onDropItem`, so every drop rule holds, with `overfill: true`
    (user ruling: the Warden's drop may go past "no free slot", GM only, with
    the `Overfilled` notice). CLAUDE.md's overflow list carries it.
  - **The Party folder is the roster** (`partyMembers`): every character filed
    there, plus every npc and hireling filed there (`PERSON_ROLES`, user ask the
    same day). A monster, a companion or a thing there isn't a member, and the
    Dropped Item Pile is filtered by `isDroppedPile`.
  - It computes NO rule of its own. Every cell reads what the sheet derives
    (`slotsUsed`, `slotsMax`, `armor`, `encumbered`, the DERIVED HP) or what
    gear.js classifies (`isHoldableLight`, `isHeldLight`, `RATIONS_RE`). If a
    cell looks wrong, the sheet is wrong too.
  - Rations count USES left, not items (user ruling), a stack's unopened units
    included, as `CairnItem#spendUse` spends them (review #36). The player is
    the user assigned the character, else the players given Owner BY NAME; the
    `default` level is never read.
  - Colour does the warning, and the rule lives once, in `rowFor` (user
    rulings): red for HP at 0, an ability below its max, no slot left, no
    rations; amber for HP below max and one slot left; teal for a shield or a
    light IN HAND and for any Fatigue. A shield or light carried but not in
    hand shows its symbol uncoloured. Conditions are boxed letters, D P E.
  - A lit light's cell is a button: the Warden's click unequips every lit light
    that actor holds (`_onPutOutLight`). It's the Equip light badge's own
    write, so `registerHeldLightSync` posts the public card (the Warden's own
    line when a player owns the character) and Torch follows.
  - Marching order is the world setting `party-marching-order` (internal): ids,
    leader first, written whole on each drop. A stale id is skipped and pruned
    by the next write; anyone the order hasn't seen comes after it by name. Its
    `onChange` fires `cairnMarchingOrderChanged`, so a second Warden's table
    follows.
  - The notes line is the actor flag `wardenNote`, capped at 200. HIDDEN, NOT
    SECRET: a flag rides the actor, so the player who owns it can read it in
    the console. The user chose that.
  - An open table redraws on actor, item, user and order changes, debounced
    (`PartyPage#queueRender`, the `party` part alone), and waits for a focused
    notes line to blur first. The focusout listener is bound in the Dashboard's
    `_onFirstRender`, once: the frame survives a re-render.
  - Gate `dev:party-sheet`.
- **Watches are core Cairn 2e and never gated; the Vald calendar is a hack**
  (`enable-vald-calendar`, `requiresReload`, converts nothing). Read the live
  `game.time.calendar`, never our literal. `ValdCalendar` overrides
  `_decomposeTimeYears` (core bug) and normalises negative weekdays in
  `timeToComponents`. `leapStart` must be 0; Reclamation season entry first;
  `yearZero: 7728` is FROZEN. Two upstream errata recorded in
  `docs/keeping-time.md`, not fixed.
- **The clock is the CALENDAR BAR since 2026-11-20** (user ask: "a bar across the top
  of the canvas, like Mythic Bastionland displays its calendar", their db-mythic). It
  is prepended into core's `#ui-top` (static markup, never rewritten; no re-attach
  hook needed), centred and scaled by `#ui-middle`, `pointer-events` back on its tabs
  only. Tabs: watch, date (the calendar's door under Vald, keeping the old
  `.cairn-watch-inner` class), season (Vald only); the weather HANGS UNDER the bar so
  it never widens it. Tones are fixed per watch/season in both schemes. Per-person
  TUCK (`calendar-bar-tuck`, client scope, config: true, on core's flat list
  because the submenus are Warden-only: As the Warden set it / Tucked / Not
  tucked since 2026-11-21, user ruling "option 2"; the first follows the world
  setting `tuck-calendar-bar-default` in the General submenu, and `tuckedHere`
  is the one reading) and the Y key
  (`pullCalendarBar`), after db-mythic. Internal names (`WatchClock`,
  `#cairn-watch-clock`, `show-watch-clock`) stayed. **Check it in BOTH interface
  schemes** via `game.configureUI` (`dev:theme`, strict surface); `dev:vald-time`
  legs 4, 6, 7. Dashboard time band is its own part
  (`parts: ["time"]`). No Make Camp button. Vald weather REPLACES Cairn's on the
  Dashboard.
- Date guards: Set the Date shows a live preview in DAYS (`describeDateAt`,
  `describeShift`, `componentsForDate`); calendar's Set-to-this-day confirms with
  Cancel default; `#selectionInView` is the one selection derivation. Number fields
  drop focus on wheel. Set the Date's month list FOLLOWS THE YEAR FIELD (review
  #36): Reclamation is offered only for a typed year that has it, and the month
  the Warden picked is kept apart from what the list can show, so it comes back
  when the finished year offers it again.
- A leap week that interrupts a season doesn't restart it (review #36):
  Reclamation is a season entry of its own inside Harvest, so the day after it
  was marked "Harvest season begins". A day that follows a leap-only month is
  compared with the last day BEFORE that month (`seasonBegins`, game-time.js).
- A tooltip that shows the Warden's typing (the bar's weather, date and season
  lines, a calendar day's festival names) is TEXT, `data-tooltip-text` (review
  #36), never `data-tooltip`, which core renders as HTML. A tooltip that's only
  one of our own keys keeps `data-tooltip`.
- `module/vald-calendar.js` (Vald only). **Festival text is CC BY-SA content and
  ships as a JournalEntry from `tools/import/vald.mjs`, not in `lang/`** — ask the
  licence question of any new content before choosing where it lives. Importer
  self-checks weekdays. Festivals found by FLAGS. Browsing state on the instance.
  `JOURNAL_BLOCKS`/`localizeJournalBlocks` live in `i18n-content.js`.
- `module/weather-log.js`, `module/calendar-events.js`: journals found by FLAG plus
  `isWardenJournal` (an OWNER key naming a GM or a gone id — a player's create can
  carry no other user's key — AND last writer a GM; unresolvable writer = unknown,
  fall back to document ownership). Demotion of the writing GM is NOT covered (stated). Never by
  a stored id (settings read-after-write is not guaranteed). Log written by the
  ACTIVE GM from `cairnWeatherChanged`, in the writer's language. "Hidden" journals
  are concealment, not secrets. Refresh on `updateJournalEntry`. The log appends
  with a FUNCTION replacer (review #36): a replacement string is a pattern, and
  weather holding `$&` was rewritten on its way in.
- Buttons that re-render need stable ids for focus restore; `_whileDisabled` checks
  `isConnected` then id, and reads `this.element`'s own document (Pop Out windows).
  **Any bare `document.` in a detachable AppV2 is a bug.**
- Dashboard layout: left-aligned labels in a glyph column; a glyph means one thing
  per window (`SEASON_ICONS` is the one map). **Font Awesome 7 Pro is bundled** —
  verify a glyph by rendering it (`::before` content), never by `all.min.css`.
