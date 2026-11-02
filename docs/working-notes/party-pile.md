# Party folder and Dropped Item Pile (`module/party-pile.js`)

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- Neither is a new type: the pile is an npc `role: container`. **Nothing is created
  on load** — folder on first Create of a PC, pile on first drop.
- **Found by flag, never by name — AND the pile must have no player owner**
  (`isDroppedPile` asks `!hasPlayerOwner`). A flag alone is not identity.
  `pileDisplayName` names it by its current name.
- **The ready sweep strips a flag only from a plant's shape**
  (`stripPlantedPileFlags`, review #34 F233): a last writer who is a player NOW
  and whose own key is below OWNER. A demoted Warden still holds the OWNER key the
  server stamped when they made the pile, so it keeps its flag. Residual, stated:
  while its maker is demoted the pile counts as handed to a player and the next
  drop starts a new one; promoted back, the original works again and the drop
  after that folds the two (`reconcilePiles`).
- **Drop sits beside the trash**, never instead of it. Not offered for Fatigue or a
  bound grimoire page; `withDrop` off on the pile.
- Confirm is a `DialogV2.wait` with a 25-char optional "where" note
  (`buildWhereField`, shared with the Fatigue drop); state `width: 400`; Drop is the
  default. Note stored `flags.air-bladder.droppedAt` → `system.droppedAt` (TOTAL
  assignment), clamped on the GM side, rendered only on the pile's sheet. Blank
  removes an old note.
- Drop icon `fa-down-to-line`; the hand means only "give to a person". Verify FA
  glyphs against the font — FA5-era names (`fa-map-marker-alt`).
- **The move runs on the active GM** via `User#query`
  (`CONFIG.queries["air-bladder.pileDrop"]`); trust only the server-authenticated
  user; GM checks the sender owns the source. No GM → refuse and say so.
- **Claim id is a fresh `randomID` per gesture** (`claimId`), never the item's id.
  Pile first, then delete from the sheet. A sibling-session `false` → check whether
  `claimId` landed.
- Pages travel with the book (`pagesOfGrimoire`), copy stowed. `reconcilePiles`
  copies only what the canonical pile lacks and deletes the extra only when all its
  ids are there. No drop from a compendium actor (`!actor.pack`). Pile is LINKED.
- Unlimited capacity is `calcCurrentMaxSlots` returning Infinity; sheet prints
  `slotsMaxLabel`. `party-pile.js` declares its own `FLAG_SCOPE` to avoid a cycle.
- Explicit folder wins; only characters default to Party. **There is no
  `FOLDER_CREATE` permission** — use `Folder.canUserCreate(game.user)`. Verify a
  permission or key by grepping the client, never by guessing the name.
- Deleting the pile: `CairnActor#deleteDialog` adds the item count.
- **Fatigue instead of Critical Damage**: asks for a drop only when already
  overburdened (`mustDropForFatigue` = `isEncumbered()`). Picker offers only
  `slotFreeingItems` (no petty, no Fatigue), sizes via `itemSlotCost`. Refusing
  ("No — take the Critical Damage", button with no callback) applies the Critical
  Damage; Escape is not a refusal; nothing to pay with = Critical Damage with no
  dialog. **The choice is claimed first and given back if the drop fails** (review
  #34 F166): for a non-author owner ONE `choiceTaken` query claims and drops on the
  Warden's client; the author or Warden claims, drops and unsets. **The drop must
  have happened** before Fatigue lands. Toasts by real reason
  (`CAIRN.Crawler.ChoiceAlreadyMade` when the card was answered first). Drop is recorded in
  chat from a flag carrying the item name, rebuilt per viewer.
