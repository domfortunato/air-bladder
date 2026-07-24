import { SETTINGS_NS } from "./settings.js";
/**
 * @param {String} formula
 * @param {Object} [data]
 * @return {Promise<Roll>}
 */
export const evaluateFormula = async (formula, data) => {
  let f = formula;
  const cairnDice = game.settings.get(SETTINGS_NS, "use-cairn-dice-notation");
  if (cairnDice && f.includes("+")) {
    // Cairn overloads "+", and the operands disambiguate it, not the operator:
    //   2d8         roll two d8s and add them            -> 2..16
    //   d8 + d8     roll two d8s and keep the highest    -> 1..8
    //   2d20 + 10   roll two d20s, add them, add 10      -> 12..50
    // Only the die-plus-die form is keep-highest. Rewriting on the presence of
    // a "+" alone turned the generator's age formula into {2d20,10}kh, i.e.
    // max(2d20, 10) -> 10..40, so the "+ 10" silently became a floor.
    const terms = f.split("+").map((t) => t.trim());
    if (terms.length > 1 && terms.every((t) => /^\d*d\d+$/i.test(t))) {
      f = "{" + terms.join(",") + "}kh";
    }
  }
  const roll = new Roll(f, data);
  return roll.evaluate();
};

/**
 * @param {String} str
 * @param {Object} data
 * @return {String}
 */
export const formatString = (str, data = {}) => {
  const fmt = /\{[^}]+\}/g;
  str = str.replace(fmt, (k) => {
    return data[k.slice(1, -1)];
  });
  return str;
};

/* V10/V9 compatibility */
/**
 * @param {Object} dropData
 * @return {Promise<{actor: CairnActor, item: CairnItem}>}
 */
export const getInfoFromDropData = async (dropData) => {
  const itemFromUuid = dropData.uuid ? await fromUuid(dropData.uuid) : null;
  const actor = itemFromUuid
    ? itemFromUuid.actor
    : dropData.sceneId
    ? game.scenes.get(dropData.sceneId).tokens.get(dropData.tokenId).actor
    : game.actors.get(dropData.actorId);

  const item = actor
    ? itemFromUuid
      ? itemFromUuid
      : actor.items.get(dropData.data._id)
    : itemFromUuid;
  return { actor, item };
};

export const stripPar = (text) => {
  return text.replace("<p>", "").replace("</p>", "");
};
