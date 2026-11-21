import { evaluateFormula, buildDiceBuilder } from "./utils.js";
import { DAMAGE_POOLS } from "./damage.js";

/**
 * The Warden's damage: traps, environments, conditions.
 *
 * Every other damage path in this system starts at a weapon on somebody's
 * sheet, so a pit, a poison, a fright and a failed save against exhaustion had
 * to be applied by hand on each sheet — with no card, no STR save, no Scar, no
 * death bar, and nothing in the log.
 *
 * A HAZARD IS A WEAPON NOBODY IS HOLDING, and that is the whole design. Almost
 * none of this is new: everything downstream of the roll is already
 * source-agnostic — `applyToTarget` wants a token id, a number and a scene and
 * has no notion of who swung — so this posts the ORDINARY damage card and the
 * flow that already ships does the rest (the splat, `askDamageTargets`, the
 * detail cards, the STR save, the Scar draw, the status bars, the attribution
 * line). What is genuinely new is a way to say what happened, and the POOL.
 *
 * The Damage page of the Warden's Dashboard since 2026-11-21 (it was its own
 * dialog): the Dashboard draws `buildForm`'s fields and its Roll button calls
 * `rollWardenDamage`.
 */

const CARD_TEMPLATE = "systems/air-bladder/templates/chat/dmg-roll-card.html";

/** What the formula field starts at. A d6 trap is the commonest thing there is. */
const DEFAULT_FORMULA = "1d6";

/* The Token-controls skull lived here until 2026-11-21; it opens the Damage
   page of the Warden's Dashboard now, and is registered with the Dashboard's
   other two tools in warden-dashboard.js (`registerWardenDashboardControl`). */

/**
 * Build the Damage page's fields: a hint, Source, Damage, the dice builder and
 * Applies to (a dialog's content until 2026-11-21; the Dashboard appends this
 * element to its `damage` part now).
 *
 * Built in code, not a template, so it stayed one builder when it changed
 * hosts. Every value is a localized string or a literal — no authored content
 * is interpolated — and it is appended as nodes, never parsed from a string.
 *
 * Values go in with `setAttribute`, which is the field's DEFAULT: it was
 * required while DialogV2 serialized this element (a property set with
 * `input.value = x` never reaches the markup), and it is still what a fresh
 * page should start at.
 */
export const buildForm = () => {
  const content = document.createElement("div");

  const hint = document.createElement("p");
  hint.textContent = game.i18n.localize("CAIRN.WardenDamage.Hint");
  content.append(hint);

  const group = (labelKey, control) => {
    const wrap = document.createElement("div");
    wrap.className = "form-group";
    const label = document.createElement("label");
    label.textContent = game.i18n.localize(labelKey);
    const fields = document.createElement("div");
    fields.className = "form-fields";
    fields.append(control);
    wrap.append(label, fields);
    content.append(wrap);
  };

  const source = document.createElement("input");
  source.setAttribute("type", "text");
  source.setAttribute("name", "source");
  source.setAttribute("placeholder", game.i18n.localize("CAIRN.WardenDamage.SourcePlaceholder"));
  group("CAIRN.WardenDamage.Source", source);

  const formula = document.createElement("input");
  formula.setAttribute("type", "text");
  formula.setAttribute("name", "formula");
  formula.setAttribute("value", DEFAULT_FORMULA);
  group("CAIRN.WardenDamage.Formula", formula);

  // The dice builder. It lives in utils.js: it was factored out there when a
  // second dialog wanted it, and stayed when that dialog stopped wanting it.
  content.append(buildDiceBuilder());

  const pool = document.createElement("select");
  pool.setAttribute("name", "pool");
  for (const value of DAMAGE_POOLS) {
    const opt = document.createElement("option");
    opt.setAttribute("value", value);
    // "hp" is Cairn's combat rule and is named for what it hits; the other three
    // ARE ability keys, and those keys are already localized (STR/FUE).
    opt.textContent = game.i18n.localize(value === "hp" ? "CAIRN.HitProtection" : value);
    if (value === "hp") opt.setAttribute("selected", "");
    pool.append(opt);
  }
  group("CAIRN.WardenDamage.Pool", pool);

  return content;
};

/* `wireDiceBuilder` (utils.js) wires the dice builder; the Dashboard calls it on
   each render of the Damage page, on the LIVE nodes. */

/**
 * Roll what the Warden typed on the Damage page and post an ordinary damage card.
 *
 * WARDEN ONLY, stated here as well as by the tool's `visible` flag and the
 * Dashboard's own refusal: this is the half that survives someone reaching the
 * function another way. Deciding what happened to somebody else's character is
 * the Warden's call.
 *
 * TARGETS come from `game.user.targets`, exactly as `#onRollDamage` does, so a
 * Warden who aimed first gets one gesture and one who did not gets the splat and
 * the picker. That is NOT the pre-tick the target picker rejected: targeting is
 * an aiming gesture the Warden made, where the pre-tick was a guess read off the
 * canvas selection.
 *
 * @param {{source?: string, formula?: string, pool?: string}} fields
 * @return {Promise<ChatMessage|null>} the card, or null if nothing was rolled
 */
export const rollWardenDamage = async ({ source = "", formula = "", pool = "hp" } = {}) => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.WardenDamageWardenOnly"));
    return null;
  }
  source = String(source).trim();
  formula = String(formula).trim();
  if (!DAMAGE_POOLS.includes(pool)) pool = "hp";
  // Refused rather than defaulted. A hazard with no damage is not a hazard, and
  // silently substituting a die would apply a number the Warden never chose.
  //
  // `@` REFERENCES ARE REFUSED TOO, and the two stubs are why: `Roll.validate`
  // replaces every `@ref` with "1" before evaluating (dice/roll.mjs:772-790), so it
  // ACCEPTS them -- while `Roll.parse` resolves them against roll data with
  // `{missing: "0"}` (:689-701, :735-743), and a hazard has no actor to supply any.
  // So the validator said yes to a formula the evaluator then silently gutted:
  // "1d6 + @abilities.STR.value" rolled as "1d6 + 0" with no warning anywhere. A
  // hazard genuinely has nothing to resolve against, so refusing is the honest
  // answer rather than a workaround. This comment used to claim the opposite.
  if (!formula || formula.includes("@") || !Roll.validate(formula)) {
    ui.notifications.warn(
      "CAIRN.Notify.WardenDamageBadFormula", { format: { formula: formula || "" } });
    return null;
  }

  const roll = await evaluateFormula(formula, {});
  const targeted = Array.from(game.user.targets).map((tk) => tk.id);
  const flavor = await foundry.applications.handlebars.renderTemplate(CARD_TEMPLATE, {
    // The Warden's own words are the card's label, VERBATIM. The attack-line
    // rewrite stands off a hazard card (that is what data-hazard is for), so
    // what they wrote is what the log shows and what the detail cards attribute
    // to. With none, the card carries the die alone — which is still a card the
    // splat can spend, and inventing "Hazard" for them would be worse.
    label: source,
    weapon: "",
    targets: targeted.length ? targeted.join(";") : null,
    pool,
    hazard: true,
  });

  // NOT a bare `ChatMessage.getSpeaker()`. With no arguments it falls through to
  // "infer from controlled tokens" and then to the user's impersonated actor
  // (chat-message.mjs:243-255), so a Warden with a token selected — which the
  // gesture before rolling routinely leaves them with — would have
  // posted the trap in that creature's name. The user speaker is built the way
  // core builds it (chat-message.mjs:307-314); a trap has no actor and no token,
  // and saying so is honest.
  const speaker = {
    scene: canvas?.scene?.id ?? null,
    actor: null,
    token: null,
    alias: game.user.name,
  };
  return roll.toMessage({ speaker, flavor });
};
