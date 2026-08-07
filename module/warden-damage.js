import { evaluateFormula } from "./utils.js";
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
 * line). What is genuinely new is a way to open the dialog, and the POOL.
 *
 * It lives in its own file rather than in `utils.js` because it owns a Foundry
 * surface — the scene-controls palette — that nothing else here touches.
 */

const CARD_TEMPLATE = "systems/air-bladder/templates/chat/dmg-roll-card.html";

/** What the formula field starts at. A d6 trap is the commonest thing there is. */
const DEFAULT_FORMULA = "1d6";

/**
 * Add the Warden's damage tool to the Token controls.
 *
 * The shipped client documents this exact case — `hooks.mjs:393-409` is a
 * GM-only `button: true` tool added at `controls.tokens.tools.<name>` with an
 * `onChange` that opens an application — so there is no API to guess at.
 *
 * `controls` and each control's `tools` are RECORDS keyed by name, not arrays
 * (`applications/ui/scene-controls.mjs:382-392`). Pushing onto them fails
 * silently, which is the trap worth knowing before writing another one.
 *
 * `visible` IS NOT A LIVE GATE. `#prepareControls` runs once, when the palette
 * is first rendered, and later renders reuse the structure
 * (`scene-controls.mjs:378-380`). That is correct for a GM check — nobody's role
 * changes mid-session — but it is an affordance and never the enforcement:
 * `openWardenDamage` refuses on its own, the way
 * `onClickChatMessageApplyButton` does.
 */
export const registerWardenDamageControl = () => {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tools = controls?.tokens?.tools;
    if (!tools) return;   // core renamed or removed the control set
    tools.abWardenDamage = {
      name: "abWardenDamage",
      title: "CAIRN.WardenDamage.Tool",
      icon: "fas fa-skull-crossbones",
      // Last in the palette. `order` is read for the default-tool sort and for
      // placement; appending means core's own tools keep the positions a
      // Warden's hands already know.
      order: Object.keys(tools).length,
      button: true,
      visible: game.user.isGM,
      onChange: () => {
        // Not awaited — `onChange` is fire-and-forget, and an unhandled
        // rejection out of a click handler is silent.
        openWardenDamage().catch((err) => {
          console.error("Air Bladder | the Warden's damage dialog failed:", err);
        });
      },
    };
  });
};

/**
 * Build the dialog's fields.
 *
 * An HTMLDivElement rather than a string, which is the security property here:
 * DialogV2 runs a STRING through `cleanHTML` but takes an element's innerHTML
 * VERBATIM (`options.content = options.content.innerHTML`, dialog.mjs:186-190),
 * and `cleanHTML`'s allow-list would strip the placeholder off the text input.
 * The outer div must carry NO attributes at all — core throws on any (:189).
 *
 * Every value is set with `setAttribute` and never as a property. The element is
 * serialized to HTML and re-parsed, so `input.value = x` sets an IDL property
 * that does NOT reflect into the markup and arrives empty, silently — the same
 * trap the target picker's checkboxes documented.
 */
const buildForm = () => {
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

/**
 * Ask the Warden what happened, roll it, and post an ordinary damage card.
 *
 * WARDEN ONLY, stated here as well as by the tool's `visible` flag: the tool
 * being absent is the affordance, this is the enforcement, and it is the half
 * that survives someone reaching the function another way. Deciding what
 * happened to somebody else's character is the Warden's call.
 *
 * TARGETS come from `game.user.targets`, exactly as `#onRollDamage` does, so a
 * Warden who aimed first gets one gesture and one who did not gets the splat and
 * the picker. That is NOT the pre-tick the target picker rejected: targeting is
 * an aiming gesture the Warden made, where the pre-tick was a guess read off the
 * canvas selection.
 *
 * @return {Promise<ChatMessage|null>} the card, or null if nothing was rolled
 */
export const openWardenDamage = async () => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.WardenDamageWardenOnly"));
    return null;
  }

  const answer = await foundry.applications.api.DialogV2.wait({
    classes: ["cairn-warden-damage"],
    window: { title: game.i18n.localize("CAIRN.WardenDamage.Title") },
    content: buildForm(),
    buttons: [
      {
        action: "roll",
        label: "CAIRN.WardenDamage.Roll",
        icon: "fa-solid fa-burst",
        default: true,
        // DialogV2 hands the callback the clicked BUTTON, and `button.form` is
        // the dialog's form. Returning an OBJECT is what tells a real answer
        // from Cancel, which resolves to its action string, and from a dismissal,
        // which resolves to null — the same discriminator askDamageTargets uses,
        // and the reason neither can be mistaken for a choice.
        callback: (event, button) => ({
          source: button.form.elements.source.value.trim(),
          formula: button.form.elements.formula.value.trim(),
          pool: button.form.elements.pool.value,
        }),
      },
      { action: "cancel", label: "CAIRN.Cancel", icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  if (!answer || typeof answer !== "object") return null;

  const { source, formula, pool } = answer;
  // Refused rather than defaulted. A hazard with no damage is not a hazard, and
  // silently substituting a die would apply a number the Warden never chose.
  // `Roll.validate` evaluates a copy with data references stubbed
  // (dice/roll.mjs:773-788), so it accepts "@abilities.STR.value" too.
  if (!formula || !Roll.validate(formula)) {
    ui.notifications.warn(
      game.i18n.format("CAIRN.Notify.WardenDamageBadFormula", { formula: formula || "" }));
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
  // gesture before opening this dialog routinely leaves them with — would have
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
