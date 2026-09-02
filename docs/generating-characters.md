# Generating Characters

Cairn characters are not built — they are dealt. Air Bladder gives you two ways
to deal one, and one loop for making the result yours. There is deliberately no
step-by-step "character builder": the dice hand you a person, and the choices
come after.

## Generate PC

The **Generate PC** button sits above the Actors sidebar. One click
rolls everything a Cairn 2e character starts with — abilities, Hit Protection,
a background with its gear and questions, traits, age, and a bond — and opens
the finished sheet. With more than one content source enabled (Custom 2e,
Barebones), a picker asks which table to deal from first.

## Import from Kettlewright

**Import from Kettlewright** sits beside it. Pick a character's `.json` export
from [Kettlewright](https://kettlewright.com/), the official Cairn app, and it
becomes a new character actor here: stats, gold and inventory as exported, a
stock Kettlewright portrait mapped to the same face, questions and bonds
matched back to their tables so they stay re-rollable. Items and bonds that
match nothing are still imported — built from their tags or kept as text — and
a summary dialog lists everything worth reviewing. A background this world
doesn't have doesn't stop the import either: the character still arrives with
the background kept as plain text, and the summary warns that its questions'
answers and bond can't be re-rolled or picked from a table.

## Players can do both

Both buttons appear for players while the Warden's switch is on — the setting
reads **"Allow players to create new player characters through random
generation or .json import"**, and the shipped **Toggle Player Character
Creation** macro flips it mid-session. A player who imports their own
Kettlewright character gets the same options dialog and the same review
summary the Warden would; if their account cannot create actors, the Warden's
client quietly does it for them and hands them the finished sheet, stamped as
theirs. Both routes run through the Warden's client for a player who can't
create actors themselves, so a Warden must be logged in — with no Warden
connected the buttons grey out (hovering says why), and they wake on their
own the moment a Warden arrives. The Warden sees a notification either way — a player import arrives
with whatever the file says, so it is never invisible.

## Make it yours: Character Creation Mode

A generated or imported character arrives quiet — no dice on the sheet. The
**Character Creation Mode** toggle in the sheet's title bar brings the
creation tools back: a die beside each part of the character re-rolls that one thing —
the name, the portrait, the age, the background (gear and all), the omen, a
bond, a background question — and a **pick-list button** (the list icon)
beside the name, background, failed career, omen, bond and question dice —
and on the portrait — lets you choose instead of roll. The pickers are how you
recreate a character you rolled with
the book, paper and dice: pick the rows you already rolled, and the sheet
grants whatever those rows grant. Traits stay hand-edited pick-lists either
way. **Roll Character** opens a checklist of everything that can be re-rolled,
all checked to begin with: uncheck what you want to keep, and only the rest is
re-rolled. The name, starting gear and the two Background Questions ride the
Background line — a new background deals its own, name included — while bonds
re-roll only when their own line is checked, and a
background you picked by hand starts unchecked, so a full re-roll keeps it
unless you say otherwise. What the list never offers it never touches: notes,
scars, pronouns, and anything bought or given stay yours. While the mode is
on, the STR/DEX/WIL save dice are grayed out — turn it off to roll saves. This
is the intended loop: generate, re-roll or pick the parts that don't sit
right, then flip the toggle off and play.

For players, the sheet tools ride their own switch — **"Let players use
Character Creation tools on their sheets"**, flipped by the **Toggle Player
Creation Tools** macro — so you can allow character creation but keep
mid-campaign re-rolls to yourself, or hand players the dice entirely.
