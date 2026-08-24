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

Measured by this gate (`npm run i18n:check --lang <code>`), against 593 English
keys (re-measured 2026-08-07, on `dev`). "Translated" means present *and*
different from the English. Every percentage here falls whenever the English
grows, without a single translation being lost — the denominator moves, and it
has moved twice (348 → 542 → 593). **Re-measure before quoting a number to a
contributor**: this table read 542 keys and `es` at 96% while the real figures
were 593 and 88%, which is the difference between "nearly done" and "sixty
strings outstanding".

| Locale | Translated | Content overlay | Note |
|---|---|---|---|
| `es` Spanish | 521 (88%) | ✅ the only one | actively maintained |
| `pl` Polish | 88 (15%) | — | inherited from the original Cairn system |
| `de` German | 52 (9%) | — | inherited |
| `da` Danish | 51 (9%) | — | inherited |
| `pt-BR` Portuguese | 51 (9%) | — | inherited |
| `fr` French | 48 (8%) | — | inherited |

The outstanding Spanish work is itemised in
[translation-handoff.md](translation-handoff.md), which separates keys that are
merely untranslated from the ones whose **English changed underneath a finished
translation** — the second kind reports as translated and is invisible to every
gate.

**That file is GENERATED — `npm run i18n:handoff [-- --lang <code>]`.** Do not edit
it by hand and do not assemble the list from a diff; regenerate it before every
tag (it is on the pre-tag list in [release-testing.md](release-testing.md)) and
commit the result. Hand-building it was how the first edition got made, and a
hand-built list can only ever describe the cycle whoever wrote it was looking at:
the drift it reports comes from `tools/i18n/baseline/<lang>.json`, which
accumulates across cycles, so a string changed two releases ago and never sent is
still on the list. A diff cannot see that.

It reports drift on **both** sides, because they fail differently and only one of
them is about keys. `lang/<lang>.json` is keyed by KEY, so an edited English value
leaves the translation present and wrong. `lang/content/<lang>.json` is keyed by
the ENGLISH SOURCE STRING, so an edited pack description leaves the translation
unreachable — and it then shows up as an orphan, which reads like prose we
deleted. Where a live string closely resembles an orphan, the generator pairs them
and says so, with the similarity score, so the answer is an edit rather than a
retranslation.

**Spanish is the translation; the other five are fragments.** They came from the
1e system and never grew as this fork added ~250 keys, so a German session is
mostly English. That is not a bug — English fallback is per string and by design —
but do not describe those languages as supported.

**All six locales pass `i18n:check` as of 2026-08-06.** The five inherited
files had failed identically — `CAIRN.CharacterRegeneratorConfirm` dropped the
`<p>` tags its English carries. When this file first noted that, only `fr`
failed; the English key gained its tags later, switching the same latent
defect on in the other four. The fix was not a bare tag-wrap: the English is
THREE paragraphs (the confirm plus two persistence notes) and the inherited
files carried only the first sentence, so the two missing paragraphs were
translated into each language using that file's own established vocabulary
(Przeszłość / Hintergrund / Baggrund / Antecedente / Historique), keeping the
inherited first sentence untouched. (The default `npm run i18n:check` checks
`es` only, so none of this ever gated a release.)

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
npm run i18n:check              # release gate: coverage + placeholder/HTML/enricher parity + VALUE DRIFT
npm run i18n:check -- --glossary  # advisory: flags a term translated inconsistently
   → you commit the JSON changes
```

### Value drift — the check that did not exist until 2026-08-07

Everything else here is structural: is the key present, do the placeholders and
the tags match. **None of it moves when you rewrite an English string that
already has a translation.** The key stays, the placeholders stay, and the
translation becomes *wrong* rather than missing — it still answers to the key
while promising what the English was deliberately changed to stop saying. Worse,
`extract-ui` computed `status = tr === en ? "todo" : "done"`, so the artefact
whose job is to show outstanding work marked those rows **done**.

Five Spanish strings were in that state when review #10 looked, and `CAIRN.Scars`
was in it for all six locales.

So `tools/i18n/baseline/<lang>.json` records, per key, the English that
translation was verified against:

```
npm run i18n:baseline -- --lang es       # seed once, from lang/en.json at the last tag
npm run i18n:check                       # reports `drifted:` and names every key
npm run i18n:check -- --strict           # makes drift (and dead entity keys) fatal
```

- **`i18n:import` advances it automatically.** Importing is the only event that
  re-verifies a key — the translator saw that English and sent back what they
  sent back. It records the row's `en`, not the live `lang/en.json`, so English
  that moved while the TSV was out with the translator still registers as drift.
- **Re-seeding is refused without `--force`**, because it would mark every
  currently-drifted key as verified and destroy exactly what the file is for.
- **Advisory by default, fatal under `--strict`.** Clearing drift needs the
  translator, and a gate only a third party can turn green is a gate that gets
  forced.
- **The limit, stated because a baseline that overclaims is worse than none:**
  the seed cannot see drift from before the tag it was seeded at. It is a floor,
  not a history.

These files are **not** in `lang/` on purpose — that directory ships in the
release zip, and `check:manifest` asserts every `lang/*.json` is a declared
Foundry language, which a baseline is not.

- `i18n:import` flags: `--dry` (validate without writing), `--lang <xx>` (target a
  locale other than `es`), `--tsv <dir>` (read TSVs from elsewhere). It rejects
  broken rows (naming each) and exits non-zero, so it can gate CI; clean rows still
  import. `status=done` with an empty `es` is an error; `es == en` and a dropped
  trailing space/em-dash are warnings.
- `i18n:check` exits non-zero on a real placeholder/HTML/enricher mismatch; a mere
  coverage gap is non-fatal (English fallback), unless you pass `--strict`.

The generated `tools/i18n/tsv/` directory is git-ignored — it is disposable output,
never committed. Only the JSON (and `glossary.tsv`) are tracked.

**`i18n:extract` overwrites every TSV from the committed JSON.** It is loss-free
only for translations already run through `i18n:import` — a filled cell that
hasn't been imported has no other copy, and since the TSVs aren't in git, nothing
could report or recover what was lost. So `extract` now **refuses** rather than
warns, in three tiers:

| Situation | Behaviour |
|---|---|
| Sheet holds a translation the JSON doesn't have | **Blocks** (exit 1) — nothing written; import first, or `--force` to discard |
| Sheet's value merely *differs* from the JSON | **Warns**, proceeds — the JSON's copy is safe, and the sheet is usually just stale after a merged PR |
| Sheet belongs to a different locale | **Blocks**, and tells you to use `--out`, explicitly *not* to import |

The three tiers exist because a guard that cries wolf is worse than none: block on
everything and people reach for `--force` by reflex, and then the tier that
matters stops working. Only the first tier describes work that exists nowhere
else. The third prints different advice on purpose — "run `i18n:import`" would be
*destructive* there, filing one language's text into another's JSON.

Guard is all-or-nothing per run: `extract-content` collects every pending write
and clears the guard before any file hits disk, so a refusal never leaves half
the sheets rebuilt.

In the brokered flow this matters most when a translator returns a filled
spreadsheet: **import it before you extract again**, and never re-extract to
"refresh" a sheet someone is still filling.

## Merging a pull request

**Never use GitHub's green "Merge pull request" button.** This is not a style
preference — the merge would be destroyed silently, and the contributor's work
with it.

`origin` is a Gitea repo that **push-mirrors** to GitHub. The mirror force-syncs
refs, so anything that exists only on GitHub is overwritten on the next sync. A
merge made with GitHub's button is exactly that: a commit on GitHub's copy of
the base branch that Gitea has never seen. It survives until the next sync and
then vanishes.
This is the same mechanism that once pruned release tags and turned releases into
drafts — see the mirror rule in [`RELEASE.md`](../RELEASE.md).

Merge locally instead, and let the mirror carry it, exactly as with any other
commit. **The target is `dev`** — all work merges to `dev` under the branch
model (`docs/git-flow.md`, 2026-07-28); this recipe said `master` for over a
week after that stopped being true, because it was written the day before the
model landed and never revisited:

```bash
git fetch github pull/<N>/head:pr-<N>   # the PR's commits as a local branch
git checkout dev
git merge --no-ff pr-<N> -m "Merge <who> <what> (PR #<N>)"

npm run i18n:check                      # gates BEFORE the push (see above)
npm run check:translations             # the loss guard: nothing the last release
                                        # shipped may have vanished (this recipe is
                                        # the one that once lost 158 strings)
npm run i18n:check -- --glossary        # advisory

git push origin dev                     # Gitea. Never push to the `github` remote.
git branch -d pr-<N>
```

Then confirm the mirror synced (Gitea → repo → Settings → Mirror → *Synchronize
Now*, if sync-on-push is off).

**Let the PR close itself. Do not close it by hand.** GitHub watches whether the
PR's head commit becomes reachable from **the PR's base branch** and flips the PR
to **Merged** when it does, with no button pressed — but only while the PR is
still *open*. A PR you close first stays merely *closed* forever, even when the
identical commits land minutes later.

Because the base branch is what GitHub watches, **a PR based on `master` must be
retargeted to `dev` BEFORE you push**, or it sits open until the next release.
Maintainer-only and browser-only (no `gh` on this machine): PR page → the pencil
beside the title → the base chip becomes a dropdown → pick `dev` → **Change
base**. It moves nothing; the contributor does not rebase or re-push. PR #12
needed exactly this; PR #13 arrived based on `dev` and flipped on the push.

Two things therefore have to hold, and the first two Spanish PRs — merged to
`master` before the branch model existed — are the worked example of each:

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

### Auditing a translation PR — three steps, each has caught something

PR #13 (2026-08-06) is the worked example; every step found a real defect:

1. **Diff by KEY against `dev` before merging** — adds / removes / changes per
   namespace, both files. A whole-file upload (the GitHub web UI's
   Delete + "Add files via upload" dance) can silently revert anything `dev`
   changed since the contributor's copy; the key-diff proves it didn't. Check
   every removed key against `en.json`: absent there means cleanup of an
   orphan, present means a revert — put it back.
2. **`i18n:check` after merging, before pushing.** On #13 it caught a
   translated PLACEHOLDER (`{name}` → `{nombre}`), which `format()` would
   print literally. Fixing machinery is a correction, not a re-voicing — the
   translator's wording stays theirs.
3. **Re-run `i18n:extract` and read the stale-count DELTA.** A NEW orphan
   after the merge is contributor work keyed to a string that can never
   match. #13's was a straight apostrophe (`You've`) where the pack source
   has the typographic one (`You’ve`) — the overlay normalizes whitespace
   only, so the entry would never display. Re-key it to the byte-exact
   source string; never ask for a retranslation.

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
