# Generating monsters

**Create Monster** rolls a complete monster: abilities, HP, an attack, sometimes
armor, a description and a portrait. It follows the **Creating Monsters**
procedure in the Cairn 2e Warden's Guide. You choose how dangerous it is.

Only the Warden sees the button.

*The numbers behind the generator are recorded in
[monster-generation.md](monster-generation.md).*

---

## Where the button is

**Actors tab → the button row at the top → Create Monster** (the dragon icon).
The same button is on the **Monsters** tab of the Warden's Dashboard, under
**Create**.

It opens a window with a **How dangerous is it?** list and a **Use random
generation.** tick-box. Clear the box if you want an empty Monster sheet. The
list greys out, because an empty sheet doesn't have a tier.

| Tier | HP | Attack die | Armor |
|---|---|---|---|
| **Standard** | 3 | d6 | 1 time in 4 |
| **Hardier** | 6 | d8 | 1 time in 2 |
| **Serious** | 10 | d10 | 3 times in 4 |
| **Random** (the default) | — | — | picks Standard, Hardier or Serious, weighted 3 : 2 : 1 |

**Cancel** or **✕** closes the window and doesn't create anything.

## What you get

- **Abilities** from the SRD's ladder: 3 (deficient), 6 (weak), 10 (average),
  14 (noteworthy) or 18 (legendary). STR runs higher at higher tiers. DEX is
  always 6, 10 or 14.
- **One equipped attack** with the tier's damage die. Its name is the rolled
  attack type plus `*` (*Bites\**, *Constricts\**), the marker the shipped
  monsters use for an attack whose special effect is in the description.
- **Armor as an equipped item**, when the tier gives it, worth 1 to 3. It's
  named for the rolled feature when that feature is Carapace, Shell or Scales,
  and "Tough Hide" otherwise.
- **A five-line description**: the appearance, a **Quirk**, a **Weakness**, an
  **Ability** and a **Critical Damage** effect. It's all prose for you to
  apply. The system doesn't automate any of it.
- **A draft name** built from the appearance rolls, such as *Hulking Tentacled
  Creature*. Rename it when you know what it is.
- **A portrait** from the creature categories of the Game-Icons gallery, or
  from your own monster art if you keep any (see
  [Using Your Own Portraits](using-your-own-portraits.md)). The token uses the
  same image. It's hostile and unlinked, like the shipped monsters, so you can
  place the same monster many times and damage each one separately. See
  [Tokens and Sheets](tokens-and-sheets.md).

## Re-rolling a monster

With Character Creation Mode on, a monster sheet has a **Roll Monster** button
in its title bar. A generated monster starts with the mode off, so press the
**CharGen: Off** toggle in the title bar to turn it on.

Roll Monster asks **Roll this monster again?** and offers the four tiers as
buttons. Pressing one is the confirmation, and it can't be undone. Everything
the monster is carrying is deleted, and its abilities, HP, attack, armor and
description are re-rolled. Its name, portrait and token stay. Closing the
window doesn't change anything.

Because the name and portrait stay, you can turn a Standard monster the party
ignored into a Serious one without changing what it looks like.

## The eight tables behind it

They are RollTables in the **Warden — Monsters** compendium:

- `Warden: Monster - Appearance (Physique)`
- `Warden: Monster - Appearance (Feature)`
- `Warden: Monster - Trait (Quirk)`
- `Warden: Monster - Trait (Weakness)`
- `Warden: Monster - Attack (Type)`
- `Warden: Monster - Attack (Critical Damage)`
- `Warden: Monster - Ability (Power)`
- `Warden: Monster - Ability (Target)`

The text is the SRD's Creating Monsters content (Warden's Guide, CC BY-SA 4.0,
by Yochai Gal). The generator never marks a table's rows as drawn.

**You can replace any of them**, as with the
[faction generator](generating-factions.md)'s tables. Make a RollTable in your
world with exactly the same name as a shipped table, and the generator rolls
yours. Your table survives a system update. Edits made inside the shipped
compendium don't, because an update replaces it.

## Monsters play by the same rules

A monster takes damage the same way every other creature does. Damage past HP comes off
STR and calls for a STR save. Damage that lands exactly on 0 HP rolls a Scar.
Armor is capped at 3.
