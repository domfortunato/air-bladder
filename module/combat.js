/**
 * Cairn's turn order, spoken by Foundry's tracker.
 *
 * Cairn has no initiative queue. At the start of combat each party member makes
 * a DEX save: pass and you act before the enemies, fail and you act after. The
 * save is rolled once when combat starts, not per round.
 *
 * Order INSIDE a bucket: the Warden may drag rows to reorder within a bucket
 * (`flags.air-bladder.combatSort`, written by the tracker's drop handler,
 * read by _sortCombatants). This SUPERSEDES the same-day ruling that order
 * inside a bucket is table talk the tracker does not manage (both rulings
 * 2026-08-08, the second with the tracker in actual play) — table talk
 * survives as the default when nobody drags, since an absent flag reads 0.
 * The bucket itself stays the DEX save's outcome: changing sides is a
 * re-roll, never a drag, and the drop handler refuses across buckets.
 *
 * ACCEPTED DEVIATION (review #13, user ruling — do not re-raise): those two
 * rules bind the UI, not the database. Core grants a combatant's OWNER update
 * rights on `initiative` and `flags` outright (common/documents/combatant.mjs
 * :76-88, "the ability to update their own initiative"), so a player who owns
 * their combatant can pin their row by writing combatSort, or cross buckets
 * by writing initiative, from the console. Foundry is closed to a system
 * here — the permission test is core's own `_preUpdate`, there is no seam to
 * narrow it, and a GM-relay would break core's roll-your-own-initiative flow.
 * Accepted under the same trust-the-players house rule as the unautomated
 * mechanics: the GM-only guard on the DRAG UI is an affordance boundary, not
 * a wall, and a player rearranging the tracker by console write is table
 * behaviour for the table to police.
 *
 * The buckets are encoded as initiative 1 / 0 / −1, which the fork-era version
 * of this file already did and which is the part worth keeping: core's sort is
 * descending with an id tiebreak (documents/combat.mjs:565-569), so the three
 * values order themselves and every existing combat in every world already
 * holds them — no migration. What was wrong was the execution:
 *
 *  - it called super.rollInitiative and then PATCHED the results, one awaited
 *    `combatant.update()` per combatant — N+1 writes, each re-running
 *    setupTurns();
 *  - core SKIPS combatants the calling user does not own
 *    (documents/combat.mjs:402), leaving `initiative` null, and the patch loop
 *    then evaluated `null <= DEX` — which is TRUE, so a save that was never
 *    rolled counted as a pass;
 *  - the bucket was read off token disposition alone, so a PC on a neutral or
 *    secret token joined the enemy slot;
 *  - the log said "rolls for Initiative — 14": the right die wearing the wrong
 *    label, with the DEX it was tested against stated nowhere.
 */

import { t } from "./i18n-content.js";

/**
 * Who makes the DEX save — i.e. who acts with the party (user ruling
 * 2026-08-08): every character-type actor, REGARDLESS of its token's
 * disposition (a disguised PC is still a PC), plus friendly-disposition tokens
 * (hirelings, beasts, allies — they act with the party). Everyone else is the
 * enemy slot.
 *
 * ONE predicate, used by the roll AND named beside the tracker's display, so
 * the two can never disagree about whose row is whose.
 *
 * @param {Combatant} combatant
 * @return {Boolean}
 */
export const isPartySide = (combatant) =>
  combatant?.actor?.type === "character"
  || (combatant?.token?.disposition ?? 0) === CONST.TOKEN_DISPOSITIONS.FRIENDLY;

/** The bucket a stored initiative value means. Any positive number is the
 * acts-first bucket and any negative the acts-last, so a hand-typed value from
 * an older world still reads as a side rather than as nothing. `null` — never
 * rolled — is its own state and deliberately NOT a bucket: the tracker shows
 * the roll button there, which is what invites the save. */
export const initiativeBucket = (initiative) => {
  if (!Number.isFinite(initiative)) return null;
  if (initiative > 0) return "first";
  if (initiative < 0) return "last";
  return "enemies";
};

/**
 * @extends Combat
 */
export class CairnCombat extends Combat {
  /**
   * Roll Cairn's DEX saves in one pass — an OVERRIDE, not a super-then-patch.
   *
   * Core's shape is kept deliberately (documents/combat.mjs:384-435): the same
   * `isOwner` skip (a player rolls their own save), ONE batched
   * `updateEmbeddedDocuments` with `turnEvents: false` and the `updateTurn`
   * option honoured, one sound for the whole set. What changes is what the
   * numbers mean:
   *
   *  - party side: the save die (getInitiativeRoll — CONFIG.Combat.initiative's
   *    "1d20") against the actor's DEX, → initiative 1 or −1, and the chat card
   *    SAYS SO: "DEX save 8 vs 13 — acts before the enemies", not "rolls for
   *    Initiative". A hidden combatant's card keeps core's GM-whisper.
   *  - enemy side: initiative 0, NO roll and NO card — the enemies don't save,
   *    and a card for a non-roll is noise.
   *
   * A combatant that never rolled stays `null`, which sorts to the BOTTOM
   * (-Infinity in _sortCombatants) — visibly unrolled, distinct from failed.
   * The old `null <= DEX` coercion put exactly those combatants in the
   * acts-first bucket.
   *
   * @override
   */
  async rollInitiative(ids, { formula = null, updateTurn = true, messageMode, messageOptions = {} } = {}) {
    ids = typeof ids === "string" ? [ids] : ids;

    // Reproduce core's still-live rollMode→messageMode compatibility shim
    // (documents/combat.mjs:386-393, {since:14, until:16}). Without it a caller
    // passing the pre-v14 `messageOptions.rollMode: "gmroll"` — which core 14.365
    // still honours with a warning — would have that key merged into messageData
    // (below) where ChatMessage prunes the unknown field, so a whispered save
    // would post PUBLIC with nothing to explain it.
    if ("rollMode" in messageOptions) {
      foundry.utils.logCompatibilityWarning("The rollMode option of Combat#rollInitiative messageOptions is"
        + " deprecated in favor of the `messageMode` option, a string key of CONFIG.ChatMessage.modes",
      { since: 14, until: 16 });
      messageMode = foundry.dice.Roll._mapLegacyRollMode(messageOptions.rollMode);
      delete messageOptions.rollMode;
    }

    const updates = [];
    const messages = [];
    for (const id of ids) {
      const combatant = this.combatants.get(id);
      if (!combatant?.isOwner) continue;

      if (!isPartySide(combatant)) {
        updates.push({ _id: id, initiative: 0 });
        continue;
      }

      // The actor's DEX directly, not getRollData: the save is against the
      // stat, and a missing actor reads 0 — a token with nothing behind it
      // cannot pass a save it has no DEX for.
      const dex = combatant.actor?.system?.abilities?.DEX?.value ?? 0;
      const roll = combatant.getInitiativeRoll(formula);
      await roll.evaluate();
      const pass = roll.total <= dex;
      updates.push({ _id: id, initiative: pass ? 1 : -1 });

      const messageData = foundry.utils.mergeObject({
        speaker: foundry.documents.ChatMessage.implementation.getSpeaker({
          actor: combatant.actor,
          token: combatant.token,
          alias: combatant.name,
        }),
        flavor: game.i18n.format(pass ? "CAIRN.Initiative.Pass" : "CAIRN.Initiative.Fail", {
          name: foundry.utils.escapeHTML(combatant.name),
          total: roll.total,
          dex,
        }),
        flags: { "core.initiativeRoll": true },
      }, messageOptions);
      const chatData = await roll.toMessage(messageData, {
        messageMode: messageMode ?? (combatant.hidden ? "gm" : undefined),
        create: false,
      });
      if (messages.length) chatData.sound = null; // one sound for the set
      messages.push(chatData);
    }
    if (!updates.length) return this;

    const updateOptions = { turnEvents: false };
    if (!updateTurn) updateOptions.combatTurn = this.turn;
    await this.updateEmbeddedDocuments("Combatant", updates, updateOptions);

    if (messages.length) await foundry.documents.ChatMessage.implementation.create(messages);
    return this;
  }

  /**
   * Bucket first (1 > 0 > −1, null to the bottom — core's descending sort,
   * kept verbatim), then the Warden's drag order (`combatSort`, ascending),
   * then core's id tiebreak. An absent flag reads 0, so every existing combat
   * keeps today's order with no migration; the initiative term compares
   * unequal for any cross-bucket pair (and for legacy hand-typed values
   * inside one), so combatSort can never promote a row across a bucket
   * boundary — the comparator itself enforces what the drop handler refuses.
   * @override
   */
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    if (ia !== ib) return ib - ia;
    const sa = a.flags?.["air-bladder"]?.combatSort ?? 0;
    const sb = b.flags?.["air-bladder"]?.combatSort ?? 0;
    return (sa - sb) || (a.id > b.id ? 1 : -1);
  }
}

/* -------------------------------------------- */
/*  The tracker                                 */
/* -------------------------------------------- */

/** The word each bucket's rows carry, and its section divider's label. */
const BUCKET_WORD = {
  first: "CAIRN.Initiative.First",
  enemies: "CAIRN.Initiative.Enemies",
  last: "CAIRN.Initiative.Last",
};
const BUCKET_HEADER = {
  first: "CAIRN.Initiative.ActFirst",
  enemies: "CAIRN.Initiative.EnemiesHeader",
  last: "CAIRN.Initiative.ActLast",
};

/**
 * The tracker that prints words where core prints numbers.
 *
 * Registered as CONFIG.ui.combat (core declares its own default at
 * config.mjs:2930). Only the tracker PART's template is forked — the initiative
 * block becomes a bucket word ("First" / "—" / "Last") plus a thin divider on
 * the first row of each bucket, and the numeric `initiative-input` goes,
 * because 1 / 0 / −1 is an encoding, not information. An UNROLLED party
 * combatant keeps core's roll button in that slot, which is what invites the
 * save. Word on every row AND the dividers (user ruling): a row stays readable
 * even when the list renders mid-roll.
 *
 * Safe to fork the template: the deploy target is pinned to build 14.365, so
 * the copy cannot drift under us.
 */
export class CairnCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
  /** @override */
  static PARTS = {
    ...super.PARTS,
    tracker: {
      template: "systems/air-bladder/templates/sidebar/combat-tracker.html",
      scrollable: [""],
    },
  };

  /** @override */
  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    if (turn.name && combatant.actor?.type !== "character") {
      turn.name = t("monster.name", turn.name);
    }
    // The tracker reads the same name the damage card beneath it reads
    // (2026-08-14, review #14 finding 14 — user ruling). Without this the
    // tracker said "Goblin" while the card said "ataca a Trasgo", same token,
    // same screen. Translated in the CONTEXT rather than swept out of the DOM,
    // because core already hands the name here and a rendered row is the wrong
    // layer to be re-reading.
    //
    // The character gate is the settled 2026-08-04 ruling: a PC's name is
    // player-authored and never localized. A combatant whose name the Warden
    // typed ("Goblin A") simply misses the overlay and `t` hands it straight
    // back, so only the gate needs stating.

    // The bucket is read off the STORED initiative, not re-derived from the
    // side predicate: a value rolled before this build, or hand-set, still
    // lands in a section instead of nowhere.
    turn.bucket = initiativeBucket(combatant.initiative);
    turn.bucketWord = turn.bucket ? game.i18n.localize(BUCKET_WORD[turn.bucket]) : null;
    return turn;
  }

  /** @override */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    // The first visible row of each bucket carries the divider. Unrolled rows
    // (bucket null) get none — they sort to the bottom and their state is the
    // roll button, not a section.
    let prev = null;
    for (const turn of context.turns ?? []) {
      if (turn.bucket && turn.bucket !== prev) {
        turn.bucketHeader = game.i18n.localize(BUCKET_HEADER[turn.bucket]);
      }
      if (turn.bucket) prev = turn.bucket;
    }
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#bindDragReorder();
  }

  /** The combatant id a drag has picked up, between dragstart and drop. */
  #dragId = null;

  /**
   * Warden drag-to-reorder, WITHIN a bucket (ruling 2026-08-08 — see the file
   * header). Drags WRITE and the render re-asserts: enforceTurnOrder re-appends
   * every row in turns order after each render, so a drag that only moved DOM
   * nodes would be un-done on the next one. The drop renumbers the whole
   * bucket in ONE batch — one write, one setupTurns, every client re-sorts —
   * and the indicator classes are cosmetic. Listeners go on the <ol>, which
   * the render rebuilds, so nothing stacks.
   */
  #bindDragReorder() {
    if (!game.user.isGM) return;
    const ol = this.element.querySelector("ol.combat-tracker");
    if (!ol) return;
    const clearMarks = () => {
      for (const el of ol.querySelectorAll(".cairn-drop-above, .cairn-drop-below, .cairn-dragging")) {
        el.classList.remove("cairn-drop-above", "cairn-drop-below", "cairn-dragging");
      }
    };
    ol.addEventListener("dragstart", (ev) => {
      const row = ev.target.closest?.('li.combatant[draggable="true"]');
      if (!row) return;
      this.#dragId = row.dataset.combatantId;
      ev.dataTransfer?.setData("text/plain", this.#dragId);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
      row.classList.add("cairn-dragging");
    });
    ol.addEventListener("dragover", (ev) => {
      if (!this.#dragId) return;
      const row = ev.target.closest?.("li.combatant[data-combatant-id]");
      for (const el of ol.querySelectorAll(".cairn-drop-above, .cairn-drop-below")) {
        el.classList.remove("cairn-drop-above", "cairn-drop-below");
      }
      if (!row || row.dataset.combatantId === this.#dragId) return;
      ev.preventDefault(); // a drop is allowed here; refusal is decided on drop
      const rect = row.getBoundingClientRect();
      const after = ev.clientY > rect.top + rect.height / 2;
      row.classList.add(after ? "cairn-drop-below" : "cairn-drop-above");
    });
    ol.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const sourceId = this.#dragId ?? ev.dataTransfer?.getData("text/plain");
      this.#dragId = null;
      const row = ev.target.closest?.("li.combatant[data-combatant-id]");
      clearMarks();
      if (sourceId && row) this.#onDropReorder(sourceId, row, ev.clientY);
    });
    ol.addEventListener("dragend", () => {
      this.#dragId = null;
      clearMarks();
    });
  }

  /**
   * Resolve a drop: refuse across buckets, renumber the bucket within.
   * @param {String} sourceId   the dragged combatant's id
   * @param {HTMLElement} targetRow  the row the drop landed on
   * @param {Number} clientY    the drop point, for the above/below decision
   */
  async #onDropReorder(sourceId, targetRow, clientY) {
    const combat = this.viewed;
    const source = combat?.combatants.get(sourceId);
    const target = combat?.combatants.get(targetRow.dataset.combatantId);
    if (!source || !target || source === target) return;
    const bucket = initiativeBucket(source.initiative);
    // Cross-bucket refuses — the bucket is the DEX save's outcome, and
    // changing sides is a re-roll, not a drag. An unrolled target (bucket
    // null) refuses the same way: its state is the roll button.
    if (!bucket || initiativeBucket(target.initiative) !== bucket) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.CombatDragBucket"));
      return;
    }
    const rect = targetRow.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    const members = combat.turns.filter(
      (c) => initiativeBucket(c.initiative) === bucket && c.id !== sourceId);
    const idx = members.findIndex((c) => c.id === target.id) + (after ? 1 : 0);
    members.splice(idx, 0, source);
    const updates = members.map((c, i) => ({ _id: c.id, "flags.air-bladder.combatSort": (i + 1) * 10 }));
    const currentId = combat.started ? combat.combatant?.id : null;
    await combat.updateEmbeddedDocuments("Combatant", updates, { turnEvents: false });
    // setupTurns keeps `turn` as a NUMERIC INDEX (combat.mjs:488-503 — it
    // never re-finds the current combatant by id), so a mid-combat reorder
    // can silently hand the turn to whoever now holds that index. Restore it
    // to the combatant whose turn it was; turnEvents: false so the correction
    // fires no phantom start/end-of-turn events. Written only when the
    // pointer actually moved.
    if (currentId && combat.combatant?.id !== currentId) {
      const turn = combat.turns.findIndex((c) => c.id === currentId);
      if (turn >= 0) await combat.update({ turn }, { turnEvents: false });
    }
  }
}

/**
 * Put the tracker's rows back in the order the render meant.
 *
 * Dividers are rebuilt and each row is appended in turns order — `append`
 * MOVES a live node, so walking the list re-sorts it in place without touching
 * row contents or listeners. Idempotent when the DOM is already right.
 */
const enforceTurnOrder = (element, context) => {
  const ol = element?.querySelector("ol.combat-tracker");
  if (!ol || !context?.turns?.length) return;
  for (const stray of ol.querySelectorAll(".cairn-bucket-divider")) stray.remove();
  for (const turn of context.turns) {
    if (turn.bucketHeader) {
      const li = document.createElement("li");
      li.className = "cairn-bucket-divider";
      li.textContent = turn.bucketHeader;
      ol.append(li);
    }
    const row = ol.querySelector(`li.combatant[data-combatant-id="${turn.id}"]`);
    if (row) ol.append(row);
  }
};

/**
 * DICE SO NICE re-sorts the tracker, and this takes the sort back.
 *
 * Found the hard way, so recording the whole shape: after every render, the
 * tracker's DOM held the RIGHT rows with the RIGHT contents in the WRONG order
 * — the previous render's order — with every element lacking a
 * `data-combatant-id` (our dividers) stranded at the top. `_renderHTML`'s
 * produced element was correct on every render (verified by wrapping it), the
 * DOM was mangled one millisecond later, a MutationObserver saw nothing
 * because the damage rode inside the render's own hook chain, and it
 * "reproduced" under core's own CombatTracker — which pointed at core until a
 * stack trap on appendChild named the real author: DSN's `InitiativeMask.apply`,
 * a `renderCombatTracker` hook that re-appends every `li.combatant` (its
 * initiative-suspense feature, keyed on rolls flagged `core.initiativeRoll`,
 * which our save cards honestly carry). Under Cairn the mask is pure damage:
 * there is no number to hide — the row's word IS the outcome — so its shuffle
 * just breaks the bucket sections.
 *
 * REGISTERED AT READY, and that is the whole mechanism: hooks run in
 * registration order, modules register theirs at init, so a ready-registered
 * hook runs after DSN's inside the same `Hooks.callAll` and gets the last
 * word on every render. `_onRender` cannot do this — it runs BEFORE the hook
 * chain, which is where the first attempt at this fix died.
 */
export const registerCombatOrderGuard = () => {
  Hooks.on("renderCombatTracker", (app, element, context) => enforceTurnOrder(element, context));
};
