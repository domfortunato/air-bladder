/**
 * System data models — the replacement for `template.json`.
 *
 * Foundry 14 deprecated `template.json` and REMOVES it in V16 (the server already
 * files a `packages.warnings` entry, so every installed user sees a warning badge
 * on the Setup screen today). Sub-types are now declared in `system.json` under
 * `documentTypes`, and their shape lives here as `TypeDataModel` subclasses
 * registered on `CONFIG.Actor.dataModels` / `CONFIG.Item.dataModels` at `init`.
 *
 * Two things to know before editing a schema here:
 *
 * 1. **A schema is strict.** A field that is written but not declared is dropped
 *    on the next write, silently — no error, no console warning. That is the only
 *    real hazard in this file. `tools/dev/field-audit.mjs` diffs every persisted
 *    `system.*` path (sheet `name=`/`target=` bindings plus `update()`/`create()`
 *    literals in `module/`) against these schemas; run it after any change here.
 *
 * 2. **Derived values are NOT declared and must not be.** `prepareData` assigns
 *    around thirty computed properties onto `this.system` (`slotsUsed`, `encumbered`,
 *    `armor`, `coinsPerSlot`, `containerObjects`, …). Assigning a non-schema property
 *    onto a DataModel instance is the documented Foundry pattern; `toObject()`
 *    serialises schema fields only, so derived values correctly never persist.
 *    Declaring one would turn it into stored state and reintroduce the
 *    stored-vs-derived collision that cost us the Hit Protection data-loss bug.
 */

import { containerClassRole } from "./icons.js";

const fields = foundry.data.fields;

/**
 * The one discriminator on the non-player model (see docs/npc-roles-plan.md).
 * Replaces `forHire` (gated the day rate) and `inanimate` (hid the stat block):
 * two independent booleans could say "for-hire inanimate chest"; one role field
 * cannot express nonsense. Order here is the sheet's pick-list order.
 *
 * **`hireling` was the sixth and is GONE (2026-08-01).** Being for hire is not a
 * different KIND of person, it is a fact about one — which is why the two roles
 * shared a sheet, a stat block, a generator and a career table, and differed only
 * in whether one row rendered. It comes back as `forHire`, a boolean beside the
 * day rate it gates, and the enum keeps its promise that a role says what
 * something IS. Every stored "hireling" is converted by `migrateData` below on
 * read and by the world migration in cairn.js on write; the `hireling` TYPE stays
 * registered (ids are immutable) but is hidden from Create Actor.
 *
 * **`mount` EVOLVED into `companion` (2026-08-08, user ruling).** The role was
 * never really about riding — the generator already mapped every one-off
 * granted beast to it — and the canon backgrounds grant companions nobody
 * rides (Fletchwind's falcon, Half Witch's raven). Same retirement machinery
 * as hireling's: `migrateData` converts stored "mount" on read, the world
 * migration in cairn.js restamps on write, and the pack YAML was rewritten by
 * its importer in the same commit.
 */
export const NPC_ROLES = ["npc", "monster", "companion", "transport", "container"];

/** Roles that hide the stat block — what `inanimate` used to mean. */
export const THING_ROLES = ["transport", "container"];

/* `KEEPER_ROLES` stood here and is GONE (2026-08-01, the flat graph). It listed
   the roles allowed to keep connections, and the flat rule leaves none: keeping
   is decided by TYPE — only a character keeps — so `CairnActor#canKeepConnected`
   states it in one line and no table is needed. The list had already shrunk to a
   single entry when the hireling role folded into npc, which is usually a rule
   asking to be written down as itself. */

/**
 * Derive a role for a document minted before `role` existed, from what it
 * already stores. The mapping is the one settled in docs/npc-roles-plan.md;
 * "everything else" is deliberately `npc`, which means a pre-roles monster
 * IMPORTED into a world derives npc (nothing stored distinguishes it) — the
 * shipped pack sources carry `role: monster` explicitly instead.
 */
export const deriveNpcRole = (src = {}) => {
  // `forHire` is deliberately NOT consulted. It used to come first and return
  // "hireling", outranking everything below — a real precedence between two
  // distinct answers. Since the collapse its answer would be "npc", which is
  // also the fallthrough, so the early return could no longer decide anything;
  // all it could do was MASK a live `inanimate` signal and quietly turn a
  // pre-roles cart into a person. (Caught by the migration probe, once its
  // legacy document was planted realistically enough to carry both keys.)
  // Being for hire is its own stored field now and needs nothing derived.
  const clsRole = containerClassRole(src.containerClass ?? "");
  if (src.inanimate === true) return clsRole === "transport" ? "transport" : "container";
  if (clsRole === "companion") return "companion";
  return "npc";
};

/* -------------------------------------------- */
/*  Field helpers                                */
/* -------------------------------------------- */

const str = (initial = "") => new fields.StringField({ required: true, blank: true, initial });
const html = (initial = "") => new fields.HTMLField({ required: true, blank: true, initial });
const bool = (initial = false) => new fields.BooleanField({ required: true, initial });

/** A whole-number counter. */
const int = (initial = 0, opts = {}) =>
  new fields.NumberField({ required: true, integer: true, nullable: false, initial, ...opts });

/** Money and prices — not forced to integers, so homebrew fractions cannot fail validation. */
const money = (initial = 0) => new fields.NumberField({ required: true, nullable: false, initial });

/** An optional whole number whose absence is meaningful (null = "auto"/unset). */
const optInt = () =>
  new fields.NumberField({ required: false, integer: true, nullable: true, initial: null });

const strList = () => new fields.ArrayField(new fields.StringField(), { required: true, initial: [] });

/**
 * The eight 2e descriptive traits (Physique … Vice), one pick-list each on the
 * sheet's Description tab, drawn from the tables-2e tables. Factored out of
 * CharacterData when role-npc PEOPLE got the same biography block (2026-08-01),
 * so the two schemas cannot drift a key apart — the sheet binds
 * `system.traits.<key>` from ONE list of keys either way.
 */
const traits = () => new fields.SchemaField({
  physique: str(),
  skin: str(),
  hair: str(),
  face: str(),
  speech: str(),
  clothing: str(),
  virtue: str(),
  vice: str(),
});

/**
 * A list of records whose interior shape varies by content and is not worth
 * pinning: bonds, questions, features, a background's starting gear and its two
 * d6 tables. ObjectField preserves whatever the generator and the importers put
 * there; over-specifying these is how fields go missing.
 */
const objList = () => new fields.ArrayField(new fields.ObjectField(), { required: true, initial: [] });

const valueMax = (initial) => new fields.SchemaField({
  value: int(initial),
  max: int(initial),
});

/* -------------------------------------------- */
/*  Shared partials (were template.json "templates")  */
/* -------------------------------------------- */

/** Hit Protection and the three abilities — every actor that can be hurt. */
const vitals = () => ({
  hp: valueMax(6),
  abilities: new fields.SchemaField({
    STR: valueMax(10),
    DEX: valueMax(10),
    WIL: valueMax(10),
  }),
});

/**
 * Slot capacity OVERRIDE, as a plain number: 0 means "use the Warden's
 * max-equip-slots setting". Read by `CairnActor#calcCurrentMaxSlots`.
 *
 * One shape for all four actor types, settled 2026-07-28. It used to be a plain
 * number on character/hireling (the equipment-limit dialog) and `{value: N}` on
 * npc/container (capacity) — the same name carrying two shapes, which is why
 * `template.json` declaring a bare Number left `calcCurrentMaxSlots` reading
 * `.value` off it and NPCs could not hold anything at all. A plain number also
 * makes minting a container from a bought transport a straight copy, since
 * `Item.transport.slots` is a plain number too.
 */
const capacity = () => int(0);

/** Coins. Every actor type can hold them, and they weigh the same everywhere. */
const purse = () => money(0);

/* -------------------------------------------- */
/*  Shape coercion                               */
/* -------------------------------------------- */

/**
 * Base class carrying the one migration this move needs.
 *
 * `slots` and `cost` were both written as `{value: N}` in places and as a bare
 * number in others — `slots` by the container/npc path, `cost` by every item
 * sheet's `name="system.cost.value"` input, which silently turned a price into an
 * object the marketplace then read as NaN. Both are plain numbers now, so a
 * document minted by an earlier version arrives with the wrong shape and fails
 * validation outright ("slots: must be a number") rather than failing quietly.
 *
 * This is deliberately NOT a general legacy-world migration story — there are no
 * worlds to migrate. It is input coercion for two fields whose shape changed in
 * this same commit, which is exactly what `migrateData` is for.
 */
class CairnDataModel extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    for (const key of ["slots", "cost"]) {
      const v = source?.[key];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const n = Number(v.value);
        source[key] = Number.isFinite(n) ? n : 0;
      }
    }
    return super.migrateData(source);
  }
}

/* -------------------------------------------- */
/*  Actors                                       */
/* -------------------------------------------- */

class CharacterData extends CairnDataModel {
  static defineSchema() {
    return {
      ...vitals(),
      contentSource: str("2e"),
      // OFF by default since 2026-08-02 (user ask): a sheet opens quiet, with
      // no per-field dice, and the header toggle is the way in. A schema
      // initial is retroactive — any actor that never stored the flag reads
      // it — which is the intent here, and every shipped pack actor already
      // pins its own value. The generators run regardless (the flag gates
      // only what the SHEET renders) and their creations land Off.
      generationEnabled: bool(),
      failedCareer: str(),
      backgroundUuid: str(),
      background: str(),
      bonds: objList(),
      age: str(),
      traits: traits(),
      biography: html(),
      // The Description tab's free prose and the Notes tab's editor. Both are
      // ProseMirror targets on character-sheet.html and were never declared in
      // template.json — a strict schema would have dropped a player's notes on
      // the next sheet submit.
      description: html(),
      notes: html(),
      questions: objList(),
      pronouns: str(),
      omenEnabled: bool(),
      omen: str(),
      scarEnabled: bool(),
      scars: strList(),
      deprived: bool(),
      panicked: bool(),
      critical: bool(),
      armorOverride: optInt(),
      gold: purse(),
      slots: capacity(),
      features: objList(),
      // NO `connectedTo` / `formerlyBelongedTo` HERE, and do not re-add them.
      // **A PC is never kept** (settled 2026-07-31, superseding Round 2's PC→PC
      // party-roster reading): a character KEEPS npcs, hirelings, mounts,
      // transports and containers, and is the top of every chain. Round 2 had
      // added `connectedTo` here so a character could be a connection TARGET —
      // and it was load-bearing for exactly that, since schema cleaning drops
      // an update to a field the model does not declare, silently. Its absence
      // is now the same wall in reverse: with no field to write, "keep a PC" is
      // unrepresentable rather than merely refused. Verified before removal
      // that no character in the dev world stored either value.
    };
  }
}

/**
 * One model for every non-player actor. The `hireling` type was folded into this
 * one: a hireling was only ever an NPC you were paying, so it carried a parallel
 * schema and a parallel sheet for the sake of three fields. `profession` and
 * `dayRate` now live here, the day rate showing only when `role: npc` and
 * `forHire` is set (the `hireling` ROLE was retired 2026-08-01 and `migrateData`
 * converts it away; the gate is `role === "npc" && forHire === true`, actor.js:638).
 * `hireling` is NOT migrated away -- it stays registered as an alias of this
 * model (see ACTOR_DATA_MODELS below for why a real retirement would cost every
 * existing hireling its document id); an alias-typed document reads as role
 * hireling regardless of its stored role (CairnActor#npcRole).
 *
 * The union is deliberate rather than minimal: the 205 shipped monsters are `npc`
 * documents and 204 of them carry `system.description`, so the merged sheet keeps
 * the Description tab a hireling sheet never had. Dropping it would have made
 * every monster's text unreachable without a single error to show for it.
 */
class NpcData extends CairnDataModel {
  static defineSchema() {
    return {
      ...vitals(),
      background: str(),
      description: html(),
      biography: html(),
      notes: html(),
      // Nullable because 202 of the 205 shipped monsters store null. An authored
      // value DOES reach the sheet: `_prepareCharacterData` uses it as a FLOOR the
      // equipped-gear sum cannot go below (actor.js:696-702, the review #9 fix),
      // with an override still beating both. (This comment once said a
      // `_prepareNpcData` clobbered it every prepare so an authored value never
      // showed — false, and doubly so since that method was deleted 2026-07-31.)
      armor: optInt(),
      gold: purse(),
      slots: capacity(),
      features: objList(),
      // --- folded in from the retired `hireling` type ---
      // OFF by default since 2026-08-02, same reasoning as CharacterData's.
      generationEnabled: bool(),
      // Labelled "Career" on the sheet; the stored key stays `profession` so
      // migrated hirelings keep their value without a rename pass.
      profession: str(),
      dayRate: money(0),
      // Is this person available to hire? The retired `hireling` ROLE, demoted to
      // the boolean it always was — see NPC_ROLES. Initially TRUE, which is the
      // asked-for default and also what makes the collapse lossless: a world
      // whose hirelings had `forHire` deleted by the 2026-07-31 role migration
      // reads the initial and lands back where it started.
      //
      // It gates the day-rate row (with role npc), nothing else. It is NOT the
      // pre-roles `forHire`: that one also decided the ROLE, which is exactly the
      // overloading the roles work took apart, and `deriveNpcRole` is the only
      // thing that still reads it that way — on a pre-roles source, once.
      forHire: bool(true),
      // --- a person is a person (2026-08-01) ---------------------------------
      // An npc with role `npc` is an innkeeper, a rival captain, a hired guard —
      // and the PC sheet gives a person pronouns, an age, eight descriptive
      // traits and scars, while this model gave them none of that, purely
      // because the sheet grew out of the old hireling sheet. These close the
      // gap. Only role npc ever SHOWS them (the sheet's showBiography gate);
      // they live on the shared model because a schema cannot vary by role, and
      // an unread "" on a crate costs nothing. `faction` is the one field a PC
      // has no counterpart of: whose interests this person serves. All plain
      // text, deliberately — an HTMLField would need declaring in system.json's
      // htmlFields or it ships as an XSS hole (see CLAUDE.md, Testing).
      faction: str(),
      pronouns: str(),
      age: str(),
      traits: traits(),
      scarEnabled: bool(),
      scars: strList(),
      // What this actor IS to the party — the one discriminator (NPC_ROLES
      // above). Replaces `forHire` and `inanimate`, both of which migrateData
      // below still reads so pre-roles documents derive the right value.
      role: new fields.StringField({ required: true, blank: false, initial: "npc", choices: NPC_ROLES }),
      deprived: bool(),
      panicked: bool(),
      critical: bool(),
      armorOverride: optInt(),
      /* --- containers-as-NPCs (see docs/npc-roles-plan.md) --------------------
         There is no separate "container" any more: an NPC that has `slots` and a
         `connectedTo` IS one. The trigger was the Outrider's horses, which carry
         "8 HP, 1 Armor, hooves (d10+d10)" as PROSE in their description because
         ContainerData has nowhere to put any of it -- a warhorse the party rides
         into a fight could not be hit, because of a type choice rather than a
         rules one. NpcData was already a near-superset (it had `slots`, and the
         keeper side of the link), so folding the two is the same move that
         folded Hireling into NPC, for the same reason. The `container` type
         itself was retired on 2026-07-31 — see the note where ContainerData
         used to be. */

      // uuid of the Actor this one is connected to; blank means connected to
      // nobody, which is exactly what a loot pile is. Named `connectedTo` rather
      // than "owner" or "keeper" deliberately: a horse is not owned by its rider
      // in any sense the sheet should assert, and `keeper` existed only to dodge
      // a Foundry collision on `owner`.
      connectedTo: str(),

      // `inanimate` used to live here (hid the stat block; a schema boolean
      // modelled on SpellbookData's `scroll`). Its job moved into `role` —
      // THING_ROLES hide the block — and migrateData still reads it off old
      // documents. Do not re-add it.

      // The KIND (labelled "Type" on the sheet since 2026-08-02): what this
      // thing is ("sack", "cart", "horse", or anything a Warden types) when
      // someone has said so explicitly; BLANK MEANS INFER from the name. A
      // known class drives the one-word label and the default slot count, and
      // a kind CHANGE stamps default art only while the current art is stock
      // (CairnActor._preUpdate) — art picks never write this field back (the
      // 2026-08-02 decoupling). The FIELD stays a free `str()` with no
      // `choices` even though the sheet offers a strict role-scoped select:
      // legacy tolerance is the point — a Warden's own word (behind the
      // select's "Other…") is a legal Kind and must load forever. The
      // inference is a list of ENGLISH keywords (icons.js containerClass), so
      // the select is also the only way a Warden working in another language
      // can say "this is a backpack". See docs/npc-roles-plan.md.
      containerClass: str(),

      // Purchase price. Needed because mounts and vehicles become Actors stocked
      // in the shop, and NpcData had only `gold` (what it CARRIES), never what it
      // COSTS.
      cost: money(0),

      // Who this used to be connected to, snapshotted as a STRING at unlink time
      // rather than derived from `connectedTo`. Deliberate: the commonest way a
      // loot pile comes into existence is the character dying and being deleted,
      // which is exactly when a uuid resolves to nothing. A name is the only form
      // of this fact that survives the event that creates the need for it.
      formerlyBelongedTo: str(),
    };
  }

  /**
   * Documents minted before `role` existed carry `forHire`/`inanimate` instead;
   * derive on every load, so packs and old worlds read correctly without being
   * written. The one-time world migration (cairn.js) persists the value and
   * deletes the two retired keys; until it runs, this shim is the truth.
   *
   * **`migrateData` RUNS ON UPDATE DIFFS, not only on whole sources.** Measured
   * against 14.365: `NpcData.migrateData({containerClass: "pile"})` comes back
   * `{containerClass: "pile", role: "npc"}`, and that injected key lands in the
   * write. So a condition of the shape "field X is absent" is not a statement
   * about the document — in a diff, everything the caller did not touch is
   * absent.
   *
   * That bit, and this is the fix (2026-07-31, found by rewriting
   * `dev:item-pile` onto the Kind control). The guard used to include
   * `|| source.containerClass`, so ANY update touching the Kind and not also
   * naming the role re-derived one — and `deriveNpcRole` reads `inanimate`,
   * which a modern document does not have, so it answered "npc". Setting a
   * crate's Kind demoted it to a plain NPC: stat block back, gold counter
   * back, capacity rules gone. The art picker did it too (`_setContainerArt`
   * writes `{"system.containerClass": cls}` and nothing else), so choosing a
   * barrel picture for a barrel silently un-made it. The sheet's own submit was
   * the one path that was safe, because the role `<select>` rides along in it —
   * which is exactly why this survived: every manual test went through the sheet.
   *
   * The guard now demands a RETIRED key — `inanimate`, and only it. `forHire`
   * was named here too until 2026-08-02, on the same "written by nothing any
   * more" reasoning, which stopped being true the day the hireling role
   * collapsed and gave it back to the sheet. See the guard itself for what
   * that cost. `inanimate` is written by nothing modern, so its presence is
   * unambiguous evidence of a whole pre-roles source rather than a diff. What
   * that gives up is a pre-roles
   * document that stored a `containerClass` and NEITHER flag, which would have
   * derived `mount` for a mount class; it takes the schema initial instead. The
   * shipped packs all state their role outright, and the world migration
   * selects on type + legacy keys + dayRate, never on this.
   */
  static migrateData(source) {
    // The funeralwagon Kind retirement (2026-08-02), FIRST — before anything
    // derives from containerClass. Same literal-value guard as the hireling
    // shim below, for the same reason: this runs on update diffs too, where
    // absence says nothing, but a literal "funeralwagon" is unambiguous
    // whichever it is, and converting an attempted write is right for one too.
    // The class's 6-slot default is not lost by this: every stored consumer
    // (the Burial Wagon pack doc) states slots outright, and the Bonekeeper
    // grant's spec.slots wins regardless.
    if (source && source.containerClass === "funeralwagon") source.containerClass = "wagon";
    // The hireling-role collapse (2026-08-01), and it MUST ship in the same
    // commit as the shrunk NPC_ROLES: `migrateData` runs BEFORE choices
    // validation (common/data/fields.mjs:234 via common/abstract/data.mjs:77-81),
    // so this is what stops every stored "hireling" failing the enum on load.
    //
    // Guarded on the LITERAL value, never on absence — the docblock above is the
    // whole reason: this also runs on update diffs, where "absent" says nothing.
    // A literal `role: "hireling"` is unambiguous whichever it is, and converting
    // an attempted write is the right answer for one too.
    if (source && source.role === "hireling") {
      source.role = "npc";
      // Only when nothing has said otherwise. The role WAS the statement "for
      // hire", so this is a rename, not an assumption — but an explicit false
      // arriving alongside it is a caller who means it.
      if (source.forHire === undefined) source.forHire = true;
    }
    // The mount→companion evolution (2026-08-08), same shape and same
    // constraints as the hireling shim above: it MUST ship in the commit that
    // renames the enum entry (migrateData runs BEFORE choices validation, so
    // this is what stops every stored "mount" failing the enum on load), and
    // it is guarded on the LITERAL value because this also runs on update
    // diffs, where absence says nothing. A pure rename — nothing else about
    // the document changes meaning.
    if (source && source.role === "mount") source.role = "companion";
    // Armed on `inanimate` ALONE. It used to accept `forHire` beside it, and
    // that was correct for exactly one day: `forHire` came BACK as a live,
    // sheet-written field on 2026-08-01 when the hireling role collapsed, and
    // this guard was never re-aimed. So `mount.update({"system.forHire": false})`
    // — a diff with no `role` in it — fired the derivation, `deriveNpcRole` saw
    // no `inanimate`, and the mount came back a PERSON: stat block returned,
    // gold counter returned, capacity rules gone. Observed live (review #7);
    // in-repo writers escaped only by accident, because a full sheet submit
    // carries the role `<select>` along with it.
    //
    // Dropping the arm loses nothing. Every whole pre-roles source stores BOTH
    // booleans (both were `required` on the old models), and a source carrying
    // only `forHire` derived "npc" — which is the schema initial it takes
    // anyway when nothing derives.
    if (source && source.role === undefined && source.inanimate !== undefined) {
      source.role = deriveNpcRole(source);
    }
    return super.migrateData(source);
  }
}

/* ContainerData is gone, and with it the `container` TYPE (2026-07-31). It was
   the pre-roles model — a slots-and-`keeper` document with its own sheet — and
   it was kept registered after the fold on the stated condition "while any world
   still holds one". No world does: the built migration converted the dev world's
   containers to npc before it was removed, and :30001 is a fresh branch install.
   What kept it alive was therefore nothing, while the create dialog went on
   OFFERING it — Foundry lists every registered subtype and there is no manifest
   flag to hide one — so the Warden's own Create Actor button still minted
   documents against the retired model, complete with the retired sheet's
   `transportKind` pick-list and no Connections tab.

   `keeper`, `transportKind` and `load` lived ONLY here and went with it; so did
   the owner-side `containers` uuid array on CharacterData/NpcData, the other
   half of the same two-way link (see CairnActor#connectedActors, which had
   promised exactly that: "that half goes away with `keeper` itself").
   `transportKind` survives on the `transport` ITEM type, which is a separate
   retirement — see docs/npc-roles-plan.md.

   HirelingData is gone the other way — folded into NpcData above, which the
   `hireling` type still points at (see ACTOR_DATA_MODELS). That one IS an alias
   and stays: it validates against the merged schema unchanged. */

/* -------------------------------------------- */
/*  Items                                        */
/* -------------------------------------------- */

/** Every carryable thing. */
const universal = () => ({
  description: html(),
  weightless: bool(),
  equipped: bool(),
  bulky: bool(),
  cost: money(0),
  quantity: int(1),
});

const withDamage = () => ({
  damageFormula: str(),
  criticalDamage: html(),
  blast: bool(),
});

const consumable = () => ({
  uses: new fields.SchemaField({ value: int(0), max: int(0) }),
});

/**
 * Relic fields (Cairn 2e Reliquary).
 *
 * A relic is NOT a type. Every relic is also an ordinary thing — a stone, a
 * sword, a helm, a pair of shoes — and the reliquary proves it: three relics
 * carry weapon damage and three grant +1 Armor. A `relic` type would have to
 * re-implement damage rolling, armor summing and equip behaviour for those six,
 * and could not represent a helm whose horns are a weapon at all. As a flag they
 * keep everything, and `iconForItem` gives a relic sword the sword art free.
 *
 * `recharge` is the whole of the "uses vs charges" distinction. Across all 46
 * shipped relics the equivalence is EXACT: every "N charges" relic states a
 * Recharge condition, every "N uses" relic does not, and none carries both. So
 * both land in the existing `uses` counter and the sheet relabels it "Charges"
 * when `recharge` is filled. A relic that can never be recharged simply leaves it
 * empty; one with no counter at all leaves `uses.max` at 0.
 *
 * NOTE `relic` had a previous life: it was a boolean in the inherited 1e
 * template.json, verified dead and stripped from 381 pack files during the
 * TypeDataModel migration. Reusing the name is deliberate — a residual
 * `relic: false` on an old document already means exactly what it says.
 */
const relicFields = () => ({
  relic: bool(),
  recharge: html(),
});

class ItemData extends CairnDataModel {
  static defineSchema() {
    return {
      ...universal(),
      ...withDamage(),
      ...consumable(),
      ...relicFields(),
      // Declared because `calcArmor()` deliberately sums armor over BOTH `armor`
      // and `item` types, and items-list.html renders the tag. No shipped item
      // carries a non-zero value, but a Warden's homebrew amulet can.
      armor: optInt(),
    };
  }
}

class WeaponData extends CairnDataModel {
  static defineSchema() {
    return { ...universal(), ...withDamage(), ...consumable(), ...relicFields() };
  }
}

class ArmorData extends CairnDataModel {
  static defineSchema() {
    return { ...universal(), ...consumable(), ...relicFields(), armor: int(1) };
  }
}

/**
 * A spellbook, and — with `scroll` ticked — a spellscroll.
 *
 * A scroll is NOT a type, for the same reason a relic is not (see relicFields
 * above), only more so: given the rule that every spellscroll is petty and
 * single-use, a scroll carries no data a spellbook does not. It is a spellbook
 * with two values pinned, and its text IS the spell's text. A `spellscroll` type
 * would duplicate this model and its sheet to express that, and because Foundry
 * treats a document's `type` as immutable, a book could never become a scroll.
 *
 * `uses` exists ONLY to serve the scroll case — a book has no uses — which is why
 * the sheet shows the counter only when `scroll` is ticked. The invariant itself
 * (petty, max 1 use, not equippable) is enforced on the document in
 * `CairnItem._preCreate`/`_preUpdate`, not here, so that EVERY path agrees: the
 * sheet checkbox, generation, a drag-and-drop copy, and `createOwnedItem` (which
 * rewrites `system.weightless` from a top-level field and would otherwise quietly
 * un-petty a scroll).
 *
 * `uses.value` stays free so a player can mark a scroll spent; only `max` is
 * pinned.
 */
class SpellbookData extends CairnDataModel {
  static defineSchema() {
    return { ...universal(), ...consumable(), scroll: bool() };
  }
}

class ObjectData extends CairnDataModel {
  static defineSchema() {
    return { ...universal(), ...consumable(), ...relicFields() };
  }
}

/**
 * A 2e background. Mirrors Kettlewright's content-library schema, which is why
 * `startingGear`, `containers` and `tables` are free-form records rather than
 * pinned sub-schemas — they round-trip that source verbatim.
 */
class BackgroundData extends CairnDataModel {
  static defineSchema() {
    return {
      source: str("2e"),
      archetype: str(),
      description: html(),
      names: strList(),
      startingGear: objList(),
      containers: objList(),
      tables: objList(),
      // "This background grants a second bond." A real field, because the shipped 2e
      // backgrounds express it in PROSE — Fieldwarden's description says "roll a
      // second time on the bonds table" and `mentionsSecondBond` regexes for that
      // sentence. A custom background cannot rely on matching an English sentence,
      // so authors get a checkbox. Both are honoured, and counted as ONE extra
      // rather than summed, so ticking the box on a background that also says the
      // sentence does not hand out three bonds.
      secondBond: bool(),
      // The NAME of a RollTable this background draws its bonds from; empty means the
      // shipped 2e Bonds table. A name, not a uuid, so a shared background still
      // resolves in the recipient's world — the same portability rule the by-name gear
      // references follow. Such a table is narrative-only; see drawBond.
      bondsTable: str(),
    };
  }
}

/** A wagon, cart, mule or backpack — capacity that becomes a container Actor when owned. */
class TransportData extends CairnDataModel {
  static defineSchema() {
    return {
      ...universal(),
      transportKind: str("worn"),
      slots: int(0),
      load: int(0),
      slow: bool(),
    };
  }
}

/* -------------------------------------------- */

export const ACTOR_DATA_MODELS = {
  character: CharacterData,
  npc: NpcData,
  // `hireling` is an ALIAS of npc: same schema, same sheet, same behaviour. A
  // hireling was only ever an NPC you were paying.
  //
  // Deliberately an alias rather than a deletion, and the difference from the
  // `container` retirement above is the whole reason: Foundry treats a
  // document's `type` as immutable, so retiring this one would mean recreating
  // every existing hireling as a new document — new ids, and therefore broken
  // scene token links and broken `connectedTo` uuids. A container had no such
  // population left to protect; a hireling does, and unlike `container` this
  // type is not a retired MODEL — it points at the live one and behaves
  // identically, so nothing is offered that should not be. Pointing the type at
  // this model costs one line, needs no migration, and leaves nothing
  // orphaned. The only difference that remains is at CREATION
  // (a hireling rolls a random portrait); once made, the two are the same thing.
  hireling: NpcData,
};

export const ITEM_DATA_MODELS = {
  item: ItemData,
  weapon: WeaponData,
  armor: ArmorData,
  spellbook: SpellbookData,
  object: ObjectData,
  background: BackgroundData,
  transport: TransportData,
};
