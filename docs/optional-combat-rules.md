# Optional Combat Rules

Three optional combat rules and three shield options. All are **off by default**,
each is switched on its own, and they live under **Game Settings → Air Bladder →
Configure Hacks**. Only **Shields are Bulky** reloads Foundry.

The combat rules, **Hands full** and **Shields are d4 weapons** affect **player
characters only**. NPCs, hirelings and monsters are untouched by them.

## Exploding damage dice

Tick **Exploding damage dice** and a player character's damage die that rolls
its highest face is rolled again and added. A die explodes at most **half its
faces, less one** times:

| Die | Explodes at most |
|---|---|
| d4 | once |
| d6 | twice |
| d8 | three times |
| d10 | four times |
| d12 | five times |
| d20 | nine times |

A d6 rolling 6 then 4 deals 10. A d6 rolling 6, 6 and then 2 deals 14. A d6
rolling 6, 6, 6 deals 18 and stops: the third six is added but not rolled again.

**Only the die you keep explodes.** Cairn's dual-wield and similar rules roll two
dice and keep the higher. If both come up 6, that is **one** six, and it explodes
once.

**Every die from a d4 up explodes.** That includes an **Impaired** roll's d4, a
d4 weapon and an **Enhanced** roll's d12. A d2 or d3 never explodes.

**Every explosion is announced.** The damage card gains a line — *A d6
exploded!* — once for each time the die went again. A die that stops at its cap
adds no extra line.

**An improvised attack counts.** The **Improvised Attack** row at the top of a
character's inventory rolls the die you type, and that die explodes like any
other.

**Only player characters' damage rolls explode.** A monster's attack, an NPC's,
and the Warden's Damage tool all roll normally.

**Mixed dice do not explode.** A keep-highest formula of **different** dice,
such as `d6 + d8`, is rolled as written. No weapon that ships with the system
is written this way. Same-sized dice — `2d6k`, `d6 + d6`, and every shipped
weapon — explode normally.

`d6 + d6` means keep the highest only while **Use Cairn dice notation: 'd6+d6'
as keep highest** is on. With it off, it is plain addition, is rolled as
written, and does not explode — the Cutpurse's twin daggers included.

**The shield is the exception.** With **Shields are d4 weapons** on, a character
who adds their shield to an attack rolls the weapon's die and the shield's d4
and keeps the higher. The kept die explodes if it rolled its highest face. A d6
rolling 6 against the d4's 3 keeps the 6 and rolls again. A d6 rolling 5 against
the d4's 4 keeps the 5, and nothing explodes. On a tie the weapon's die is kept:
a d6 and the d4 both rolling 4 keep the d6's 4, so nothing explodes.

**Formulas of your own.** A damage formula that **adds** two dice — `2d10`,
which no shipped weapon uses — shares one cap between them. A formula typed with
its own `x`, such as an improvised attack rolling `1d6x`, is rolled exactly as
typed, with no cap.

## Fatigue instead of Critical Damage

Tick **Fatigue instead of Critical Damage** and a player character who fails a
Critical Damage save is offered two buttons on the chat card: **Mark Critical
Damage**, or **Take a Fatigue instead**.

**Only an overburdened character has to pay.** A Fatigue fills a slot. If the
character has a free slot, pressing the button adds the Fatigue, even when that
fills their last slot. If they have no free slot, a window asks what they put
down to make room, and that item goes to the party's Dropped Item Pile. The
player always chooses the item.

The list offers only things that free a slot. Petty items and Fatigue are not on
it. Each row says what it frees, because a bulky item frees two slots. A torch
shows how many uses it has left.

**Refusing costs the save.** The window's second button is *No — take the
Critical Damage*, and pressing it marks the Critical Damage. Pressing Escape or
closing the window is **not** a refusal: the card is left as it was.

A character with **nothing** that frees a slot cannot pay. They take the
Critical Damage when they press the Fatigue button, with no window, and the card
shows a tick against *Mark Critical Damage*.

Pressing either button settles the card for good. A tick marks the one that was
taken.

The choice appears on a card only if the option was on when the save was rolled.
Turning the option off later does not remove a choice already on screen.

## Maneuver on max damage

Tick **Maneuver on max damage** and when a player character's damage die rolls
its **highest face**, the damage stands as rolled and the chat card adds a line:
*Maximum damage! You may also attempt a maneuver.*

A maneuver is resolved with an ability check the Warden calls for, and it causes
no damage directly. The rule is borrowed from **Knave 2e** by Ben Milton, which
lists the usual examples. The system does not reprint them.

**The damage still applies.** Apply it as usual. There is nothing to choose or
press on the card.

**With Exploding damage dice also on, both happen.** The die explodes, the chain
is added to the damage, and the line still appears.

**Any die, melee or ranged.** An **Impaired** attack's d4 earns the line on a 4,
and an **Enhanced** attack's d12 on a 12. An **improvised attack** is judged on
the die you typed. The weapon sheet's **Ranged** checkbox does nothing at the
moment.

**The same limit as exploding dice.** A keep-highest formula of **different**
dice — `d6 + d8` — never shows the line. `d6 + d6` works normally while **Use
Cairn dice notation: 'd6+d6' as keep highest** is on. With it off, `d6 + d6` is
plain addition and never shows the line.

**With a shield added, the line follows the die you keep.** A d4 that rolls 4
but loses to the weapon's 5 earns no maneuver.

The line appears only if the option was on when the damage was rolled, and only
to the people who can see the roll.

## Shields

A shield is any armor with **Shield** ticked on its sheet. A character holds or
slings one with the **Hold shield?** badge beside Armor on their sheet. A
**Broken** shield cannot be held.

**Shields are Bulky.** Every shield takes two inventory slots, like any Bulky
item. This one applies to every sheet, and changing it reloads Foundry.

**Hands full: a shield and a light.** A player character holding both a shield
and a light can attack only with the shield, the light, or an improvised attack.
Their other weapons cannot be rolled until a hand is free. The Attack window
says why: *Your hands are full: you are holding a shield and a light.*

**Shields are d4 weapons.** A player character's held shield rolls d4 damage
from its inventory row and appears in the Attack window. Choose a one-handed
weapon there and tick **Add the shield (d4)** to roll both dice on a standard
attack and keep the higher. A two-handed weapon — anything Bulky, and any bow —
cannot take the shield. A panicked character cannot add it either.

## Tougher characters, if you want them

Under **Configure Character Generation**, **Ability dice for player characters**
offers **Crawler (2d6 + 3)**, which rolls every ability between 5 and 15. It is
independent of everything on this page.

## See also

- [Dice Formulas](dice-formulas.md) — what a damage formula can say, including
  keep-highest notation.
- [GLoG Magic in Foundry](glog-magic.md) — another optional hack.
