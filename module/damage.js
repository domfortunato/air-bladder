import { findCompendiumItem } from './compendium.js'
import { evaluateFormula, askDamageTargets } from './utils.js'
import { postStatusCard } from './actor/actor.js'

// The system's flag namespace, imported rather than re-declared: a second
// "air-bladder" literal is a second thing that can drift, and a flag written
// under one namespace and read under another is invisible until it is missing.
// FLAG_SCOPE's home in character-generator.js is historical; nothing there
// imports this file, so there is no cycle.
import { FLAG_SCOPE } from './character-generator.js'

/** Flag recording that a damage card's Apply control has already been used. */
export const DAMAGE_APPLIED_FLAG = "damageApplied";

/**
 * Flag on a DETAIL card naming where its damage came from.
 *
 * IDS AND A RAW WEAPON NAME, never a finished sentence. The line is built per
 * VIEWER at render time (nameDamageSource in cairn.js), which is what lets a
 * monster attacker's name go through the content overlay in a Spanish client
 * while a player-authored PC name is left alone — and what keeps every authored
 * name out of stored HTML, since this card renders in everyone's log.
 *
 * Deliberately the same SHAPE as `message.speaker` (`token`, `actor`, `alias`),
 * so the attacker-naming rule is one function both the attack line and this
 * share rather than two that can drift.
 */
export const DAMAGE_SOURCE_FLAG = "damageSource";

/**
 * Where a damage card's damage LANDS.
 *
 * "hp" is the whole of Cairn's combat rule — armour, then Hit Protection, then
 * overflow into STR — and it is what every card that carries no pool at all
 * means, which is every card rolled before this existed.
 *
 * The other three are a Warden's hazard aimed straight at an ability: poison at
 * STR, a snapped tendon at DEX, a horror at WIL. They bypass armour by
 * construction, because armour stops blows and not fear; a hazard that SHOULD be
 * reduced by armour is an "hp" hazard.
 *
 * A WHITELIST, not a free string, and that is the point of naming it here: the
 * pool arrives off a stored chat card and is spliced into an update path
 * (`system.abilities.<POOL>.value`), so an unrecognised value must fall back to
 * "hp" rather than write a field nothing declares.
 */
export const DAMAGE_POOLS = ["hp", "STR", "DEX", "WIL"];

/** The status bar an ability reaching 0 announces. STR's is death. */
const POOL_ZERO_STATUS = { STR: "dead", DEX: "paralyzed", WIL: "delirious" };

export class Damage {

    /**
     * @description Apply damage to several tokens
     * @param {String[]} targets Array of Id of the targeted tokens
     * @param {Number} damage Positive number
     * @param {Scene} [scene] Scene the card was spoken in; defaults to the viewer's
     * @param {Object|null} [source] Where the damage came from — see
     *   DAMAGE_SOURCE_FLAG. OPTIONAL and defaulting to null so every existing
     *   caller (the shift-click path, the probes) keeps working and simply
     *   renders no attribution line.
     * @returns {Promise<{id: String, dmg: Number}[]>} what actually landed, per
     *   token. The caller stamps this onto the originating card so the log records
     *   that the Warden used the control and what it did; targets whose token is
     *   gone are absent, exactly as they are absent from the detail cards.
     */
    static async applyToTargets(targets, damage, scene = canvas?.scene, source = null, pool = "hp") {
        let missed = 0;
        const applied = [];
        for (const target of targets) {
            const data = await this.applyToTarget(target, damage, scene, pool);
            if (data) {
                // AWAITED, which it was not before. _showDetails now posts a
                // second card (the death bar) that must land AFTER the damage
                // card, and two un-awaited creates racing per target would also
                // let a second target's damage card overtake the first's.
                await this._showDetails({ ...data, source });   // skip targets whose token is gone
                applied.push({ id: target, dmg: data.dmg });
            }
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
        return applied;
    }

    /**
     * @description Apply damage to one token
     * @param {*} target Id of one token
     * @param {*} damage Amount of damaage
     * @param {Scene} [scene] Scene the card was spoken in; defaults to the viewer's
     * @returns actor + old and new values
     */
    static async applyToTarget(target, damage, scene = canvas?.scene, pool = "hp") {
        const token = scene?.tokens?.get(target);
        // The chat card holds token ids from the roll-time scene; the token may
        // have been deleted (a killed foe) or the GM switched scenes since.
        if (!token?.actor) return null;

        // Anything unrecognised is Cairn's ordinary rule. The value comes off a
        // stored card and is spliced into a field path below — see DAMAGE_POOLS.
        if (!DAMAGE_POOLS.includes(pool)) pool = "hp";

        // A HAZARD aimed at an ability: no armour, no Hit Protection, no
        // overflow. It is subtracted straight off the ability and floored at 0.
        //
        // abNoStatusCard for the same reason the HP path passes it: this write is
        // what paralyses (or kills) the target, so CairnActor's hook would post
        // the bar the instant it resolves — before _showDetails posts the damage
        // card that explains it. _showDetails posts it, in order.
        if (pool !== "hp") {
            const abl = Number(token.actor.system.abilities?.[pool]?.value ?? 0);
            let newAbl = abl - damage;
            if (newAbl < 0) newAbl = 0;
            await token.actor.update(
                { [`system.abilities.${pool}.value`]: newAbl },
                { abNoStatusCard: true });
            return { token, pool, dmg: damage, damage, abl, newAbl };
        }

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

        // abNoStatusCard: this write is what KILLS the target, so CairnActor's
        // _onUpdate would post the death bar the instant it resolves -- which is
        // before _showDetails posts the damage card below it, leaving the log
        // reading "Dead" above the "Damage: 5" that caused it. _showDetails posts
        // it instead, in order. See postStatusCard.
        await token.actor.update(
            { 'system.hp.value': newHp, 'system.abilities.STR.value': newStr },
            { abNoStatusCard: true });

        return { token, pool: "hp", dmg, damage, armor, hp, str, newHp, newStr };
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
     * @param {ChatMessage} [message] The card that was clicked. Given, the outcome
     *   is stamped onto it as a flag, which is what lets the card say it was used
     *   and what it did -- and what makes a second click impossible. Optional so
     *   the shift-click targeting path and any other caller still work without it.
     */
    static async onClickChatMessageApplyButton(event, html, data, scene = canvas?.scene, message = null) {
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
        //
        // GUARDED, and it has to be: an UNTARGETED card carries no data-targets
        // at all (offerUntargetedApply builds the anchor without one, because its
        // absence is the signal), so the bare `targets.split(';')` this used to do
        // threw the moment such a card was clicked. The filter also drops the
        // empty string a stray separator would otherwise leave behind.
        const targets = event.currentTarget.dataset.targets;
        let targetsList = String(targets ?? "").split(';').map((s) => s.trim()).filter(Boolean);

        // Shift Click allow to target the targeted tokens
        if (event.shiftKey) {
            // Nothing to target. Saying so beats a silent no-op -- the Warden
            // shift-clicked and would otherwise have no way to tell the gesture
            // from a broken one.
            if (!targetsList.length) {
                ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoTargetsToSelect"));
                return;
            }
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
            // Once only. The control used to leave the card exactly as it found
            // it, so nothing on the tile recorded that it had been used -- and a
            // second click applied the whole roll again, silently, to a creature
            // that had already taken it. The flag is the enforcement; the render
            // hook disabling the anchor is the affordance, and a card left open
            // in a scrolled-back log must not be a way past it.
            if (message?.getFlag(FLAG_SCOPE, DAMAGE_APPLIED_FLAG)) {
                ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DamageAlreadyApplied"));
                return;
            }

            // An UNTARGETED roll: ask who takes it. AFTER the once-only check
            // above and not before -- a card that has already been spent must not
            // open a picker, or the Warden chooses targets and is then refused.
            if (!targetsList.length) {
                targetsList = await askDamageTargets(scene);
                if (!targetsList.length) return; // dismissed, cancelled, or nothing ticked
            }

            const dmg = parseInt(html.querySelector(".dice-total").textContent);
            // Where it came from, read off the card that was clicked. Both halves
            // are already here and neither has to be captured at roll time: the
            // attacker is the message's own speaker, and the weapon is the datum
            // dmg-roll-card.html stamps precisely so the sentence can be rebuilt
            // from DATA rather than scraped back out of localized prose (the
            // attack line reads the same attribute). `nameDamageTargets` rewrote
            // that label with replaceChildren, which replaces child NODES and not
            // attributes, so data-weapon is still here after it ran.
            //
            // Nothing is localized or formatted here. Ids and the raw name travel;
            // the sentence is built per viewer at render — see DAMAGE_SOURCE_FLAG.
            const label = html.querySelector(".dmg-label");
            const source = {
                token: message?.speaker?.token ?? null,
                actor: message?.speaker?.actor ?? null,
                alias: message?.speaker?.alias ?? "",
                weapon: label?.dataset.weapon ?? "",
                // A hazard has no attacker to name, so what the line names
                // instead is the Warden's own words for it — which are the
                // card's label, still intact because the attack-line rewrite
                // stands off a hazard card. Empty for every ordinary roll.
                hazard: label?.dataset.hazard === "1"
                    ? (label.textContent ?? "").trim() : "",
            };
            // WHERE it lands rides on the card too, beside the weapon, and not
            // in the dialog that made it: the Warden may spend this card minutes
            // later, or on a second creature, and a poison must still be poison.
            // `||` and not `??` — an empty attribute is not a pool.
            const applied = await this.applyToTargets(
                targetsList, dmg, scene, source, label?.dataset.pool || "hp");
            // Only a GM reaches this line (the guard at the top), so the write
            // needs no socket relay. Token ids, not names: the summary is
            // rendered per VIEWER so it localizes and so a concealed token is
            // never named -- see nameDamageTargets in cairn.js.
            if (message && applied.length) {
                await message.setFlag(FLAG_SCOPE, DAMAGE_APPLIED_FLAG, { applied });
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
     * Show chat message details of damage done for a token.
     *
     * ASYNC since 2026-08-07, and awaited by applyToTargets: death is announced
     * by its own card and that card has to land AFTER this one, which two
     * un-awaited creates cannot guarantee.
     * @param data
     * @private
     */
    static async _showDetails(data) {

        const { token, dmg, damage, armor, hp, str, newHp, newStr, source, pool } = data

        // A HAZARD aimed at an ability. Its own branch rather than a widened HP
        // path, because almost nothing on that card applies: there is no armour
        // bracket (armour was never consulted), no Hit Protection line (HP did
        // not move), and no Scar (a Scar is what taking a hit to 0 HP costs).
        if (pool && pool !== "hp") return this._showAbilityDetails(data);


        if (str == 0) {
            // ALREADY dead before this hit, so the update was 0 -> 0 and no
            // transition fired: this bar is the only feedback the Warden gets,
            // and without it a click on a corpse does nothing visible at all --
            // the same "nothing is indistinguishable from armor absorbed it"
            // problem the missed-target warning exists for. It is a statement of
            // state rather than an announcement, which is why it is posted here
            // and not by the update hook.
            await postStatusCard(token?.actor, "dead");
            return;
        }

        // "Damage: 6 (6-0)" named neither number, and the Warden had to ask what
        // the 0 was. It is the victim's armor. Both numbers are now labelled --
        // the leading one is the RAW roll, which is not obvious on the common card
        // where it equals the result.
        //
        // ONE key holding every placeholder, not a localize() for the word "armor"
        // glued on with `+`. A translator handed fragments cannot reorder them,
        // which is the rule the two "Rolling damage with..." keys and the attack
        // line already follow. The minus is U+2212 and spaced, inside the string
        // where a translator can change it -- "6-0" read as a range.
        //
        // ARMOR 0 DROPS THE BRACKET ENTIRELY (user ruling 2026-08-07). The
        // Warden was told an absent bracket cannot distinguish "no armour" from
        // "the system did not check" and chose it anyway; this is a ruling, not an
        // oversight. It is self-consistent: armor === 0 implies dmg === damage, so
        // nothing is ever lost with the bracket -- and a hit fully absorbed by
        // armour always KEEPS its bracket, which is what stops "Damage: 0" from
        // reading like a broken card.
        const breakdown = armor > 0
            ? game.i18n.format('CAIRN.DamageBreakdown', { dmg, damage, armor })
            : String(dmg)
        let content = '<p><strong>' + game.i18n.localize('CAIRN.Damage') + '</strong>: ' + breakdown + '</p>'
        // The HP and STR lines were the same untranslatable concatenation, so they
        // move in the same breath -- one handoff to the translator rather than
        // two. ONE key SHARED by both: they are the same sentence, and a second
        // copy is a second thing to drift.
        //
        // THE VISIBLE CARD MUST NOT CHANGE HERE. Same "=>", same strike-through;
        // the arrow is kept verbatim rather than smartened to an arrow glyph,
        // because this half was sold as a translatability fix with no visual
        // consequence. It now lives in a key, so it can be changed later on
        // purpose rather than as a side effect.
        if (newHp !== hp) {
            content += '<p><strong>' + game.i18n.localize('CAIRN.HitProtection') + '</strong>: '
                + game.i18n.format('CAIRN.StatChange', { from: hp, to: newHp }) + '</p>'
        } else {
            content += '<p><strong>' + game.i18n.localize('CAIRN.HitProtection') + '</strong>: ' + hp + '</p>'
        }
        if (newStr !== str) {
            content += '<p><strong>' + game.i18n.localize('STR') + '</strong>: '
                + game.i18n.format('CAIRN.StatChange', { from: str, to: newStr }) + '</p>'
        }

        // Monsters take BOTH branches below on purpose (ratified 2026-08-01):
        // overflow past HP offers the STR-save button, and damage landing
        // exactly on 0 HP rolls a Scar. Cairn's rules carve monsters out of
        // neither, so no npcRole gate belongs here.
        // DEATH, decided here and announced below. The old code appended a bare
        // <strong>Dead</strong> to this card -- the plainest thing on it, for the
        // worst outcome in the game -- and it is now its own red status bar,
        // posted AFTER this card so the log reads "Damage: 5" and then "Dead".
        const died = newStr < str && newStr === 0;

        // Monsters take BOTH branches below on purpose (ratified 2026-08-01):
        // overflow past HP offers the STR-save button, and damage landing
        // exactly on 0 HP rolls a Scar. Cairn's rules carve monsters out of
        // neither, so no npcRole gate belongs here.
        if (newStr < str) {
            if (!died) {
                content += '<p><strong>' + game.i18n.localize('CAIRN.StrSave') + '</strong></p>'
                content += '<button type="button" class="roll-str-save">' + game.i18n.localize('CAIRN.RollStrSave') + '</button>'
            }
        } else if (newHp === 0 && hp !== 0) {
            content += '<p class="cairn-scar-banner">' + game.i18n.localize('CAIRN.Scars') + '</p>'
            // The TOKEN goes with it, or the scar card is posted in someone else's
            // name -- see _rollScarsTable. Deliberately NOT awaited even though
            // this method is async now: the damage card below must land first,
            // and the draw is slower than it. Catch here -- an unhandled
            // rejection mid-damage-resolution is silent.
            this._rollScarsTable(dmg, token).catch((err) => {
                console.error("Air Bladder | the Scars draw failed:", err);
            });
        }

        // The source rides as a FLAG in the CREATE data — one write, not a
        // setFlag afterwards, which would be a second update every viewer has to
        // re-render for. Omitted entirely when there is none, so a card carrying
        // no attribution is indistinguishable from every card already in the log.
        const messageData = {
            user: game.user._id,
            speaker: ChatMessage.getSpeaker({ token: token }),
            content: content,
        }
        if (source) messageData.flags = { [FLAG_SCOPE]: { [DAMAGE_SOURCE_FLAG]: source } }
        await ChatMessage.create(messageData, {})

        // AFTER the damage card, and that ordering is the whole reason this is
        // posted here rather than from CairnActor's update hook -- see
        // postStatusCard's docblock.
        if (died) await postStatusCard(token?.actor, "dead");
    }

    /**
     * The detail card for a hazard aimed at an ability.
     *
     * Its own method rather than a widened `_showDetails`, because almost
     * nothing on the combat card applies here: no armour bracket (armour was
     * never consulted), no Hit Protection line (HP did not move), no Scar (a
     * Scar is what taking a hit to exactly 0 HP costs). What DOES carry over is
     * carried over rather than restated — the same `CAIRN.StatChange` key the
     * HP and STR lines use, the same STR-save button, the same source flag, and
     * the same status bars.
     *
     * @param data  from applyToTarget's ability branch
     * @private
     */
    static async _showAbilityDetails(data) {

        const { token, dmg, abl, newAbl, source, pool } = data

        let content = '<p><strong>' + game.i18n.localize('CAIRN.Damage') + '</strong>: ' + dmg + '</p>'
        content += '<p><strong>' + game.i18n.localize(pool) + '</strong>: '
            + game.i18n.format('CAIRN.StatChange', { from: abl, to: newAbl }) + '</p>'

        // STR loss owes a save, and it is not a second rule: combat's branch is
        // `newStr < str`, which direct STR damage lands in unchanged. Withheld
        // from a corpse for the reason it is there — the save decides whether the
        // character takes Critical Damage, and there is nothing left to decide.
        const zeroed = newAbl === 0 && abl > 0;
        const died = pool === "STR" && zeroed;
        if (pool === "STR" && newAbl < abl && !died) {
            content += '<p><strong>' + game.i18n.localize('CAIRN.StrSave') + '</strong></p>'
            content += '<button type="button" class="roll-str-save">' + game.i18n.localize('CAIRN.RollStrSave') + '</button>'
        }

        const messageData = {
            user: game.user._id,
            speaker: ChatMessage.getSpeaker({ token: token }),
            content: content,
        }
        if (source) messageData.flags = { [FLAG_SCOPE]: { [DAMAGE_SOURCE_FLAG]: source } }
        await ChatMessage.create(messageData, {})

        // AFTER the damage card, which is the whole reason applyToTarget passed
        // abNoStatusCard on the write: DEX 0 is paralyzed, WIL 0 is delirious,
        // STR 0 is death, and a bar posted from the update hook would land above
        // the card that explains it.
        if (zeroed) await postStatusCard(token?.actor, POOL_ZERO_STATUS[pool]);
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
