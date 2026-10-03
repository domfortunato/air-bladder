# Optional Combat Rules

Three optional rules for a fiercer fight. Each is **off by default**, each is
switched on and off on its own, and they live under **Game Settings → Air
Bladder → Configure Hacks**. None of them needs a reload.

They affect **player characters only**. NPCs, hirelings and monsters are
untouched by every one of them.

## Resting costs a ration

This one is not optional. It is a **house rule that applies at every table**,
to player characters only: pressing **Rest** uses up one ration and restores
Hit Protection to its maximum. The button's dialog says so and shows how many
rations the character has left; with none on the sheet it refuses, and the
character cannot rest until they have one.

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

**Only an overburdened character has to pay.** A Fatigue fills a slot, like any
ordinary item. If the character has a free slot, pressing the button simply adds
the Fatigue — even when that leaves them overburdened, as it does at nine of ten.
If they are **already** overburdened, with no free slot, pressing it asks what
they put down to make room, and that item goes to the party's Dropped Item Pile,
so the trade is one thing on the floor for one Fatigue in the pack. Which item
is always the player's choice; the system never picks.

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

## Tougher characters, if you want them

Under **Configure Character Generation**, **Ability dice for player characters**
offers **Crawler (2d6 + 3)**, which rolls every ability between 5 and 15. It is
independent of everything on this page — use either without the other. Hit
Protection follows the **Hit Protection formula** there, like every other table.

## See also

- **Dice Formulas** — what a damage formula can say, including keep-highest
  notation.
- **GLOG Magic in Foundry** — another optional hack.
