# Attribution for custom backgrounds — decided and built

*Internal design note, kept as the record of a decision rather than as a plan.
Not published — `tools/site.mjs` copies only `docs/images/*.png`, so `.md` files
here stay out of the built site by construction.*

*Raised 2026-08-15 as "if a Warden writes their own backgrounds, where do they
record who wrote it and under what licence?" — investigated, then answered the
same day. **Built.** What follows is the shape that shipped and the reasoning,
so the alternatives are not re-argued.*

---

## The answer

`system.attribution` on `BackgroundData` — one free-text line, editable on the
authoring form, printed in the footer of every character sheet built on that
background.

Before it, the only place was the **Description**, as prose: it travelled with
the document but never reached the printed page and nothing could read it.

## What it replaced, and why the replacement matters more than the field

For exactly one day (`a5ae5d32`, unreleased) the footer credited Gordon
McCormick by reading the shipped class backgrounds' `backgroundSource`
provenance flag. That was wrong in a way that only shows up from the Warden's
side: **a credit derived from provenance can never be switched off.** Duplicate
a Cleric, rewrite every word, and the sheet went on printing his name over
writing that was no longer his, with nothing in the UI to stop it.

A field is editable, so the line belongs to whoever owns the text. That is the
whole change; the field for homebrew authors falls out of it for free.

Two consequences that are the design, not accidents:

- **The canon 2e and Barebones backgrounds ship with the field EMPTY.** Cairn's
  own credit prints on every sheet unconditionally — the page reproduces its
  rules whether a background is involved or not — so filling theirs would name
  Yochai Gal twice. The FIELD is still on them, because it is schema: duplicate
  a Fletchwind and the box is there waiting.
- **A background with no credit prints no author line at all.** Air Bladder
  never guesses. Guessing would put a real person's name on someone else's
  writing, which is the one failure this feature could introduce, so it is a
  probe leg rather than a comment.

## Where it lives

| | |
|---|---|
| Schema | `module/data-models.js`, `BackgroundData.attribution` |
| Printed | `module/actor/actor-sheet.js` — joined into `credits`, with a full stop appended when the authored value lacks one |
| Rendered | `templates/print/character-print.html` — the escaped `{{ credits }}` stash, never a triple-stash |
| Authored | `templates/item/background-sheet.html` — a `bg-edit-row` input, plus a read-only paragraph for locked shipped packs |
| Shipped value | `tools/import/class-backgrounds.mjs` writes the seven |
| Strings | `CAIRN.BgAuthor.Attribution` / `.AttributionHint` / `.AttributionPlaceholder` |
| Probes | `dev:print` (five legs), `dev:bg-author` (four legs) |

The shipped value is worded as a **citation**, not a sentence —
`Backgrounds for Cairn — Gordon McCormick, after BECMI D&D by Frank Mentzer ·
CC BY-SA 4.0`. The field is authored data and never goes through the content
overlay, so this exact string is what a Spanish player reads: two names, a title
and a licence code travel between languages; "Background from … after … text
licensed …" would not.

## Decided against

- **No migration.** The flag-based credit was never released, so no world has
  ever printed McCormick's line and nothing is taken away by removing it. A
  pre-existing duplicate of a Cleric gets an empty, editable box — which is the
  point. A one-shot stamp was considered and rejected: it would re-assert his
  authorship over text that may have been entirely rewritten, once instead of
  forever, when the entire object of the exercise is that the assertion is the
  Warden's to make.
- **Structured author + licence fields, or a licence dropdown.** A picker invites
  a wrong answer chosen for being nearby, Wardens write terms in prose anyway,
  and structured data is only worth it once something consumes it — a credits
  index, a share bundle. Nothing does. One field is also one migration.
- **Clearing the `backgroundSource` flag.** It stays, as provenance metadata; no
  behaviour reads it any more.

## Still open, and NOT part of this

**Art outside the system earns no credit line.** The footer's art attribution
matches the portrait path against five prefixes under `art/`, so a portrait on a
shared library or any other external path prints nothing. If such a set's licence
requires attribution, the printed sheet does not satisfy it. Path-prefix matching
cannot express it — that would need per-portrait metadata, a much larger change.
Raised and understood 2026-08-15; not being built.
