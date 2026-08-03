/**
 * The Faction generator — a Warden-only button that composes the SRD faction
 * tables (Setting Seeds, CC BY-SA 4.0) into a JournalEntry dossier. The first
 * JournalEntry this system mints: a faction is campaign machinery, not an
 * Actor, and a chat card would scroll away.
 *
 * Every roll resolves BY NAME, WORLD FIRST (findTableByName), so a Warden who
 * has replaced or edited any of the tables feeds the generator their own
 * content automatically — the same contract as the NPC sheet's Faction die.
 * roll(), never draw(): these are the Warden's tables and a draw would dirty
 * their drawn state (the config.js invariant).
 *
 * The dossier is baked in the SESSION'S language via t("table.result") — the
 * ratified monster-generation exception: generated world content is authored
 * in the language it was generated in (identity in an English world).
 *
 * The loop closes by hand, deliberately: when a rolled faction earns a place
 * in the campaign, the Warden adds its name as a row in their world
 * "Warden: NPC - Faction" table — and the sheet die starts dealing it to NPCs
 * and Monsters. The generator invents candidates; the Warden's table is the
 * canon. Clicking again mints another dossier; nothing is ever overwritten.
 */

import { findTableByName, resultText } from "./compendium.js";
import { t } from "./i18n-content.js";

/** The suite, by shipped name. World copies of these names win by design. */
const TABLES = {
  type: "Warden: NPC - Faction",
  agent: "Warden: Faction - Agent",
  trait1: "Warden: Faction - Trait (Trait 1)",
  trait2: "Warden: Faction - Trait (Trait 2)",
  advantageCount: "Warden: Faction - Advantage (Count)",
  advantage: "Warden: Faction - Advantage",
  agenda: "Warden: Faction - Agenda",
  obstacle: "Warden: Faction - Obstacle",
};

/** One rolled cell, display-language baked; "" when the table is missing/empty. */
const rollText = async (tableName) => {
  const table = await findTableByName(tableName);
  if (!table) return "";
  const { results } = await table.roll();
  const raw = resultText(results[0]).trim();
  return raw ? t("table.result", raw) : "";
};

/**
 * The SRD Advantages procedure: the (Count) column says HOW MANY advantages
 * the faction has, then the Advantage column is rolled that many times,
 * rerolling repeats. Count is 1–4 against 20 distinct rows, so distinctness
 * always terminates; the attempt cap is a belt for a Warden's edited table
 * that repeats itself.
 * @returns {Promise<String[]>}
 */
const rollAdvantages = async () => {
  const rolled = parseInt(await rollText(TABLES.advantageCount), 10);
  const count = Math.min(4, Math.max(1, Number.isNaN(rolled) ? 1 : rolled));
  const out = new Set();
  for (let attempts = 0; attempts < 40 && out.size < count; attempts++) {
    const adv = await rollText(TABLES.advantage);
    if (!adv) break;
    out.add(adv);
  }
  return [...out];
};

/**
 * Roll a whole faction and mint its dossier. Returns the JournalEntry (the
 * caller renders it), or null only when creation itself failed. A missing
 * table degrades its line to an em-dash — the journal still mints, because a
 * Warden mid-edit should get a partial dossier, not an error.
 * @returns {Promise<JournalEntry|null>}
 */
export const generateFaction = async () => {
  const type = await rollText(TABLES.type);
  const agent = await rollText(TABLES.agent);
  const trait1 = await rollText(TABLES.trait1);
  const trait2 = await rollText(TABLES.trait2);
  const advantages = await rollAdvantages();
  const agenda = await rollText(TABLES.agenda);
  const obstacle = await rollText(TABLES.obstacle);

  // "The Enigmatic Cultists" — obviously a draft name, meant to be replaced.
  // A localizable FORMAT key, because "The <trait> <type>" is English word
  // order and a translator may need to reorder.
  const name = trait1 && type
    ? game.i18n.format("CAIRN.FactionName", { trait: trait1, type })
    : game.i18n.localize("CAIRN.Faction");

  // One key per WHOLE LINE, colon and bold included, the same shape as the
  // sibling MonsterGen.Desc* keys. Assembling `${label}:` in code hands the
  // translator a noun and keeps the punctuation — French wants a narrow
  // no-break space before a colon, English does not, and neither can be
  // written from the other end.
  //
  // Lists go through Intl.ListFormat rather than a hardcoded ", ". Narrow
  // conjunction leaves the English rendering byte-identical ("A, B, C") while
  // giving every other locale its own form — es "A, B y C", ja "A、B、C". Not
  // `type: "unit"`, which is the measurement joiner and drops the separator
  // altogether in narrow English ("A B C"), as the faction probe found. Worth
  // the care because this
  // dossier is BAKED into a journal at generation time: whatever it writes is
  // permanent, and a Warden is not going to re-punctuate six lines by hand.
  //
  // NOT the CAIRN.Bio.List* keys the sheet's biography uses, deliberately.
  // Those build a sentence in running prose ("a Bony Physique, Black Hair and
  // Pale Skin"), where the conjunction is the translator's to place. This is a
  // bare enumeration after a label — separator only — and that is data the
  // platform already has for every locale, including the ones nobody has
  // translated yet.
  const list = new Intl.ListFormat(game.i18n.lang ?? "en", { style: "narrow", type: "conjunction" });
  const line = (key, value) => `<p>${game.i18n.format(key, { value: value || "&mdash;" })}</p>`;
  const content = [
    line("CAIRN.FactionDossier.Type", type),
    line("CAIRN.FactionDossier.Agent", agent),
    line("CAIRN.FactionDossier.Traits", list.format([trait1, trait2].filter(Boolean))),
    line("CAIRN.FactionDossier.Advantages", list.format(advantages)),
    line("CAIRN.FactionDossier.Agenda", agenda),
    line("CAIRN.FactionDossier.Obstacle", obstacle),
  ].join("\n");

  // GM-only visibility: factions are the Warden's machinery. Through the
  // configured document class, so a future subclass is not bypassed.
  const entry = await CONFIG.JournalEntry.documentClass.create({
    name,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    pages: [{ name, type: "text", text: { content } }],
  });
  return entry ?? null;
};
