/**
 * Cairn's turn order, spoken by Foundry's tracker.
 *
 * Cairn has no initiative queue. At the start of combat each party member makes
 * a DEX save: pass and you act before the enemies, fail and you act after.
 * Order inside a bucket is table talk, on purpose — the tracker does not manage
 * it (user ruling 2026-08-08), and the save is rolled once when combat starts,
 * not per round.
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
