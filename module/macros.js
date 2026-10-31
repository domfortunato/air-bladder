import { evaluateFormula, getInfoFromDropData, askDamageQuality, damageFormulaFor, damageQualityLabel, damageQualityKind, combatDamageFormula } from "./utils.js";
import { SETTINGS_NS } from "./settings.js";
import { t, actorDisplayName, itemNamespaces } from "./i18n-content.js";

/**
 * @param {Object} data
 * @param {Number} slot
 * @return {Promise.<void>}
 */
export const createCairnMacro = async (data, slot) => {
  const { item, actor } = await getInfoFromDropData(data ?? {});

  if (data?.type !== "Item") {
    // TRUTHINESS, not `!== undefined`. `getInfoFromDropData` initialises the
    // resolved document to NULL when there is no uuid to resolve, and a text,
    // URL or file dragged onto the hotbar reaches this hook as an object with
    // no `type` and no `uuid` at all — so `null !== undefined` was true and the
    // next line read `.name` off null. It threw out of an unawaited call, which
    // is why it surfaced as an unhandled rejection naming nothing rather than
    // as a message anyone could act on (review #14).
    if (item) {
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

  // A compendium actor's item too (review #34 finding 171): the macro is keyed
  // by the actor's id and rollItemMacro looks it up in the WORLD, so it reported
  // "This macro's actor no longer exists", or rolled the world copy that a
  // keepId import left wearing the same id.
  if (!actor || actor.pack) {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Macro.OwnedItemsOnly"));
  }

  if (item.type !== "weapon") {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Macro.WeaponsOnly"));
  }

  const command = `game.cairn.rollItemMacro("${actor.id}", "${item.id}");`;
  // ONLY A MACRO THIS USER AUTHORED is reused (review #34 finding 154, a
  // security fix). Every world macro reaches every client, a macro's author may
  // rewrite its command, and assignHotbarMacro checks nothing — so matching on
  // name and command alone handed the Warden's bar a player-authored script the
  // player could then edit, run as the Warden on the next click; and the other
  // way round handed a player the Warden's macro they may not execute. Core
  // never finds another user's macro by lookup (Hotbar#_onDrop's derived drops
  // always create one), and `isAuthor` is core's own test
  // (client/documents/macro.mjs). Script type too: a chat macro with this text
  // would post the command instead of running it.
  let macro = game.macros.find((m) => m.isAuthor && m.type === "script"
    && m.name === item.name && m.command === command);
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
    // The actor's DISPLAY name, the same gate the sheet header uses (a PC's
    // name stays, a creature's translates) — nine lines above a weapon name
    // that was already routed (review #19).
    return ui.notifications.warn(game.i18n.format("CAIRN.Macro.NoItem", { name: actorDisplayName(actor) }));
  }

  // Show the weapon's name through the content overlay, exactly as the sheet's
  // damage control does (localizeNameDesc over _itemNamespaces): a Spanish
  // player's hotbar macro must not print the English name the sheet already
  // localizes — the "one sheet, two answers" tell. The owner's namespaces
  // (`itemNamespaces`): a monster's item, then item.name.
  const weaponName = t(itemNamespaces(actor).nameNs, item.name);

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
    // Same title as the sheet's control gets — the localized weapon name.
    quality = await askDamageQuality(item.system.damageFormula, weaponName);
    if (quality === null) return; // dismissed: roll nothing
  }
  // One of the three PC damage call sites — the hotbar macro. Gated through the
  // SAME function as the sheet's two (actor-sheet.js `#onRollDamage` and
  // `#onImprovisedAttack`, both through `combatDamageFormula` in utils.js);
  // those three are the only places a damage roll can be a player
  // character's, and the Warden's Damage tool is
  // deliberately NOT one of them (a trap has no actor). No die-size floor since
  // 2026-10-03, and melee and ranged are the same to both options since.
  const base = damageFormulaFor(quality, item.system.damageFormula);
  const { formula: rollSchema, maneuver: mayManeuver } = combatDamageFormula(base, {
    pc: actor.type === "character",
  });

  // determine roll result
  const roll = await evaluateFormula(rollSchema, actor.getRollData());
  // Whole-sentence keys, same as the sheet's damage roll — this was the third
  // copy of the localize()+concat shape and the one nobody remembered.
  const label = weaponName
    ? game.i18n.format(panicked ? "CAIRN.RollingDmgWithWeaponPanic" : "CAIRN.RollingDmgWithWeapon",
      { weapon: weaponName })
    : "";

  const targetedTokens = Array.from(game.user.targets).map((tk) => tk.id);

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
    weapon: weaponName,
    quality: damageQualityLabel(quality, { panicked }),
    // The datum the render hook rebuilds the badge from — see the sheet's
    // roller and templates/chat/dmg-roll-card.html.
    qualityKind: damageQualityKind(quality, { panicked }),
    panic: panicked,
    // See the sheet's roller: the datum says "a PC's attack, maneuver option on".
    maneuver: mayManeuver,
  };
  const msg = await foundry.applications.handlebars.renderTemplate(rollMessageTpl, tplData);
  roll.toMessage({    
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    flavor: msg,
  });
};
