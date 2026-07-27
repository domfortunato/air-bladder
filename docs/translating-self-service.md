<!--
  Self-service translator guide, for a translator who works directly in the repo
  with git + pull requests (as opposed to the emailed-spreadsheet flow in
  TRANSLATING.md). Written first for Malecho (fsmalecho), who is doing the Spanish
  translation this way. Language-agnostic: swap `es` for any locale.
-->

# Translating Air Bladder — the self-service (git) workflow

You already translate the **interface** by editing `lang/es.json` and opening a PR.
This is how to do the **game content** — backgrounds, items, spells, tables,
monsters — the same self-service way, and how the whole pipeline fits together.

## Short answer to "do I upload spreadsheets to `lang/content/`?"

**No.** `lang/content/es.json` is a **generated** file — you never hand-edit it
(it's keyed by the English source string, not meant for human editing). The
spreadsheets you edit are **TSV files** that a script generates into
`tools/i18n/tsv/` — one per content pack (`content-<pack>.tsv`). You fill in the
Spanish column, run one command to compile them, and commit the resulting
`lang/content/es.json`. The TSVs themselves are throwaway (git-ignored); the JSON
is the thing that ships.

## One-time setup

You have git already. You also need **Node.js + npm** (any recent LTS). Once, in
your clone:

```bash
npm install
```

That's it — the translation scripts are offline and only read the English source.

> **Another language?** Every command below takes `--lang <code>` and defaults to
> `es`, and your TSV's translation column is named after your locale rather than
> `es`. So `npm run i18n:extract -- --lang fr` writes an `fr` column, and
> `npm run i18n:import -- --lang fr` writes `lang/fr.json` +
> `lang/content/fr.json`. Nothing else differs.
>
> Where you'd start from: Spanish is the only language with translated game
> content, and the Danish, French, German, Polish and Brazilian Portuguese
> interface files inherited from the original Cairn system sit at 15–30% and
> aren't maintained. Untranslated strings fall back to English individually, so
> partial work always ships.

## Three commands, one loop

| Command | What it does |
|---|---|
| `npm run i18n:extract` | (Re)generates the TSVs in `tools/i18n/tsv/` from the current English + packs, **pre-filling** the Spanish column from whatever is already translated. **Run this first, every session.** |
| `npm run i18n:import`  | Compiles the filled TSVs → `lang/es.json` (UI) + `lang/content/es.json` (content). Validates every row and **rejects** broken ones. |
| `npm run i18n:check`   | Coverage + validation report for the **UI** (`lang/es.json`). |

### The loop, step by step (content)

```bash
# 1. Sync the working spreadsheets to the current source.
#    WARNING: this OVERWRITES the TSVs from the committed JSON. Run i18n:import
#    first if you have filled cells you haven't imported yet (see the note below).
npm run i18n:extract

# 2. Open a pack's TSV and fill the `es` column, e.g.
#    tools/i18n/tsv/content-armor.tsv
#    (open in LibreOffice / Excel / Google Sheets as *tab-separated*, or a text editor)

# 3. Compile your translations into the shipped JSON
npm run i18n:import

# 4. (optional) UI coverage report
npm run i18n:check

# 5. Commit ONLY the generated JSON and open a PR
git add lang/content/es.json          # and lang/es.json too, if you touched the UI
git commit -m "es: translate armor descriptions"
```

> **Do not commit the TSVs.** `tools/i18n/tsv/` is git-ignored on purpose. Only the
> JSON is committed and reviewed.
>
> ⚠️ **`i18n:extract` OVERWRITES every TSV** — it rebuilds them from the committed
> JSON. Anything you typed into a cell and have **not** yet run `i18n:import` on is
> gone, with no prompt and no way to get it back (the TSVs aren't in git either, so
> nothing will even show you what disappeared).
>
> **So: import before you extract.** Once a translation is in `lang/es.json` /
> `lang/content/es.json`, the next `extract` pre-fills it straight back into the
> spreadsheet and it's safe forever. It's the gap between *typed* and *imported*
> that's dangerous — step 3 above is what makes your work permanent, not step 2.
> If you're stopping mid-file, run `npm run i18n:import` before you close the laptop.

## The spreadsheet columns

Each row is one phrase. Columns (tab-separated, UTF-8):

| Column | Fill it? | What it is |
|---|---|---|
| `key` | leave alone | the string's category (`item.name`, `bg.desc`, `table.result`, …) |
| `context` | leave alone | a hint about where it appears (e.g. `Shield · description`) |
| `en` | leave alone | the English source |
| **`es`** | **yes** | **your translation** — leave empty for anything not done yet |
| `notes` | optional | a place to leave a question or comment back to the maintainer |
| `status` | optional | `todo` / `done`; mark `done` as you finish (a `done` row with an empty `es` is rejected, which catches accidental blanks) |

**Leaving `es` empty is fine and safe** — untranslated strings simply show in
English in the game. Nothing breaks, partial work ships, you improve it release
after release.

## The four rules the importer enforces

`i18n:import` will **reject** a row (name it, and exit non-zero) if a translation:

1. **Drops or changes a `{placeholder}`.** Keep every `{name}`, `{n}`, `{slots}`
   exactly as in the English — the game fills those in.
2. **Changes the HTML tags.** Keep `<p>`, `<strong>`, `<a href="…">` etc.;
   translate only the words between them. (You *may* freely **add** emphasis like
   `<b>…</b>` — that's explicitly allowed.)
3. **Mangles an `@…[…]` link/enricher.** Keep the target inside the brackets
   intact; translate only the visible label in `{curly braces}` after it.
4. **Is marked `done` but left blank.**

You don't have to be perfect — the importer catches these before they reach a
player.

## You don't have to translate from scratch — just don't use AI to translate

Cairn 2e has an **official Spanish edition** (*Guía del jugador*). For core
content, **adapting and confirming** that wording beats inventing new Spanish —
it's less work for you and more consistent for players.

Machine translation is the one shortcut to skip — specifically for the **game
text**, which is what this whole pipeline moves. What makes a translation worth
shipping is the judgement an engine can't supply: register, idiom, and knowing
when a word is a rules term rather than an ordinary word. It also matters for
credit —
the translation ships under CC BY-SA 4.0 **with your name on it as its author**,
and that should mean something you actually wrote.

To keep terms consistent across every screen, there's a shared word list
at [`tools/i18n/glossary.tsv`](../tools/i18n/glossary.tsv) (FUE/DES/VOL, *fatiga*,
*espacios*, *insignificante*, …). A few 2e / Warden terms are marked
**"CONFIRM w/ fsmalecho"** (*vínculo*, *presagio*, *asalariado*, *Custodio*) —
those are proposals waiting on **your** decision. Run the advisory drift check any
time with:

```bash
npm run i18n:check -- --glossary
```

## What's in each pack, and a sane order

`npm run i18n:extract` prints a **per-file row count** so you can see the size of
each pack. A comfortable order (small warm-ups first, heavy prose last), one pack
per PR:

1. **Small / mechanical:** `content-armor`, `content-weapons`,
   `content-expeditionary-gear`, `content-tools`, `content-trinkets`,
   `content-transports`, `content-market-goods`, `content-marketplace`.
2. **Tables:** `content-tables-2e`, `content-tables-barebones`,
   `content-warden-encounters`, `content-warden-npcs`, `content-warden-travel`,
   `content-warden-monsters`.
3. **Big prose (last):** `content-backgrounds-2e`, `content-background-items`,
   `content-spellbooks`, `content-more-spellbooks`, `content-monsters`.

There's **no deadline** and no wrong order — import merges whatever you've filled,
so you can ship a pack at a time.

## Three gotchas worth knowing

- **Start a session with `npm run i18n:extract` — but only on a clean slate.** It
  folds your existing `lang/es.json` edits and prior content translations back into
  the spreadsheets, so a later `i18n:import` never overwrites older work with a
  stale cell. (You've been editing `lang/es.json` directly — that's fine; extract
  picks those up.)
- **End a session with `npm run i18n:import`.** That is the step that makes a
  translation permanent. `extract` rebuilds every TSV from the committed JSON, so a
  filled-but-unimported cell does not survive the next `extract` — and because the
  TSVs are git-ignored, nothing warns you and nothing can recover it. Typed is not
  saved; imported is saved.
- **If a `content-stale.tsv` appears**, it lists translations whose English source
  changed or was removed. It's **review-only** (never re-imported). Move any still-good
  Spanish into the matching current row in the normal `content-<pack>.tsv`, then
  ignore/delete the stale file.

## Credit & license

You're **credited** by name or handle — your choice. Because Cairn's text is
**CC BY-SA 4.0**, your translation is shared under the same license as part of the
open project (and where you adapt the official Spanish edition, that team is
credited too). See **Credits & licenses** in the [README](../README.md).

---

*This is the developer/self-service counterpart to [TRANSLATING.md](TRANSLATING.md)
(the emailed-spreadsheet flow for non-technical translators). Maintainer notes on
the machinery live in [i18n-maintainer.md](i18n-maintainer.md).*
