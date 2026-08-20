# NPC roles — design plan

Settled in conversation 2026-07-31, on top of the `containers-as-npcs` branch. This
records the decisions and their reasons so the build doesn't re-argue them.

**STATUS: BUILT, same day.** Gated by `npm run dev:roles` (the sheet composition,
keeping matrix, cycle guard, tab reset, art/Kind decoupling) and
`npm run dev:role-migration` (all three migration layers); the migration's one
non-obvious constraint — "role absent in the database" is not observable from a
running client, so selection keys on type + legacy keys + day rate — is documented
in `migrateNpcRoles` (module/cairn.js).

**AMENDED 2026-08-20: the table below is true again.** Hireling and NPC were
collapsed into one role on 2026-08-01 (see the note under the table) and split
apart again on 2026-08-20, at the user's ask. The collapse's argument was that
being for hire is not a different KIND of person, only a fact about one — sound
while the two roles shared a sheet, a stat block, a generator and a career table
and differed in whether one row rendered. What was missing was a third thing: an
NPC with a **Background** off the Warden's Guide table and Quirk / Goal / Virtue
/ Vice off that book's NPC tables. Once that exists the two are different kinds
of person and the collapse's argument stops applying.

The split is gated by `npm run dev:npc-split` (what each role IS, the trait
pick-lists, the sentence's grammatical person, and a re-role round trip that
loses nothing) and by the third leg of `dev:role-migration`.

Four things the split settled, so they are not re-argued:

- **Every existing role-`npc` person became a Hireling**, not a split on
  `forHire`. That boolean holds the distinction exactly for anything made after
  2026-08-01 and reads the schema initial `true` for anything older, so the
  signal is only three weeks deep. Converting everything means nothing on any
  sheet disappears and no Warden is handed an NPC they did not ask for.
- **Both roles draw names from the same d60 table.** It IS the Warden's Guide
  NPC name list, and a hireling has no other source.
- **The NPC keeps everything the person had** — stat block, the six appearance
  traits, pronouns, age, faction — and gains the four NPC traits. It loses only
  For Hire and Day Rate, and Career becomes Background.
- **Two directory buttons**, Generate NPC and Generate Hireling, plus both in the
  Create Actor "+" switchboard.
- **A generated NPC's stat block is ROLLED** — 3d6 a piece and 1d6 Hit
  Protection, from `Cairn.npcGenerator.ability` / `.hitProtection`. This
  REVERSES the split's own out-of-scope line, the next day and at the user's
  ask. That line reasoned that the Warden's Guide gives NPCs no stat block, so
  none should be invented; what it missed is that a generator which leaves the
  schema's 10/10/10 and 6 in place has not declined to invent numbers — it has
  invented three identical ones and hidden that it did. A hireling's statblock
  comes off its career and an NPC has no career, so an NPC is made the way every
  other person in Cairn is made. The numbers stay a starting point: nothing
  reads them differently to a hand-typed one.

Two fields, never one relabelled: a hireling's Career lives in `profession` and
an NPC's Background in `background`. Sharing a key would have made every re-role
a chance for `_preUpdate`'s day-rate autofill to fire on somebody who has none.

## The problem

The NPC sheet's behavior currently hangs off two independent checkboxes: `forHire`
(gates the day-rate row, discriminates hirelings) and `inanimate` (hides the stat
block, discriminates things from creatures). Two independent booleans allow
nonsense combinations — a for-hire inanimate chest — and neither self-describes.
Meanwhile the label "Career/Role" sits on the rollable *profession* field, which
misleads: it names two concepts and holds one.

## Role — one stored field replaces two checkboxes

A new `role` field on `NpcData`, stored, defaulting to `npc`:

| Role | Stat block | Career | Day rate | Kind | Connections tab |
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

## Kind — a strict pick list labelled "Type", decoupled from art

*(Rewritten 2026-08-02: the free-text-with-datalist contract this section
described shipped, and then hardened into a select on the user's ruling. The
field name stays `containerClass` — a label is not a migration.)*

`containerClass` (still a free `str()` in the schema — legacy tolerance is
deliberate) is surfaced as a **strict, role-scoped `<select>`** labelled
**Type** on Mount/Transport/Container sheets, partitioned by role from the one
`CONTAINER_CLASSES` table:

- **Mount**: Horse (4 slots), Mule (6), Donkey (4)
- **Transport**: Wagon (8), Cart (4), Hand Cart (4), Small Craft (8)
- **Container**: Item Pile (0), Backpack (4), Sack (2), Chest (6), Crate (6),
  Barrel (4), Box (2)

plus a blank row (no Kind — infer from the name) and **"Other…"**, which
reveals a free-text input bound to the field. The select itself is UNNAMED so
the Other sentinel can never reach the document; the revealed input is the
field's only free-text writer, and a typed label still maps back to its key on
submit. A stored word the table does not know selects Other and displays
verbatim (Warden content, not our i18n).

- A **known** Kind key brings its default slot count, and default art only
  while the current art is stock; an **unknown** one brings nothing and takes
  the world-default slots until a number is typed. Defaults never overwrite a
  hand-entered capacity.
- **Art is just art — every path** (ruled 2026-08-02). Picking any picture,
  gallery glyph included, writes the image and nothing else; the gallery's
  old double duty (the mule glyph also said "this is a mule") is gone, and
  Role/Type changes are the select's alone. The surviving direction: a Kind
  CHANGE stamps default art while the art is stock. A mule with the Warden's
  own mule painting is still Kind "mule", 6 slots, labelled Mule.
- `funeralwagon` is retired (2026-08-02): a hearse is a WAGON a Warden has
  named. The Burial Wagon pack doc stores `wagon`, keeps its coffin art (legal
  under the decoupling) and its 6 slots; `migrateData` converts every stored
  `funeralwagon` on read; the name classifier still catches
  funeral/hearse/burial and answers `wagon`.
- Name inference (blank Kind reads the name) survives as fallback but stops
  being load-bearing: role answers every behavioral question; Kind is
  label + defaults.

## Pile-ness is a Kind, not a state

An Item Pile is a container Kind a Warden deliberately picks — **nothing
becomes a pile automatically any more**. When a dead PC's container is unlinked
it keeps its Kind (a Backpack stays a Backpack); `formerlyBelongedTo` still
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
art, no names, no Kinds, no slot counts — nothing recurring, nothing that
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
`system`, `keeper`→`connectedTo`, `transportKind` baked into role + Kind, probe-gated
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
- ~~**PC → PC connections exist.**~~ **RETRACTED 2026-07-31: A PC IS NEVER
  KEPT.** Round 2 made characters valid connection targets so one PC could hold
  a party roster of PCs; the user retired that. A character KEEPS — npcs,
  hirelings, mounts, transports, containers — and is the top of every chain.
  Consequences, all landed: `CharacterData` no longer declares `connectedTo` or
  `formerlyBelongedTo`; `canBeConnected` refuses every character (no branch
  needed — `npcRole` is null for a character, so the existing role test already
  says no); the pairwise "an NPC must never keep a PC" rule and its notice are
  gone, because a general "no character is a legal target" swallows the special
  case; and both pickers drop their character clauses.
  **The schema removal is the load-bearing half, not the guard.** Measured with
  an in-page control that forces `canBeConnected` open: `connectActor` then
  RETURNS TRUE while storing nothing, because cleaning drops an update to a
  field the model does not declare. So the method reports success on a write
  that never happened — the guard is what makes the refusal *honest*, the schema
  is what makes it *true*. `dev:roles` asserts both halves separately.
- **Ownership follows connection.** Connecting a PC → NPC copies the PC's
  ownership onto the NPC (the marketplace-buy precedent, `deepClone` of the
  whole ownership object), executed GM-side — free, since manual connects are
  Warden-only. (The "PC → PC grants nothing" half of this rule went with PC→PC
  itself — a connection target can no longer be a character at all.)
- **One upward link at a time STANDS.** "One connection to a PC and one to an
  NPC" was probed as both-at-once and rejected — every keeper-death, ownership
  and authoritative-tab question forks under two parents. Enforced as
  single-parent-ever in `connectActor` itself (the dialog filter alone was the
  only guard before, so a drop could steal a connected actor). The tab shows
  both directions instead: the upward keeper row and the kept list.

## Round 3 — the flat graph, the cap, and the player verb (settled 2026-08-01)

This round SUPERSEDES two Round-2 rules above; they are left in place as the
record of what was tried, and this section is what the code does.

- ~~**NPC → NPC below that.**~~ **The graph is FLAT: only a character keeps.**
  Every `connectedTo` points at a PC; the hireling-keeps-her-own-backpack
  chain died on the user's own question ("isn't nesting an invitation to
  disaster?"). The reason is ownership, not tidiness: with connection driving
  ownership (below), every connect/break under nesting becomes a transitive
  walk over a subtree, re-deriving the rights of documents nobody touched.
  `KEEPER_ROLES` is gone — keeping is decided by TYPE, in one line of
  `canKeepConnected`. The cycle guard survives as belt-and-braces over
  pre-flat data; `flattenConnections` (marker `connections-migrated`)
  re-points PC-rooted chains, unlinks-and-stamps npc-rooted, dangling and
  cyclic ones, and never destroys data.
- **A cap of ten connections per character, counting EVERY role** (a horse, a
  cart and two sacks are four of the ten). `MAX_CONNECTIONS` in
  `module/connections.js`, read only through `maxConnections()` — a future GM
  setting is anticipated, not built. The cap gates NEW connections only: the
  three mint flows (marketplace, generation grants, the socket broker — the
  broker being the WALL, since the player-side clamp cannot bind a crafted
  client) each enforce it, and the migration deliberately does not.
- ~~**Edges are the Warden's alone.**~~ **ONE verb, player-usable: the Warden
  always, else the OWNER OF BOTH ENDS.** Both dialogs read one label
  ("Connect"); the wall lives inside `connectActor`/`unlinkOwnedContainer`
  as before, now testing `isGM || (keeper.isOwner && child.isOwner)`; a
  dangling keeper's detach needs only the child's owner — there is no other
  end left to own.
- **Ownership FOLLOWS connection, as shapes, transitions-only, monsters
  excluded.** Connected → `{default: OBSERVER, keeper's players: OWNER}`;
  broken/unconnected → `{default: LIMITED}`, connection-granted OWNER
  stripped, sub-OWNER grants kept. Applied with
  `foundry.data.operators.ForcedReplacement` (the `"==key"` spelling is
  deprecated legacy syntax on 14.365) so stale entries actually go — this
  replaces Round 2's wholesale `deepClone` copy at all four write sites. No
  re-enforcement sweep ever runs: a Warden's manual grant after the fact is
  theirs. A PLAYER's client cannot write the shapes (server wall), so their
  connect/break folds `flags.air-bladder.ownershipSyncPending` into the same
  write and emits `ownershipSync`; the active GM's client recomputes from
  document state (the flag is the authorization), and a GM-load sweep
  catches flags set while no GM was online. Known, accepted, release-notes-
  worthy: a player who breaks a connection loses OWNER and cannot reconnect
  alone. `_preCreate` gives unconnected non-monster npcs a LIMITED default
  (creation-time defaults are the one ownership write a player may make).

Gated by `npm run dev:connections` (the verb, the relay, the walls, the
_preCreate default) and `npm run dev:connections-migration` (every branch of
the flatten, with the monster-exclusion and never-downgrade witnesses).
