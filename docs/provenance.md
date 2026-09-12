# Who made what

Air Bladder mixes work by several people under seven licensing regimes, and it
was built with AI assistance. This document says, per category, **who authored
what and how** — the question Foundry's content policy asks of a package, and a
question the licence files answer only halfway. `README.md` and `LICENSE.txt`
record which licence covers which path; neither records whether a thing was
made by a person.

It is written to be checkable rather than reassuring. Where the answer is
"documented by the artist", the statement is quoted and sourced. Where the
answer is "not documented", it says so.

## Code

The code is written **with AI assistance** (Claude Code), on a base inherited
from Yochai Gal and Oskar Świda's `Cairn-FoundryVTT`.

What is the maintainer's own, and verifiable: every design decision. The
rulings, the constraints, the reversals and the reasons are recorded as they
were made, in two places a reader can check independently —

- **Commit messages**, which are long and explain *why* rather than what. `git
  log` is the design record for this project, by policy.
- **`CLAUDE.md`**, a tracked, deliberately candid working-notes file that
  records deviations from Foundry practice, the reason for each, and what the
  mistakes cost. It is not documentation and says so; it is the argument the
  project has had with itself.

Structure, dependency order, and where the difficult parts are:
[`docs/architecture.md`](architecture.md).

**Nothing in the code is generated at runtime, by AI or otherwise.** The system
does no runtime generation of code or content: randomness is dice and roll
tables. There is no AI feature, no model call, and no network request to any
service.

## Visual media

Eight sets ship. None is machine-generated.

| Set | Path | Files | Artist | Licence | Human authorship |
|---|---|--:|---|---|---|
| Character portraits and tokens | `art/jon-aspeheim/` | 160 | Jon Aspeheim | CC BY 4.0 | **Stated by the artist** |
| Character and creature galleries | `art/lydia-comer/portraits*`, `tokens*` | 90 | Lydia Comer | CC BY-NC-SA 4.0 | **Stated by the artist** |
| The Air Bladder logo | `art/lydia-comer/Airbladder0*.webp` | 3 | Lydia Comer | All rights reserved | Same artist, same commission |
| Token drawings | `art/tlomdev/` | 368 | tlomdev | CC BY-SA 4.0 | Assessed, not stated — see below |
| Picker icon gallery | `art/game-icons/` | 2,275 | 22 named game-icons.net contributors | CC BY 3.0 | Assessed, not stated — see below |
| Class icons | `icons/` | 25 | Lorc, Delapouite, Skoll, SeregaCthtuf | CC BY 3.0 | Assessed, not stated — see below |
| Cairn compatibility marks | `logo/` | 4 | Yochai Gal / cairnrpg.com | CC BY-SA 4.0 | Publisher's own marks |
| Alegreya typeface | `fonts/` | 5 | Huerta Tipográfica, 2011 | OFL 1.1 | Predates generative type |

**Where the artist has stated it.** Jon Aspeheim's source page states the
portraits were created without AI; that is recorded in
`art/jon-aspeheim/license.txt` and in both READMEs. Lydia Comer's own licence
file states "No AI was used to create this artwork"; she writes that file
herself, and it is never edited here to match anything. Both claims are
reported as *the artist's statement*, which is the honest form: this project
can source a statement, not warrant someone else's process.

**Where it is assessed rather than stated.** For tlomdev, game-icons.net and
the class icons, no artist statement about method could be found.

- **game-icons.net** and the class icons drawn from it are a long-running
  collaborative icon project; `art/game-icons/CREDITS.md` and
  `icons/CREDITS.md` name the individual author and source page of every single
  glyph, and the contributors are identifiable people with attributed bodies of
  work predating generative image tools.
- **tlomdev's tokens** are a single consistent hand-drawn black-and-white style
  across 368 files, published as a paid asset pack in 2023 under the artist's
  own name. The itch.io page carries no statement about method in either
  direction, and no AI-generated disclosure flag, which the platform provides
  and the artist did not set. That is weak negative evidence, not a statement.

This is the honest position: **strong for two sets, reasoned for the rest, and
not claimed as more than that.** A written statement from tlomdev would close
the largest of these; it has been sought.

**Screenshots.** `docs/images/*.png` (6) are screen captures of this system
running, taken by the maintainer. `system.json` declares no `media` field.

**No AI artwork is accepted**, including from contributors —
`CONTRIBUTING.md` states this as a condition of contributing.

## Written text

Four buckets, and the boundaries are documented in the tooling rather than
asserted here.

**1. Cairn's own text, fetched from the SRD by script.** Most compendium
content. `tools/import/README.md` is the ledger: it names, per pack, the
upstream file each importer reads. Every script fetches from `yochaigal/cairn`
**at run time** rather than from a snapshot, so a rerun surfaces upstream
changes instead of freezing them. Author: **Yochai Gal**, CC BY-SA 4.0.

**2. Cairn's text transcribed once, then continuously verified.** The Warden
roll tables were authored from cairnrpg.com, and `npm run check:warden` diffs
them against the live SRD on every run: **560 rows across 37 tables**. This is
stronger evidence than an importer would give, because it re-proves itself on
demand rather than dating from the day it ran.

It is also honest about its own edges, which is why it is worth citing. Eight
tables are reported as **deliberately not checked**, each with its reason named
in the output — for example one is user-authored and draws on the Cairn 2e
Bestiary rather than SRD text, and another comes from a third-party hack on
cairnrpg.com rather than from Cairn 2e core. A gate that silently skipped those
would be worth nothing here.

**3. Inherited from the predecessor system.** `src/packs/monsters/` (205
documents) and `src/packs/more-spellbooks/` (216; the pack has grown by one since) came from
`yochaigal/Cairn-FoundryVTT` at this project's first commit. Filenames **and
document ids** are identical to it, 205 for 205. The bestiary text is Cairn's
own, by its own author.

**4. Written for this project, by the maintainer.** The item flavour text in
`tools/import/marketplace-descriptions.csv` and the archetypes in
`background-archetypes.csv` — declared as "ours, not upstream's" in the
importer ledger, because the SRD price list is names and numbers with no
flavour. Also the hand-tended gear pool, the interface strings in
`lang/en.json` (1,050 interface strings, a count `npm run i18n:check` holds to the file), the Warden guides in `docs/`, both READMEs, and the
listing description.

**Translations.** `lang/es.json` and `lang/content/es.json` are by
**fsmalecho**, credited by name and licensed CC BY-SA 4.0 as derivatives of the
game text. `docs/TRANSLATING.md` asks translators **not** to use machine
translation, and says why: the value is judgement about register and idiom, and
the translation ships under the translator's own name.

## Audio

**None.** No audio file of any kind ships, and the manifest declares none.

## Marketing text

The description in `system.json`, the opening of `README.md`, and the copy on
`site/index.html` are written by the maintainer.

## How to check any of this

Nothing here asks to be taken on trust. The claims above are backed by files
and by gates that fail when they drift:

| Claim | Where to check |
|---|---|
| Which licence covers which path | `LICENSE.txt`, `README.md` |
| The two agree, and every path named exists | `npm run check:licence` |
| Every shipped directory and file is named by some clause | same gate |
| Per-glyph and per-image attribution | `art/*/CREDITS.md`, `icons/CREDITS.md` |
| Each artist's own terms, in their words | `art/*/license.txt` |
| Which upstream file each pack came from | `tools/import/README.md` |
| Shipped tables still match the Cairn SRD | `npm run check:warden` |
| No world-specific or fork-era provenance stamps ship | `npm run check:fields` |
| Design decisions and their reasons | `git log`, `CLAUDE.md` |
