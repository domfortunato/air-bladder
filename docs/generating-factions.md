# Generating factions

One click composes Cairn 2e's **Setting Seeds** faction tables into a complete
faction write-up — a **dossier** — and files it as a **Journal Entry**. A
faction is campaign machinery, not a creature, so it does not become an Actor,
and it does not scroll away in chat: it lands in your Journal sidebar, ready to
rename, edit and build on.

You need to be the Warden (GM). Players never see the button, and the dossiers
it creates are private to you by default.

---

## Where the button is

**Actors tab → the button row at the top → Generate Faction** (the flag icon).

There is no confirmation dialog, deliberately: creating a journal destroys
nothing. The dossier opens as soon as it is rolled. Click again for another
candidate — every click makes a new entry, and nothing is ever overwritten.

## What the dossier contains

Six lines, each rolled from its own table:

| Line | What it answers |
|---|---|
| **Type** | What kind of group this is — Artisans, Criminals, Cultists… |
| **Agent** | A representative you can put in front of the party |
| **Traits** | Two character notes for how the faction behaves |
| **Advantages** | What the faction has going for it — 1 to 4 entries, always distinct (the count is itself rolled, per the SRD's procedure) |
| **Agenda** | What they are trying to do |
| **Obstacle** | What stands in their way |

The entry's name is drafted as **"The ⟨Trait⟩ ⟨Type⟩"** — *The Enigmatic
Cultists* — and it is *meant* to be replaced once the faction earns a real name
in your campaign.

**Dossiers are private by default.** Each journal is created with no player
visibility — factions are the Warden's machinery. Grant Observer on an entry
in the usual Foundry way if you ever want to hand one to the table.

## The eight tables behind it

All of them ship as RollTables in the **Warden: NPCs** compendium:

- `Warden: NPC - Faction` — the Type column (shared with the sheet die, below)
- `Warden: Faction - Agent`
- `Warden: Faction - Trait (Trait 1)`
- `Warden: Faction - Trait (Trait 2)`
- `Warden: Faction - Advantage (Count)`
- `Warden: Faction - Advantage`
- `Warden: Faction - Agenda`
- `Warden: Faction - Obstacle`

The text is the Cairn 2e SRD's Setting Seeds content (CC BY-SA 4.0, by Yochai
Gal). The generator *rolls* these tables rather than *drawing* from them, so it
never marks your table rows as drawn.

## Making the tables yours

Every roll resolves **by table name, world first**. If a RollTable in your
world has exactly one of the names above, it silently wins over the shipped
copy — so you can either edit the compendium tables, or (better) import one
into the world and rework it there. Your version survives every system update,
because the generator finds it by name, not by id.

If a table is missing or empty, its line degrades to an em-dash and the dossier
still mints — mid-edit you get a partial dossier, never an error.

## Closing the loop: the Faction die on NPC and Monster sheets

NPC and Monster sheets carry a **Faction** field in the header — free text,
always editable. When **Randomization is On** (the toggle in the sheet's title
bar), a d20 die appears beside it; clicking it rolls `Warden: NPC - Faction` —
world first, same contract — and fills the field. It touches nothing else on
the sheet.

That gives the feature its intended workflow:

1. **Generate Faction** until a candidate sticks. Rename it, edit the dossier,
   keep it in the Journal.
2. **Add the faction's name as a row** in your world copy of
   `Warden: NPC - Faction`.
3. From then on, the **Faction die deals your factions** to every NPC and
   Monster you stamp it on. The generator invents candidates; your table is
   the canon.

## One note on language

The dossier's text is baked in the language of the session that generated it.
Generate in an English world and the entry is English prose thereafter; a
Spanish client generates a Spanish dossier. Rolled world content is authored
content, not display-translated content — the same rule monster generation
follows.
