/**
 * The grimoire's magic surface — Magic Dice and the cast flow (rulings
 * 2026-08-05, the GLOG Magic hack, cairnrpg.com/hacks/glog-magic/).
 *
 * Magic Dice are the KEEPER's free inventory slots, read live through
 * `connectedTo` at the moment of asking and never stored: fill a slot and the
 * next cast's pool shrinks by itself — the hack's feedback loop falls out of
 * the slot math with no bookkeeping to drift. The cast is a real Foundry Roll
 * (DSN animates it for free) whose SPEAKER IS THE KEEPER, not the book — the
 * generation-dice precedent: the roller is passed explicitly, because the
 * character casts and the book is where the spell lives.
 *
 * Nothing mechanical is automated past the report (house rule): the card
 * states sum, doubles, and how many dice came up 4–6, and offers ONE button —
 * Add N Fatigue, the Apply-damage precedent (a roll reports, a human applies
 * with one click). Fatigue is never refused (`ignoreCapacity`), and on
 * doubles the card names the Mishaps table for the Warden to roll by hand.
 */
import { FATIGUE_NAME } from "./item/item.js";

/**
 * The keeper and their castable dice, or null when the book is unbound.
 * `dice` is min(4, the keeper's free slots) — the hack invests up to four —
 * and can legitimately be 0: a fully loaded keeper cannot cast at all.
 * @param {CairnActor} book  a grimoire-role npc
 * @returns {{keeper: CairnActor, dice: number}|null}
 */
export const magicDiceFor = (book) => {
  const link = book?.system?.connectedTo || "";
  const keeper = link ? game.actors.find((a) => a.uuid === link) : null;
  if (!keeper || keeper.type !== "character") return null;
  const free = Math.max(0, (keeper.system.slotsMax ?? 0) - (keeper.system.slotsUsed ?? 0));
  return { keeper, dice: Math.min(4, free) };
};

/**
 * Cast `item` (a spellbook in the grimoire's inventory): pick 1..dice Magic
 * Dice, roll them, and report. Returns the ChatMessage, or null when the cast
 * could not happen (unbound book, no free slot, dialog dismissed).
 * @param {CairnActor} book
 * @param {CairnItem} item
 * @returns {Promise<ChatMessage|null>}
 */
export const castFromGrimoire = async (book, item) => {
  const md = magicDiceFor(book);
  if (!md) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.GrimoireNotBound", { name: book.name }));
    return null;
  }
  if (md.dice < 1) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.GrimoireNoDice", { name: md.keeper.name }));
    return null;
  }
  const L = (k) => game.i18n.localize(k);
  const esc = foundry.utils.escapeHTML;
  const options = Array.from({ length: md.dice }, (_, i) =>
    `<option value="${i + 1}">${i + 1}</option>`).join("");
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("CAIRN.GrimoireCastTitle", { spell: item.name }), icon: "fas fa-hand-sparkles" },
    position: { width: 380 },
    content: `
      <div class="form-group">
        <label>${game.i18n.format("CAIRN.GrimoireCastPick", { max: md.dice })}</label>
        <select name="dice">${options}</select>
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

  const roll = new Roll(`${picked}d6`);
  await roll.evaluate();
  const faces = roll.dice[0].results.map((r) => r.result);
  const sum = faces.reduce((a, b) => a + b, 0);
  const fatigue = faces.filter((v) => v >= 4).length;
  const doubles = new Set(faces).size < faces.length;

  const lines = [
    `<div class="grimoire-cast-card">`,
    `<h3>${esc(item.name)}</h3>`,
    `<p>${game.i18n.format("CAIRN.GrimoireCastLine", {
      count: picked, sum, keeper: esc(md.keeper.name), book: esc(book.name),
    })}</p>`,
  ];
  if (fatigue > 0) {
    lines.push(`<p>${game.i18n.format("CAIRN.GrimoireFatigueLine", { count: fatigue })}</p>`);
    lines.push(`<button type="button" class="grimoire-add-fatigue" data-keeper-uuid="${esc(md.keeper.uuid)}" data-count="${fatigue}">`
      + `<i class="fas fa-battery-quarter"></i> ${game.i18n.format("CAIRN.GrimoireAddFatigue", { count: fatigue })}</button>`);
  }
  if (doubles) {
    lines.push(`<p class="grimoire-mishap">${game.i18n.format("CAIRN.GrimoireMishapLine", { sum })}</p>`);
  }
  lines.push(`</div>`);

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: md.keeper }),
    rolls: [roll],
    content: lines.join("\n"),
  });
};

/**
 * The Warden's Generate Grimoire flow (the monster precedent: Warden-only,
 * the picker IS the confirmation, ✕ creates nothing). Mints an UNCONNECTED
 * grimoire-role npc — found-only treasure by ruling: no marketplace row, no
 * generation grant, so a directory button for the Warden is the one way a
 * book enters the world — and optionally rolls N spells into it from the
 * ACTIVE pool (canon normally, GLOG ∪ custom while the setting is on),
 * recorded as permanent PAGES: real spellbook items, not scrolls, because a
 * bound book's pages are copied-in spells, and the scroll fiction is for
 * loose found magic.
 * @param {{folder?: string|null}} [options]
 * @returns {Promise<CairnActor|null>}
 */
export const createGrimoire = async ({ folder = null } = {}) => {
  if (!game.user.isGM) return null;
  const L = (k) => game.i18n.localize(k);
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: L("CAIRN.CreateGrimoire"), icon: "fas fa-book-skull" },
    position: { width: 420 },
    content: `
      <div class="form-group">
        <label>${L("CAIRN.Name")}</label>
        <input type="text" name="name" value="${L("CAIRN.RoleGrimoire")}" />
      </div>
      <div class="form-group">
        <label>${L("CAIRN.GrimoirePages")}</label>
        <input type="number" name="slots" value="10" min="1" step="1" />
      </div>
      <div class="form-group">
        <label>${L("CAIRN.GrimoireGenSpells")}</label>
        <select name="spells">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === 1 ? " selected" : ""}>${n}</option>`).join("")}</select>
      </div>`,
    buttons: [
      {
        action: "create", label: L("CAIRN.CreateGrimoire"), icon: "fas fa-book-skull", default: true,
        callback: (_ev, button) => ({
          name: button.form?.elements?.name?.value?.trim() || L("CAIRN.RoleGrimoire"),
          slots: Math.max(1, Math.trunc(Number(button.form?.elements?.slots?.value)) || 10),
          spells: Number(button.form?.elements?.spells?.value) || 0,
        }),
      },
      { action: "cancel", label: L("CAIRN.Cancel"), callback: () => null },
    ],
    rejectClose: false,
  });
  if (!picked) return null;

  const actor = await CONFIG.Actor.documentClass.create({
    name: picked.name, type: "npc", folder,
    system: { role: "grimoire", slots: picked.slots },
  });
  if (!actor) return null;

  if (picked.spells > 0) {
    const { randomSpellbookDoc } = await import("./character-generator.js");
    const pages = new Map();
    // Draw with a retry margin so a duplicate name re-rolls instead of
    // shorting the count; a pool smaller than the ask just fills what it can.
    for (let tries = 0; pages.size < picked.spells && tries < picked.spells * 5; tries++) {
      const doc = await randomSpellbookDoc();
      if (!doc || pages.has(doc.name)) continue;
      pages.set(doc.name, {
        name: doc.name, type: doc.type, img: doc.img,
        system: { ...doc.system.toObject(), scroll: false, equipped: false },
      });
    }
    if (pages.size) await actor.createEmbeddedDocuments("Item", [...pages.values()]);
  }
  return actor;
};

/**
 * Wire the card's Add-N-Fatigue button — called from the
 * renderChatMessageHTML hook (the Apply-damage precedent). Owner-or-Warden
 * only; anyone else sees no button at all, the damage card's rule.
 * Fatigue is added with `ignoreCapacity` — casting fills a slot whether or
 * not one is free; refusing it would cancel a cost, not protect the player.
 * @param {HTMLElement} html  the rendered chat message
 */
export const bindGrimoireCard = (html) => {
  for (const btn of html.querySelectorAll(".grimoire-add-fatigue")) {
    const keeper = game.actors.find((a) => a.uuid === btn.dataset.keeperUuid);
    if (!keeper || !(keeper.isOwner || game.user.isGM)) { btn.remove(); continue; }
    btn.onclick = async () => {
      const count = Math.max(1, Number(btn.dataset.count) || 1);
      for (let i = 0; i < count; i++) {
        await keeper.createOwnedItem({ name: FATIGUE_NAME, type: "item" }, { ignoreCapacity: true });
      }
      btn.disabled = true;
      if (keeper.isEncumbered()) {
        ui.notifications.warn(game.i18n.format("CAIRN.Notify.Overloaded", {
          name: game.i18n.localize("CAIRN.Fatigue"),
        }));
      }
    };
  }
};
