import { evaluateFormula, composeDiceFormula, parseDiceFormula, DIE_ICONS, dieIcon } from "./utils.js";
import { DAMAGE_POOLS } from "./damage.js";
import { SETTINGS_NS } from "./settings.js";

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
 * An HTMLDivElement rather than a string. DialogV2 runs a STRING through
 * `cleanHTML` but takes an element's innerHTML VERBATIM
 * (`options.content = options.content.innerHTML`, dialog.mjs:187-191), so the
 * element path is the one that is NOT sanitized. Safe here for a reason worth
 * stating rather than assuming: every node below is built in code, and every
 * value is a localized string or a literal — no authored content is
 * interpolated. Interpolate any, and this must go back to being a string.
 *
 * Until 2026-08-07 this comment justified the element by claiming `cleanHTML`
 * would strip the placeholder off the text input. It would not: `placeholder`
 * is in core's `input` allow-list (`common/constants.mjs:1863-1866`), `class`
 * is global (:1839-1841), and `select`/`option` keep `name`/`value`/`selected`
 * — nothing in this form would be touched. The element that lacks
 * `placeholder` is `textarea` (:1885).
 *
 * The outer div must BE a div and carry NO attributes at all — core throws on
 * each separately (dialog.mjs:188-189).
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

  // The dice builder. It writes INTO the formula field and holds no state of
  // its own — every click re-reads the field through `parseDiceFormula`, so a
  // hand edit is never clobbered, and nothing downstream can tell a built
  // formula from a typed one. When the field says something the buttons cannot
  // (`2d6 + 3`, an `@ref`), they grey out and the field stays fully editable:
  // the greying is the affordance, and there is nothing to enforce because the
  // field is authoritative.
  //
  // Every <button> is `type="button"` EXPLICITLY: DialogV2 renders content
  // inside a <form>, where a bare <button> is type=submit — a die click would
  // submit the dialog and close it.
  //
  // Listeners are NOT attached here. This element is serialized to innerHTML
  // and re-parsed (dialog.mjs:187-191), so anything wired now is dead on
  // arrival; `openWardenDamage` wires the LIVE nodes in its `render` callback.
  const builder = document.createElement("div");
  builder.className = "wd-dice-builder";

  const diceRow = document.createElement("div");
  diceRow.className = "wd-dice-row";
  for (const size of [...DIE_ICONS].sort((a, b) => a - b)) {
    const btn = document.createElement("button");
    btn.setAttribute("type", "button");
    btn.className = "wd-die";
    btn.setAttribute("data-die", String(size));
    btn.setAttribute("data-tooltip", game.i18n.format("CAIRN.WardenDamage.AddDie", { die: `d${size}` }));
    const icon = document.createElement("i");
    icon.className = dieIcon(`d${size}`);
    const label = document.createElement("span");
    label.textContent = `d${size}`;
    btn.append(icon, label);
    diceRow.append(btn);
  }
  const clear = document.createElement("button");
  clear.setAttribute("type", "button");
  clear.className = "wd-clear";
  clear.setAttribute("data-tooltip", game.i18n.localize("CAIRN.WardenDamage.Clear"));
  const clearIcon = document.createElement("i");
  clearIcon.className = "fa-solid fa-xmark";
  clear.append(clearIcon);
  diceRow.append(clear);
  builder.append(diceRow);

  const modeRow = document.createElement("div");
  modeRow.className = "wd-mode-row";
  for (const [value, key] of [["sum", "CAIRN.WardenDamage.Sum"], ["kh", "CAIRN.WardenDamage.KeepHighest"]]) {
    const lbl = document.createElement("label");
    const radio = document.createElement("input");
    radio.setAttribute("type", "radio");
    radio.setAttribute("name", "diceMode");
    radio.setAttribute("value", value);
    // `checked` as an ATTRIBUTE — a property never reaches the serialized markup.
    if (value === "sum") radio.setAttribute("checked", "");
    const text = document.createElement("span");
    text.textContent = game.i18n.localize(key);
    lbl.append(radio, text);
    modeRow.append(lbl);
  }
  builder.append(modeRow);
  content.append(builder);

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
 * Wire the dice builder onto the dialog's LIVE nodes.
 *
 * Called from DialogV2's `render` option (dialog.mjs:405, :420-422) — the seam
 * the client's own docs point at for exactly this ("the element will get
 * stringified, so any listeners … will not carry forward; you must still use
 * the `render` option", dialog.mjs:152-155). The same rule the background
 * picker's eye toggles already follow via `dialog.render(true).then(...)`.
 *
 * THE FIELD IS THE ONLY STATE. Every gesture is read-modify-write against the
 * formula input via `parseDiceFormula` / `composeDiceFormula`:
 *
 *  - a die button parses the field, appends its die, recomposes;
 *  - a mode radio recomposes the same dice under the new mode;
 *  - ✕ EMPTIES the field (user ruling — ✕ means clear, the buttons are the way
 *    back; only opening the dialog pre-fills 1d6);
 *  - a hand edit re-greys or re-enables on every keystroke.
 *
 * The DIALECT is read from the setting ONCE here and passed as an argument —
 * `composeDiceFormula` itself reads nothing, which is what lets a probe drive
 * both dialects with zero world writes against a `requiresReload` setting.
 */
const wireDiceBuilder = (root) => {
  const field = root.querySelector('input[name="formula"]');
  const dice = [...root.querySelectorAll(".wd-die")];
  const clear = root.querySelector(".wd-clear");
  const radios = [...root.querySelectorAll('input[name="diceMode"]')];
  if (!field || !dice.length || !clear || !radios.length) return;
  const cairnNotation = game.settings.get(SETTINGS_NS, "use-cairn-dice-notation");

  const mode = () => radios.find((r) => r.checked)?.value ?? "sum";
  const refresh = () => {
    const parsed = parseDiceFormula(field.value);
    const off = parsed === null;
    for (const el of [...dice, ...radios]) el.disabled = off;
    // The string decides the mode where it can (2d6 is a sum, d6 + d6 a keep-
    // highest); a single die or an empty field leaves the radios where they are.
    if (parsed?.mode) for (const r of radios) r.checked = r.value === parsed.mode;
  };

  for (const btn of dice) {
    btn.addEventListener("click", () => {
      const parsed = parseDiceFormula(field.value);
      if (parsed === null) return; // disabled anyway; a race is not a crash
      parsed.sizes.push(Number(btn.dataset.die));
      field.value = composeDiceFormula(parsed.sizes, mode(), { cairnNotation });
      refresh();
    });
  }
  for (const r of radios) {
    r.addEventListener("change", () => {
      const parsed = parseDiceFormula(field.value);
      if (parsed === null || !parsed.sizes.length) return;
      field.value = composeDiceFormula(parsed.sizes, mode(), { cairnNotation });
      refresh();
    });
  }
  clear.addEventListener("click", () => {
    field.value = "";
    refresh();
  });
  field.addEventListener("input", refresh);
  refresh();
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
    // The dice builder's listeners go on the LIVE nodes — see wireDiceBuilder.
    render: (event, dialog) => wireDiceBuilder(dialog.element),
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
