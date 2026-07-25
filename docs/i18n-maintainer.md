# Localization — maintainer runbook

This is the **maintainer's** guide to Air Bladder's translation pipeline. If you
are the *translator*, read [`TRANSLATING.md`](TRANSLATING.md) instead — this file
is for whoever runs the tooling, reviews contributions, and commits the result.

## The model in one paragraph

**English is the single source of truth.** The shipped translations are two JSON
files per language: `lang/<lang>.json` (interface) and
`lang/content/<lang>.json` (compendium content — the display overlay). The
per-string TSV spreadsheets under `tools/i18n/tsv/` are **not** a source of
truth — they are a *working format* regenerated from the JSON on demand. Anything
not translated falls back to English, per string, automatically (Foundry's
per-key merge for the UI; the overlay's return-source-on-miss for content), so a
partial translation is always shippable and never blank.

Two properties make this safe to hand around:

- **`extract` pre-fills** every TSV `es` cell from the current JSON, so
  re-generating never discards prior work.
- **`import` merges** filled rows onto the existing JSON and never deletes — and
  it is a *validating gate*: a dropped `{placeholder}`, a broken HTML tag set, or a
  mangled `@UUID[...]` target is rejected before it can reach a player.

## Two ways a translation arrives

Both paths write the same JSON and compose cleanly (extract pre-fills from
whatever the other path committed), so a project can switch between them mid-way.

1. **Git-comfortable contributor (e.g. fsmalecho).** Opens a pull request editing
   `lang/<lang>.json` and/or `lang/content/<lang>.json` directly, or fills the
   TSVs and PRs those. Review, run the gates below, merge.
2. **Non-git translator (a likely successor).** Works only in spreadsheets. You
   broker the round-trip: generate the TSVs, hand them off, receive them back
   filled, import, and commit. The translator never touches git or Foundry — the
   plumbing is yours. The TSV format also earns its keep for the ~3200-string
   *content* phase even with a git contributor: a validated spreadsheet catches a
   dropped `</p>` that a giant-JSON PR review would miss.

## The command cycle

```
npm run i18n:extract            # JSON → tools/i18n/tsv/*.tsv  (es pre-filled from current JSON)
   → hand tools/i18n/tsv/*.tsv to the translator; they fill the `es` column
npm run i18n:import             # filled TSV → lang/es.json + lang/content/es.json  (merge + validate)
npm run i18n:check              # release gate: coverage + placeholder/HTML/enricher parity
npm run i18n:check -- --glossary  # advisory: flags a term translated inconsistently
   → you commit the JSON changes
```

- `i18n:import` flags: `--dry` (validate without writing), `--lang <xx>` (target a
  locale other than `es`), `--tsv <dir>` (read TSVs from elsewhere). It rejects
  broken rows (naming each) and exits non-zero, so it can gate CI; clean rows still
  import. `status=done` with an empty `es` is an error; `es == en` and a dropped
  trailing space/em-dash are warnings.
- `i18n:check` exits non-zero on a real placeholder/HTML/enricher mismatch; a mere
  coverage gap is non-fatal (English fallback), unless you pass `--strict`.

The generated `tools/i18n/tsv/` directory is git-ignored — it is disposable output,
never committed. Only the JSON (and `glossary.tsv`) are tracked.

## Resuming a stalled translation

This is the case the TSV path exists for: someone translated part of it, stopped,
and a new person (maybe non-git) picks it up later — possibly after the English
source has been edited in the meantime.

- **Continuation is automatic.** `npm run i18n:extract` pre-fills every `es` cell
  from the current JSON, so the successor's TSVs already contain all prior
  translations (marked `done`) and only the untranslated rows are blank (`todo`).
  They continue from exactly where the last person left off.
- **Source drift is surfaced, not silently dropped.** When an English string was
  edited or removed while translation was paused, its old translation no longer
  matches any current source. `extract` writes those orphans to
  **`tools/i18n/tsv/content-stale.tsv`** (content) and appends `status=stale` rows
  to `ui.tsv` (interface), each carrying the prior Spanish so it can be revised or
  ported to the changed string rather than lost. These rows are **review-only** —
  `import` never reads `content-stale.tsv` and skips any `status=stale` row, so a
  removed key can't creep back into the shipped JSON. When there are no orphans, no
  `content-stale.tsv` is produced.

## The glossary

`tools/i18n/glossary.tsv` (columns `en · es · kind · source · notes`) is the term
contract — one Spanish word per concept, so "background" is always *Trasfondo* and
never *fondo*. It is seeded from the terms already settled in `lang/es.json` plus
established Cairn Spanish vocabulary; a handful of 2e/Warden/fork terms are marked
**"CONFIRM w/ fsmalecho"** and are proposals awaiting the translator's decision.
`npm run i18n:check -- --glossary` warns (advisory) when a translated line uses a
glossary term one way in English but another in Spanish.

## Licensing & credit (do not skip)

Cairn's text is **CC BY-SA 4.0**, so a translation is a derivative under the same
licence — the translator is credited as its author but cannot reserve rights on
it. Add them to `README.md` credits (and `system.json` authors if they wish). Where
the translation adapts the official Spanish *Guía del jugador* or the 1e Spanish
SRD, those teams (La esquina del rol / Mario; the 1e SRD team) **must** be credited
too under ShareAlike. See the licensing notes in the translation plan.
