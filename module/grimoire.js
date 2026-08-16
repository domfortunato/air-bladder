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
import { SETTINGS_NS } from "./settings.js";

/** The shipped Mishaps table's stored English name (tables-glog). */
export const MISHAPS_TABLE_NAME = "GLOG Magic: Mishaps";

/**
 * Every Grimoire `actor` holds. A CHARACTER carries at most one — the one-book
 * wall, enforced in CairnItem — but a pile, a crate or a mule may hold a
 * library, and that is the case every "the grimoire" lookup used to get wrong.
 * @param {CairnActor|null} actor
 * @returns {CairnItem[]}
 */
export const grimoiresOn = (actor) =>
  actor ? actor.items.filter((i) => i.type === "item" && i.system?.grimoire) : [];

/**
 * The pages belonging to ONE book (issue #17, fsmalecho, 2026-08-16).
 *
 * A page names its book by `system.boundTo`, matching the book's
 * `system.grimoireKey`. Both are `system` data rather than ids on purpose: a
 * book moving between sheets is a create-then-delete, so its `_id` changes
 * every journey while `system` copies across verbatim.
 *
 * An UNKEYED page — bound before the field existed, in a world
 * `migrateGrimoirePages` has not opened yet — belongs to the book only when the
 * actor holds exactly ONE. That was the whole rule before this fix, and it was
 * right in exactly that case: on a character it still is, because a character
 * may only ever carry one. On a multi-book actor an unkeyed page belongs to
 * nobody nameable, so it stays where it is. Guessing is what the bug did:
 * dragging one of two books out of a pile took all six pages with it, past the
 * book's own capacity, and left the other book empty.
 * @param {CairnActor} actor
 * @param {CairnItem} book
 * @returns {CairnItem[]}
 */
export const pagesOfGrimoire = (actor, book) => {
  if (!actor || !book) return [];
  const key = book.system?.grimoireKey ?? "";
  const sole = grimoiresOn(actor).length === 1;
  return actor.items.filter((i) => {
    if (i.type !== "spellbook" || !i.system.bound) return false;
    const to = i.system.boundTo ?? "";
    return to && key ? to === key : !to && sole;
  });
};

/**
 * The book's key, minting and persisting one if it predates the field. Called
 * at the moment a page is about to name it — the transmute — so a legacy book
 * acquires its identity on first use rather than waiting for the migration.
 * @param {CairnItem} book
 * @returns {Promise<string>}
 */
export const ensureGrimoireKey = async (book) => {
  const key = book?.system?.grimoireKey ?? "";
  if (key) return key;
  const minted = foundry.utils.randomID();
  await book.update({ "system.grimoireKey": minted });
  return minted;
};

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
 *   transcription preserves) is left exactly as written. A value that DID
 *   resolve is wrapped `<span class="grimoire-resolved" data-tooltip="[expr]">`
 *   so the card marks it as dice-made rather than authored prose, the original
 *   expression a hover away.
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
      // A resolved value comes back MARKED, at the one moment its provenance
      // is known: the card shows which number the dice made, and the tooltip
      // holds the authored expression behind it (ruling 2026-08-10). esc on
      // the attribute — the expression is pack/Warden-authored text.
      return Number.isFinite(v)
        ? `<span class="grimoire-resolved" data-tooltip="${esc(match)}">${v}</span>`
        : match;
    } catch {
      return match;
    }
  });
};

/** Document names go into dialog/card HTML; a name is user-authored text. */
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Magic Dice available to `actor` right now: min(4, free inventory slots).
 * Read at the moment of asking, never stored — see the module docblock.
 */
const magicDice = (actor) =>
  Math.min(4, Math.max(0, (actor.system.slotsMax ?? 0) - (actor.system.slotsUsed ?? 0)));

/**
 * The shared back half of every cast: roll the invested dice and report —
 * the resolved effect publicly, the mechanics privately. One function on
 * purpose: a scroll "works exactly the same as spells recorded in your
 * Grimoire" (the hack's own sentence, shipped verbatim in the handout), so a
 * second copy of the fatigue/mishap machinery would be a place for the two
 * casts to drift apart.
 * @param {CairnActor} actor
 * @param {CairnItem} spell   a bound page, or a spellscroll
 * @param {number} dice       Magic Dice invested (1..4)
 * @returns {Promise<ChatMessage>} the public card
 */
const reportCast = async (actor, spell, dice) => {
  const L = (k) => game.i18n.localize(k);
  const roll = new Roll(`${dice}d6`);
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
  const resolved = resolveSpellText(t("item.desc", spell.system.description), dice, sum);
  const speaker = ChatMessage.getSpeaker({ actor });
  // Both tiles identify themselves as spellcasting in the flavor line — the
  // speaker name alone reads as ordinary chat (user wording, 2026-08-10:
  // "Salina's Spell" / "Salina's spell triggered a magical mishap!") — and
  // every GLOG card opens it with a lit "GLOG" tag (same day's ruling: the
  // Die of Fate treatment in its own colour). A future GLOG card must carry
  // the tag too; today these two messages are the only ones.
  const glogTag = `<span class="glog-flavor-tag">GLOG</span> — `;
  const castFlavor = glogTag + game.i18n.format("CAIRN.GrimoireCastFlavor",
    { name: esc(speaker.alias ?? actor.name) });
  const publicCard = await ChatMessage.create({
    speaker,
    flavor: castFlavor,
    rolls: [roll],
    content: [
      `<div class="grimoire-cast-card">`,
      `<h3>${esc(t("item.name", spell.name))}</h3>`,
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
    // "Rolled 2 magic dice, result is 4, 4 (8)" — or "Rolled 1 magic die,
    // result is 1" (user wording, 2026-08-10, refined live): the left side
    // names what was invested, the right lists what the dice made with the
    // sum in parentheses — one die IS its sum, so the singular skips it.
    // _one form via formatCount, the fatigue line's mechanism.
    `<p>${formatCount("CAIRN.GrimoireWhisperDice", dice, {
      count: dice,
      faces: dice === 1 ? String(faces[0]) : `${faces.join(", ")} (${sum})`,
    })}</p>`,
  ];
  if (fatigue > 0) {
    lines.push(`<p>${formatCount("CAIRN.GrimoireFatigueLine", fatigue, { count: fatigue })}</p>`);
    lines.push(`<button type="button" class="grimoire-add-fatigue"`
      + ` data-actor-uuid="${esc(actor.uuid)}" data-count="${fatigue}">`
      // weight-hanging, NOT a battery: the same icon Fatigue wears in the
      // inventory (item.js stamps it on the Fatigue item), so the button
      // shows the thing it mints (user ask, 2026-08-10).
      + `<i class="fas fa-weight-hanging"></i> `
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
  } else if (dice > 1) {
    // Silence reads as an unfinished card — the whisper SAYS no mishap
    // happened (user ask, 2026-08-10). But only where a mishap was POSSIBLE:
    // one die cannot double, so on a single-die cast the sentence is noise
    // (same day's ruling).
    lines.push(`<p>${L("CAIRN.GrimoireNoMishapLine")}</p>`);
  }
  lines.push(`</div>`);
  await ChatMessage.create({
    speaker,
    flavor: doubles
      ? glogTag + game.i18n.format("CAIRN.GrimoireMishapFlavor", { name: esc(speaker.alias ?? actor.name) })
      : castFlavor,
    whisper: [game.user.id],
    content: lines.join("\n"),
  });

  return publicCard;
};

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
  const book = grimoiresOn(actor)[0];
  if (!book) return null;
  // This book's pages, not every page on the actor. Identical on a character
  // (the one-book wall), and it is the wall that is doing that work — reading
  // the actor's whole shelf here would be a second place to fix if it ever
  // moved.
  const pages = pagesOfGrimoire(actor, book);
  if (!pages.length) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.GrimoireNoPages", { name: book.name }));
    return null;
  }
  const maxDice = magicDice(actor);
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

  return reportCast(actor, page, picked.dice);
};

/**
 * Cast a SPELLSCROLL — no Grimoire needed, by the hack's own rule: "Scrolls
 * contain a single spell and are destroyed after a single use. Otherwise,
 * they work exactly the same as spells recorded in your Grimoire." So the
 * whole cast machinery runs — full Magic Dice, Fatigue, Mishaps — and the
 * one difference is the spend at the end: the scroll's single use is marked
 * (uses 1 -> 0, the strike-through every spent scroll already wears), never
 * deleted, so the paid 50gp transmute into a book someone later finds is
 * still the player's to weigh against a spent piece of vellum.
 *
 * Gated on `enable-glog-magic` — a RULES setting (the use-panic class): the
 * setting is what makes Magic Dice a rule of this world at all. The row
 * control is the affordance; every guard re-derives here.
 * @param {CairnActor} actor
 * @param {CairnItem} scroll
 * @returns {Promise<ChatMessage|null>}
 */
export const castScroll = async (actor, scroll) => {
  if (actor?.type !== "character") return null;
  if (!game.settings.get(SETTINGS_NS, "enable-glog-magic")) return null;
  if (scroll?.type !== "spellbook" || !scroll.system.scroll || scroll.system.bound) return null;
  if ((scroll.system.uses?.value ?? 0) < 1) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.ScrollSpent"));
    return null;
  }
  const maxDice = magicDice(actor);
  if (maxDice < 1) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.GrimoireNoDice", { name: actor.name }));
    return null;
  }

  const L = (k) => game.i18n.localize(k);
  const powerOptions = Array.from({ length: maxDice }, (_, i) =>
    `<option value="${i + 1}">${i + 1}</option>`).join("");
  const picked = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.format("CAIRN.GrimoireCastTitle", { spell: t("item.name", scroll.name) }),
      icon: "fas fa-hand-sparkles",
    },
    position: { width: 400 },
    content: `
      <div class="form-group">
        <label>${game.i18n.format("CAIRN.GrimoireCastPick", { max: maxDice })}</label>
        <select name="dice">${powerOptions}</select>
      </div>`,
    buttons: [
      {
        action: "cast", label: L("CAIRN.GrimoireCast"), icon: "fas fa-hand-sparkles", default: true,
        callback: (_ev, button) => Number(button.form?.elements?.dice?.value) || 1,
      },
      { action: "cancel", label: L("CAIRN.Cancel"), callback: () => null },
    ],
    rejectClose: false,
  });
  if (!picked) return null;

  const card = await reportCast(actor, scroll, picked);
  // The spend, AFTER the report so a failed card never eats the scroll.
  // `_preUpdate`'s scroll pin deliberately leaves `uses.value` alone, which is
  // exactly what lets this stick.
  await scroll.update({ "system.uses.value": 0 });
  return card;
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
    // Fatigue is a COST, never refused — the one thing ignoreCapacity is for.
    // ONE batched create for all N (createOwnedItem's count), not N awaits that
    // each wrote a document and re-rendered the sheet.
    await actor.createOwnedItem({ name: FATIGUE_NAME, type: "item" }, { ignoreCapacity: true, count });
    await message.setFlag("air-bladder", "fatigueApplied", true);
  };
};
