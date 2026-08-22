# How to use GLOG Magic in Air Bladder

Air Bladder ships with an optional [GLOG Magic hack](https://cairnrpg.com/hacks/glog-magic/) for Cairn, which is based on Goblin Punch's seminal **Goblin Laws of Magic** and its [2016 blogpost](https://goblinpunch.blogspot.com/2016/05/the-glog.html). To use GLOG Magic with the system, the Game Master must first enable it in the world's game settings.

Yochai Gal's adaptation of the GLOG Magic rules text — casting, Fatigue,Mishaps, copying and creating Grimoires — ships in Air Bladder as the **GLOG Magic — Player Rules** journal in the **Journals (GLOG)** compendium, with all 100 spells beside it in **GLOG Magic — Spells**.*

## Overview

Some think that GLOG makes magic more powerful and interesting in Cairn. Here is an overview of how it works:

**Magic Dice** — are required for each spell, and equal to the number of free item slots that a character has available. Investing more magic dice in your spell casting can increase the power, range and duration of your spell. But each die invested increases risk of fatigue or magical mishap!

**Grimoires** — These are special spell books that a PC can make or have made at great expense, which can hold spellscrolls as pages. Unlike spellscrolls, the spell pages in a Grimoire have unlimited uses. 

**Spellscrolls** — There are no "normal" spellbooks in a world with GLOG Magic enabled. All player spellbooks (including those give by background grants or previous sessions) automatically convert to GLOG Spellscrolls that are single use only and require at least one Magic Die to cast.



---

## Turning it on

**Configure Settings → Air Bladder → GLOG & Other Hacks → Configure → Use GLOG Magic (converts all spellbooks!)**

The exclamation mark is earned. Turning this ON converts the whole world, once, immediately:

- **Every canon spellbook anywhere becomes a spellscroll**— in inventories, in world items, on unlinked tokens, in world compendia — becomes a single-use **Spellscroll**
  carrying the GLOG wording of its spell. A scroll that was already spent
  stays spent.
- **New arrivals convert too.** Drag a canon spellbook from any compendium onto a character and it lands as an unspent Spellscroll. There are no spellbooks in a GLOG world — there are only Grimoires and spellscrolls.
- **Character generation** hands out only GLOG and custom spells, always as scrolls.

**IMPORTANT: Turning GLOG magic off in settings will not convert spellscrolls back into normal (non-GLOG) spellbooks and spellscrolls** Treat the switch to GLOG as a campaign decision, not a toggle to flip between sessions.

## Getting a Grimoire into a character's inventory

The Grimoire is a special magical item stored in the **Air Bladder Items | Reliquary** compendium folder — no special actor, no macro needed!

1. Open the **Reliquary** compendium. Import it into your world if you wish.
2. Drag a **Grimoire** onto a character's sheet.

It is *bulky* (two slots), and a character can carry **one** — dropping a second onto the same character is refused. An NPC crate or pile can hold any number of recovered books; it just offers none of the magic controls, because transmuting and casting belong to the book's carrier.

A Grimoire costs 300gp in labor and special inks and is *always found, made or taken*. Players will never find one for sale as shelf stock — so it ships in the Reliquary, not the Marketplace. Creating one from a Scroll (requiring 200gp in special ink, and a full moon) is downtime action in the Player Rules journal.

A warden can edit a Grimoire's **spellpage capacity** in — `Pages` on the Grimoire's item sheet, 10 by default. Edit the capacity there if your table uses larger or meaner tomes. Each spellpage holds one spell that was formerly a spellscroll.

## Moving a Grimoire between sheets

**A book's pages travel with it, and only its own.** Drag a Grimoire from one sheet to another and its spellpages go along in the same move — to another character, into a crate, out of one again. They cannot be dragged separately: a page belongs to a book, not to whoever is holding it that day.

That holds when a crate is holding several books at once. Each one keeps the pages that were written into it, so taking one library off the shelf leaves the others exactly as they were.

One exception, and it only ever concerns pages bound in an earlier version of Air Bladder, before a page recorded which book it was in. Your world is repaired the first time you open it after updating — but only where the answer is readable, meaning a sheet holding one book. If two or more of those older books are sitting on the *same* sheet, nothing in the saved data says which pages belong to which, so they are left where they are rather than guessed at, and they stay behind when either book leaves. Move the books off one at a time and the last one out takes what remains, or transmute the spells afresh into the book you want them in. The repair names any such sheet in the browser console (F12) when it runs.

## Transmuting spellscrolls into a Grimoire's pages

While a character carries a Grimoire that is not yet full, every unbound Spellscroll in their inventory grows a **Transmute into the Grimoire** control on its row. Click the control and confirm the dialog and the spell becomes a **spell page**:

- weightless — spellpages do not consume inventory slots
- grouped and indented under the Grimoire wearing a "page" icon;
- a scroll's one-use nature is cleared — a spellpage casts forever, even multiple times per day, which is exactly what the 50gp transmute buys (the scroll dialog names the cost: 50 gold and 6 hours of downtime, *deduct those costs manually on the Player's sheets*);
- **bound is forever. **Typically, unless your table plays differently with GLOG! 

## Casting

**From the book:** once the Grimoire holds at least one spellpage, its inventory row on the Player's sheet shows **Cast**. Pick the spell and invest **Magic Dice** — up to your *free inventory slots*, capped at 4. A full pack means no dice and no cast: encumbrance is the resource, exactly as the hack intends, with no bookkeeping — fill a slot and the next cast's pool shrinks by itself.

The roll is a real Foundry roll (Dice So Nice animates it), spoken by the character. Two messages follow:

- **A public card** with the spell's text *resolved*: `[dice]`, `[sum]` and
  per-power blocks are replaced by the rolled values, each marked — hover a
  resolved number to see the expression it came from.
- **A private whisper to the caster** with the rolled faces, an **Add N
  Fatigue** button — one Fatigue per die showing 4–6, never refused, even
  into a full pack, because the cost is owed — and, when the dice come up
  doubles, the **Mishap**: the line names it and the drawn row from the
  Mishaps table rides the whisper. No doubles, and the whisper says so
  outright.

**From a scroll (GLOG setting on):** an unspent, unbound Spellscroll shows
its own cast control — the same dice, Fatigue and Mishaps — and the cast
**spends** the scroll: struck through, kept, never deleted. A spent scroll
can still be transmuted into a Grimoire, where it comes back as a permanent
page — that is the 50gp decision the hack leaves on the table.

## Customizing the Mishaps

The Mishap draw resolves **world-first**: import **GLOG Magic: Mishaps**
from the **Tables (GLOG)** compendium into your world and edit your copy —
the cast flow finds the world's table before the shipped one, the same way
the Faction die works.

## What is deliberately not automated

The whisper reports; it does not apply. Fatigue is the one button, because
its count is pure arithmetic. Everything a Mishap or spell *does* — reversed
effects, lost slots, combusting inventories — stays prose for the table to
act out, by the same house rule that keeps "Restores 1 STR" a sentence.
