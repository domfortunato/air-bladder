# Generating monsters

One click rolls a complete monster — a real Actor with a statblock, an
equipped attack, armor, a five-line description and a portrait — following
the Cairn 2e Warden's Guide procedure for **Creating Monsters**. You pick how
dangerous it is; the tables do the rest.

You need to be the Warden (GM). Players never see the button.

*This page is about using the generator. Every number behind it — the tier
stats, the ability weights, the design reasoning — is recorded in
[monster-generation.md](monster-generation.md).*

---

## Where the button is

**Actors tab → the button row at the top → Generate Monster** (the dragon
icon).

Clicking it opens one question — **"How dangerous is it?"** — with four
buttons:

| Tier | HP | Attack die | Armor |
|---|---|---|---|
| **Standard** | 3 | d6 | rarely |
| **Hardier** | 6 | d8 | sometimes |
| **Serious** | 10 | d10 | usually |
| **Random** (the default) | — | — | weighted 3 : 2 : 1, so mooks are common and bosses are rare |

Dismissing the dialog with **✕** creates nothing — a monster only ever
arrives from an explicit button press.

## What you get

- **Abilities on the SRD's ladder** — 3 (deficient), 6 (weak), 10 (average),
  14 (noteworthy), 18 (legendary) — never 3d6. STR shifts upward with the
  tier; DEX stays in the middle band, because speed is texture, not what
  makes a monster deadly.
- **One equipped attack**, its damage die set by the tier. Its name is the
  rolled attack verb plus `*` — *Bites\**, *Constricts\** — the same marker
  the shipped monsters use for an attack whose special effect lives in the
  description.
- **Armor as an equipped item** when the tier grants it, so the Armor score
  derives exactly as it does for the 205 shipped monsters. It is named for
  the rolled feature when the feature *is* the armor — Carapace, Shell,
  Scales — and "Tough Hide" otherwise.
- **A five-line description**: the appearance, a **Quirk**, a **Weakness**,
  an **Ability**, and a **Critical Damage** effect. All of it is prose, none
  of it is automated — the rules stay in your hands, as everywhere in this
  system.
- **A draft name** composed from the appearance rolls — *Hulking Tentacled
  Creature*. The SRD's final step ("Thunder Snail") is creative
  interpretation no table can roll; the composed name keeps every monster
  distinguishable in the directory until inspiration strikes. Rename freely.
- **A portrait** drawn from the creature categories of the Game-Icons
  gallery, with the token wearing the same image — hostile and unlinked,
  like the shipped monsters.

## Re-rolling a monster

Every monster sheet has a **Roll Monster** button in its title bar (the same
dragon). If you don't see it, flip **Randomization** on with the toggle
beside it.

Clicking Roll Monster opens the same tier picker with different wording —
and here **the picker is also the confirmation**: it tells you the
abilities, HP, attack, armor and description will be re-rolled and that the
**name, portrait and token stay**. Dismissing it touches nothing. There is
no second "are you sure" — the button press in the picker is the yes, and it
cannot be undone.

That keep-the-name rule is what makes re-rolling useful mid-campaign: you
can promote a Standard nuisance the party ignored into a Serious threat
without it changing face.

## The eight tables behind it

All of them ship as RollTables in the **Warden — Monsters** compendium:

- `Warden: Monster - Appearance (Physique)`
- `Warden: Monster - Appearance (Feature)`
- `Warden: Monster - Trait (Quirk)`
- `Warden: Monster - Trait (Weakness)`
- `Warden: Monster - Attack (Type)`
- `Warden: Monster - Attack (Critical Damage)`
- `Warden: Monster - Ability (Power)`
- `Warden: Monster - Ability (Target)`

The text is the SRD's Creating Monsters content (Warden's Guide, CC BY-SA
4.0, by Yochai Gal). The generator *rolls* these tables rather than
*drawing* from them, so it never marks your table rows as drawn.

One difference from the [faction generator](generating-factions.md): these
tables are read **straight from the compendium** — there is no
world-table-by-name override. You can unlock the pack and edit the rows, but
a system update ships fresh copies, so treat edits there as temporary.

## Monsters play by the same rules

Generated or shipped, a monster takes damage exactly like everyone else —
by design, the damage flow has no actor-type exceptions. Overflow past HP
dents STR and forces a STR save, damage landing exactly on 0 HP rolls a
Scar, and the armor cap of 3 holds. A monster that survives an encounter
carries its scars into the next one.
