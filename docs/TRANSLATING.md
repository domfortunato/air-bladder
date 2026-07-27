<!--
  Maintainer notes (not shown on GitHub):
  - Before inviting a translator, agree a HANDOFF METHOD (email / shared drive)
    and a FEEDBACK CHANNEL (email / chat), and drop them into the two spots
    marked "[agree with the maintainer]" below.
  - The tooling this describes (spreadsheet export/import, the automatic checker,
    the glossary) is specified in the project's translation plan. This doc is the
    translator-facing front-end and deliberately hides the machinery.
  - Current language effort: Spanish (Latin American). The same process applies to
    any future language.
-->

# Translating Air Bladder

Thank you for helping translate Air Bladder! Air Bladder is a free, fan-made
companion system for playing **Cairn (2nd edition)** on Foundry VTT. The current
goal is to make it fully playable in **Latin American Spanish** — every menu and
button, and all the game content: backgrounds, items, spells, tables, and
monsters.

Your role is simply to **translate**. You won't need to write code, install
anything, or use developer tools. Your whole job is turning English into good
Spanish in a spreadsheet — the maintainer handles everything technical.

## How it works, in one breath

1. We send you a **spreadsheet**.
2. You fill in the **Spanish** column.
3. You send it back.
4. We load it, and your Spanish appears in the game.

That's the entire loop, repeated one batch at a time.

> **Translating into another language?** This guide says "Spanish" throughout
> because Spanish is the translation currently in progress — it's the example, not
> a limit. The tooling takes any locale code, and your spreadsheet's column is
> named after your language rather than `es`. Only two bits of advice here are
> genuinely Spanish-specific: the suggestion to adapt the official Spanish edition
> (which exists for Spanish and may not for your language), and the starter
> glossary. Say hello and we'll set up the rest.
>
> For honesty's sake: Air Bladder ships partial Danish, French, German, Polish and
> Brazilian Portuguese interface files inherited from the original Cairn system,
> covering 15–30% of the current interface and unmaintained. Spanish is the only
> language with translated game content. Untranslated text falls back to English
> string by string, so nothing breaks — but if you're picking a language up, you're
> starting nearer the beginning than those numbers suggest.

## The spreadsheet

Each spreadsheet is a simple table — one row per phrase — with these columns:

- **English** — the original text (leave this alone).
- **Spanish** — the empty column you fill in.
- **Where it appears** — a short hint about context (e.g. "a button," "a
  monster's description," "a background question") so you can phrase it correctly
  without ever opening the game.
- **Notes** — a place for you to leave questions or comments back to us.
- **Status** — mark each row *done* or *draft* as you go.

A few easy rules (with examples in the file):

- Keep anything in **{curly braces}** exactly as-is — those are slots the game
  fills in with numbers or names.
- Keep any **formatting tags** (like `<b>…</b>`) — translate the words between
  them, leave the tags.
- Don't translate **names, code, or web links** — those are marked or obvious.
- When you send a file back, an **automatic checker** flags any row where a slot
  or tag got dropped, so small slips are caught before they ever reach a player.
  You don't have to be perfect — the checker has your back.

## You won't be translating from scratch — but please don't use AI

Cairn 2e already has an **official Spanish edition** (the *Guía del jugador*). For
the core game content, you'll mostly be **adapting and confirming** that existing
Spanish rather than inventing it.

The one shortcut to skip is machine translation. Running the **game text** through
a translation engine isn't what this is for — the value is your judgement about
register, idiom, and when a word is a rules term rather than an ordinary one. It
matters for credit, too: the translation ships under CC BY-SA 4.0 with your name
on it as its author, and that should mean something you actually wrote.

We'll also give you a **glossary** — a shared
word list — so the same term is always translated the same way everywhere (we
agree on one word for "Warden," one for "background," and so on). If you hit a
term that isn't in the glossary, note it and we'll add it.

A **starter glossary** already lives at [`tools/i18n/glossary.tsv`](../tools/i18n/glossary.tsv),
seeded from the existing Spanish in the system and the terms Cairn players
already know (FUE/DES/VOL, *fatiga*, *espacios*, *insignificante*…). A handful of
2e / Warden terms are marked **"CONFIRM w/ fsmalecho"** (*vínculo*, *presagio*,
*asalariado*, *Custodio*) — those are proposals waiting on your call, not
decisions. The optional check `npm run i18n:check -- --glossary` flags any
translated line that uses an English term one way but its Spanish another, so the
same word never drifts across two screens.

## The order of work — pace yourself

Two stages, and you never face all of it at once:

1. **The interface first** — a few hundred short phrases (buttons, menus,
   tooltips). Small and self-contained; a good warm-up that proves the whole
   process works end to end, and it ships on its own so Spanish players get a
   translated interface early.
2. **The game content next** — backgrounds, items, spells, tables, monsters —
   delivered **one category at a time**, so you work through it in waves at a
   comfortable pace. **There's no deadline.**

> [!TIP]
> **Nothing you haven't finished will ever break.** Anything not yet translated
> simply shows in **English** — no blank spaces, no error messages. You can send
> partial work, players can use it immediately, and you can keep improving it
> release after release. Work at whatever pace suits you.

## Questions and feedback

Use the **Notes** column for anything specific to a row. For bigger questions — a
term, a tone choice, something ambiguous — reach out directly
_[agree with the maintainer: email / chat]_. We'd always rather you ask than
guess.

> [!IMPORTANT]
> **Credit and licensing.**
> - You'll be **credited** by name or handle — your choice.
> - Because Cairn's text is shared under an open license (**CC BY-SA 4.0**), your
>   Spanish translation is shared the same way — you're credited as its author,
>   but it becomes part of the free, open project rather than something kept
>   private. Where you adapt the official Spanish edition, we credit that team
>   too. (See **Credits & licenses** in the [README](../README.md).)

## To get started, we just need

- How you'd like to **receive and return** the spreadsheets
  _[agree with the maintainer: email / shared drive / …]_.
- How you'd like to be **credited**.

Then we send you the first spreadsheet — the interface — and you're off.
