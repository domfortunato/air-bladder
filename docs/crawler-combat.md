# Crawler Combat Mode

**Crawler Combat Mode** is an optional hack for a harsher, more lethal game. It
is **off by default** and changes nothing until you turn it on, under **Game
Settings → Air Bladder → Configure Hacks**.

It affects **player characters only**. NPCs, hirelings and monsters are untouched
by every part of it.

Turning it on reloads the world, so everyone at the table sees the same rules at
the same moment.

## What the hack itself does

**An overburdened player character is Deprived.**

Cairn already sets a character's Hit Protection to 0 while they are
overburdened. With Crawler Combat Mode on, they are **Deprived** as well, until
they are no longer overburdened.

Being Deprived means they cannot Rest and cannot Restore Abilities — both
buttons grey out on the sheet. This is **not** the same as Critical Damage,
which is a separate condition with its own banner and its own recovery.

While the hack is holding a character Deprived, the Deprived box on their sheet
is ticked and cannot be unticked — hovering it says why. **Your own use of the
box is not lost**: if you had marked a character Deprived for going without food
or rest, that is still there, and it comes back the moment they stop being
overburdened.

One thing worth knowing at the table: **overburdened means no free slot**. A pack
filled to exactly its limit counts, so clearing it means ending up with a slot
genuinely spare. A character at 11 of 10 slots has to put down two things, not
one.

## Exploding damage dice

Tick **Exploding damage dice** and a player character's damage die that rolls
its highest face is rolled again and added — for as long as it keeps rolling the
highest.

A d6 rolling 6 then 4 deals 10. A d6 rolling 6, 6 and then 2 deals 14.

**Only the die you keep explodes.** Cairn's dual-wield and similar rules roll two
dice and keep the higher. If both come up 6, that is **one** six, so it explodes
once — you do not get two chains.

Impaired (d4) and Enhanced (d12) rolls explode too.

**Only player characters' damage rolls explode.** A monster's attack, an NPC's,
and the Warden's Damage tool for a trap or hazard all roll normally.

**One limit, stated plainly.** If you write a keep-highest damage formula out of
**different** dice — `d6 + d8`, say — it will not explode. Keeping the highest
and then exploding only that die has no way to be written for mixed dice, and
the alternative would quietly give you better odds than the rule above. No
weapon that ships with the system is written this way. Same-sized dice —
`2d6k`, `d6 + d6`, and every shipped weapon — explode normally.

## Fatigue instead of Critical Damage

Tick **Fatigue instead of Critical Damage** and a player character who fails a
Critical Damage save is offered a choice on the chat card: take the Critical
Damage as usual, or **Take a Fatigue instead**.

Taking the Fatigue adds it to their inventory **even if they have no free
slot** — Fatigue is a cost the rules impose, not something they chose to pick
up. That will usually leave them overburdened, which under this hack means
Deprived and at 0 Hit Protection until they free a slot. The button says so
before you press it.

It is one choice or the other. Pressing either button settles the card, and it
stays settled — coming back to it later, the buttons are spent.

The choice appears on a card only if the option was on when the save was rolled.
Turning the option off later does not retract a choice already on screen.

## A matching character generator

This hack suits characters built to survive it. Under **Configure Character
Generation**, **Ability dice for player characters** offers **Crawler
(2d6 + 6)**, which never rolls an ability below 8.

That setting is independent of this hack — you can use either without the other.

## See also

- **Dice Formulas** — what a damage formula can say, including keep-highest
  notation.
- **GLOG Magic in Foundry** — the system's other optional hack.
