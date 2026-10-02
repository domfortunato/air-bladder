# Dice Formulas

Air Bladder reads dice formulas in a few places a Warden can edit — a
weapon's damage, a monster's attack, the **Damage** field on the Warden's
Damage tool, and two settings under Character Generation: the **Age
formula** and the **Hit Protection formula for player characters**. This
page is what those formulas can say. It also explains the notation on the
**Ability dice** and **Gold dice** menus, which offer a fixed set of
formulas rather than a box to type in.

**Every field that takes dice also takes a plain number.** Put `4` in the
Hit Protection formula and every character has 4 Hit Protection; put `3` in
the Warden's Damage field and it deals 3. A fixed amount is simply a
formula with no dice in it, so there is nothing special to turn on.

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

## Keeping the best of several dice

`kh` after a die means "keep the highest", and the number after it says how
many dice to keep:

| You write | It means | Result |
|---|---|---|
| `4d6kh3` | roll four d6, keep the best three | 3–18, high results much more likely |
| `2d20kh1` | roll two d20, keep the higher | 1–20 |
| `3d6kl2` | roll three d6, keep the lowest two | 2–12 (**k**eep **l**owest) |

This is Foundry's own notation rather than Cairn's, so it works whether the
Cairn notation setting is on or off. It is what the **Adventurer** option on
the Ability dice and Gold dice menus rolls: `4d6kh3` covers the same 3–18
range as the book's `3d6`, but weights it heavily towards the top.

Mind the difference from Cairn's plus form above. `d8 + d8` keeps **one** die
of two, so it stays within one die's range, 1–8. `4d6kh3` keeps **three**
dice and adds them, so its range is three dice wide.

## Exploding dice

`x` after a die rolls it again whenever it comes up its highest face, and adds
the result — for as long as it keeps rolling the highest:

| You write | It means | Result |
|---|---|---|
| `1d6x` | roll a d6; on a 6, roll and add again | 1–5, or 6 plus another roll |
| `2d6kx` | roll two d6, keep the higher, and explode **that one** | 1–5, or 6 plus another roll |

Order matters, and `2d6kx` is deliberate: `k` keeps the higher die first, so
only the kept die explodes. Two sixes are one six. Written the other way round,
`2d6xk` explodes both dice and then compares them, which can never exceed 6 —
not what you want.

**Crawler Combat Mode applies this for you**, to player characters' damage rolls
only, so you do not normally type it. See that guide. Two limits go with it.
A keep-highest roll of **different** dice, `d6 + d8`, is left alone — keeping the
highest and then exploding it cannot be written for mixed dice. And **nothing
smaller than a d6 explodes**, so a d4 weapon and every Impaired roll are left
alone too; Enhanced rolls are a d12 and explode normally.

With **Maneuver on max melee damage** also on, a melee attack's die does not
explode by itself: the card offers the player the choice of exploding it or
forgoing the damage for a maneuver, and pressing **Explode the Die** rolls the
chain then and there. Typing `x` yourself still explodes immediately — the choice
is something the hack offers, not something the notation does.

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
