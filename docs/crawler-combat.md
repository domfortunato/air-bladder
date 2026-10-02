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

**Nothing smaller than a d6 explodes.** An **Impaired** roll is a d4, so an
impaired attack never explodes — and neither does a d4 weapon, if you write one.
**Enhanced** rolls are a d12 and explode normally. The same floor decides whether
a maneuver is offered, so the two options agree about which dice are big enough
to be interesting.

**Every explosion is announced.** The damage card gains a line — *A d6 exploded!*
— once for each time the die went again, so a chain of three says so three times.

**An improvised attack counts.** The **Improvised Attack** button on the sheet
rolls whatever die you type into it, and that die is judged like any other: type
a d6 and it explodes, leave it at the d4 an unarmed attack rolls and it does not.

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

## Maneuver on max melee damage

Tick **Maneuver on max melee damage** and a player character who rolls the
**highest face** of their damage die with a **melee** weapon is offered a choice
on the chat card: keep the damage, or give all of it up and attempt a
**maneuver** instead.

A maneuver is anything the Warden agrees is plausible in the moment — the sort of
thing that changes the situation rather than the enemy's Hit Protection. It is
resolved with an ability check the Warden calls for, and it causes no damage
directly. This is borrowed from **Knave 2e** by Ben Milton, which lists the usual
examples; the system deliberately does not reprint them.

**Press Maneuver and the damage is forgone.** The card says so, and the
Apply-damage control is greyed and refuses — the player traded that damage for the
attempt, so the card cannot also spend it. If you rule that some of it lands
anyway, the **Warden's Damage** tool is the right instrument for a number the dice
did not decide.

**With Exploding damage dice also on, the card asks which.** The die has rolled
its maximum, so the player may either let it **Explode the Die** — rolling the
chain then and there, with the dice animating and the card's total rewritten — or
**Maneuver** and forgo the lot. That is the whole bet: more damage, or a chance to
change the situation. The hover text on each button says what it does.

Note what that means for the roll itself: when both options are on, a melee
attack's die does **not** explode on its own any more, because the explosion is
now the player's to choose. Ranged attacks, sub-d6 dice and everything else still
explode immediately, exactly as before.

**Melee only.** Cairn 2e does not divide weapons into melee and ranged, so the
system asks: a weapon's sheet has a **Ranged** checkbox, and the Bow, Crossbow and
Sling arrive with it ticked. Anything unticked counts as melee, which is every
other shipped weapon. Tick it on your own ranged weapons and they will stop
offering maneuvers.

**d6 or larger.** The same floor as exploding dice: an **Impaired** attack is a d4
and never offers a maneuver, and neither does a d4 weapon. Enhanced attacks (d12)
do. An **improvised attack** is judged on the die you typed, so a chair leg at
d6 can maneuver and bare fists at d4 cannot.

**One limit, the same one exploding dice has.** A keep-highest formula written out
of separate dice — `d6 + d6` or `d6 + d8` — offers no maneuver, because when the
losing die may also have rolled its maximum there is no single answer to "did it
roll the highest face". Write such a weapon as `2d6k` and it works normally.

It is one choice or the other, once. Pressing either button settles the card and
it stays settled, and the choice appears only if the option was on when the damage
was rolled.

## A matching character generator

This hack suits characters built to survive it. Under **Configure Character
Generation**, **Ability dice for player characters** offers **Crawler
(2d6 + 6)**, which never rolls an ability below 8.

That setting is independent of this hack — you can use either without the other.

## See also

- **Dice Formulas** — what a damage formula can say, including keep-highest
  notation.
- **GLOG Magic in Foundry** — the system's other optional hack.
