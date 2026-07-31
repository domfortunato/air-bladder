# NPC roles — design plan

Settled in conversation 2026-07-31, on top of the `containers-as-npcs` branch. This
records the decisions and their reasons so the build doesn't re-argue them. One
point is still open and is marked as such.

## The problem

The NPC sheet's behavior currently hangs off two independent checkboxes: `forHire`
(gates the day-rate row, discriminates hirelings) and `inanimate` (hides the stat
block, discriminates things from creatures). Two independent booleans allow
nonsense combinations — a for-hire inanimate chest — and neither self-describes.
Meanwhile the label "Career/Role" sits on the rollable *profession* field, which
misleads: it names two concepts and holds one.

## Role — one stored field replaces two checkboxes

A new `role` field on `NpcData`, stored, defaulting to `npc`:

| Role | Stat block | Career | Day rate | Variety | Connections tab |
|-----------|------------|--------|----------|---------|-----------------|
| NPC | yes | yes | — | — | read/write |
| Hireling | yes | yes | **yes** | — | read/write |
| Monster | yes | — | — | — | **no tab** |
| Mount | yes | — | — | mount list | shown, cannot keep |
| Transport | **no** | — | — | transport list | shown, cannot keep |
| Container | **no** | — | — | container list | shown, cannot keep |

- **`role` REPLACES `forHire` and `inanimate` as stored state.** They do not
  coexist — three overlapping discriminators would contradict each other. The
  "For Hire" and "Inanimate" checkboxes leave the sheet entirely.
- The rollable profession field keeps its stored key (`profession`) and is
  relabelled **"Career"**. Role is its own field beside it.
- There is still **no container type** — the branch rule holds. Role is
  presentation and behavior on the one NPC model, not a document type.
- Mounts are creatures with stat blocks — all horses, mules, etc. keep full
  vitals. (Already true in the code; the whole branch was triggered by the
  Outrider's warhorse carrying its stats as prose.)
- Role labels are interface strings (`lang/*.json`), so they localize normally.

The stat block (settled 2026-07-31, closing the last open point): **only
Monster, NPC, Hireling and Mount show it. Transport and Container hide it** —
the behavior `inanimate` used to provide, now a consequence of role. Things
still store 0/0 HP so nothing downstream divides by a phantom 6.

## Connections — a relationship graph, not an inventory view

The tab is renamed **"Connections"** (was "Connected") and moves between
Description and Notes: Items, Description, Connections, Notes.

- It displays **connections, not inventory items**, and expresses one PC →
  potentially many NPCs, with NPC → NPC below that (a hireling keeps her own
  backpack: PC → hireling → backpack).
- **Keeping connections is a Character/NPC/Hireling privilege.** Mount,
  Transport and Container can only *be* connected — a mule cannot keep a
  backpack, a wagon cannot keep a chest. Monster neither keeps nor connects and
  gets no tab at all.
- This kills the old flat no-nesting rule (`canKeepConnected` refusing anything
  with a `connectedTo`). Its replacement is the role matrix above **plus a cycle
  guard**: NPC → NPC makes A→B→A expressible, so connecting walks up the
  `connectedTo` chain and refuses a loop. Container-chaining abuse stays dead
  because containers can't keep.
- The tab's **marketplace link is removed**, and **"Add Container" becomes
  "Add Connection"** — establishing PC→NPC or NPC→NPC links.
- **Hirelings become connected actors.** Today hiring is a checkbox on a
  free-standing NPC; nothing links Azura to anyone. The PC's Connections tab
  becomes the party roster: hirelings, mounts, transports, containers, as
  connection rows. No stored relationship exists to migrate from, so existing
  hirelings start unconnected and Wardens connect them by hand.
- Build note: the Connections tab is now conditional on role, and a tab that
  vanishes under the sheet showing it blanks the body — the role change handler
  needs a `tabGroups` reset (same trap the Reliquary tab hit).

## Variety — an editable field, decoupled from art

`containerClass` (already a free `str()` in the schema) is surfaced as a visible,
**editable text input** on Mount/Transport/Container sheets, with the known
varieties as datalist suggestions, partitioned by role from the one
`CONTAINER_CLASSES` table:

- **Mount**: Horse (4 slots), Mule (6), Donkey (4)
- **Transport**: Handcart (4), Cart (4), Wagon (8)
- **Container**: Backpack (4), Sack (2), Chest (6), Box (2), Crate (6),
  Barrel (4), Item Pile (0)

Crate and Barrel stay — they ship with their own art and cost nothing to keep.

- A **known** variety key brings its default art and slot count; an **unknown**
  one (a Warden types "Saddlebags") brings nothing and takes the world-default
  slots until a number is typed. Defaults never overwrite a hand-entered
  capacity — same rule as today.
- **Custom art becomes just art.** The gallery keeps its double duty (picking
  the mule glyph still says "this is a mule"), but the FilePicker path stops
  clearing the stored variety. A mule with the Warden's own mule painting is
  still variety "mule", 6 slots, labelled Mule. Only the picture changes.
- Name inference (blank variety reads the name) survives as fallback but stops
  being load-bearing: role answers every behavioral question; variety is
  label + defaults. Custom variety strings display verbatim (Warden content,
  not our i18n).

## Pile-ness is a variety, not a state

An Item Pile is a container variety a Warden deliberately picks — **nothing
becomes a pile automatically any more**. When a dead PC's container is unlinked
it keeps its variety (a Backpack stays a Backpack); `formerlyBelongedTo` still
records whose it was. The old derived notion ("a pile is a container connected
to nobody") is gone: any NPC-line actor can simply be unconnected.

## Migration — one-time, derivable, content-preserving

A one-time stamp of `role` onto existing world actors and the pack sources,
derived from what's already stored:

- `forHire: true` → **Hireling**
- `inanimate` + vehicle-ish class (handcart/cart/wagon) → **Transport**
- `inanimate` + anything else → **Container**
- creature with a mount class (horse/mule/donkey) → **Mount**
- the shipped monsters → **Monster** (stamped in `src/packs/` source)
- everything else → **NPC**

After it runs, `forHire` and `inanimate` are gone as stored state. It touches no
art, no names, no varieties, no slot counts — nothing recurring, nothing that
rewrites Warden content.
