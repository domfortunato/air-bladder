# Content importers

Every script here fetches from **`yochaigal/cairn`** (the Cairn SRD) at run time.
Nothing reads another repo off the local disk, and nothing is snapshotted into a
checked-in JSON: a rerun surfaces upstream changes rather than freezing whatever
was true the day it was first run.

Game text is CC BY-SA 4.0, Yochai Gal — attribution required, see the README.

## Run order

```
node tools/import/barebones.mjs      # gear gap, 100 backgrounds, 3 creation tables
node tools/import/marketplace.mjs    # prices onto pool items, shop-only goods, 3 shop tables
node tools/import/transports.mjs     # container Actors + the transports shop table
npm run build:packs                  # src/packs -> packs   (stop Foundry first)
```

The order matters twice, and both cases are silent failures rather than errors:

- **barebones before marketplace** — the shop authors a market-only near-duplicate
  of anything it cannot find in the pool, so the Barebones gear has to exist first
  or you get a second "Sewing kit" beside the real "Sewing Kit".
- **transports after marketplace** — marketplace wipes the whole marketplace table
  dir, which would delete the shop table transports.mjs writes into it.

These three are independent of the order above:

```
node tools/import/backgrounds-2e.mjs # rewrite the 20 2e backgrounds' TEXT
node tools/import/npc-careers-2e.mjs # module/npc-careers-2e.json
node tools/import/portraits.mjs      # module/portrait-manifest.json
node tools/import/game-icons.mjs --src <dir>   # game-icons/ + its manifest
```

`game-icons.mjs` is the one importer that is **not reproducible from this repo**:
its input is a hand-curated download from game-icons.net, so which icons ship is
a decision rather than a query. `art/game-icons/` and `art/game-icons/CREDITS.md` are
therefore the artifacts of record — committed, and rebuilt only when the
curation changes. Point `--src` at the unpacked download.

## What each one owns

| script | writes | source |
| --- | --- | --- |
| `barebones.mjs` | `backgrounds-barebones`, `tables-barebones`, + missing gear | `barebones/rules/barebones-character-creation.md` |
| `backgrounds-2e.mjs` | text fields of `backgrounds-2e` | `second-edition/backgrounds/*.md` (20 files) |
| `marketplace.mjs` | `marketplace`, `market-goods`, `cost` on pool items | `second-edition/players-guide/marketplace.md` + `marketplace-descriptions.csv` |
| `transports.mjs` | `transports`, the transport shop table | self-contained (2e transport numbers) |
| `npc-careers-2e.mjs` | `module/npc-careers-2e.json` | `resources/hirelings.md` |
| `portraits.mjs` | `module/portrait-manifest.json` | the shipped image folders |
| `game-icons.mjs` | `art/game-icons/` (1,643 svg + `CREDITS.md` + `license.txt`), `module/game-icons-manifest.json` | a curated game-icons.net download, via `--src` — or `--restamp`, which needs none |
| `monster-art.mjs` | the `img` and prototype-token art of `monsters` | the names themselves, matched against the gallery |
| `item-art.mjs` | the `img` of `armor`, `expeditionary-gear`, `market-goods`, `reliquary`, `tools`, `trinkets`, `weapons` | the names themselves, matched against the gallery |

**The two art proposers are not importers in the same sense** — nothing upstream
tells you which glyph a Dagger should wear. They read the pack names, propose,
and write only with `--apply`; both skip anything already carrying gallery art,
because that was chosen by hand and a machine should not overrule it. Both keep
an explicit table of judgements, and `item-art.mjs --search-only` shows what the
algorithm would say without one. **After either, run `table-icons.mjs`**: a
RollTable result stores its `img` as a snapshot rather than reading the document
it references, so re-arting an item leaves every table that lists it stale.

`marketplace-descriptions.csv` and `background-archetypes.csv` are **ours**, not
upstream's: the SRD price list is names and numbers with no flavour text, and
Fighter/Wizard/Thief appear nowhere in the 2e text at all.

## The Warden tables have no importer either

`warden-encounters`, `warden-travel`, `warden-npcs`, `warden-monsters` — 26
RollTables — were authored once from cairnrpg.com, which publishes the same
CC BY-SA text as this repo's other sources. They are verified rather than
regenerated:

```
npm run check:warden        # no Foundry needed; fetches the SRD, diffs the packs
```

Regenerating them would destroy work a parser cannot reproduce. The SRD gives
these as multi-column rows; ours merge them into one presentable string, and —
more importantly — rewrite the SRD's *website* cross-links to name our own
compendium tables, which is the only form that is useful inside a VTT. The
checker knows the difference: the 14 verbatim tables are compared exactly, the 11
composed ones by containment after markup is normalised away, and every inline
rewrite is declared in `REWRITES` so an upstream rewording still trips it.

`Warden: NPC - What Do They Want?` is third-party (Modular Rules & Procedures
hack) and is reported as skipped, never silently passed.

## The gear pool has no importer, and that is deliberate

`src/packs/{expeditionary-gear,tools,trinkets,extra,weapons,armor}` — the ~260
bespoke 2e items that backgrounds, bonds and hirelings grant by name — are
**checked-in content, maintained by hand or in Foundry**, not generated.

They were bootstrapped once from the predecessor fork's inline gear records by two
scripts (`gear-2e.mjs`, `port-2e-content.mjs`) that have since been deleted, along
with the dependency on that repo. They are not coming back, because the data they
read cannot be recovered from the SRD: an item granted by a choice table appears
only in prose, and the SRD bolds the *salient noun*, not the item — `**eye**`,
`**foot**` and `**arm**` sit in exactly the same markup as `**Oil Can**`. A parser
over that authors a pack full of body parts. The curated references are worth more
than the reproducibility would be.

What protects the pool instead is an invariant, checked against a live world:
`tools/dev/gear-probe.mjs` harvests every name any grant path can hand a character
— starting gear, choice-table options, bond payloads, hireling loadouts — straight
out of the shipped packs, and fails if a single one does not resolve. Add content
and it is covered immediately; delete an item something references and the probe
says so. That is the guarantee the importer used to give, enforced closer to what
actually ships.
