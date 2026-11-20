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
  TUCK (`tuck-calendar-bar`, client scope, config: true — the one air-bladder row on
  core's flat list, because the submenus are Warden-only) and the Y key
  (`pullCalendarBar`), after db-mythic. Internal names (`WatchClock`,
  `#cairn-watch-clock`, `show-watch-clock`) stayed. **Check it in BOTH interface
  schemes** via `game.configureUI` (`dev:theme`, strict surface); `dev:vald-time`
  legs 4, 6, 7. Dashboard time band is its own part
  (`parts: ["time"]`). No Make Camp button. Vald weather REPLACES Cairn's on the
  Dashboard.
- Date guards: Set the Date shows a live preview in DAYS (`describeDateAt`,
  `describeShift`, `componentsForDate`); calendar's Set-to-this-day confirms with
  Cancel default; `#selectionInView` is the one selection derivation. Number fields
  drop focus on wheel.
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
  are concealment, not secrets. Refresh on `updateJournalEntry`.
- Buttons that re-render need stable ids for focus restore; `_whileDisabled` checks
  `isConnected` then id, and reads `this.element`'s own document (Pop Out windows).
  **Any bare `document.` in a detachable AppV2 is a bug.**
- Dashboard layout: left-aligned labels in a glyph column; a glyph means one thing
  per window (`SEASON_ICONS` is the one map). **Font Awesome 7 Pro is bundled** —
  verify a glyph by rendering it (`::before` content), never by `all.min.css`.
