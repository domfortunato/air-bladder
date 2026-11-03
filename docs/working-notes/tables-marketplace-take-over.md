# World-first tables, marketplace, take-over doors

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- **Every table a generator declares resolves world-first** via
  `compendium.js` `findDeclaredTable` (world by name, then the declared pack). The
  `"pack;Name"` prefix is the FALLBACK, never a lock. **Read with `roll()`, never
  `draw()`** (`draw` marks world rows drawn): `rollTable` / `rollTablePlainText`
  (the one text reader; the chat-text one is retired). Pick-lists resolve the same way; trait
  dropdowns via `declaredTableCached` (not `findDeclaredTable` — too slow). Scars
  checklist stays pack-only. Kettlewright's Bonds matcher and `resolveVirtueVice`
  stay on the pack deliberately. `roll()` still skips drawn rows and saves a blank
  formula. Gate `dev:world-tables`.
- Random spells are a declared table (`characterGenerator2e.spells.canon` / `.glog`),
  rows type-filtered. **`more-spellbooks` is removed — do not restore it.**
  `SPELL_PACKS` names `background-items`. Gate `dev:spell-pool`.
- **Marketplace is world first** (`module/marketplace.js` `marketTables`): a world
  `Market: X` REPLACES that aisle, an unknown prefix ADDS one (the Bonds/Omens rule).
  The installer wipes the package directory, so edits to our compendium never
  survive. Price rides the item. Shop never draws. Gate `dev:marketplace`.
- `resortTableByName` / `fitFormula` via table-banner.js `onReadTableRowsChanged`
  on `createTableResult` + `deleteTableResult`, creating client only, world tables
  only, gated by `tableRole`. `keptAlphabetical` = aisles + the two spell-pool
  tables. Compare the STORED formula. Flat `1dN` tables only; curves are the
  Warden's.
- **Take-over doors** (`module/take-over.js`): Create a Custom Spell Table…,
  Marketplace…, Barebones Creation Tables…, 2e Backgrounds and Tables…; all at the
  top of Rollable Tables, the 2e one also on Compendium. Labels say the OUTCOME.
  The shipped compendiums are TEMPLATES.
  - **Plan, then run** — `importDocument` silently replaces on id collision;
    nothing calls it. Membership: items/mounts/background copies by shipped id
    (adopt via `_stats.compendiumSource`); tables by NAME only; `tableIdFor` uses
    the shipped id only while free.
  - Tables last, rows inline, `formula` explicit. Items into "Custom …" folders,
    a subfolder per source compendium (`sourceFolders`), found by flag.
  - Background copy stands in by id (`build2ePool` dedups by id); nothing written
    to `disabled-backgrounds`; `disabledBackgroundIds` / `isBackgroundDisabled` ask
    by id. World pack label stores the KEY (`customBackgroundsPackLabel`).
  - Enter never copies (all `type: "button"`, Cancel default). `running` set before
    the first await; doors disabled while a job runs (`setDoorsBusy`). Locked pack
    refused in confirm and result. Names come from documents (`namesFor`).
  - `resolveBarebonesResult` asks `!doc.pack` first so a world row wins.
  - Spell door replaced "Reseed a Spell Table" — **do not bring Reseed back**.
    Spec read at click time (GLOG swaps the pool). "Consistent with X" means X's
    mechanism.
  - Door CSS scoped to `.cairn-take-over`; Actor Directory buttons
    `min-width: fit-content` (labels wrap, never clip).
  - Gate `dev:take-over` (its entry sweep deletes copies made by hand in dev).
- **Table banner** (`module/table-banner.js`) — decided by NAME via `kindOfTable`;
  Warden only; names core's labels (`TABLE.ACTIONS.ChangeMode.Edit`,
  `TABLE.TABS.summary`, `COMPENDIUM.ImportEntry`); view-mode sentence; warns on two
  world tables of one name; `refreshTableBanners` re-injects DOM, never re-renders.
  Tables tab name from `RollTable` `labelPlural`, not `SIDEBAR.TabTables`. **Verify
  a core key by grepping the client for a reader, not en.json.** Gate
  `dev:table-banner`.
