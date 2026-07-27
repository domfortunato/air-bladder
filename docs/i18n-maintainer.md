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

## Where the languages actually stand

Measured by this gate (`npm run i18n:check --lang <code>`), against 348 English
keys. "Translated" means present *and* different from the English:

| Locale | Translated | Content overlay | Note |
|---|---|---|---|
| `es` Spanish | 284 (82%) | ✅ the only one | actively maintained |
| `pl` Polish | 104 (30%) | — | inherited from the original Cairn system |
| `de` German | 58 (17%) | — | inherited |
| `da` Danish | 57 (16%) | — | inherited |
| `pt-BR` Portuguese | 55 (16%) | — | inherited |
| `fr` French | 53 (15%) | — | inherited; **fails the gate** (see below) |

**Spanish is the translation; the other five are fragments.** They came from the
1e system and never grew as this fork added ~250 keys, so a German session is
mostly English. That is not a bug — English fallback is per string and by design —
but do not describe those languages as supported.

`fr.json` currently fails `i18n:check` outright: `CAIRN.CharacterRegeneratorConfirm`
drops the `<p>` tags its English carries. The inherited files have never been
through this gate, so assume the others hold similar defects until checked.

`cn.json` was removed (2026-07-27): it shipped in `lang/` but was never listed in
`system.json` `languages`, so Foundry never loaded it — 17% of a 1e interface that
no player could ever have seen.

## Any locale, not just Spanish

Every tool takes `--lang <code>` and defaults to `es`:

```bash
node tools/i18n/extract-ui.mjs --lang fr     # → ui.tsv with an `fr` column
node tools/i18n/extract-content.mjs --lang fr
node tools/i18n/import-i18n.mjs  --lang fr   # → lang/fr.json + lang/content/fr.json
node tools/i18n/check.mjs        --lang fr
```

Two details worth knowing:

- **The TSV's translation column is named after the locale**, so a French
  translator fills a column headed `fr`. In code that cell is always `row.tr` —
  the file format carries the locale, the tooling does not. `readTSV` still
  accepts an older `es`-headed TSV, so a spreadsheet filled before this change
  imports fine.
- **The glossary is per-locale**: `tools/i18n/glossary-<lang>.tsv`, with the
  unsuffixed `glossary.tsv` serving Spanish because it predates this. A locale
  with no glossary simply skips the drift check instead of failing.

The content advice in the translator guides is Spanish-specific for a reason that
doesn't travel: "adapt the official Spanish edition" works because *Guía del
jugador* exists. A language with no official Cairn edition gets no such shortcut,
and starts from a blank glossary.

## Two ways a translation arrives

Both paths write the same JSON and compose cleanly (extract pre-fills from
whatever the other path committed), so a project can switch between them mid-way.

1. **Git-comfortable contributor (e.g. fsmalecho).** Opens a pull request editing
   `lang/<lang>.json` and/or `lang/content/<lang>.json` directly, or fills the
   TSVs and PRs those. Review, run the gates below, then merge it **the way
   described in "Merging a pull request" — not with GitHub's merge button.**
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

**`i18n:extract` overwrites every TSV from the committed JSON, silently.** It is
loss-free only for translations that have already been *imported* — a filled cell
that hasn't been through `i18n:import` does not survive the next extract, and
since the TSVs aren't in git, nothing reports what was lost. This matters most in
the brokered flow: when a translator returns a filled spreadsheet, **import it
before you extract again**, and don't re-extract to "refresh" a spreadsheet
someone is still working in. The translator guide now warns about this too, but
the tooling does not yet enforce it.

## Merging a pull request

**Never use GitHub's green "Merge pull request" button.** This is not a style
preference — the merge would be destroyed silently, and the contributor's work
with it.

`origin` is a Gitea repo that **push-mirrors** to GitHub. The mirror force-syncs
refs, so anything that exists only on GitHub is overwritten on the next sync. A
merge made with GitHub's button is exactly that: a commit on GitHub's `master`
that Gitea has never seen. It survives until the next sync and then vanishes.
This is the same mechanism that once pruned release tags and turned releases into
drafts — see the mirror rule in [`RELEASE.md`](../RELEASE.md).

Merge locally instead, and let the mirror carry it, exactly as with any other
commit:

```bash
git fetch github pull/<N>/head:pr-<N>   # the PR's commits as a local branch
git checkout master
git merge --no-ff pr-<N> -m "Merge <who> <what> (PR #<N>)"

npm run i18n:check                      # gates BEFORE the push (see above)
npm run i18n:check -- --glossary        # advisory

git push origin master                  # Gitea. Never push to the `github` remote.
git branch -d pr-<N>
```

Then confirm the mirror synced (Gitea → repo → Settings → Mirror → *Synchronize
Now*, if sync-on-push is off).

**Let the PR close itself. Do not close it by hand.** GitHub watches whether the
PR's head commit becomes reachable from `master` and flips the PR to **Merged**
when it does, with no button pressed — but only while the PR is still *open*. A
PR you close first stays merely *closed* forever, even when the identical commits
land minutes later.

Two things therefore have to hold, and the two Spanish PRs are the worked example
of each:

- **Keep their commits.** Merge `--no-ff` on the contributor's actual branch
  rather than re-typing their changes, so the SHA survives. Both PRs got this
  right — `refs/pull/2/head` and `refs/pull/3/head` are both ancestors of
  `master` today.
- **Push before the PR closes.** **#3** was still open when its merge reached
  GitHub, and reads as *merged*. **#2** was closed manually at 16:34 UTC and its
  commit landed around 16:44 — ten minutes too late. It reads as merely *closed*,
  permanently, despite the work being in `master` the whole time.

Both shipped the translation; only one gave the contributor the merged-PR credit
on their profile. When someone donates work, get them the badge.

**This rule is not specific to translations.** Any pull request against this
repo — a code fix, a doc typo — merges the same way, for the same reason.

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
