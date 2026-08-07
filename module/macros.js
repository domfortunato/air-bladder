import { evaluateFormula, getInfoFromDropData, askDamageQuality, damageFormulaFor, damageQualityLabel } from "./utils.js";
import { SETTINGS_NS } from "./settings.js";

/**
 * @param {Object} data
 * @param {Number} slot
 * @return {Promise.<void>}
 */
export const createCairnMacro = async (data, slot) => {
  const { item, actor } = await getInfoFromDropData(data);

  if (data.type !== "Item") {
    if (item !== undefined) {
      const macro = await Macro.create({
        name: item.name,
        type: "script",
        img: item.img,
        command: 'await foundry.applications.ui.Hotbar.toggleDocumentSheet("' + item.uuid + '")',
        flags: { "air-bladder.itemMacro": true },
      });
      await game.user.assignHotbarMacro(macro, slot);
    }

    return true;
  }

  if (!actor) {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Macro.OwnedItemsOnly"));
  }

  if (item.type !== "weapon") {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Macro.WeaponsOnly"));
  }

  const command = `game.cairn.rollItemMacro("${actor.id}", "${item.id}");`;
  let macro = game.macros.find((m) => m.name === item.name && m.command === command);
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command,
      flags: { "air-bladder.itemMacro": true },
    });
  }
  await game.user.assignHotbarMacro(macro, slot);
  return false;
};

/**
 * @param {string} actorId
 * @param {string} itemId
 * @return {Promise.<void>}
 */
export const rollItemMacro = async (actorId, itemId) => {
  const actor = game.actors.get(actorId);
  if (!actor) {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Macro.NoActor"));
  }
  const item = actor.items.get(itemId);
  if (!item) {
    return ui.notifications.warn(game.i18n.format("CAIRN.Macro.NoItem", { name: actor.name }));
  }

  const usePanic = game.settings.get(SETTINGS_NS, "use-panic");
  const panicked = usePanic && actor.system.panicked;

  // Same rule and the same helper as the sheet's damage control: panic IMPOSES
  // impaired and offers no choice, so a panicked character is never asked. Panic
  // no longer substitutes a formula of its own — it names a quality, and
  // damageFormulaFor turns that into the die. The old d4 substitution was
  // written twice and drifted; impaired/enhanced is not repeating that.
  let quality;
  if (panicked) quality = "impaired";
  else {
    // Same title as the sheet's control gets — the macro has the item itself.
    quality = await askDamageQuality(item.system.damageFormula, item.name ?? "");
    if (quality === null) return; // dismissed: roll nothing
  }
  const rollSchema = damageFormulaFor(quality, item.system.damageFormula);

  // determine roll result
  const roll = await evaluateFormula(rollSchema, actor.getRollData());
  // Whole-sentence keys, same as the sheet's damage roll — this was the third
  // copy of the localize()+concat shape and the one nobody remembered.
  const label = item.name
    ? game.i18n.format(panicked ? "CAIRN.RollingDmgWithWeaponPanic" : "CAIRN.RollingDmgWithWeapon",
      { weapon: item.name })
    : "";

  const targetedTokens = Array.from(game.user.targets).map((t) => t.id);

  let targetIds;
  if (targetedTokens.length == 0) targetIds = null;
  else if (targetedTokens.length == 1) targetIds = targetedTokens[0];
  else {
    targetIds = targetedTokens[0];
    for (let index = 1; index < targetedTokens.length; index++) {
      const element = targetedTokens[index];
      targetIds = targetIds.concat(";", element);
    }
  }
  
  const rollMessageTpl = "systems/air-bladder/templates/chat/dmg-roll-card.html";
  const tplData = {
    label: label, targets: targetIds,
    weapon: item.name ?? "",
    quality: damageQualityLabel(quality, { panicked }),
  };
  const msg = await foundry.applications.handlebars.renderTemplate(rollMessageTpl, tplData);
  roll.toMessage({    
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    flavor: msg,
  });
};
