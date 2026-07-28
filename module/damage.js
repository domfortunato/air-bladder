import { findCompendiumItem } from './compendium.js'
import { evaluateFormula } from './utils.js'

export class Damage {

    /**
     * @description Apply damage to several tokens
     * @param {String[]} targets Array of Id of the targeted tokens
     * @param {Number} damage Positive number
     */
    static async applyToTargets(targets, damage) {
        for (const target of targets) {
            const data = await this.applyToTarget(target, damage);
            if (data) this._showDetails(data);   // skip targets whose token is gone
        };
    }

    /**
     * @description Apply damage to one token
     * @param {*} target Id of one token
     * @param {*} damage Amount of damaage
     * @returns actor + old and new values
     */
    static async applyToTarget(target, damage) {
        const token = canvas.scene?.tokens?.get(target);
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
     */
    static onClickChatMessageApplyButton(event, html, data) {
        const btn = $(event.currentTarget);
        const targets = btn.data("targets");

        let targetsList = targets.split(';');

        // Shift Click allow to target the targeted tokens
        if (event.shiftKey) {
            for (let index = 0; index < targetsList.length; index++) {
                const target = targetsList[index];
                const token = canvas.scene?.tokens?.get(target)?.object;
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
                this.applyToTargets(targetsList, dmg);
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

        if (newStr < str) {
            if (newStr === 0) {
                content += '<strong>' + game.i18n.localize('CAIRN.Dead') + '</strong>'
            } else {
                content += '<p><strong>' + game.i18n.localize('CAIRN.StrSave') + '</strong></p>'
                content += '<button type="button" class="roll-str-save">' + game.i18n.localize('CAIRN.RollStrSave') + '</button>'
            }
        } else if (newHp === 0 && hp !== 0) {
            content += '<p><strong>' + game.i18n.localize('CAIRN.Scars') + '</strong></p>'
            this._rollScarsTable(dmg);
        }

        ChatMessage.create({
            user: game.user._id,
            speaker: ChatMessage.getSpeaker({ token: token }),
            content: content,
        }, {})

    }

    static async _rollScarsTable(damage) {
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
        const roll = new Roll(damage.toString());
        await table.draw({ roll });
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
