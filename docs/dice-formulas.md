# Dice Formulas

Air Bladder reads dice formulas in a few places a Warden can edit — a
weapon's damage, a monster's attack, and the **Age formula** setting under
Character Generation. This page is what those formulas can say.

## The basics

A die is `NdX`: `1d20` rolls one twenty-sider, `2d6` rolls two six-siders
and adds them. Plain numbers add on: `2d20 + 10` rolls two d20s, adds them
together, then adds 10 — ages 12 to 50, the book's roll and the Age
formula's default. Any number of faces works: `1d31 + 19` is a real roll,
ages 20 to 50 with every age equally likely.

A formula can also be just a number: `30` means every roll comes out 30.

## Cairn's plus sign

Cairn's rules write "roll two dice and keep the highest" as `d8 + d8`, so
with **Use Cairn dice notation** on (the default), the system reads `+`
the way the book does — and what is on each side decides which meaning
applies:

| You write | It means | Result |
|---|---|---|
| `2d8` | roll two d8 and add them | 2–16 |
| `d8 + d8` | roll two d8, keep the highest | 1–8 |
| `2d20 + 10` | roll, add, plus 10 | 12–50 |

Only the die-plus-die form keeps the highest. With the notation setting
off, `+` always adds and `d8 + d8` is simply 2–16.

## Minimums and maximums

Braces compare two rolls and keep one, which is how a formula says "but
never below" or "but never above":

| You write | It means |
|---|---|
| `{2d20 + 10, 21}kh` | roll 2d20 + 10, but never below 21 (**k**eep **h**ighest) |
| `{2d20 + 10, 40}kl` | roll 2d20 + 10, but never above 40 (**k**eep **l**owest) |

These work whether the Cairn notation setting is on or off — the brace
form belongs to Foundry itself.

Prefer shaping the dice over capping them where you can: a cap piles
results onto the boundary (capping `2d20 + 10` at 30 makes more than half
of all rolls exactly 30), while dice sized to the range spread across it.

## Age formula recipes

| You want | Write |
|---|---|
| The book's roll, ages 12–50 | `2d20 + 10` (the default) |
| No characters under 21 | `{2d20 + 10, 21}kh` |
| Ages 20–30, the middle most likely | `2d6 + 18` |
| Ages 20–50, all equally likely | `1d31 + 19` |
| Everyone arrives the same age | `30` |

## When a formula does not parse

A formula the dice reader cannot understand is not rolled: the default is
used instead and a warning names the text that was rejected, so a typo
never silently changes what the setting does. A **blank** field just means
"use the default", with no warning.

The age box on a character's sheet stays free text either way — a typed
age is never checked against any formula.

Foundry's own dice reference covers the full notation, modifiers and all:
[foundryvtt.com/article/dice](https://foundryvtt.com/article/dice/).
