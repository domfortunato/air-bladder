# Design note: GM-authored custom 2e backgrounds

**Status:** Planning only — not started, no code written.
**Date:** 2026-07-23
**Scope decision:** Deferred past Air Bladder v1 (see [§8](#8-v1-scope-decision)).

A planning session on how to let Game Masters author their own **Cairn 2e-style**
backgrounds — tagline, example names, starting gear, and the two d6 question
tables with item/gold grants — and share them with other GMs.

Barebones-style backgrounds are explicitly **out of scope** for this feature; this
is about the rich 2e format only.

---

## 1. TL;DR — decisions made this session

| Question | Decision |
| --- | --- |
| Is sharing / portability a goal? | **Yes.** This is the decisive constraint — it forces a *self-contained* design. |
| How do custom items attach to a background? | **Snapshot a dragged item** (serialize a frozen copy into the background). Not by-name, not a live reference. |
| How are the two d6 tables modelled? | **Embedded structured data** on the background (the current `system.tables` shape), not Foundry RollTables. |
| Authoring gesture for items | **Drag an existing Item onto the sheet → snapshot it.** Chosen because it reuses the existing item sheets and is the least failure-prone. |
| Table flexibility | **Always exactly two d6 tables, six options each.** Fixed shape, not an open-ended builder. |
| Archetype | GM assigns one of the **three** existing archetypes (Wizard / Fighter / Thief); custom backgrounds slot into the **same picker**, no "Custom" bucket. |
| Preview / validation | **Yes** — a "test-roll ×10" affordance that doubles as a pre-share linter. |
| Ship in v1? | **No.** Defer the authoring feature to a later release; publish v1 without it. Very low lock-in risk. |
| Ship sample custom backgrounds? | **No.** The 20 shipped backgrounds are the examples; add a "Duplicate into my backgrounds" action when the feature lands. |

---

## 2. The goal

At some point after v1, give a GM a way to add their own 2e-style backgrounds to
the system — complete with a description, example names, starting gear, the two d6
"question" tables whose answers grant items/gold and prose, and **custom items** —
and to **share those backgrounds with other GMs**.

## 3. Where we already are (this is mostly solved)

The reassuring finding: the data model is already ~90% of what's needed. A 2e
background is a first-class `background` Item type that already carries the full
shape (see `src/packs/backgrounds-2e/Jongleur_LFOAOlXTH0Bsk2g4.yml`):

- `system.source` — `2e` / `barebones` / `srd-2e`
- `system.archetype` — Wizard / Fighter / Thief (currently importer-set and shown
  only inside the picker)
- `system.description` — HTML tagline/prose
- `system.names` — example names (array of strings)
- `system.startingGear` — `[{ name, uses? }]`, resolved **by name** at generation
- `system.containers` — transport/container grants
- `system.tables` — `[{ question, options: [{ description, items: [{name}], gold? }] }]`
  — the two d6 tables, each with six options; each option = prose + item grants + gold

So a custom 2e background is **not a new document type or schema** — it is an
instance of a type the system already ships. That reframes the work: this is an
**authoring-UX + content-discovery** problem, not a data-modelling one.

Three concrete gaps between today and the feature:

1. **The background sheet is read-only** (`templates/item/background-sheet.html`) —
   it renders names/gear/tables as lists with no editing controls.
2. **Generation reads one hardcoded shipped pack** —
   `character-generator.js` `BG_PACK_FOR = { "2e": "air-bladder.backgrounds-2e", … }`.
3. **Item grants are by-name strings**, resolved against the canonical gear packs
   (`gear.js` `resolveGearItem`) — fine for shipped items, fragile for a GM's
   one-off items, and (critically) **not portable**.

## 4. The one hard constraint (Foundry best practice)

**Never store user content in a system-provided compendium.** Foundry's own docs
are blunt: *"changes will be lost when the module or system updates."* The shipped
`backgrounds-2e` pack is overwritten on every system update.

Therefore custom backgrounds **must live in a world compendium** (or the GM's own
personal module). Worlds create editable Item compendiums trivially (sidebar →
Create Compendium → type: Item). Because the `background` *type* is defined by the
system, custom `background` Items sitting in a **world** pack are fully valid and
survive updates — all the benefit of a custom type with none of the module
sub-type fragility (deactivating a module invalidates its documents). **No module
is required.** Shipped content stays locked/read-only; custom content lives beside
it, editable.

## 5. Architecture — four pieces

1. **Storage — a world compendium.** Either the GM creates one, or (nicer) the
   system offers a "New Custom Background" affordance that lazily creates a world
   pack and drops a blank background into it.

2. **Discovery — decouple generation from the hardcoded pack.** Recommended:
   *zero-config* — generation scans all `background`-type Items with
   `system.source === "2e"` across world compendiums **plus** the shipped pack,
   unioned and de-duped by id. The GM just makes a background and it appears. (The
   explicit alternative — a world setting listing extra background packs — trades
   convenience for control.) This is an isolated code change in one function; **no
   data migration.**

3. **Authoring — an editable background sheet.** The real build. Turn the
   read-only details tab into a form:
   - **names**: a repeatable text list (add/remove),
   - **starting gear**: rows populated by dragging an Item onto the sheet
     (snapshot), plus remove/reorder,
   - **the two d6 tables**: a **fixed 2×6 form** (two questions, six options each),
     each option = prose + item grants (drag → snapshot) + optional gold,
   - **archetype**: a three-option selector.

   The nested-array management mirrors patterns already on the character sheet
   (bonds / questions / scars add/remove/re-roll handlers).

4. **Item references — snapshot on drop** (see [§6](#6-design-forks-resolved)).

## 6. Design forks — resolved

### Fork A — how custom items attach

**Resolved: snapshot a dragged item.** Foundry Items cannot embed child Items, so
in practice the background stores a *serialized copy* of each granted item's data
(type + system fields) inside its gear rows and table options. At generation, the
character is built from those inline copies.

- Chosen over "build items inline" because snapshotting **reuses the existing,
  battle-tested weapon/armor/item sheets** — the GM authors the item once with real
  validation, then drags it in. Only a drop handler + serialization is new code; no
  second item-editor is reimplemented inside the background sheet (which is where
  the bugs would live).
- By-name resolution stays as a **fallback** for shipped content; custom content
  authored for sharing gets frozen copies.

### Fork B — the two d6 tables

**Resolved: keep them embedded** (`system.tables`), not Foundry RollTables.

- Embedded is self-contained, portable, simple for the generator, and edited inline
  on the sheet. It also fits the house rule that mechanical text stays **prose**,
  not automation.
- RollTables are the "more Foundry-native" primitive (and their Compendium result
  type can link to items), but they add coupling (a background references two tables
  by UUID), lifecycle headaches (copy/delete/orphan), and would need gold+prose
  stuffed into result flags. The coupling cost works against a self-contained,
  shareable unit.
- **Fixed shape:** always exactly two tables of six options — so the builder is a
  fixed form and the generator keeps its existing assumptions.

## 7. The portability trade-off (state this plainly)

Snapshotting means a custom background **gives up "edit the item once, it flows
everywhere."** If a GM drags the shipped *Rations* into their background, they get a
*frozen* Rations; later changes to the real Rations do **not** propagate. This is
not a bug — it is the price of portability, and it is the correct trade for a
shareable unit. Worth documenting so nobody is surprised.

**Sharing mechanisms, lightest → heaviest**, all enabled by the self-contained unit:

- Export a single background Item to JSON (one GM sends another a file).
- Export a world compendium of them.
- Package a set as a no-code module via Foundry's built-in **Module Maker** (v11+).

A pre-share **validation/linter** (same engine as the preview below) confirms a
background is fully self-contained — no dangling name-only references that won't
travel.

## 8. v1 scope decision

**Defer the authoring feature past Air Bladder v1. Do not gate publishing on it.**

- v1's job is a clean, playable, publishable 2e system. The 20 shipped backgrounds
  already deliver the whole core experience; custom authoring is a power-user
  extension on top of a working game.
- **Deferring is cheap — almost no lock-in risk.** The two things the feature needs
  from the rest of the system are both non-breaking to add later: (a) extra optional
  schema fields (a gear/option row can gain an `itemData` snapshot field any time —
  adding optional fields migrates nothing), and (b) swapping discovery from the one
  hardcoded pack to a scan (an isolated code change, not a data migration). So v1
  does **not** need to "plan structurally" for this; it can be bolted on later
  without regret.
- The feature benefits from real GM feedback on the drag-item-onto-an-option gesture
  — better designed after people have played with the shipped backgrounds.
- Nice release story: *v1 — play Cairn 2e; v1.1 — build your own backgrounds.*

### No sample *custom* backgrounds in v1

- A sample a GM is meant to edit **can't live in a shipped system pack** (the
  overwritten-on-update trap), so a shipped sample would only be a template anyway.
- The **20 shipped 2e backgrounds already are the worked examples** — they
  demonstrate every field.
- In v1 there is no editable sheet, so a "sample" couldn't be edited through the UI
  regardless.
- Instead, **when the feature ships**, add a **"Duplicate into my backgrounds"**
  action: copy any shipped background into the GM's editable world compendium as a
  fully-formed starting point to rename and rework. Teaches by example and respects
  the world-pack constraint — without a confusing parallel "samples" pack.

**Net v1:** the 20 backgrounds + today's read-only sheet, published. Custom
authoring becomes a focused follow-up release.

## 9. Preview / validation (planned for the feature, not v1)

A **"Test this background ×10"** button on the editable sheet that runs the real
generation logic against the draft and reports the spread — which gear, which table
options fired, resulting gold, and **any grant that didn't resolve**. Because it
reuses the generator, it is mostly a report UI, and it doubles as the pre-share
linter from [§7](#7-the-portability-trade-off-state-this-plainly).

## 10. Remaining open questions

_None blocking. Candidates to settle when the feature is picked up:_

- **Discovery default** — zero-config scan vs an explicit "extra packs" setting
  (or both). Leaning zero-config with the shipped pack always included.
- **Duplicate-to-world UX** — where the action lives (background sheet header?
  compendium context menu?) and whether it also copies referenced items as
  snapshots at duplicate time.
- **Schema hardening** — whether to move `background` onto a `TypeDataModel`
  (with `migrateData`) before non-authors edit the data, or keep the legacy
  `template.json` model and rely on defensive generation (skip + notify on bad
  data). The system's AppV1 posture argues for the latter unless sheet work forces
  the migration.
- **A "custom" marker** in the picker — optional nicety so a GM can distinguish
  their homebrew from shipped entries (functionally they are peers).

## 11. Rough sequencing when picked up

1. Discovery: union world background packs with the shipped pack (isolated change).
2. Editable background sheet — names + archetype + gear rows (drag → snapshot).
3. The fixed 2×6 table builder (the largest single piece; prototype the
   drag-item-onto-an-option gesture first).
4. Snapshot serialization + generation reads `itemData` when present, else name.
5. "Test ×10" preview / linter.
6. "Duplicate into my backgrounds" action + a world-pack home.
7. Sharing polish (single-item JSON export; document the Module Maker path).

## 12. Research sources

Foundry best practices consulted for this plan:

- [Introduction to System Development](https://foundryvtt.com/article/system-development/)
- [Introduction to System Data Models](https://foundryvtt.com/article/system-data-models/) ·
  [`TypeDataModel` API](https://foundryvtt.com/api/classes/foundry.abstract.TypeDataModel.html)
- [Introduction to Module Sub-Types](https://foundryvtt.com/article/module-sub-types/)
- [Compendium Packs](https://foundryvtt.com/article/compendium/) ·
  [Community Wiki: Compendia](https://foundryvtt.wiki/en/basics/Compendia)
- [Rollable Tables](https://foundryvtt.com/article/roll-tables/)
