import { findCompendiumItem } from './compendium.js'
import { evaluateFormula } from './utils.js'

export class Damage {

    /**
     * @description Apply damage to several tokens
     * @param {String[]} targets Array of Id of the targeted tokens
     * @param {Number} damage Positive number
     * @param {Scene} [scene] Scene the card was spoken in; defaults to the viewer's
     */
    static async applyToTargets(targets, damage, scene = canvas?.scene) {
        let missed = 0;
        for (const target of targets) {
            const data = await this.applyToTarget(target, damage, scene);
            if (data) this._showDetails(data);   // skip targets whose token is gone
            else missed++;
        }
        // A miss used to be swallowed here. The button reports success by posting a
        // damage card per target, so nothing at all is indistinguishable from
        // "armor absorbed it" -- the Warden clicks, sees no card, and cannot tell
        // whether the click failed or the hit did.
        if (missed) {
            ui.notifications.warn(
                game.i18n.format("CAIRN.Notify.DamageTargetsGone", { count: missed })
            );
        }
    }

    /**
     * @description Apply damage to one token
     * @param {*} target Id of one token
     * @param {*} damage Amount of damaage
     * @param {Scene} [scene] Scene the card was spoken in; defaults to the viewer's
     * @returns actor + old and new values
     */
    static async applyToTarget(target, damage, scene = canvas?.scene) {
        const token = scene?.tokens?.get(target);
        // The chat card holds token ids from the roll-time scene; the token may
        // have been deleted (a killed foe) or the GM switched scenes since.
        if (!token?.actor) return null;

        const armor = token.actor.system.armor;
        // HP comes from SOURCE, not the derived value. _prepareCharacterData zeroes
        // system.hp.value whenever the actor is encumbered or panicked, and this
        // result is written straight back with update() — so reading the derived 0
        // and persisting it destroyed the stored Hit Protection, even when armor
        // absorbed the hit entirely (dmg 0 <= hp 0 still writes 0). Armor and STR
        // are safe to read derived; only HP is overwritten during data prep.
        const hp = token.actor.toObject().system.hp.value;
        const str = token.actor.system.abilities.STR.value;

        let { dmg, newHp, newStr } = this._calculateHpAndStr(damage, armor, hp, str);
        if (newStr < 0) newStr = 0; // cannot drop below being dead

        await token.actor.update({ 'system.hp.value': newHp, 'system.abilities.STR.value': newStr });

        return { token, dmg, damage, armor, hp, str, newHp, newStr };
    }

    /**
     * @description Apply damage to a target token based on the token's id
     * @param {*} event
     * @param {*} html
     * @param {*} data
     * @param {Scene} [scene] Scene the card was spoken in -- NOT the viewer's.
     *   The ids in data-targets belong to the scene the roll happened on, so
     *   reading `canvas.scene` here meant the button silently applied nothing
     *   the moment the party moved on. The sibling STR-save button was fixed for
     *   exactly this (cairn.js, `speaker.scene`); this one never was.
     */
    static onClickChatMessageApplyButton(event, html, data, scene = canvas?.scene) {
        // Warden only, and stated HERE as well as in the render hook that removes
        // the control from a player's copy of the card. Removing the button is the
        // affordance; this is the refusal, and it is the half that survives someone
        // reaching the function by another route. Applying damage decides what
        // happened to somebody else's character -- it is the Warden's call.
        if (!game.user.isGM) {
            ui.notifications.warn(game.i18n.localize("CAIRN.Notify.ApplyDamageWardenOnly"));
            return;
        }
        // currentTarget, not target: the handler hangs off the anchor and a real
        // pointer lands on the icon inside it. dataset reads the same
        // data-targets attribute jQuery's .data() did, minus .data()'s implicit
        // type coercion -- the value is a plain `;`-joined token-id string.
        const targets = event.currentTarget.dataset.targets;

        const targetsList = targets.split(';');

        // Shift Click allow to target the targeted tokens
        if (event.shiftKey) {
            for (let index = 0; index < targetsList.length; index++) {
                const target = targetsList[index];
                // `.object` is a placeable, so this can only ever resolve while the
                // card's scene IS the viewed one -- which is the correct behaviour
                // for targeting. Resolving through `scene` rather than `canvas.scene`
                // stops a token id that happens to exist on the viewed scene (a
                // duplicated scene) from being targeted instead.
                const token = scene?.tokens?.get(target)?.object;
                if (!token) continue;
                const releaseOthers = (index == 0 ? (!token.isTargeted ? true : false) : false);
                const targeted = !token.isTargeted;
                token.setTarget(targeted, { releaseOthers: releaseOthers });
            }
        }
        // Apply damage to targets
        else {
            if (targets !== undefined) {
                const dmg = parseInt(html.querySelector(".dice-total").textContent);
                this.applyToTargets(targetsList, dmg, scene);
            }
        }
    }

    /**
     * @description Damage are reduced by armor, then apply to HP, and then to STR if not enough HP
     * @param {*} damage 
     * @param {*} armor 
     * @param {*} hp 
     * @param {*} str 
     * @returns damage done, new HP value and STR value
     */
    static _calculateHpAndStr(damage, armor, hp, str) {
        let dmg = damage - armor;
        if (dmg < 0) dmg = 0;

        let newHp;
        let newStr = str;
        if (dmg <= hp) {
            newHp = hp - dmg;
            if (newHp < 0) newHp = 0;
        }
        else {
            newHp = 0;
            newStr = str - (dmg - hp);
        }

        return { dmg, newHp, newStr };
    }

    /**
     * Show chat message details of damage done for a token
     * @param data
     * @private
     */
    static _showDetails(data) {

        const { token, dmg, damage, armor, hp, str, newHp, newStr } = data

        

        if (str == 0) {
            ChatMessage.create({
                user: game.user._id,
                speaker: ChatMessage.getSpeaker({ token: token }),
                content: '<strong>' + game.i18n.localize('CAIRN.Dead') + '</strong>',
            }, {});
            return;
        }

        let content = '<p><strong>' + game.i18n.localize('CAIRN.Damage') + '</strong>: ' + dmg + ' (' + damage + '-' + armor + ')</p>'
        if (newHp !== hp) {
            content += '<p><strong>' + game.i18n.localize('CAIRN.HitProtection') + '</strong>: <s>' + hp + '</s> => ' + newHp + '</p>'
        } else {
            content += '<p><strong>' + game.i18n.localize('CAIRN.HitProtection') + '</strong>: ' + hp + '</p>'
        }
        if (newStr !== str) {
            content += '<p><strong>' + game.i18n.localize('STR') + '</strong>: <s>' + str + '</s> => ' + newStr + '</p>'
        }

        // Monsters take BOTH branches below on purpose (ratified 2026-08-01):
        // overflow past HP offers the STR-save button, and damage landing
        // exactly on 0 HP rolls a Scar. Cairn's rules carve monsters out of
        // neither, so no npcRole gate belongs here.
        if (newStr < str) {
            if (newStr === 0) {
                content += '<strong>' + game.i18n.localize('CAIRN.Dead') + '</strong>'
            } else {
                content += '<p><strong>' + game.i18n.localize('CAIRN.StrSave') + '</strong></p>'
                content += '<button type="button" class="roll-str-save">' + game.i18n.localize('CAIRN.RollStrSave') + '</button>'
            }
        } else if (newHp === 0 && hp !== 0) {
            content += '<p class="cairn-scar-banner">' + game.i18n.localize('CAIRN.Scars') + '</p>'
            // The TOKEN goes with it, or the scar card is posted in someone else's
            // name -- see _rollScarsTable. Not awaited (this method is sync and the
            // damage card below should land first), so catch here: an unhandled
            // rejection mid-damage-resolution is silent.
            this._rollScarsTable(dmg, token).catch((err) => {
                console.error("Air Bladder | the Scars draw failed:", err);
            });
        }

        ChatMessage.create({
            user: game.user._id,
            speaker: ChatMessage.getSpeaker({ token: token }),
            content: content,
        }, {})

    }

    /**
     * Roll the Scars table for the actor that was just scarred, and post the card
     * IN THAT ACTOR'S NAME.
     *
     * The name matters more than it sounds. `RollTable#draw` forwards only
     * `messageOptions` to `toMessage` and never `messageData`
     * (roll-table.mjs:139), so the card fell through to `toMessage`'s defaults:
     * `speaker: ChatMessage.getSpeaker()` with no argument, which resolves to the
     * VIEWER'S OWN assigned character (roll-table.mjs:57). So a scar taken by a
     * monster was posted under the attacking player's name, above core's
     * "Draws a result from the Scars table" flavor — reading as though the
     * attacker had drawn a scar for herself. She had done neither: she took no
     * damage and never touched the table.
     *
     * The fix is to do the two halves separately. `draw({displayChat: false})`
     * still rolls and still marks results drawn; `toMessage` then takes the
     * speaker and the flavor. There is no option on `draw` that would do this.
     *
     * @param {number} damage  the damage that landed, which IS the table's roll
     * @param {TokenDocument|null} [token]  who was scarred
     */
    static async _rollScarsTable(damage, token = null) {
        // findCompendiumItem resolves to undefined on a miss (it only warns to the
        // console), so this dereference used to throw mid-damage-resolution if the
        // pack were absent, renamed, or the table deleted from the world copy.
        // Failing loudly but harmlessly is right here: the Warden asked for a scar
        // and needs to know it did not happen.
        const table = await findCompendiumItem("air-bladder.utils", "Scars");
        if (!table) {
            ui.notifications?.warn(game.i18n.localize("CAIRN.Notify.NoScarsTable"));
            return;
        }
        const drawn = await table.draw({ roll: new Roll(damage.toString()), displayChat: false });
        if (!drawn?.results?.length) return;
        // Speaker only when there is a token to name; with none, leaving it unset
        // keeps core's default rather than inventing an empty header.
        const messageData = { flavor: game.i18n.localize("CAIRN.ScarFlavor") };
        if (token) messageData.speaker = ChatMessage.getSpeaker({ token });
        // The roll goes to `draw` -- it is what SELECTS the result row -- and is
        // deliberately NOT forwarded to `toMessage`, which renders
        // `rollHTML: this.displayRoll && roll` (roll-table.mjs:76). The roll here is
        // a CONSTANT (`new Roll("5")`), so rendering it printed formula "5" and
        // total "5": the damage number twice, on a card whose only job is to name
        // the scar, directly below a damage card that had just said "Damage: 5
        // (7-2)". Dropping it takes the whole dice block out.
        // Costs the dice sound (`sound: roll ? CONFIG.sounds.dice : null`, :64),
        // which is right -- nothing is rolled visibly here and the damage card that
        // triggered this already made the noise.
        await table.toMessage(drawn.results, { messageData });
    }

    static async _rollStrSave(token, html) {
        const roll = await evaluateFormula("d20cs<=@STR", token.actor.getRollData());
        const label = game.i18n.format("CAIRN.Save", { key: game.i18n.localize("STR") });
        const rolled = roll.terms[0].results[0].result;
        const failed = roll.total === 0;
        const result = failed ? game.i18n.localize("CAIRN.Fail") : game.i18n.localize("CAIRN.Success");
        const resultCls = failed ? "failure" : "success";
        // A failed Critical Damage save means the character is taking Critical
        // Damage. STR was already reduced when the damage was applied, so this
        // only offers to flag the status (set by the button; not automatic, per
        // house style). Wired in cairn.js renderChatMessageHTML.
        const critButton = failed
            ? `<button type="button" class="mark-critical-damage">${game.i18n.localize("CAIRN.MarkCriticalDamage")}</button>`
            : "";
        roll.toMessage({
            speaker: ChatMessage.getSpeaker({ token: token }),
            flavor: label,
            content: `<div class="dice-roll"><div class="dice-result"><div class="dice-formula">${roll.formula}</div><div class="dice-tooltip" style="display: none;"><section class="tooltip-part"><div class="dice"><header class="part-header flexrow"><span class="part-formula">${roll.formula}</span></header><ol class="dice-rolls"><li class="roll die d20">${rolled}</li></ol></div></section></div><h4 class="dice-total ${resultCls}">${result} (${rolled})</h4></div></div>${critButton}`,
        });
        html.querySelector(".roll-str-save").setAttribute('disabled', 'disabled')
    }
}
