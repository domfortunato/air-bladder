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

const fields = foundry.data.fields;

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
      generationEnabled: bool(true),
      failedCareer: str(),
      backgroundUuid: str(),
      background: str(),
      bonds: objList(),
      age: str(),
      traits: new fields.SchemaField({
        physique: str(),
        skin: str(),
        hair: str(),
        face: str(),
        speech: str(),
        clothing: str(),
        virtue: str(),
        vice: str(),
      }),
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
      // uuids of container Actors, not embedded records.
      containers: strList(),
      features: objList(),
    };
  }
}

/**
 * One model for every non-player actor. The `hireling` type was folded into this
 * one: a hireling was only ever an NPC you were paying, so it carried a parallel
 * schema and a parallel sheet for the sake of three fields. `profession`,
 * `dayRate` and the `forHire` flag now live here, the day rate showing only when
 * `forHire` is ticked. `hireling` is NOT migrated away -- it stays registered as an
 * alias of this model (see ACTOR_DATA_MODELS below for why a real retirement would
 * cost every existing hireling its document id).
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
      // Nullable because 202 of the 205 shipped monsters store null. NOTE this is
      // also overwritten every prepareData by `_prepareNpcData` (armor = calcArmor()),
      // so an authored value never reaches the sheet — a stored-vs-derived collision
      // left as-is by the migration, not introduced by it.
      armor: optInt(),
      gold: purse(),
      slots: capacity(),
      features: objList(),
      containers: strList(),
      // --- folded in from the retired `hireling` type ---
      generationEnabled: bool(true),
      // Relabelled "Career/Role" on the sheet; the stored key stays `profession`
      // so migrated hirelings keep their value without a rename pass.
      profession: str(),
      dayRate: money(0),
      // Gates the day-rate row. Default false: most NPCs are not for hire, and a
      // day rate on a wolf reads as a bug.
      forHire: bool(false),
      deprived: bool(),
      panicked: bool(),
      critical: bool(),
      armorOverride: optInt(),
    };
  }
}

class ContainerData extends CairnDataModel {
  static defineSchema() {
    return {
      description: html(),
      biography: html(),
      slots: capacity(),
      // uuid of the owning Actor. Named "keeper" to dodge a Foundry collision.
      keeper: str(),
      cost: money(0),
      transportKind: str(),
      load: int(0),
      gold: purse(),
      // What this container IS ("backpack", "cart", "horse"...), when someone has
      // said so explicitly. BLANK MEANS INFER, which is why it defaults empty and
      // needs no migration: every container that predates this field keeps being
      // classified from its name exactly as before.
      //
      // It exists because the inference is a list of ENGLISH keywords
      // (icons.js containerClass), and it decides two things at once: the art
      // stamped at creation and the one-word class label on the sheet. A Warden
      // typing "Mochila" or "Rucksack" got a chest for both -- consistently wrong,
      // and unfixable from inside a keyword list without asking every translator
      // for a synonym table.
      containerClass: str(),
    };
  }
}

/* HirelingData is gone — folded into NpcData above, which the `hireling` type now
   points at as well (see ACTOR_DATA_MODELS). Nothing to migrate: an existing
   hireling validates against the merged schema unchanged, since it is a superset. */

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
  container: ContainerData,
  // `hireling` is an ALIAS of npc: same schema, same sheet, same behaviour. A
  // hireling was only ever an NPC you were paying.
  //
  // Deliberately an alias rather than a deletion. Foundry treats a document's
  // `type` as immutable, so retiring the type would mean recreating every
  // existing hireling as a new document — new ids, and therefore broken scene
  // token links and broken container `keeper` uuids — in every world already on
  // 0.1.7. Pointing the type at this model costs one line, needs no migration,
  // and leaves nothing orphaned. The only difference that remains is at CREATION
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
