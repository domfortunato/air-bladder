import { containerClassLabel } from "./icons.js";
import { grantSourceLabel } from "./utils.js";
import { t } from "./i18n-content.js";

/**
 * The bulleted lines a character's generation grants leave on their notes.
 *
 * A background that hands you a horse mints an Actor; the horse's own sheet
 * carries its prose, but the horse is a separate document a player has to go
 * and open, and the promise was made to the CHARACTER. So each grant writes one
 * line onto the keeper's Background & Notes, saying what the thing is, where it
 * came from, and what it does.
 *
 * **The line is REMOVED BY THE CONTAINER'S DELETION, not by the path that
 * caused it.** The first cut pruned inside the re-roll and regenerate paths by
 * recomputing the line and matching that text against the stored notes. It
 * worked exactly until the line's format changed — one commit later — and then
 * every note written by the previous version became unmatchable, so a re-rolled
 * question left a bullet describing a beast that no longer existed and a
 * changed background left a whole pair of them. Recomputing what you wrote is a
 * guess about your own past.
 *
 * What is stored instead is a LEDGER: `flags.air-bladder.grantNotes`, one
 * record per line, holding the exact html written and the names it covers.
 * Removal reads the ledger rather than rebuilding it, so a format change can
 * never orphan a line, and it hangs off `_onDeleteOperation` — which every
 * route travels, the re-roll, the regenerate, the background swap and a Warden
 * deleting the mule straight out of the directory.
 */

const SCOPE = "air-bladder";
const LEDGER = "grantNotes";

/**
 * One line per grant, as escaped html.
 *
 *   Companion: Horse [Question] — Piebald Cob: Intelligent, it can understand
 *   simple commands and even has an instinct for danger. 6 HP. +4 slots.
 *
 * The LABEL is the sheet's own two words for the thing, Role and Kind: a player
 * reading "Rivertooth: impressively strong" has no way to know whether that is
 * a beast they lead or a wagon they push. The TAG is the same word the
 * inventory's grant chips use, so the note and the item row beside it never
 * disagree about where something came from. The PROSE is the granting option's
 * own where there is any, and the pack document's stock description where there
 * is not — Mountebank's cart is granted outright and states nothing of its own,
 * and a line reading only "Transport: Cart" says less than the compendium
 * already knows.
 *
 * ONE OPTION, ONE LINE. The Bonekeeper's burial wagon "came with a stubborn old
 * donkey" and grants two things in a single sentence; a line each printed that
 * sentence twice. Both Actors are still created — only the note collapses.
 *
 * Everything is localized HERE, at write time, because notes are deliberately
 * not run through the content overlay on display: they are the player's own
 * words. And everything is escaped — a background is Warden-authorable content
 * and `notes` is an htmlField, so this is not the side that trusts it as markup.
 * @param {Object[]} entries  {role, cls, source, prose?, stockProse?, name?}
 * @returns {{html: String, names: String[], source: String}[]}
 */
export const grantLines = (entries) => {
  const esc = foundry.utils.escapeHTML;
  const label = ({ role, cls }) => {
    const key = String(role || "companion");
    return [
      game.i18n.localize(`CAIRN.Role${key.charAt(0).toUpperCase()}${key.slice(1)}`),
      game.i18n.localize(containerClassLabel("", "", String(cls || ""))),
    ].join(": ");
  };
  const line = (labels, tag, said) => [
    `<strong>${esc(labels.join(", "))}</strong>`,
    tag ? ` <em>[${esc(tag)}]</em>` : "",
    said ? ` — ${esc(said)}` : "",
  ].join("");

  const groups = new Map();
  const out = [];
  for (const e of entries) {
    const prose = String(e.prose ?? "").trim();
    if (!prose) {
      out.push({
        html: line([label(e)], grantSourceLabel(e.source), t("monster.desc", String(e.stockProse ?? "").trim())),
        names: [String(e.name ?? "")],
        source: String(e.source ?? ""),
      });
      continue;
    }
    if (!groups.has(prose)) {
      groups.set(prose, { members: [], at: out.length });
      out.push(null);
    }
    groups.get(prose).members.push(e);
  }
  // Which of a group's things the line is filed under: the TRANSPORT, then a
  // companion, then a container — the wagon is what the answer granted and the
  // donkey is what came with it (user ruling, 2026-08-13).
  const rank = (e) => {
    const i = ["transport", "companion", "container"].indexOf(String(e.role));
    return i < 0 ? 99 : i;
  };
  for (const [prose, g] of groups) {
    const head = g.members.slice().sort((a, b) => (rank(a) - rank(b)) || label(a).localeCompare(label(b)))[0];
    out[g.at] = {
      html: line([label(head)], grantSourceLabel(head.source), t("bg.optionDesc", prose)),
      names: g.members.map((m) => String(m.name ?? "")),
      source: String(head.source ?? ""),
    };
  }
  return out.filter(Boolean);
};

/** Add one bullet, into a trailing list rather than a rival one. Idempotent. */
const withBullet = (notes, html) => {
  const body = String(html ?? "").trim();
  const existing = String(notes ?? "").trim();
  if (!body) return existing;
  const li = `<li>${body}</li>`;
  if (existing.includes(li)) return existing;
  if (!existing) return `<ul>${li}</ul>`;
  return existing.endsWith("</ul>")
    ? `${existing.slice(0, -"</ul>".length)}${li}</ul>`
    : `${existing}<ul>${li}</ul>`;
};

/**
 * Take one bullet back out, and any list left empty by it.
 *
 * Matched by the EXACT html the ledger recorded, so this is not a guess about
 * what an earlier version of the code would have written. If a player has since
 * edited that line by hand it simply will not match, and their words stay —
 * which is the right way round for a field they own.
 */
const withoutBullet = (notes, html) => {
  const body = String(html ?? "").trim();
  const existing = String(notes ?? "").trim();
  if (!body || !existing) return existing;
  return existing
    .split(`<li>${body}</li>`).join("")
    .split("<ul></ul>").join("")
    .trim();
};

/** The ledger, as a plain array. */
const ledgerOf = (actor) => {
  const raw = actor?.getFlag(SCOPE, LEDGER);
  return Array.isArray(raw) ? raw : [];
};

/**
 * Write the lines for a set of grants, and record them.
 *
 * Called BEFORE the fork between the Warden's direct create and the player's
 * socket request, so it lands on both paths: minting an Actor needs the
 * Warden's client, but a player owns their own character and writes this
 * themselves. Nothing about the note crosses the socket.
 * @param {CairnActor} actor @param {Object[]} entries  see grantLines
 */
export const applyGrantNotes = async (actor, entries) => {
  const lines = grantLines(entries);
  if (!lines.length) return;
  const before = actor.system.notes ?? "";
  let notes = before;
  for (const line of lines) notes = withBullet(notes, line.html);
  if (notes === before) return;
  await actor.update({
    "system.notes": notes,
    [`flags.${SCOPE}.${LEDGER}`]: [...ledgerOf(actor), ...lines],
  }, { abNoStatusCard: true });
};

/**
 * Drop the lines whose things are gone.
 *
 * A record survives while ANY container it covers is still connected to this
 * keeper under the same grant source — so deleting one half of the Bonekeeper's
 * wagon-and-donkey pair keeps the sentence that describes them both, and
 * deleting the second takes it away.
 *
 * Runs from `CairnActor._onDeleteOperation`, on the acting client only, which
 * is every route a grant can end: a re-rolled question, a regenerate, a changed
 * background, or a Warden deleting the beast out of the directory.
 * @param {CairnActor} actor  the keeper
 * @param {Set<String>} [deletedIds]  ids already gone but possibly still in the collection
 */
export const pruneGrantNotes = async (actor, deletedIds = new Set()) => {
  const ledger = ledgerOf(actor);
  if (!ledger.length) return;
  const alive = game.actors.filter((c) =>
    !deletedIds.has(c.id)
    && c.system?.connectedTo === actor.uuid
    && !!c.getFlag(SCOPE, "grantSource"));
  const keeps = (rec) => (rec.names ?? []).some((n) =>
    alive.some((c) => c.name === n && c.getFlag(SCOPE, "grantSource") === rec.source));
  const kept = ledger.filter(keeps);
  if (kept.length === ledger.length) return;
  const before = actor.system.notes ?? "";
  let notes = before;
  for (const rec of ledger.filter((r) => !keeps(r))) notes = withoutBullet(notes, rec.html);
  await actor.update({
    "system.notes": notes,
    [`flags.${SCOPE}.${LEDGER}`]: kept,
  }, { abNoStatusCard: true });
};
