# Dice Formulas

Air Bladder reads dice formulas in a few places you can edit: a weapon's
damage, a monster's attack, the **Damage** field on the Warden's Damage tool,
and two settings under Character Generation, the **Age formula for generated
characters** and the **Hit Protection formula for player characters**. This
page covers what those formulas can say. It also explains the notation on the
**Ability dice for player characters** and **Gold dice for player characters**
menus, which offer a fixed set of formulas.

**Every field that takes dice also takes a plain number.** Put `4` in the Hit
Protection formula and every character has 4 Hit Protection. Put `3` in the
Warden's Damage field and it deals 3.

## The basics

A die is written `NdX`. `1d20` rolls one twenty-sider, and `2d6` rolls two
six-siders and adds them. Plain numbers add on, so `2d20 + 10` rolls two d20s,
adds them, then adds 10. That gives ages 12 to 50, which is the book's roll and
the Age formula's default. Any number of faces works. `1d31 + 19` gives ages 20
to 50, with every age equally likely.

## Cairn's plus sign

Cairn's rules write "roll two dice and keep the highest" as `d8 + d8`. With
**Use Cairn dice notation: 'd6+d6' as keep highest** on (the default), the
system reads `+` the way the book does:

| You write | It means | Result |
|---|---|---|
| `2d8` | roll two d8 and add them | 2–16 |
| `d8 + d8` | roll two d8, keep the highest | 1–8 |
| `2d20 + 10` | roll, add, plus 10 | 12–50 |

Only the die-plus-die form keeps the highest. With the setting off, `+` always
adds and `d8 + d8` is 2–16.

## Keeping the best of several dice

`kh` after a die means "keep the highest", and the number after it says how
many dice to keep:

| You write | It means | Result |
|---|---|---|
| `4d6kh3` | roll four d6, keep the best three | 3–18, high results much more likely |
| `2d20kh1` | roll two d20, keep the higher | 1–20 |
| `3d6kl2` | roll three d6, keep the lowest two | 2–12 (**k**eep **l**owest) |

This is Foundry's own notation, so it works whether the Cairn notation setting
is on or off. The **Adventurer** option on the Ability dice and Gold dice menus
rolls `4d6kh3`. That's the same 3–18 range as the book's `3d6`, weighted
towards the top.

`d8 + d8` keeps **one** die of two, so it stays within one die's range, 1–8.
`4d6kh3` keeps **three** dice and adds them.

## Exploding dice

`x` after a die rolls it again whenever it comes up its highest face, and adds
the result, for as long as it keeps rolling the highest:

| You write | It means | Result |
|---|---|---|
| `1d6x` | roll a d6; on a 6, roll and add again | 1–5, or 6 plus another roll |
| `2d6kx` | roll two d6, keep the higher, and explode **that one** | 1–5, or 6 plus another roll |
| `1d6x2=6` | roll a d6; on a 6, roll and add again, **at most twice** | 1–5, or 6 plus up to two more |

Order matters. In `2d6kx`, `k` keeps the higher die first, so only the kept die
explodes, and two sixes count as one. Written the other way round, `2d6xk`
explodes both dice and then compares them, which can never be more than 6.

**The Exploding damage dice option does this for you**, for player characters'
damage rolls only. See [Optional Combat Rules](optional-combat-rules.md). It
writes the capped form: `1d6x2=6`, `2d6kx2=6`, `1d4x1=4`. The number after `x`
is the cap and the number after `=` is the face that explodes. Foundry reads
`x2` on its own as "explode on a 2", so keep the `=` if you type a cap yourself.

## Minimums and maximums

Braces compare two rolls and keep one. This is how a formula says "never below"
or "never above":

| You write | It means |
|---|---|
| `{2d20 + 10, 21}kh` | roll 2d20 + 10, but never below 21 (**k**eep **h**ighest) |
| `{2d20 + 10, 40}kl` | roll 2d20 + 10, but never above 40 (**k**eep **l**owest) |

The brace form is Foundry's own, so it works whether the Cairn notation setting
is on or off.

Where you can, shape the dice instead of capping them. A cap piles results onto
the boundary. Capping `2d20 + 10` at 30 makes more than half of all rolls
exactly 30. Dice sized to the range spread across it instead.

## Age formula recipes

| You want | Write |
|---|---|
| The book's roll, ages 12–50 | `2d20 + 10` (the default) |
| No characters under 21 | `{2d20 + 10, 21}kh` |
| Ages 20–30, the middle most likely | `2d6 + 18` |
| Ages 20–50, all equally likely | `1d31 + 19` |
| Everyone arrives the same age | `30` |

## When a formula cannot be read

If the system can't read the formula in the Age or Hit Protection setting, it
doesn't roll it. It rolls the default instead, and a warning shows the text
that was rejected. A **blank** field means "use the default", and you don't get
a warning.

The age box on a character's sheet stays free text. An age you type there isn't
checked against any formula.

Foundry's own dice reference covers the full notation:
[foundryvtt.com/article/dice](https://foundryvtt.com/article/dice/).
