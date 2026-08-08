import { CairnActor } from "./actor/actor.js";
import { Cairn } from "./config.js";
import { compendiumInfoFromString, findCompendiumItem, resultText } from "./compendium.js";
import { getGameIconManifest } from "./character-generator.js";
// Aliased: the tier config is locally `t` throughout generateMonster.
import { t as tr } from "./i18n-content.js";

/* -------------------------------------------------------------------------- */
/*  Monster generation — SRD "Creating Monsters" (Warden's Guide, CC BY-SA)    */
/*                                                                            */
/*  The eight d20 tables ship in the warden-monsters pack (see                */
/*  Cairn.monsterGenerator in config.js); what lives here is the stats layer  */
/*  that realizes the SRD's PROSE guidance as weighted dice, and the assembly */
/*  of a pack-shaped npc actor with role "monster". The design of record —   */
/*  every weight below, and why — is docs/monster-generation.md. Change one   */
/*  without the other and the next reader re-derives it wrong.                */
/* -------------------------------------------------------------------------- */

// SRD tiers: HP 3 standard / 6 hardier / 10+ serious threat. The attack die
// and armor odds ride the same tier — the pack's own monsters cluster d6/d8/d10.
// Armor values are 1..3 by construction; calcArmor caps at 3 again regardless.
const TIERS = {
  standard: { hp: 3, die: "d6", armorChance: 0.25, armorWeights: [[1, 1]] },
  hardier: { hp: 6, die: "d8", armorChance: 0.5, armorWeights: [[1, 3], [2, 1]] },
  serious: { hp: 10, die: "d10", armorChance: 0.75, armorWeights: [[1, 2], [2, 2], [3, 1]] },
};

// "Random" tier: mooks common, bosses rare.
const RANDOM_TIER_W = [["standard", 3], ["hardier", 2], ["serious", 1]];

// SRD ability ladder: 3 deficient, 6 weak, 10 average, 14 noteworthy,
// 18 legendary — average dominating. WIL always draws from the base weights;
// STR shifts upward with tier (a serious threat that folds to one sword blow
// is not serious); DEX starts at 10 per the SRD and never hits the extremes —
// speed is a texture, not what makes a monster deadly.
const BASE_W = [[3, 1], [6, 3], [10, 8], [14, 3], [18, 1]];
const DEX_W = [[6, 3], [10, 10], [14, 3]];
const STR_W = {
  standard: BASE_W,
  hardier: [[6, 2], [10, 8], [14, 4], [18, 2]],
  serious: [[6, 1], [10, 5], [14, 6], [18, 4]],
};

// When the rolled Feature is itself the armor, the armor item wears its name —
// a Carapace monster's protection IS the carapace. English source-table match,
// deliberate: the same keyword-inference pattern as containerClass in icons.js,
// and the feature strings come off the shipped English tables.
const ARMORED_FEATURES = ["Carapace", "Shell", "Scales"];

// The game-icons categories a monster portrait may draw from. A constant, not
// a manifest scan: "tools" and "armor" are categories too, and a monster
// wearing a spanner for a face is not a fallback anyone asked for.
const CREATURE_CATEGORIES = ["animals", "birds", "creatures", "fish", "heads", "mammals", "reptiles", "skull"];
const MONSTER_ICON_FALLBACK = "systems/air-bladder/icons/monster.svg";

/** One weighted pick. @param {Array<[any, Number]>} pairs @returns {any} */
const pickWeighted = (pairs) => {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [value, w] of pairs) {
    roll -= w;
    if (roll < 0) return value;
  }
  return pairs[pairs.length - 1][0];
};

/**
 * One text result off a Warden table, by "packId;Table Name" config string.
 * roll(), never draw() — these are the WARDEN'S tables and a draw would dirty
 * their drawn state (the rollNameFromTable invariant). "" on a missing or
 * empty table: generation degrades, it never throws (the drawTableText
 * contract, and findCompendiumItem already warned).
 * @param {String} config
 * @returns {Promise<String>}
 */
const rollTableText = async (config) => {
  const [packName, tableName] = compendiumInfoFromString(config);
  const table = await findCompendiumItem(packName, tableName);
  if (!table) return "";
  const { results } = await table.roll();
  return resultText(results[0]).trim();
};

/**
 * The tier picker — and, on a re-roll, the CONFIRMATION. It is dismissible
 * (✕ resolves null, nothing is created or touched — same rule as
 * promptContentSource) and its regenerate wording says what will be replaced,
 * so destructive work only ever follows an explicit button press. That is why
 * #onRollActor does not stack a DialogV2.confirm in front of this.
 * @param {{regenerate?: Boolean}} [options]
 * @returns {Promise<"standard"|"hardier"|"serious"|"random"|null>}
 */
export const promptMonsterTier = async ({ regenerate = false } = {}) => {
  const chosen = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.localize(regenerate ? "CAIRN.MonsterGen.RegenerateTitle" : "CAIRN.MonsterGen.TierTitle"),
      icon: "fas fa-dragon",
    },
    content: `<p>${game.i18n.localize(regenerate ? "CAIRN.MonsterGen.RegeneratePrompt" : "CAIRN.MonsterGen.TierPrompt")}</p>`,
    buttons: [
      { action: "standard", label: game.i18n.localize("CAIRN.MonsterGen.TierStandard") },
      { action: "hardier", label: game.i18n.localize("CAIRN.MonsterGen.TierHardier") },
      { action: "serious", label: game.i18n.localize("CAIRN.MonsterGen.TierSerious") },
      { action: "random", label: game.i18n.localize("CAIRN.MonsterGen.TierRandom"), default: true },
    ],
    rejectClose: false,
  });
  return chosen ?? null;
};

const resolveTier = (choice) => (choice === "random" ? pickWeighted(RANDOM_TIER_W) : choice);

const rollMonsterAbilities = (tier) => ({
  STR: pickWeighted(STR_W[tier]),
  DEX: pickWeighted(DEX_W),
  WIL: pickWeighted(BASE_W),
});

const abilityData = (a) => ({
  STR: { value: a.STR, max: a.STR },
  DEX: { value: a.DEX, max: a.DEX },
  WIL: { value: a.WIL, max: a.WIL },
});

/**
 * Generate a full monster as plain data — no document writes here.
 * @param {"standard"|"hardier"|"serious"|"random"} tierChoice
 * @returns {Promise<Object>} {tier, name, hp, abilities, description, items}
 */
export const generateMonster = async (tierChoice) => {
  const tier = resolveTier(tierChoice);
  const t = TIERS[tier];
  const cfg = Cairn.monsterGenerator;

  const physique = await rollTableText(cfg.physique);
  const feature = await rollTableText(cfg.feature);
  const quirk = await rollTableText(cfg.quirk);
  const weakness = await rollTableText(cfg.weakness);
  const attackType = await rollTableText(cfg.attackType);
  const criticalDamage = await rollTableText(cfg.criticalDamage);
  const abilityPower = await rollTableText(cfg.abilityPower);
  const abilityTarget = await rollTableText(cfg.abilityTarget);

  // The rolled strings are table.result rows and go through the overlay for
  // everything DISPLAYED-and-stored: this path already bakes the localized
  // CAIRN.MonsterGen.* frames onto the document (generated monsters are WORLD
  // content authored in the session's language — unlike pack content, which
  // stays English for the display-only overlay), and half-baking gave a
  // Spanish Warden "Criatura Emaciated Trunk". The RAW rolls stay in scope
  // because two things match on the English source: ARMORED_FEATURES below,
  // and the drawn-state bookkeeping in the tables themselves. In an English
  // world every d() is the identity.
  const d = (s) => tr("table.result", s);

  // The SRD's step 5 ("Thunder Snail") is creative interpretation and cannot be
  // automated; the appearance rolls at least land every monster in the
  // directory distinguishable. The Warden renames when inspiration strikes.
  const name = (physique || feature)
    ? game.i18n.format("CAIRN.MonsterGen.Name", { physique: d(physique), feature: d(feature) }).replace(/\s+/g, " ").trim()
    : game.i18n.localize("CAIRN.RoleMonster");

  const items = [];

  // The attack keeps the table's verb verbatim ("Bites*") — deriving "Bite"
  // from "Bites" is English morphology and would break the moment the format
  // key is translated. The * is the pack's marker for an attack whose special
  // effect lives in the description, which is always true here: a Critical
  // damage bullet is always written.
  items.push({
    name: attackType
      ? game.i18n.format("CAIRN.MonsterGen.AttackName", { type: d(attackType) })
      : game.i18n.localize("CAIRN.RoleMonster"),
    type: "item",
    system: { damageFormula: t.die, equipped: true, quantity: 1, slots: 0, armor: 0 },
  });

  // Armor arrives as an equipped item so the actor's Armor DERIVES via
  // calcArmor, exactly like the 205 pack monsters (actor system.armor stays
  // null). Named after the rolled Feature when the feature is the armor.
  if (Math.random() < t.armorChance) {
    items.push({
      // The MEMBERSHIP test is on the raw English roll; only the display copy
      // that becomes the item's name is translated.
      name: ARMORED_FEATURES.includes(feature)
        ? d(feature)
        : game.i18n.localize("CAIRN.MonsterGen.ArmorName"),
      type: "item",
      system: { armor: pickWeighted(t.armorWeights), equipped: true, quantity: 1, slots: 0 },
    });
  }

  // A <ul> of prose bullets, critical damage included AS PROSE — no automation
  // of mechanical text, house rule. Rolled strings are escaped because a Warden
  // can edit the world copies of these tables into anything (same reason as the
  // bgName escape in actor-sheet.js).
  //
  // The markup is ProseMirror-CANONICAL (<li><p>…</p></li>, no newlines), not
  // the pack monsters' <li>…<br></li> shape. The sheet's root element IS its
  // form, so every frame-button click submits it — and a description the editor
  // re-serializes differently makes that submit a real write, rewriting the
  // document on the first click of ANY header button (observed 2026-08-01 via a
  // preUpdateActor logger; the probe's decline leg caught it). Canonical markup
  // round-trips to an empty diff.
  // The 2026-08-02 formatting ruling: a bold label, no trailing period, and a
  // LOWERCASED payload — a table row is a fragment ("Emaciated trunk"), not a
  // sentence, and it reads as one mid-bullet. Lowercasing happens INLINE at the
  // format call and never to the variables: `ARMORED_FEATURES.includes(feature)`
  // above matches the raw English roll. The appearance bullet keeps its leading
  // capital because only the INSERTED results are folded.
  const esc = foundry.utils.escapeHTML;
  const lc = (s) => d(s).toLocaleLowerCase(game.i18n.lang);
  const bullets = [];
  if (physique && feature) {
    bullets.push(game.i18n.format("CAIRN.MonsterGen.DescAppearance", { physique: esc(lc(physique)), feature: esc(lc(feature)) }));
  }
  if (quirk) bullets.push(game.i18n.format("CAIRN.MonsterGen.DescQuirk", { quirk: esc(lc(quirk)) }));
  if (weakness) bullets.push(game.i18n.format("CAIRN.MonsterGen.DescWeakness", { weakness: esc(lc(weakness)) }));
  if (abilityPower && abilityTarget) {
    bullets.push(game.i18n.format("CAIRN.MonsterGen.DescAbility", { power: esc(lc(abilityPower)), target: esc(lc(abilityTarget)) }));
  }
  if (criticalDamage) bullets.push(game.i18n.format("CAIRN.MonsterGen.DescCritical", { effect: esc(lc(criticalDamage)) }));
  const description = bullets.length
    ? `<ul>${bullets.map((b) => `<li><p>${b}</p></li>`).join("")}</ul>`
    : "";

  return { tier, name, hp: t.hp, abilities: rollMonsterAbilities(tier), description, items };
};

/** @returns {Object} Foundry create data for a monster. Mirrors npcToActorData. */
const monsterToActorData = (m) => ({
  name: m.name,
  type: "npc",
  system: {
    role: "monster",
    // Off-by-default, stated rather than inherited: a generated monster's
    // switch reads Off, same as the 205 shipped ones pin it.
    generationEnabled: false,
    hp: { value: m.hp, max: m.hp },
    abilities: abilityData(m.abilities),
    description: m.description,
    armor: null,
    armorOverride: null,
    critical: false,
    deprived: false,
    panicked: false,
  },
  items: m.items,
  // The pack convention for every shipped monster: hostile, unlinked, STR and
  // HP as the token bars. Explicit values here win over _preCreate defaults.
  prototypeToken: {
    disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
    actorLink: false,
    displayBars: 0,
    bar1: { attribute: "abilities.STR" },
    bar2: { attribute: "hp" },
  },
});

/**
 * A random portrait from the game-icons creature categories, or the shipped
 * monster glyph when the manifest is unavailable (fetch failed, curation
 * re-cut without these categories). Uniform over icons, not categories, so a
 * 20-icon category does not outweigh a 200-icon one per icon.
 * @returns {Promise<String>}
 */
const randomMonsterIcon = async () => {
  const manifest = await getGameIconManifest();
  const iconDir = manifest?.iconDir;
  if (!iconDir) return MONSTER_ICON_FALLBACK;
  const pool = (manifest.categories ?? [])
    .filter((c) => CREATURE_CATEGORIES.includes(c.key) && Array.isArray(c.names) && c.names.length)
    .flatMap((c) => c.names.map((n) => `${iconDir}/${c.key}/${n}`));
  if (!pool.length) return MONSTER_ICON_FALLBACK;
  return pool[Math.floor(Math.random() * pool.length)];
};

/**
 * The directory button's whole flow: ask the tier (dismiss = create nothing),
 * generate, create. The portrait doubles as the token texture — monsters have
 * no paired token art the way Aspeheim portraits do.
 * @returns {Promise<CairnActor|null>}
 */
export const createMonster = async ({ folder = null } = {}) => {
  const choice = await promptMonsterTier();
  if (!choice) return null;
  const data = monsterToActorData(await generateMonster(choice));
  const img = await randomMonsterIcon();
  data.img = img;
  data.prototypeToken.texture = { src: img };
  // Folder threaded from the createDialog switchboard (2026-08-02).
  if (folder) data.folder = folder;
  // Document.create can return undefined when creation is refused; the caller
  // tests truthiness before rendering a sheet.
  return (await CairnActor.create(data)) ?? null;
};

/**
 * Full re-roll of an existing monster at a chosen tier: new stats, attack,
 * armor and description. Keeps the name, portrait and token art — the update
 * omits them (regenerateNpc's keep-by-omission rule).
 * @param {CairnActor} actor
 * @param {"standard"|"hardier"|"serious"|"random"} tierChoice
 * @returns {Promise<CairnActor>}
 */
export const regenerateMonster = async (actor, tierChoice) => {
  const m = await generateMonster(tierChoice);
  await actor.deleteEmbeddedDocuments("Item", [], { deleteAll: true, render: false });
  // createEmbeddedDocuments, never `items` inside the update: the update route
  // creates embedded documents without firing createItem hooks. Same order as
  // regenerateNpc — create render:false, then the one update renders.
  if (m.items?.length) await actor.createEmbeddedDocuments("Item", m.items, { render: false });
  await actor.update({
    system: {
      role: "monster",
      hp: { value: m.hp, max: m.hp },
      abilities: abilityData(m.abilities),
      description: m.description,
      critical: false,
      // Reset the whole defensive/status set the create payload (monsterToActorData)
      // writes: a regenerated monster is a NEW creature. `armor` in particular is a
      // FLOOR the sheet honours (actor.js:696-702), so omitting it left the previous
      // creature's protection stapled to the new statblock.
      armor: null,
      armorOverride: null,
      deprived: false,
      panicked: false,
    },
  }, {
    // A regenerated monster is a NEW creature, not one that pulled through, so the
    // cleared `critical` must not post a Stabilized bar. Same flag as regenerateNpc.
    abNoStatusCard: true,
  });
  return actor;
};
