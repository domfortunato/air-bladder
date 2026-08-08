/**
 * The connection graph's shape rules — who may keep, and how many.
 *
 * These live outside `actor.js` because the document class is not where most
 * connections are made. THREE flows mint an actor with `connectedTo` already in
 * its creation data and never call `connectActor` at all: the marketplace's
 * `acquireTransport`, generation's `grantContainers`, and the socket broker that
 * runs the latter on the Warden's client for a player. A ceiling enforced only
 * in the one method all three skip is not a ceiling.
 *
 * The graph is FLAT as of 2026-08-01: every `connectedTo` points at a character.
 * That rule itself is `CairnActor#canKeepConnected` (it needs the document class
 * to state it), but it is why the counting here is simple — a keeper's subtree
 * is exactly its direct children, so there is no walk to get wrong.
 */

/**
 * How many actors one character may keep. Ten, counting EVERY role: a horse, a
 * cart and two sacks are four of the ten, not four of some per-role allowance.
 * The number exists so the Connections tab does not quietly become a second
 * inventory with no slot rule on it.
 */
export const MAX_CONNECTIONS = 10;

/**
 * The ceiling, read through a function on purpose. Every caller goes through
 * this and none reads the constant, so the day it becomes a GM setting is a
 * change to this one line and nothing else. It is deliberately NOT a setting
 * today: the user anticipated one, and a setting nobody has asked to move is a
 * setting nobody has tested.
 * @returns {number}
 */
export const maxConnections = () => MAX_CONNECTIONS;

/**
 * How many actors this one currently keeps.
 * @param {CairnActor} keeper
 * @returns {number}
 */
export const connectionCount = (keeper) => keeper?.connectedActors?.().length ?? 0;

/**
 * How much room is left. The minting flows need the NUMBER, not the boolean: a
 * background granting three containers to a keeper with room for one must grant
 * that one — refusing the lot loses two the character is entitled to, and
 * granting all three walks straight through the ceiling.
 * @param {CairnActor} keeper
 * @returns {number}
 */
export const connectionHeadroom = (keeper) => Math.max(0, maxConnections() - connectionCount(keeper));

/**
 * @param {CairnActor} keeper
 * @returns {boolean} true when one more connection would exceed the ceiling
 */
export const atConnectionLimit = (keeper) => connectionHeadroom(keeper) <= 0;

/* -------------------------------------------------------------------------- */
/*  Ownership follows connection (2026-08-01)                                  */
/* -------------------------------------------------------------------------- */

/*
 * Connection drives OWNERSHIP now. Connected -> the keeper's players own the
 * child and the table may look at it; broken or unconnected -> a stranger's
 * silhouette. TRANSITIONS ONLY: these shapes are applied when an edge is made
 * or broken (and once by the migration), never by a re-enforcement sweep — a
 * Warden's manual grant after the fact is theirs to make and ours to leave
 * alone. Monsters are excluded EVERYWHERE: role monster never joins the graph
 * and its ownership is never touched by any of this.
 *
 * Both shapes are applied with foundry.data.operators.ForcedReplacement — the
 * v14 spelling; the "==ownership" key prefix is deprecated legacy syntax that
 * logs a compatibility warning (common/utils/helpers.mjs:463-466) — because a
 * plain object update MERGES by key and the whole point is that stale entries
 * actually go.
 *
 * Only a GM client may apply them: the server refuses any non-GM update that
 * touches `default` or another user's entry (sanitizeDocumentOwnershipField).
 * A player's connect/break instead folds `flags.air-bladder.
 * ownershipSyncPending: true` into their own write and emits `ownershipSync`
 * on the system socket; the active GM's client recomputes the shape FROM
 * DOCUMENT STATE. The flag is the authorization — only the child's owners can
 * set it — so nothing in the message is trusted.
 */

/** The flag a player's connect/break sets to request the GM-side ownership
 *  write. Scope is the SYSTEM ID (Foundry validates flag scopes against real
 *  package ids), key exported so probes and the sweep read one spelling. */
export const OWNERSHIP_SYNC_FLAG = "ownershipSyncPending";

/**
 * The shape a CONNECTED child wears: the world may look (OBSERVER), the
 * keeper's players own it. Explicit non-GM OWNER entries on the keeper are
 * copied; GM users are skipped as noise (isGM short-circuits to OWNER on
 * everything anyway); sub-OWNER entries on the keeper do NOT propagate — a
 * Warden letting Bob watch Alice's sheet was not granting Bob her mule. A
 * keeper whose own `default` is raised contributes nothing extra by design:
 * only explicit entries name the players whose character this is.
 * @param {CairnActor} keeper  a character
 * @returns {Object<string, number>}
 */
export const connectedOwnershipShape = (keeper) => {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const shape = { default: L.OBSERVER };
  for (const [id, level] of Object.entries(keeper?.ownership ?? {})) {
    if (id === "default") continue;
    const user = game.users.get(id);
    if (!user || user.isGM) continue;
    if (level >= L.OWNER) shape[id] = L.OWNER;
  }
  return shape;
};

/**
 * The shape a BROKEN (or never-connected) child wears: a loot pile is a
 * stranger until someone finds it, so `default` drops to LIMITED and the
 * connection-granted OWNER entries are stripped. Sub-OWNER explicit entries
 * survive — those are the Warden's own grants, not this automation's, and
 * stripping them would be exactly the fight the transitions-only rule
 * forbids. The consequence is deliberate and release-notes-worthy: a player
 * who breaks a connection loses OWNER on the child and cannot reconnect it
 * alone.
 * @param {CairnActor} child
 * @returns {Object<string, number>}
 */
export const brokenOwnershipShape = (child) => {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const shape = { default: L.LIMITED };
  for (const [id, level] of Object.entries(child?.ownership ?? {})) {
    if (id === "default") continue;
    const user = game.users.get(id);
    if (!user || user.isGM) continue;
    if (level >= L.OWNER) continue;
    shape[id] = level;
  }
  return shape;
};

/**
 * Apply the ownership a child's CURRENT document state calls for, iff it
 * carries the sync flag. GM CLIENT ONLY (the server refuses everyone else).
 *
 * Trusts nothing but the document: the flag is the authorization (settable
 * only by the child's owners), `connectedTo` decides which shape, and the
 * flag is cleared in the same update — with ForcedDeletion, core's own
 * unsetFlag spelling (common/abstract/document.mjs:997-1003), so no residue
 * key survives to make a later reader wonder. Wrong type or a monster just
 * loses the flag: their ownership is not this automation's to touch.
 *
 * `requester` re-checks the BOTH-ENDS rule on this side of the wire. The
 * client refuses a connect unless you own both actors, but that rule lives
 * entirely in the client and `system.*` has no server wall — so a crafted
 * client can point its own npc's `connectedTo` at a stranger's PC, raise the
 * flag, and have the Warden's client sign the ownership shape for it. The
 * result is a nuisance rather than an escalation (it burns one of the victim's
 * connection slots and hands them an actor they did not ask for), but the
 * sender id is authenticated by the server and was simply unused.
 *
 * On a refusal the flag is CLEARED so a refused request cannot lurk for a
 * later pass. The ready-time catch-up sweep passes `_stats.lastModifiedBy` as
 * the requester — server-stamped, so a client cannot sign as someone else —
 * which holds the OFFLINE route (set the flag, never emit, wait for the next
 * GM load) to the same both-ends check as the live relay. Until review #9 the
 * sweep passed NO requester and this comment claimed the opposite of the code
 * beneath it: the check was decorative for exactly that route. A GM edit that
 * postdates the player's flag can still launder the id — accepted; the harm
 * stays nuisance-grade (above) and the common shape is closed. The refusal
 * does NOT undo the `connectedTo` write — the graph is client-writable by
 * design, and unpicking someone's link is a bigger decision than declining to
 * sign for it.
 *
 * @param {CairnActor} child  a WORLD actor (callers verify)
 * @param {{requester?: User|null}} [opts]  set by the socket relay AND the catch-up sweep
 */
export const syncPendingOwnership = async (child, { requester = null } = {}) => {
  if (child.getFlag("air-bladder", OWNERSHIP_SYNC_FLAG) === undefined) return;
  const ops = foundry.data.operators;
  if (requester) {
    const owns = (doc) => !!doc?.testUserPermission(requester, "OWNER");
    const link = child.system?.connectedTo || "";
    const other = link ? game.actors.find((a) => a.uuid === link) : null;
    if (!owns(child) || (other && !owns(other))) {
      console.warn(`Air Bladder | refusing an ownership sync for ${child.name}: `
        + `${requester.name} does not own both ends`);
      await child.update({ [`flags.air-bladder.${OWNERSHIP_SYNC_FLAG}`]: new ops.ForcedDeletion() });
      return;
    }
  }
  const changes = {
    [`flags.air-bladder.${OWNERSHIP_SYNC_FLAG}`]: new ops.ForcedDeletion(),
  };
  if (["npc", "hireling"].includes(child.type) && child.npcRole !== "monster") {
    const link = child.system?.connectedTo || "";
    const keeper = link ? game.actors.find((a) => a.uuid === link) : null;
    let shape;
    if (keeper?.type === "character") {
      shape = connectedOwnershipShape(keeper);
    } else {
      shape = brokenOwnershipShape(child);
      // A PLAYER-requested break must never degrade ANOTHER user's access. With
      // `connectedTo` already empty, the both-ends check above reduces to "owns
      // the child" (there is no other end left to check), so a crafted request
      // could otherwise force this broken shape onto an UNCONNECTED actor the
      // requester merely co-owns — stripping a co-owner's OWNER or a Warden's
      // manual grant, which the transitions-only rule forbids (see the shapes'
      // docblocks). Preserve every explicit OWNER entry that is not the
      // requester's own: the breaker still loses OWNER and `default` still drops
      // to LIMITED (a real break's loot-pile-is-a-stranger rule holds), but no
      // one else's rights move. The GM-side direct break paths call
      // brokenOwnershipShape themselves, not through here, and are unaffected.
      if (requester) {
        const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        for (const [id, level] of Object.entries(child.ownership ?? {})) {
          if (id !== "default" && id !== requester.id && level >= OWNER) shape[id] = OWNER;
        }
      }
    }
    changes.ownership = ops.ForcedReplacement.create(shape);
  }
  await child.update(changes);
};
