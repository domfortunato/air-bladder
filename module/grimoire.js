/**
 * The GLOG cast flow — a DialogV2 raised from the carried Grimoire, a resolved
 * spell text, a public card and a private whisper (rulings 2026-08-09; the
 * GLOG Magic hack, cairnrpg.com/hacks/glog-magic/).
 *
 * Magic Dice are the caster's FREE INVENTORY SLOTS, read at the moment of
 * asking and never stored: fill a slot and the next cast's pool shrinks by
 * itself — the hack's feedback loop falls out of the slot math with no
 * bookkeeping to drift. The dice cap at 4 (the hack's limit), the Roll is a
 * real Foundry Roll (DSN animates it) SPOKEN BY THE CHARACTER, and nothing
 * mechanical is automated past the report: the whisper offers ONE button —
 * Add N Fatigue, never refused (`ignoreCapacity`) — and on doubles it carries
 * the drawn Mishap. The Mishaps table resolves WORLD-FIRST, the Faction-die
 * precedent, so a Warden customizes it by importing a world copy.
 */
import { FATIGUE_NAME } from "./item/item.js";
import { findTableByName } from "./compendium.js";
import { t } from "./i18n-content.js";
import { formatCount } from "./utils.js";

/** The shipped Mishaps table's stored English name (tables-glog). */
export const MISHAPS_TABLE_NAME = "GLOG Magic: Mishaps";

/**
 * Resolve a spell's DISPLAYED text against the dice just rolled.
 *
 * The shape — per-power blocks and bracketed expressions — is adopted from
 * fsmalecho's cast macro (credit where the design was proven: he built the
 * resolved-text idea against the canon pack, Spanish `[dado]` markers
 * included, before this module existed):
 *
 * - `[1] … [2] …` blocks: when bare-digit markers are present, the block
 *   matching the invested dice replaces them (the text before the first
 *   marker is kept as preamble). No block for this power — or no markers at
 *   all — leaves the whole text standing: harmless when absent.
 * - `[sum]`, `[dice]` (and Malecho's Spanish `[dado]`) substitute the rolled
 *   values, and arithmetic like `[sum*10]` EVALUATES — but only when, after
 *   substitution, nothing but digits and arithmetic remains. Anything else
 *   (`[8 HP, 3 STR…]` stat blocks, the odd stray bracket the verbatim
 *   transcription preserves) is left exactly as written.
 *
 * Runs on the DISPLAYED text — the overlay-localized copy — so a Spanish
 * client resolves the Spanish sentence, not the stored English under it.
 *
 * @param {string} text   the displayed (localized) spell description, HTML
 * @param {number} dice   Magic Dice invested
 * @param {number} sum    their total
 * @returns {string}
 */
export const resolveSpellText = (text, dice, sum) => {
  let out = String(text ?? "");

  // Per-power blocks. Split keeps the captured digit at odd indices:
  // [preamble, "1", block1, "2", block2, …].
  if (/\[([1-4])\]/.test(out)) {
    const parts = out.split(/\[([1-4])\]/);
    for (let i = 1; i < parts.length; i += 2) {
      if (Number(parts[i]) === dice) {
        out = parts[0] + parts[i + 1];
        break;
      }
    }
  }

  // Bracketed expressions. Substitute the variables, then evaluate ONLY a
  // purely numeric residue — `Function` is safe here precisely because the
  // whitelist admits nothing but digits, arithmetic operators and parens.
  return out.replace(/\[([^\][]+)\]/g, (match, expr) => {
    // A bare digit 1-4 is a BLOCK MARKER, never arithmetic: when no block
    // matched the power above (or the markers were malformed), the markers
    // stay visible rather than collapsing into stray numbers.
    if (/^\s*[1-4]\s*$/.test(expr)) return match;
    const sub = expr
      .replace(/\bsum\b/gi, String(sum))
      .replace(/\bdice\b/gi, String(dice))
      .replace(/\bdado\b/gi, String(dice))
      .replace(/[×]/g, "*");
    if (!/^[\d+\-*/().\s]+$/.test(sub) || !/\d/.test(sub)) return match;
    try {
      const v = Function(`"use strict"; return (${sub});`)();
      return Number.isFinite(v) ? String(v) : match;
    } catch {
      return match;
    }
  });
};

/** Document names go into dialog/card HTML; a name is user-authored text. */
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Cast from `actor`'s carried Grimoire: pick a bound page and a power
 * (1..min(4, free slots)), roll, and report — the resolved effect publicly,
 * the mechanics privately. Returns the public ChatMessage, or null when the
 * cast could not happen (no book, no pages, no dice, dialog dismissed).
 * @param {CairnActor} actor
 * @returns {Promise<ChatMessage|null>}
 */
export const castFromGrimoire = async (actor) => {
  if (actor?.type !== "character") return null;
  const book = actor.items.find((i) => i.type === "item" && i.system.grimoire);
  if (!book) return null;
  const pages = actor.items.filter((i) => i.type === "spellbook" && i.system.bound);
  if (!pages.length) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.GrimoireNoPages", { name: book.name }));
    return null;
  }
  const free = Math.max(0, (actor.system.slotsMax ?? 0) - (actor.system.slotsUsed ?? 0));
  const maxDice = Math.min(4, free);
  if (maxDice < 1) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.GrimoireNoDice", { name: actor.name }));
    return null;
  }

  const L = (k) => game.i18n.localize(k);
  // Display names through the overlay; the VALUE stays the item id.
  const pageOptions = pages.map((p) =>
    `<option value="${esc(p.id)}">${esc(t("item.name", p.name))}</option>`).join("");
  const powerOptions = Array.from({ length: maxDice }, (_, i) =>
    `<option value="${i + 1}">${i + 1}</option>`).join("");
  const picked = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.format("CAIRN.GrimoireCastFrom", { book: book.name }),
      icon: "fas fa-hand-sparkles",
    },
    position: { width: 400 },
    content: `
      <div class="form-group">
        <label>${L("CAIRN.GrimoireCastSpell")}</label>
        <select name="page">${pageOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.format("CAIRN.GrimoireCastPick", { max: maxDice })}</label>
        <select name="dice">${powerOptions}</select>
      </div>`,
    buttons: [
      {
        action: "cast", label: L("CAIRN.GrimoireCast"), icon: "fas fa-hand-sparkles", default: true,
        callback: (_ev, button) => ({
          pageId: String(button.form?.elements?.page?.value ?? ""),
          dice: Number(button.form?.elements?.dice?.value) || 1,
        }),
      },
      { action: "cancel", label: L("CAIRN.Cancel"), callback: () => null },
    ],
    rejectClose: false,
  });
  if (!picked) return null;
  const page = actor.items.get(picked.pageId);
  if (!page) return null;

  const roll = new Roll(`${picked.dice}d6`);
  await roll.evaluate();
  const faces = roll.dice[0].results.map((r) => r.result);
  const sum = faces.reduce((a, b) => a + b, 0);
  const fatigue = faces.filter((v) => v >= 4).length;
  const doubles = new Set(faces).size < faces.length;

  // THE PUBLIC CARD: the spell's effect with real numbers — what the table
  // sees happen. The description is pack/Warden-authored HTML and renders as
  // HTML the same way the inventory's description dropdowns render it; the
  // resolution runs on the localized copy so every reader of a Spanish client
  // got a Spanish sentence resolved with the same numbers.
  const resolved = resolveSpellText(t("item.desc", page.system.description), picked.dice, sum);
  const speaker = ChatMessage.getSpeaker({ actor });
  const publicCard = await ChatMessage.create({
    speaker,
    rolls: [roll],
    content: [
      `<div class="grimoire-cast-card">`,
      `<h3>${esc(t("item.name", page.name))}</h3>`,
      `<div class="grimoire-cast-effect">${resolved}</div>`,
      `</div>`,
    ].join("\n"),
  });

  // THE PRIVATE WHISPER: the mechanics — dice, sum, the Fatigue the caster
  // owes (with the one button, never refused), and on doubles the Mishap,
  // drawn here from the world-first table so the caster reads their fate
  // without the table's own card announcing it to the room.
  const lines = [
    `<div class="grimoire-cast-whisper">`,
    `<p>${game.i18n.format("CAIRN.GrimoireWhisperDice",
      { faces: faces.join(", "), sum })}</p>`,
  ];
  if (fatigue > 0) {
    lines.push(`<p>${formatCount("CAIRN.GrimoireFatigueLine", fatigue, { count: fatigue })}</p>`);
    lines.push(`<button type="button" class="grimoire-add-fatigue"`
      + ` data-actor-uuid="${esc(actor.uuid)}" data-count="${fatigue}">`
      + `<i class="fas fa-battery-quarter"></i> `
      + `${game.i18n.format("CAIRN.GrimoireAddFatigue", { count: fatigue })}</button>`);
  }
  if (doubles) {
    lines.push(`<p class="grimoire-mishap"><strong>${L("CAIRN.GrimoireMishapLine")}</strong></p>`);
    const table = await findTableByName(MISHAPS_TABLE_NAME);
    if (table) {
      // roll(), not draw(): draw posts its own PUBLIC card (and never forwards
      // messageData — the recorded speaker trap), and a mishap belongs in this
      // whisper. `replacement: true` tables never mark rows drawn, so reading
      // a locked pack copy is safe.
      const { results } = await table.roll();
      for (const r of results) {
        lines.push(`<div class="grimoire-mishap-text">${t("table.result", r.description ?? "")}</div>`);
      }
    } else {
      lines.push(`<p>${game.i18n.format("CAIRN.GrimoireMishapNoTable",
        { name: MISHAPS_TABLE_NAME })}</p>`);
    }
  }
  lines.push(`</div>`);
  await ChatMessage.create({
    speaker,
    whisper: [game.user.id],
    content: lines.join("\n"),
  });

  return publicCard;
};

/**
 * Wire the whisper's Add-N-Fatigue button on a rendered chat message. Called
 * from the renderChatMessageHTML hook in cairn.js. The whisper is only ever
 * visible to its author, but the OWNERSHIP test is still the gate (not
 * authorship): the enforcement must hold even if the message reaches another
 * client by some future route. Spent is recorded on the MESSAGE
 * (`flags.air-bladder.fatigueApplied`) — the damage-card precedent: the
 * disabled button is the affordance, the flag check here is the enforcement,
 * and a card scrolled back to hours later is still spent.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export const bindGrimoireFatigueButton = (message, html) => {
  const btn = html.querySelector(".grimoire-add-fatigue");
  if (!btn) return;
  if (message.getFlag("air-bladder", "fatigueApplied")) {
    btn.setAttribute("disabled", "disabled");
    return;
  }
  btn.onclick = async () => {
    if (message.getFlag("air-bladder", "fatigueApplied")) return;
    const actor = fromUuidSync(btn.dataset.actorUuid);
    if (!actor?.isOwner) return;
    const count = Math.max(1, Number(btn.dataset.count) || 1);
    for (let i = 0; i < count; i++) {
      // Fatigue is a COST, never refused — the one thing ignoreCapacity is for.
      await actor.createOwnedItem({ name: FATIGUE_NAME, type: "item" }, { ignoreCapacity: true });
    }
    await message.setFlag("air-bladder", "fatigueApplied", true);
  };
};
