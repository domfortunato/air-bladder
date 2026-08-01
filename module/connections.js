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
