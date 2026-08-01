# NPC roles — design plan

Settled in conversation 2026-07-31, on top of the `containers-as-npcs` branch. This
records the decisions and their reasons so the build doesn't re-argue them.

**STATUS: BUILT, same day.** Gated by `npm run dev:roles` (the sheet composition,
keeping matrix, cycle guard, tab reset, art/variety decoupling) and
`npm run dev:role-migration` (both migration layers); the migration's one
non-obvious constraint — "role absent in the database" is not observable from a
running client, so selection keys on type + legacy keys + day rate — is documented
in `migrateNpcRoles` (module/cairn.js).

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

## The legacy `container` type is REMOVED — 2026-07-31, later the same day

The section below decided not to MIGRATE old container-typed documents. It also
said "the legacy type must stay registered while any world still holds one",
and that condition turned out to be false the moment it was written: the built
migration had already converted the dev world, and :30001 was rebuilt from the
branch. So nothing was being protected — while the type went on being **offered
in the Create Actor dialog**, because Foundry lists every registered subtype and
a system cannot mark one uncreatable (`createDialog` filters only on a `types`
option the sidebar never passes; client/documents/abstract/client-document.mjs
around line 787). The Warden pressed Create, picked Container, and got a
document against a retired model: the retired sheet, its `transportKind`
pick-list of worn/mount/vehicle/pile, and no Connections tab at all — the tab
map gave that type two tabs.

What went with it, because each existed only to serve it: `ContainerData` (and
so `keeper`, `transportKind` and `load` as ACTOR fields — `transportKind`
survives on the `transport` ITEM type, which is a separate retirement),
`templates/actor/container-sheet.html`, `createOwnedContainer`,
`_prepareContainerData`, the ready-hook art migration, and the owner-side
`system.containers` array on CharacterData/NpcData — the other half of the
two-way link, which `connectedActors` had already promised would go "with
`keeper` itself".

**Three live behaviours were keyed on the type and so had silently stopped
firing** once containers became npcs. They are re-keyed on the ROLE, which is
the same correction review #5 made to the marketplace's nesting guard:

- the Actor Directory's grayscale thumbnail and the `show-container-actors`
  hide rule (`cairn.js`) — the setting had been hiding nobody;
- the marketplace's strict-capacity/never-equipped rule (`acquire`), which an
  npc sack had been exempt from, so it took stock past its capacity;
- the sheet's own strict-capacity and never-equipped drop rules.

`isThing` is the test in the last two — role container or transport. A MOUNT is
deliberately excluded: it is a creature with a stat block, so it follows the npc
rule (over capacity does nothing) and it can equip barding.

A second setting went with the sheet: `show-gold-not-cost`, which swapped a
container sheet's Cost box for a Gold box. The npc sheet has no Cost box, and
Round 2 settled that Gold hides on a thing or a mount as a ROLE fact.

## No migration for the legacy `container` type — decided 2026-07-31

Old `container`-typed documents are NOT converted to npc. A full in-place
migration (`migrateContainerType`: type change via `ForcedReplacement` of
`system`, `keeper`→`connectedTo`, kind baked into role + variety, probe-gated
with a marker-set control run) was built, proven green, and **removed the same
day**: the only worlds running this system are the two on this machine, and the
one being wiped at upgrade time is cheaper than carrying the code. Do not
rebuild it without an actual population of external worlds to convert. What the
exercise established and keeps being true: v14 supports document type changes
(`system` must be a `ForcedReplacement`), a legacy type must stay registered
while any world still holds one, and the dev world was converted by the built
migration before removal — its container docs are npc-typed data now, with no
code behind that fact. **That last point is what let the type itself be removed
hours later (see above): "no world holds one" was already true, so keeping it
registered bought nothing and cost a creatable retired model.**

## Round 2 — sheet honesty and either-end edges (settled 2026-07-31 evening)

Six decisions from using the built sheets, locked in conversation. The role
table above changes in one column: **Gold now follows the role too.**

- **Gold hides on Mount, Transport and Container sheets.** The stored field
  stays (a chest still holds coins and coins still take slots — the RULE is
  untouched); only the counter goes. This reverses the Round-1 reading that the
  Gold box had to survive on things, which is why the `dev:roles` "Gold
  survives" leg flips to assert hidden-but-value-preserved. NPC, Hireling and
  Monster keep the counter.
- **The header's empty band collapses.** A Monster sheet showed dead space
  between HP/Gold and STR/Armor. The mechanism was NOT an empty grid track: the
  NPC header is a flex column stretched to the portrait's 140px row, and any
  role whose stack is shorter than that left the slack at the BOTTOM — between
  the vitals and the row below. Fix: the vitals line takes `margin-top: auto`,
  pinning HP/Gold flush with the portrait's foot exactly the way the character
  sheet's 1fr slack row already does. (The `.npc-name-section` grid-pinning
  rules in cairn.css are dead — no template renders that class.)
- **Edges are managed from either end, by the Warden only.** A thing's (and
  mount's) Connections tab shows its upward keeper as a row, gains a
  "Connect to…" picker while unconnected (= attach ME to a keeper: same edge,
  child end), and the connection can be broken from either end. Manual
  connect/unlink is **Warden-only** — the gate lives INSIDE `connectActor` and
  `unlinkOwnedContainer`, one wall for every spelling (dialog, drop, child
  end), which is safe because every caller is a manual gesture: the automatic
  flows (marketplace buys, generation grants, the socket mint) write
  `connectedTo` directly and never pass through these methods.
- **PC → PC connections exist.** Characters become valid connection targets —
  `CharacterData` grows `connectedTo` (+ `formerlyBelongedTo` for unlink);
  without the schema field the connect write would be silently dropped by
  cleaning. One PC can keep several PCs (the party-roster reading). **An NPC
  must never keep a PC** — pairwise-refused in `connectActor`, and the picker
  never offers it.
- **Ownership follows connection.** Connecting a PC → NPC copies the PC's
  ownership onto the NPC (the marketplace-buy precedent, `deepClone` of the
  whole ownership object), executed GM-side — free, since manual connects are
  Warden-only. PC → PC grants nothing: a character's ownership is never
  rewritten.
- **One upward link at a time STANDS.** "One connection to a PC and one to an
  NPC" was probed as both-at-once and rejected — every keeper-death, ownership
  and authoritative-tab question forks under two parents. Enforced as
  single-parent-ever in `connectActor` itself (the dialog filter alone was the
  only guard before, so a drop could steal a connected actor). The tab shows
  both directions instead: the upward keeper row and the kept list.
