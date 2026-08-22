import { SETTINGS_NS } from "../settings.js";
import { grantSourceLabel } from "../utils.js";
import { iconForItem, SPELLBOOK_ICON, SPELLSCROLL_ICON } from "../icons.js";
import { glogEnabled, glogConversionDiff, glogTextCached } from "../glog.js";

/**
 * The stored name of a Fatigue item. ENGLISH, always — Foundry's language setting
 * is per-client, so an item created under the translated name was invisible to
 * every other language: a Spanish player's "Fatiga" did not match the English GM's
 * remove filter, and the − button silently did nothing for them both ways round.
 *
 * Storing it in English also keeps the system's own rule (i18n-content.js): stored
 * documents stay English and translation happens at display. The sheet localizes
 * the label it shows, so nobody actually reads this string.
 */
export const FATIGUE_NAME = "Fatigue";

/**
 * The stored name a scroll created from the Create Item dialog gets when the user
 * types none — ENGLISH, for the same reason as FATIGUE_NAME above, and this is the
 * one place the type list's own label must NOT be reused. That label is localized,
 * and localizing it was right for the <option> and wrong for the name: a Spanish
 * Warden's unnamed scroll was stored as "Pergamino", so the same document read
 * differently to every other client and matched nothing that looks a spellbook up
 * by name (gear resolution, the background-swap identity match, the content
 * overlay's own English keys).
 *
 * Pre-filled at all rather than left blank because core's fallback for an empty
 * name is `defaultName({type})`, and the type here really is "spellbook" — so an
 * unnamed create would otherwise produce a scroll called "Spellbook".
 */
export const SPELLSCROLL_NAME = "Spellscroll";

/**
 * Every spellscroll is petty and single-use — the Warden's rule, and the one thing
 * that separates a scroll from the book of the same spell. So it is derived from
 * the `scroll` flag rather than typed in: the sheet offers no Petty box and no Max
 * uses field for a spellbook, and these values are written whenever the flag is.
 *
 * `uses.value` is deliberately absent: it is set once, on the transition to
 * `scroll: true` (a fresh scroll has its use), and left alone afterwards so
 * marking one spent survives the next save. Forcing it here would silently refill
 * every scroll on every edit.
 */
const SCROLL_PINNED = { weightless: true, equipped: false, "uses.max": 1 };

/** What ticking `scroll` off restores: a book is not petty and has no uses. */
const BOOK_PINNED = { weightless: false, "uses.max": 0, "uses.value": 0 };

/**
 * A page bound into a Grimoire: weightless (the book carries it), never held
 * ready, and NOT a scroll — the transmute converts a scroll into a page, which
 * is the 50gp/6hr conversion the GLOG hack charges for (the cost stays prose;
 * trust players). `scroll: false` is pinned here so the two flags can never
 * both be true, whatever path writes them.
 */
const PAGE_PINNED = {
  weightless: true, equipped: false, scroll: false,
  // A page has no uses: it is the spell recorded permanently in the book, so a
  // transmuted scroll's one-shot counter clears with the scroll flag.
  "uses.max": 0, "uses.value": 0,
};

/**
 * Is an incoming update value an attempt to CLEAR the field rather than set it?
 *
 * Three spellings land in the same place and the guards below must catch all
 * three: `""`, `null` (a StringField casts it back to blank), and v14's
 * `ForcedDeletion` operator — deleting a schema field's key leaves it taking
 * its blank initial. A guard testing only `=== ""` is walked past by the
 * spelling the platform itself now recommends
 * (common/data/operators.mjs:81, the replacement for `-=key: null`).
 * @param {*} value
 * @returns {boolean}
 */
const isClearing = (value) => !value
  || (value instanceof foundry.data.operators.ForcedDeletion);

/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class CairnItem extends Item {
  /**
   * The schema-level art seam: `img`'s field initial consults this
   * (common/documents/item.mjs:50-52) for EVERY route that creates an item
   * without art — including items riding inside an Actor's creation payload,
   * which never reach `_preCreate` (the client preCreates only the
   * operation's top-level documents, client-backend.mjs:103). That gap
   * shipped generated monsters whose attack and armor items wore core's grey
   * item-bag while Regenerate — whose re-roll path goes through
   * createEmbeddedDocuments — stamped the system glyph on the same items
   * (review #9). The _preCreate stamp below remains for what it adds on its
   * routes (the DEFAULT_ICON re-stamp for dialog-created items).
   */
  static getDefaultArtwork(itemData) {
    const type = itemData?.type ?? "item";
    const img = type === "spellbook" && itemData?.system?.scroll
      ? SPELLSCROLL_ICON
      : iconForItem(type, itemData?.name ?? "");
    return { img };
  }

  /**
   * The one-book wall's other half: the BATCH.
   *
   * `_preCreate` above asks `this.parent.items` whether a Grimoire is already
   * there, and for a single create that is the whole question. For a BATCH it is
   * blind by construction — Foundry runs every document's `_preCreate` before
   * inserting any of them (`client-backend.mjs:102-110`, which pushes to
   * `documents` only after each per-document workflow returns), so two Grimoires
   * created in one call each look around, each see zero, and both land. Reachable
   * with no crafting at all: `changeBackground` batches a custom background's
   * whole startingGear in one `createEmbeddedDocuments`, so a background listing
   * two books hands over two.
   *
   * Surplus books are SPLICED OUT rather than the operation refused, because
   * `client-backend.mjs:120` assigns `operation.data = documents` — so dropping
   * the extras leaves the rest of that background's gear to land, where returning
   * false would take the boots and the rope with them. One warning for the batch,
   * not one per book.
   *
   * It also decides WHERE A NEW ROW LANDS — see `#appendSort` below. Both
   * questions need the BATCH rather than the document, which is why they share
   * this seam.
   * @override
   */
  static async _preCreateOperation(documents, operation, user) {
    const allowed = await super._preCreateOperation(documents, operation, user);
    if (allowed === false) return false;

    const parent = operation?.parent;
    if (parent?.type === "character" && CairnItem.#enforceOneBook(documents, parent) === false) {
      return false;
    }
    CairnItem.#appendSort(documents, parent);
  }

  /**
   * Give an arriving item a place at the END of the list rather than the top.
   *
   * A generated loadout arrives ARRANGED — weapons, armor, everything else,
   * light, Rations (gear.js `orderGrantedItems`) — and those payloads carry
   * explicit non-zero sorts, which this leaves alone. Everything ELSE created on
   * an actor arrives at `sort: 0`, the field's initial
   * (common/data/fields.mjs:3974-3983), and 0 is ABOVE every numbered row: with
   * nothing here, buying one thing at the marketplace put it at the top of the
   * pack, over the sword.
   *
   * That was already true before any of the ordering work, which is why this is
   * a fix and not merely its support: the first drag renormalises every sibling
   * to positive values (`performIntegerSort`), and the next new item landed
   * above all of them.
   *
   * `sort` being 0 IS the discriminator. An item deliberately created at 0 is
   * indistinguishable from one that stated nothing, and appending it is harmless.
   *
   * Ungated by `enable-inventory-reorder`: that setting decides whether the
   * sheet READS `sort`, and writing a meaningful one into a world that currently
   * ignores it costs nothing while meaning the order is already right the day a
   * Warden turns it on.
   *
   * Actors only — a world or compendium item has no actor parent, and the
   * sidebar does its own ordering.
   *
   * A BOUND GRIMOIRE PAGE is deliberately left at 0, and it is the one exception
   * worth knowing: a page has no place in the flat list, because
   * `groupPagesUnderBooks` lifts every page out and re-files it under its own
   * book. All that survives is its order relative to its SIBLING pages, and that
   * has always been alphabetical — `_sortItemsForDisplay` falls through to the
   * display name when sorts tie. Numbering pages here would silently change that
   * to the order they were transmuted in, which nobody asked for; there is no
   * unbind path, so a page never re-enters the list needing a position.
   * @param {CairnItem[]} documents  temporary instances, mutated via updateSource
   * @param {Document|null} parent
   */
  static #appendSort(documents, parent) {
    if (parent?.documentName !== "Actor") return;
    let next = parent.items.reduce((max, i) => Math.max(max, i.sort ?? 0), 0);
    for (const doc of documents) {
      if (doc.sort || doc.system?.bound) continue;
      next += CONST.SORT_INTEGER_DENSITY;
      doc.updateSource({ sort: next });
    }
  }

  /**
   * The one-book wall's batch half, split out of `_preCreateOperation` so that
   * method can go on to place sorts for EVERY parent rather than returning early
   * for anything that is not a character.
   * @returns {false|void} false when the splice left nothing to create
   */
  static #enforceOneBook(documents, parent) {
    const isGrimoire = (d) => d?.type === "item" && d?.system?.grimoire;
    // Seeded from the parent for completeness only: a book arriving at a
    // character who already has one was refused one seam up and is not in
    // `documents` to begin with.
    let seen = parent.items.some(isGrimoire);
    const surplus = [];
    for (const doc of documents) {
      if (!isGrimoire(doc)) continue;
      if (seen) surplus.push(doc);
      else seen = true;
    }
    if (!surplus.length) return;
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.GrimoireOnlyOne"));
    for (const doc of surplus) {
      const at = documents.indexOf(doc);
      if (at >= 0) documents.splice(at, 1);
    }
    if (!documents.length) return false;
  }

  /**
   * Hold a spellbook to the scroll invariant at write time, whichever path wrote
   * it: the sheet's Scroll box, generation, a drag-and-drop copy, an importer, or
   * `Actor#createOwnedItem` (which rebuilds `system.weightless` from a top-level
   * field, so it would hand back an un-petty scroll on its own).
   *
   * Written to the document rather than derived in `prepareData`, so the stored
   * data is true — a derived-only petty flag would be a lie to anything reading the
   * document instead of the prepared model, and re-deriving a value that a form
   * also binds is how the HP clobber bug worked.
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    // The one-book wall (2026-08-09 ruling): a CHARACTER carries at most one
    // Grimoire; other books are unrestricted, and so are npcs — an Item Pile
    // holding two recovered grimoires is a pile doing its job. This is the
    // ENFORCEMENT layer behind the drop handler's refusal (the two-layer rule
    // the Fatigue guards set): a stale open dialog, a macro, or a module write
    // all land here whatever the UI showed.
    //
    // This half answers "does the character ALREADY have one". It cannot answer
    // "does this batch contain two" — see `_preCreateOperation` below, which is
    // the only seam that can.
    if (this.type === "item" && this.system.grimoire
        && this.parent?.type === "character"
        && this.parent.items.some((i) => i.type === "item" && i.system?.grimoire)) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.GrimoireOnlyOne"));
      return false;
    }

    // A GRIMOIRE'S IDENTITY (issue #17, 2026-08-16), minted here so every route
    // that makes a book gets one: the Reliquary drag, the Create Item dialog,
    // an importer, a macro, a module. A book MOVING between sheets is a
    // create-then-delete carrying its `system` across, so it arrives holding
    // its key and the pages naming it stay its own.
    //
    // A key already worn by a book on the SAME parent is a DUPLICATE, not a
    // move — nothing is in two places on one actor — and gets a fresh one, or
    // the copy and the original would share one library between them.
    if (this.type === "item" && this.system.grimoire) {
      const key = this.system.grimoireKey;
      const clash = key && this.parent?.items.some((i) =>
        i !== this && i.type === "item" && i.system?.grimoire && i.system.grimoireKey === key);
      if (!key || clash) {
        this.updateSource({ system: { grimoireKey: foundry.utils.randomID() } });
      }
    }

    // A page arriving bound (the travel bundle copies pages between actors)
    // holds its invariant from the first write, same as a scroll does below.
    if (this.type === "spellbook" && this.system.bound) {
      this.updateSource({ system: { ...PAGE_PINNED } });
    }

    // Under GLOG there are no spellbooks (user ruling 2026-08-09) — only
    // Grimoires, their bound pages, and spellscrolls. The flip's world sweep
    // (glog.js) converts what EXISTS; this seam converts what ARRIVES: a
    // compendium drag, the Create Item dialog, an importer, a macro — which is
    // how a post-flip drop of Haste stayed a book. Bound pages are exempt (the
    // travel bundle must land pages as pages, and a page is past the scroll
    // stage). Runs BEFORE the class-art and scroll-pin blocks below so both
    // then see a scroll. `uses.value` is set here rather than left to the pin,
    // whose data-guard would read the BOOK's stored 0 as "a spent scroll
    // carried across" — a converted book always arrives unspent, the same
    // choice _preUpdate makes on the sweep's book→scroll transition.
    if (this.type === "spellbook" && !this.system.scroll && !this.system.bound
        && glogEnabled()) {
      const diff = glogConversionDiff(this, await glogTextCached());
      if (diff) {
        this.updateSource(foundry.utils.expandObject({ ...diff, "system.uses.value": 1 }));
      }
    }

    // Class art for anything created WITHOUT its own image. Foundry's Item schema
    // initialises `img` to `icons/svg/item-bag.svg`, so every item made through the
    // Create Item dialog kept the generic bag: a hand-made weapon, armor, spellbook
    // or scroll looked nothing like the shipped ones. `Actor#createOwnedItem` has
    // always done this for items it mints; the world/dialog path never did.
    //
    // It also unblocked the scroll art. `_preUpdate` only re-arts an item whose
    // image is still ours to change, and a bag was not — so ticking Scroll on a
    // dialog-created spellbook silently left the bag in place.
    if (!this.img || this.img === this.constructor.DEFAULT_ICON) {
      const art = this.type === "spellbook" && this.system.scroll
        ? SPELLSCROLL_ICON
        : iconForItem(this.type, this.name);
      this.updateSource({ img: art });
    }

    if (this.type !== "spellbook" || !this.system.scroll) return;
    const pinned = { ...SCROLL_PINNED };
    // A scroll created straight from the flag arrives UNSPENT — pinning only `max`
    // left `value` at the schema default of 0, so a new scroll rendered as already
    // used up. One created with an explicit count keeps it, which is what lets the
    // spellscroll migration carry a spent scroll across without refilling it.
    if (foundry.utils.getProperty(data ?? {}, "system.uses.value") === undefined) {
      pinned["uses.value"] = 1;
    }
    this.updateSource({ system: pinned });
  }

  /**
   * The same invariant on edit, plus the two transitions. Ticking Scroll makes a
   * fresh scroll (its one use unspent) and unticking restores a book; while the
   * flag merely stays on, `uses.value` is left alone so a spent scroll stays spent.
   *
   * The art follows the flag only when it is still ours to change — a Warden who
   * picked their own image keeps it.
   * @override
   */
  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate(changed, options, user);
    if (allowed === false) return false;

    // A BOOK'S identity is as permanent as a page's binding below, and for a
    // worse reason: clearing `grimoireKey` orphans every page naming it, and
    // there is NO way back — `ensureGrimoireKey` mints a fresh key on next use
    // rather than restoring the old one, so the pages stay pointed at a key no
    // book wears. Stripped rather than refused, the scroll-pin precedent: the
    // rest of the edit lands and the clearing silently does not. The sheet
    // offers no control; only an API write can even try. (Review #15.)
    if (this.type === "item" && this.system.grimoire && this.system.grimoireKey
        && changed.system && "grimoireKey" in changed.system
        && isClearing(changed.system.grimoireKey)) {
      delete changed.system.grimoireKey;
    }

    if (this.type !== "spellbook") return;

    // The OPERATOR spelling, normalized before any guard reads it (review
    // #17): a ForcedDeletion resets a field to its schema initial — false,
    // for these two required booleans — and is a truthy OBJECT, so it walked
    // straight past every equality and truthiness test below: an un-bind the
    // bound guard was built to strip, or a scroll reset that took the
    // BECOMING-scroll branch and pinned scroll uses onto a non-scroll. On a
    // required boolean the operator IS a plain `false` write (and passing it
    // through to the schema draws a "may not be undefined" validation
    // complaint on its way to the same end state — dev:grimoire's console
    // gate caught that), so it is rewritten to one here and the guards below
    // reason about booleans only. The STRING fields (`boundTo`,
    // `grimoireKey`) keep their isClearing guards instead — blank is a legal
    // stored value there, so clearing means something different.
    for (const key of ["bound", "scroll"]) {
      if (changed.system?.[key] instanceof foundry.data.operators.ForcedDeletion) {
        changed.system[key] = false;
      }
    }

    // Binding is FOREVER (2026-08-09 ruling #12): a write clearing `bound` is
    // stripped rather than refused, the scroll-pin precedent — the rest of the
    // edit lands, the un-bind silently does not. The sheet offers no control;
    // only an API write can even try.
    if (this.system.bound && changed.system?.bound === false) {
      delete changed.system.bound;
    }

    // WHICH book is as permanent as the binding: a write CLEARING `boundTo`
    // while one is set is stripped the same way, or a page could be orphaned
    // into the state issue #17 was about — bound, with no book to name. Writing
    // one over a BLANK stays legal, because that is the transmute stamping a
    // page for the first time and the migration stamping a legacy one.
    if (this.system.boundTo && changed.system && "boundTo" in changed.system
        && isClearing(changed.system.boundTo)) {
      delete changed.system.boundTo;
    }

    const scrollChanged = changed.system?.scroll !== undefined;
    if (scrollChanged) {
      // Safe to read as truthiness only because the normalization above has
      // already rewritten a ForcedDeletion to plain `false` — un-normalized,
      // the truthy operator took this branch while resetting the flag.
      const becomingScroll = !!changed.system.scroll;
      foundry.utils.mergeObject(changed, {
        system: becomingScroll ? { ...SCROLL_PINNED, "uses.value": 1 } : BOOK_PINNED,
      });
      // Re-art only while the image is still ours to change — a Warden who picked
      // their own keeps it. The default bag counts as ours: items created before
      // the class-art fill above still carry it, and leaving those on a bag was
      // the whole reported defect.
      const was = becomingScroll ? SPELLBOOK_ICON : SPELLSCROLL_ICON;
      if (this.img === was || this.img === this.constructor.DEFAULT_ICON) {
        changed.img = becomingScroll ? SPELLSCROLL_ICON : SPELLBOOK_ICON;
      }
    } else if (this.system.scroll && changed.system?.bound !== true) {
      // No transition: just hold the invariant for a scroll being edited. The
      // `!== true` term lets the transmute through — becoming a page IS the
      // one legal exit from being a scroll, and PAGE_PINNED below writes the
      // scroll flag off in the same breath. `!== true` rather than the old
      // `!changed.system?.bound`: only a genuine binding write may skip the
      // hold, never merely a truthy value (review #17).
      foundry.utils.mergeObject(changed, { system: SCROLL_PINNED });
    }

    // The page invariant, held on the transition AND on every later edit —
    // merged LAST, over the scroll handling above, so a scroll being transmuted
    // ends weightless whatever BOOK_PINNED said a line earlier. `=== true`,
    // not truthy: only a genuine binding write may dress an item in
    // PAGE_PINNED (review #17).
    if (changed.system?.bound === true || (this.system.bound && changed.system?.bound !== false)) {
      foundry.utils.mergeObject(changed, { system: { ...PAGE_PINNED } });
    }
  }

  /**
   * Augment the basic item data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();
    // Items inside a THING are cargo, never equipped (the drop handler
    // un-equips on the way in; this is what keeps them that way). The test was
    // `actor.type != "container"` until 2026-08-04 — that TYPE was retired
    // 2026-07-31, so the clause compared against a value no actor can hold and
    // was always true: a Warden could re-tick Equipped on armor sitting in a
    // crate and calcArmor counted it. `isThing` is the live rule (role
    // container/transport), the same test every other site migrated to.
    // A spellscroll is read once and consumed, never held ready, so it is the one
    // spellbook that cannot be equipped. A bound page is the other: the BOOK is
    // what the character holds, and its pages are not separately to hand.
    this.system.isEquipable =
      ["weapon", "armor", "spellbook"].includes(this.type) &&
      !this.system.scroll &&
      !this.system.bound &&
      !this.actor?.isThing;
    this.system.hasPlusMinus = (this.system.uses?.max ?? 0) > 0;
    if (this.system.uses) {
      if (this.system.uses.value > this.system.uses.max)
        this.system.uses.value = this.system.uses.max;
    }
    this.system.isFatigue = this.name === FATIGUE_NAME;

    // Grant-source chip (Background / Bond / Question) shown beside the item's
    // other tags, so the three sources are distinguishable. Starting gear and
    // bought items get none. The source rides on the item as
    // flags.air-bladder.grantSource ("background" / "bond:<id>" / "question:<i>"),
    // set at generation; the re-roll/replacement machinery keys off it, so the
    // display-only "show-grant-tags" setting never affects the flag itself.
    // A container that a background/question rolled, but recorded as a plain
    // (weightless) inventory item because the Containers tab is off. It keeps its
    // grantSource for the re-roll machinery, so the "Container" tag rides on a
    // separate flag and takes precedence over the source label. That flag also
    // suppresses the "Petty" (weightless) chip in the inventory row — a cart isn't
    // a petty item, it just isn't tracked as cargo when the feature is off.
    const grantSource = this.getFlag("air-bladder", "grantSource");
    const isContainerItem = !!this.getFlag("air-bladder", "containerItem");
    this.system.isContainerItem = isContainerItem;
    // The UNGATED label first — the mapping alone, no setting. The printed
    // sheet shows the tag under its OWN switch (show-grant-tags-print), so
    // it reads this raw value; the sheet's display gate is applied one
    // statement below. Fold the two back together and the print silently
    // couples to the inventory switch (the probe's inv-off leg is the
    // witness).
    this.system.grantLabelRaw = isContainerItem
      ? game.i18n.localize("CAIRN.GrantContainer")
      : grantSourceLabel(grantSource);
    this.system.grantLabel = game.settings.get(SETTINGS_NS, "show-grant-tags")
      ? this.system.grantLabelRaw : "";

    this.system.useItemIcons = game.settings.get(SETTINGS_NS, "use-item-icons");
    if (this.system.useItemIcons) {
      this.system.icon = "";
      switch (this.type) {
        case "spellbook":
          this.system.icon = this.system.scroll ? "scroll" : "book";
          break;
        case "weapon":
          this.system.icon = "sword";
          break;
        case "armor":
          this.system.icon = "shield";
          break;
        case "item":
          if (this.name === FATIGUE_NAME) {
            this.system.icon = "weight-hanging";
          }
          break;
      }
    }
    // Quantity fallback
    if (this.system.quantity == undefined) {
      this.system.quantity = 1;
    }
  }
}
