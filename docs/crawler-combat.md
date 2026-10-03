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

**Player characters are made with 6 Hit Protection.**

While the hack is on, a new player character starts with 6 Hit Protection, and
6 is their maximum — the **Hit Protection formula** under Character Generation is
ignored, and its hint says so. Ticking Hit Protection on the Roll Character
checklist deals 6 as well. Scars can raise a maximum above 6 exactly as they
always could; type the new number into the sheet.

Switching the hack on does **not** rewrite characters that already exist. Set
their maximum to 6 by hand, or tick Hit Protection on Roll Character.

**A Rest rolls for Hit Protection instead of restoring it.**

Pressing **Rest** still costs a ration (the house rule below), but under the hack
it does not refill Hit Protection. It rolls one die the size of the character's
maximum — a d6 for most, a d7 for a maximum of 7 — and if the roll is higher than
their current Hit Protection, that is their new Hit Protection. If it is not,
nothing changes, and the ration is gone either way. A chat card shows the die
and says which it was.

### The first Fatigue is free

This is a **house rule, and it applies whether or not any of this is switched
on**: a character carries their **first Fatigue for free**, as though it were
petty. Every Fatigue after that fills a slot as normal. The free one wears a
**Petty** tag on the sheet so you can see which it is, and the slot count agrees
with it — a character with nine things and one Fatigue reads nine of ten, not ten
of ten.

Cairn as written charges a slot for every Fatigue. The reason for the change is
further down this page: when a player takes a Fatigue instead of Critical Damage
and it would not fit, they have to put something down, and without this the
trade left them no better off than before. With it, they drop one thing, take
one Fatigue, and end where they started — and a first Fatigue, costing nothing,
never needs anything put down at all.

When a Fatigue is cleared — by the **−** button or by the row's dustbin — the
system removes one that **costs a slot**, keeping the free one. That way the
Petty tag stays put instead of jumping to another row, and the slot you expected
to get back is the one you get back.

### Resting costs a ration

This is a **house rule too, and it also applies whether or not the hack is on**,
to player characters only: pressing **Rest** uses up one ration. The button's
dialog says so and shows how many rations the character has left; with none on
the sheet it refuses, and the character cannot rest until they have one.

**Rations are counted by uses.** The Rations item ships with three, so one item
is three rations, and a Rest spends one use. Several Rations items are fine: the
first one with a use left pays. A stack of Rations (quantity 2) rolls over the
way the row's **−** button does — when the last use of one unit goes, the next
unit opens full. Anything named Rations counts, so a Warden's own "Iron
Rations" does too, as long as it has a uses counter; a Rations item with no uses
counter, or with all its uses spent, is not food the system can see.

NPCs, hirelings and monsters rest as they always did. Nothing is logged twice:
the change log records a Rest as one entry that names both the Hit Protection
and the ration.

## Exploding damage dice

Tick **Exploding damage dice** and a player character's damage die that rolls
its highest face is rolled again and added — for as long as it keeps rolling the
highest.

A d6 rolling 6 then 4 deals 10. A d6 rolling 6, 6 and then 2 deals 14.

**Only the die you keep explodes.** Cairn's dual-wield and similar rules roll two
dice and keep the higher. If both come up 6, that is **one** six, so it explodes
once — you do not get two chains.

**Every die explodes, however small.** An **Impaired** roll is a d4 and explodes
like any other die; so does a d4 weapon, if you write one, and so does an
**Enhanced** roll's d12. There is no smallest die.

**Every explosion is announced.** The damage card gains a line — *A d6 exploded!*
— once for each time the die went again, so a chain of three says so three times.

**An unarmed attack counts.** The **Unarmed Attack** row at the top of a
character's inventory rolls whatever die you type into it, and that die explodes
like any other — the d4 an unarmed attack starts on included.

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
Critical Damage save is offered a choice on the chat card, side by side: take the
Critical Damage as usual, or **Take a Fatigue instead**.

**The Fatigue has to fit.** With room in the pack, pressing it simply adds the
Fatigue. If the Fatigue would overburden the character, pressing it asks what
they put down to make room, and that item goes to the party's Dropped Item Pile
— so the trade is one thing on the floor for one Fatigue in the pack. Which
item is always the player's choice; the system never picks. A first Fatigue
takes no slot, so a character carrying none is never asked, even with a full
pack; it is a second or later Fatigue, at nine of ten slots or more, that has to
be made room for.

The list offers only things whose loss would actually free a slot. Petty items
are not on it — they take no slot, so giving one up would cost nothing and free
nothing — and neither is Fatigue itself. Each row says what it frees, because a
bulky item frees two slots and that is usually the thing worth knowing. A torch
shows how many uses it has left: it is one item with up to three uses, not three
torches.

**Refusing costs the save.** The dialog's second button is *No — take the
Critical Damage*, and pressing it marks them as you would have anyway. Pressing
Escape, or closing the window, is **not** a refusal: nothing happens and the card
is left as it was, so a dialog dismissed by accident has not cost anybody their
alternative.

A character with **nothing** that frees a slot cannot pay, so they take the
Critical Damage the moment they press the Fatigue button — no dialog, because
there is nothing to choose from. Worth knowing at the table: it tends to be the
character who has been taking Fatigue all session who loses the alternative, and
the card shows a tick against *Mark Critical Damage* so it is clear what
happened.

It is one choice or the other. Pressing either button settles the card, and it
stays settled — coming back to it later, neither button glows, and a tick marks
the one that was taken.

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
now the player's to choose. Ranged attacks still explode immediately, exactly as
before.

**Melee only.** Cairn 2e does not divide weapons into melee and ranged, so the
system asks: a weapon's sheet has a **Ranged** checkbox, and the Bow, Crossbow and
Sling arrive with it ticked. Anything unticked counts as melee, which is every
other shipped weapon. Tick it on your own ranged weapons and they will stop
offering maneuvers.

**Any die.** The same rule as exploding dice: an **Impaired** attack's d4 offers a
maneuver when it rolls a 4, a d4 weapon's does, and so does an Enhanced attack's
d12 on a 12. An **unarmed attack** is judged on the die you typed. Melee-only is
the one place the two options differ: a ranged weapon's die explodes but never
offers a maneuver.

**One limit, the same one exploding dice has.** A keep-highest formula out of
**different** dice — `d6 + d8` — offers no maneuver, for the reason it does not
explode. Same-sized dice written as `d6 + d6` are rolled as `2d6k` when a
maneuver is on offer, so the card can tell which die was kept, and work normally.

It is one choice or the other, once. Pressing either button settles the card and
it stays settled, and the choice appears only if the option was on when the damage
was rolled.

## A matching character generator

This hack suits characters built to survive it. Under **Configure Character
Generation**, **Ability dice for player characters** offers **Crawler
(2d6 + 6)**, which never rolls an ability below 8.

That setting is independent of this hack — you can use either without the other.
Hit Protection is the exception: with the hack on, its formula is ignored and
every player character is made with 6.

## See also

- **Dice Formulas** — what a damage formula can say, including keep-highest
  notation.
- **GLOG Magic in Foundry** — the system's other optional hack.
