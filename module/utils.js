import { SETTINGS_NS } from "./settings.js";
import { tokenDisplayName } from "./i18n-content.js";
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

/* -------------------------------------------- */
/*  Impaired / Enhanced damage                  */
/* -------------------------------------------- */

/**
 * Cairn has no advantage or disadvantage. A damage roll is STANDARD (the weapon's
 * own die), IMPAIRED (1d4 whatever the weapon is) or ENHANCED (1d12 whatever the
 * weapon is). 2e p.10.
 *
 * The die is REPLACED wholesale — it is not a penalty term added to the formula,
 * and that distinction is load-bearing here, not stylistic: this system overloads
 * "+" so `d8 + d8` means keep-highest (see evaluateFormula above). An
 * implementation that appended a term would silently mean something else.
 */
export const IMPAIRED_FORMULA = "1d4";
export const ENHANCED_FORMULA = "1d12";

/**
 * The formula a damage roll of the given quality uses.
 *
 * **INDEPENDENT OF PANIC, and that is the whole point of the seam.** The only d4
 * substitution that existed before this lived inside panic's branch, gated on the
 * `use-panic` SETTING — so building impaired by extending it would have made a
 * core Cairn rule vanish for any table that turns panic off. Nothing in this
 * function reads a setting or an actor: the caller hands in whatever a STANDARD
 * roll would be for this character RIGHT NOW, and impaired/enhanced override it
 * or "standard" keeps it.
 *
 * There is no collision to rule on. Panic IMPOSES impaired and never opens the
 * dialog (user ruling 2026-08-07), so a panicked character reaches this as
 * quality "impaired" and gets 1d4 from the same branch every other impaired roll
 * uses — panic substitutes no formula of its own any more. The earlier reading,
 * where panic and an Enhanced choice collided and "the later one wins", is
 * SUPERSEDED; do not restore it.
 *
 * @param {"impaired"|"standard"|"enhanced"} quality
 * @param {String} standardFormula  what this roll would be without the choice
 * @return {String}
 */
export const damageFormulaFor = (quality, standardFormula) =>
  quality === "impaired" ? IMPAIRED_FORMULA
    : quality === "enhanced" ? ENHANCED_FORMULA
      : standardFormula;

/**
 * The badge a card shows for an impaired or enhanced roll, and "" for a standard
 * one — a card that says nothing is saying the roll was ordinary, which is most
 * of them. Its own line on the card rather than folded into
 * the flavor sentence: there are already two whole-sentence damage keys (weapon,
 * weapon-panicked) and the attack line makes two more — multiplying those by
 * three qualities is how a translator ends up with a dozen sentences to keep in
 * step.
 *
 * `panicked` gets its own badge because the flavor that used to carry "(Panic)"
 * is REPLACED by the attack line whenever there is a target, so without this the
 * table would see "Impaired" with nothing saying why. It says both.
 *
 * @param {String} quality
 * @param {Object} [opts]
 * @param {Boolean} [opts.panicked]  panic imposed this, rather than a choice
 * @return {String}
 */
export const damageQualityLabel = (quality, { panicked = false } = {}) => {
  if (quality === "impaired") {
    return game.i18n.localize(
      panicked ? "CAIRN.DamageQuality.BadgePanic" : "CAIRN.DamageQuality.BadgeImpaired");
  }
  if (quality === "enhanced") return game.i18n.localize("CAIRN.DamageQuality.BadgeEnhanced");
  return "";
};

/** The dice Font Awesome actually ships a glyph for. */
const DIE_ICONS = new Set([4, 6, 8, 10, 12, 20]);

/**
 * The Font Awesome class for a formula's die, or "" if it names none.
 *
 * NO `\b` before the `d`. There is no word boundary between the digits and the
 * `d` in "2d6", so `\bd(\d+)` matches NOTHING on the commonest multi-die
 * formula — every such weapon would quietly lose its icon while d6 weapons kept
 * theirs, which reads as a font problem rather than a regex one.
 *
 * A formula naming no standard die gets NO icon rather than a generic
 * pair-of-dice glyph (user ruling): `_renderButtons` does `if (icon)`
 * (dialog.mjs:243), so "" simply omits the `<i>`, and nothing on the button can
 * then state a die the roll will not use.
 *
 * @param {String} formula
 * @return {String}  a class list, or "" for no icon at all
 */
const dieIcon = (formula) => {
  const n = Number(/d(\d+)/i.exec(String(formula ?? ""))?.[1]);
  return DIE_ICONS.has(n) ? `fa-solid fa-dice-d${n}` : "";
};

/**
 * Ask whether this damage roll is impaired, standard or enhanced.
 *
 * ONE helper, called by both producers — the sheet's damage control and
 * `macros.js`, which builds the same card independently. The panic substitution
 * was written twice and drifted; this is not repeating that.
 *
 * The FIRST button shows the WEAPON's own die, so a d6 weapon offers d6 / d4 /
 * d12 and the player sees what they are choosing rather than three words. Each
 * button also carries that die's Font Awesome glyph — see `dieIcon`.
 *
 * "Standard", not "Normal" (user ruling 2026-08-07). The i18n KEY was renamed
 * with the copy and so was the action string, so there is one word for the
 * concept everywhere; a key reading `.Normal` under a button reading "Standard"
 * is the kind of drift a translator has no way to resolve.
 *
 * DialogV2 notes, all three of which this repo has paid for:
 *   - Buttons carry `action` and NO callback. `DialogV2` resolves a button to
 *     `(await callback(...)) ?? button.action` (dialog.mjs:273), so a callback
 *     returning null is indistinguishable from no callback at all. Having none
 *     means the resolved value is exactly the action string, with no trap to
 *     step in.
 *   - Nothing is built in JS and handed to `content`: DialogV2 serializes it to
 *     innerHTML, so listeners on constructed nodes are dead on arrival. The three
 *     choices ARE the dialog's buttons.
 *   - `rejectClose: false`, so dismissing resolves rather than throwing.
 *   - `icon`, `class` and `tooltip` are all supported per button
 *     (dialog.mjs:227-246), so the decoration below needs no custom markup and
 *     stays clear of `content` entirely.
 *
 * ORDER: STANDARD, impaired, enhanced (user ruling 2026-08-07), superseding the
 * first cut's "impaired → standard → enhanced is the scale the rule is described
 * in". The default leads, which is where the eye starts and where autofocus
 * already sat. It also closes a latent trap: `isDefault` falls back to
 * `(i === 0) && !buttons.some(b => b.default)` (dialog.mjs:228), so with Impaired
 * at index 0, dropping `default: true` would silently have made IMPAIRED the
 * button Enter presses.
 *
 * @param {String} standardFormula  the weapon's die, shown on the first button
 * @param {String} [weaponName]  the item the roll came from, named in the title.
 *   Verbatim and never re-localized, for the reason the card's weapon datum is:
 *   `item.name` is already the display name, and translating it per viewer would
 *   need a reverse lookup into a MANY-TO-ONE overlay.
 * @return {Promise<"impaired"|"standard"|"enhanced"|null>} null = dismissed, and
 *   a dismissal must roll NOTHING — a ✕ is an instruction, not a default.
 */
export const askDamageQuality = async (standardFormula, weaponName = "") => {
  const opt = (action, key, formula) => ({
    action,
    label: game.i18n.format(key, { formula }),
    icon: dieIcon(formula),
  });
  const chosen = await foundry.applications.api.DialogV2.wait({
    // Scopes the stacking and default-cue rules. `classes` CONCATENATES with
    // ApplicationV2's own (application.mjs:477) rather than replacing them, so
    // `dialog.dialog` still matches — worth knowing before adding one, since a
    // replacing merge would have broken every selector that names it.
    classes: ["cairn-damage-quality"],
    // TWO keys, not one with an empty placeholder. A roll made from a control
    // with no label has no weapon at all, and a dangling "— " is not something a
    // translator can repair — the same rule the two attack-line keys follow.
    window: {
      title: weaponName
        ? game.i18n.format("CAIRN.DamageQuality.TitleWeapon", { weapon: weaponName })
        : game.i18n.localize("CAIRN.DamageQuality.Title"),
    },
    content: `<p>${game.i18n.localize("CAIRN.DamageQuality.Prompt")}</p>`,
    buttons: [
      {
        ...opt("standard", "CAIRN.DamageQuality.Standard", standardFormula),
        // Enter rolls the ordinary roll, which is most of them. But `default:
        // true` emits ONLY `autofocus` (dialog.mjs:242) — no class, no attribute
        // of its own — and core ships no `button[autofocus]` rule, so which
        // button Enter presses is invisible unless we say so. The class is that
        // cue for a sighted reader; `tooltip` is the same fact for a screen
        // reader, since it lands in `aria-label` (dialog.mjs:239-241).
        default: true,
        class: "cairn-quality-default",
        tooltip: "CAIRN.DamageQuality.DefaultTip",
      },
      opt("impaired", "CAIRN.DamageQuality.Impaired", IMPAIRED_FORMULA),
      opt("enhanced", "CAIRN.DamageQuality.Enhanced", ENHANCED_FORMULA),
    ],
    rejectClose: false,
  });
  return chosen ?? null;
};

/* -------------------------------------------- */
/*  Who takes the damage                        */
/* -------------------------------------------- */

/**
 * The subset of token ids this VIEWER may be told about, as display names.
 *
 * One function, because the attack line, the applied-damage summary and the
 * target picker must conceal the same tokens and a second copy of this test is a
 * second thing to get wrong. Order is preserved so a caller can zip names back
 * against its own data.
 *
 * Lives here rather than in `cairn.js` (where it was written) because
 * `askDamageTargets` below needs it and `damage.js` calls that — importing back
 * into `cairn.js` would be a cycle, and copying it would be the second copy this
 * docblock exists to prevent.
 *
 * @param {String[]} ids
 * @param {Scene} [scene]
 * @return {{id: String, name: String}[]}
 */
export const nameableTokens = (ids, scene) => {
  const out = [];
  for (const id of ids) {
    const tok = scene?.tokens?.get(id);
    if (!tok) continue; // killed since, or the scene is gone
    // Core's own test for whether a user may be shown a token at all:
    // Combatant#visible is `this.isOwner || !this.hidden`
    // (documents/combatant.mjs:82-84). A token the Warden has hidden must not be
    // named in a card every player reads; a GM owns everything, so the Warden
    // still gets the whole sentence.
    if (tok.hidden && !tok.isOwner) continue;
    // And the second concealment channel, which is not the same one: a SECRET
    // disposition hides a token from anyone below OBSERVER on it
    // (TokenDocument#isSecret, documents/token.mjs:341-343). Evaluated on the
    // VIEWER's client, so the Warden's copy is unaffected. Not folded into the
    // test above — `hidden` is "the Warden took it off the board", SECRET is
    // "this one is not for the players", and a Warden may use either.
    if (tok.isSecret) continue;
    out.push({ id, name: tokenDisplayName(tok) });
  }
  return out;
};

/**
 * Who may be told this token's NAME — as a whisper list, or null for "everybody".
 *
 * `nameableTokens` above answers the same question, but it answers it for the
 * CURRENT client, which is exactly wrong here. Both of its concealment channels
 * are viewer-evaluated — `hidden` is paired with `isOwner`, and `TokenDocument
 * #isSecret` is literally `disposition === SECRET && !testUserPermission(game.user,
 * "OBSERVER")` (documents/token.mjs:341-343). The card is CREATED on the Warden's
 * client, and a GM owns and observes everything, so asking there always returns
 * "visible" and would conceal nothing.
 *
 * So the same two rules are re-stated per USER instead of per client. They must
 * stay in step with `nameableTokens`: a viewer who would be shown the name in the
 * attack line must be a viewer who receives the cards that follow it, or the
 * concealment moves rather than holds.
 *
 * Why a whisper at all: the roll card withholds the name and the detail, Scar and
 * status cards that follow are spoken AS the token, so its name lands in
 * `message-sender` for every reader (`templates/sidebar/chat-message.hbs:4`,
 * fed by `alias` at `documents/chat-message.mjs:433`). Suppressing just the header
 * was rejected — a player who cannot know the creature exists should not be told
 * something took 6 damage either (user ruling, 2026-08-07).
 *
 * ONE CAVEAT that decides where this may be used: `ChatMessage#visible` returns
 * true for a whispered message when `isRoll` (`chat-message.mjs:101-104`), so a
 * card carrying a Roll CANNOT be concealed this way. Every call site here posts a
 * plain `ChatMessage.create`, and the Scars card deliberately does not forward its
 * roll — see `_rollScarsTable`. Attach a roll to any of them and this silently
 * stops working.
 *
 * @param {TokenDocument} [token]
 * @return {String[]|null}  user ids to whisper to, or null to post publicly
 */
export const concealmentWhisper = (token) => {
  if (!token) return null;
  const mayName = (user) => {
    if (user.isGM) return true;
    if (token.hidden && !token.testUserPermission(user, "OWNER")) return false;
    if (token.disposition === CONST.TOKEN_DISPOSITIONS.SECRET
      && !token.testUserPermission(user, "OBSERVER")) return false;
    return true;
  };
  const allowed = game.users.filter(mayName);
  // Public is the default and must stay indistinguishable from a card that never
  // considered concealment — an empty `whisper` is what every existing card has.
  return allowed.length === game.users.size ? null : allowed.map((u) => u.id);
};

/**
 * Ask the Warden who takes an UNTARGETED damage roll.
 *
 * A roll made with nothing targeted used to carry no Apply control at all, so the
 * number sat in the log and had to be applied by hand on the creature's sheet —
 * and nothing recorded that it ever landed. The machinery was always there
 * (`applyToTarget` wants a token id and a scene, and has no notion of "was this
 * targeted"); only the answer to "who?" was missing.
 *
 * It ALWAYS confirms, and it **PROPOSES NOBODY** (user ruling 2026-08-07,
 * superseding the first cut). Applying damage decides what happened to somebody
 * else's character, and a control that reads the canvas silently would make the
 * most consequential click in the log depend on state the Warden cannot see from
 * the log.
 *
 * The first cut pre-ticked the canvas selection, and in play it proposed the
 * ATTACKER as her own victim. That is not bad luck: the gesture that PRECEDES a
 * damage roll — opening a combatant's sheet, usually by double-clicking its token
 * — SELECTS the roller. So the heuristic was biased toward exactly the wrong
 * answer, and most reliably wrong in the commonest case.
 *
 * A targets-only variant (`game.user.targets`, which has no such bias, since
 * targeting is aiming where selection is controlling) was offered and rejected
 * too. **Nothing is pre-ticked; do not re-propose a smarter default.** A wrong
 * default is worse than no default, and the cost is one tick.
 *
 * Two groups, monsters first — that is the common case — and PCs listed rather
 * than filtered out, because falling damage and friendly fire are real and a
 * filter would have to guess. Nothing re-sorts under the Warden.
 *
 * Concealment is `nameableTokens`, not a second test. A GM is above every gate in
 * it, so in practice the Warden is offered the whole scene — but routing through
 * the one function means this can never become the surface that names a token the
 * viewer may not be told about.
 *
 * @param {Scene} [scene]  the scene the CARD was spoken in, never the viewer's
 * @return {Promise<String[]>}  token ids; EMPTY on dismissal, on Cancel, and on
 *   an empty tick list — all three mean "apply nothing", per the same rule
 *   `askDamageQuality` follows: a ✕ is an instruction, not a default.
 */
export const askDamageTargets = async (scene) => {
  const listed = nameableTokens((scene?.tokens?.contents ?? []).map((tk) => tk.id), scene);
  if (!listed.length) {
    // A legacy card whose scene was deleted, or one whose creatures are all gone.
    // Saying so beats opening a picker with nothing in it and an Apply button.
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoTokensToDamage"));
    return [];
  }

  // NOTHING is read from the canvas here — see the docblock. Neither
  // `canvas.tokens.controlled` nor `game.user.targets`.
  const foes = [];
  const pcs = [];
  for (const entry of listed) {
    const isPC = scene.tokens.get(entry.id)?.actor?.type === "character";
    (isPC ? pcs : foes).push(entry);
  }

  // An HTMLDivElement rather than a string, and that is the security property
  // here: DialogV2 cleans a string `content` but takes an element's innerHTML
  // VERBATIM (`options.content = options.content.innerHTML`, dialog.mjs:187-190).
  // Token names are Warden-authored free text, so every one goes in as
  // `textContent` on a node and is escaped by the serializer — nothing authored
  // is ever parsed as markup. The div must be plain: core throws on any
  // attribute (:189).
  const content = document.createElement("div");
  const prompt = document.createElement("p");
  // Multi-select gives each ticked creature the FULL roll, which is what a
  // targeted card already does — but nothing on a checkbox list says so.
  prompt.textContent = game.i18n.localize("CAIRN.DamageTargets.Prompt");
  content.append(prompt);

  const group = (key, entries) => {
    if (!entries.length) return; // no empty heading over an empty list
    const head = document.createElement("p");
    head.className = "ab-target-group";
    head.textContent = game.i18n.localize(key);
    content.append(head);
    for (const entry of entries) {
      const row = document.createElement("label");
      row.className = "ab-target-row";
      const box = document.createElement("input");
      // setAttribute, NOT the properties. The element is serialized to HTML and
      // re-parsed, so `box.value = id` sets an IDL property that does NOT reflect
      // into the markup — every row would arrive with an empty value, silently.
      // `type` and `name` do reflect; they are written the same way so the next
      // reader is not left deciding which of three lines is safe.
      //
      // Nothing sets `checked` any more (the picker proposes nobody), which is
      // why no row is ticked and not an oversight.
      box.setAttribute("type", "checkbox");
      box.setAttribute("name", "abDamageTarget");
      box.setAttribute("value", entry.id);
      const name = document.createElement("span");
      name.textContent = entry.name;
      row.append(box, name);
      content.append(row);
    }
  };
  group("CAIRN.DamageTargets.Foes", foes);
  group("CAIRN.DamageTargets.Party", pcs);

  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["cairn-damage-targets"],
    window: { title: game.i18n.localize("CAIRN.DamageTargets.Title") },
    content,
    buttons: [
      {
        action: "apply",
        label: "CAIRN.ApplyDamage",
        icon: "fa-solid fa-burst",
        default: true,
        callback: (event, button) => Array.from(
          button.form.querySelectorAll('input[name="abDamageTarget"]:checked'),
        ).map((box) => box.value),
      },
      { action: "cancel", label: "CAIRN.Cancel", icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  // Cancel resolves to its action STRING and a dismissal to null; only the Apply
  // callback returns an array. Testing the shape rather than the action name
  // means neither can be mistaken for a pick.
  return Array.isArray(picked) ? picked : [];
};

/**
 * A content source's display name — "Cairn 2e", "Cairn Barebones".
 *
 * ONE definition, in `utils.js` rather than beside either sheet, because there were
 * two and they had already drifted: the actor sheet said "Cairn Barebones" and the
 * background sheet said "Barebones", so the same edition was named differently on
 * two sheets a Warden has open side by side. The background sheet's map also carried
 * an `srd-2e` entry, which cannot occur — `srd-2e` is a value of the
 * `flags.air-bladder.backgroundSource` PROVENANCE flag, never of `system.source`,
 * whose schema defaults to "2e" (data-models.js `BackgroundData`).
 *
 * Localized rather than literal, which reverses the old comment's reasoning. The
 * argument for literals was that these are the editions' proper names — but
 * `CAIRN.ContentSource2e` and `CAIRN.ContentSourceBarebones` already existed for the
 * source picker and are already in `es.json`, so a language that adapts them got a
 * picker and a sheet header naming the same edition two different ways. Whether an
 * edition name should be adapted at all is the translator's call to make once, not a
 * decision to take away from them at half the call sites.
 *
 * An unrecognised source falls back to the raw stored value, so a legacy character
 * whose source is something else reads as that rather than as blank.
 * @param {String} source
 * @return {String}
 */
const SOURCE_KEYS = { "2e": "CAIRN.ContentSource2e", barebones: "CAIRN.ContentSourceBarebones" };
export const sourceLabel = (source) => {
  const key = SOURCE_KEYS[source];
  return key ? game.i18n.localize(key) : String(source ?? "");
};

/**
 * Format a counted noun, choosing the locale's plural form.
 *
 * Foundry's Localization has no plural support at all, so "{n} uses" shipped
 * rendering "1 uses" on every single-use item — a scroll, a torch, most of the
 * shop. The neighbouring `CAIRN.NSlot` avoids it only by never being formatted
 * with anything but 1.
 *
 * `Intl.PluralRules` names the form ("one", "other", and for Polish "few" and
 * "many"). **The BASE key is the "other" form** — deliberately, so that every
 * key already in use keeps working and no translation is orphaned by this:
 * `lang/es.json` has carried `CAIRN.NUses` for a while, and renaming it to
 * `CAIRN.NUses.other` would have turned a finished Spanish string back into
 * English to fix an English bug. A language adds `<key>_one` (and `_few` /
 * `_many`) as it needs them, and does nothing at all to keep what it has.
 *
 * **UNDERSCORE, not a dot, and that is forced.** Foundry expands every dotted
 * key in a language file into nested objects, so `"CAIRN.NUses"` (a string) and
 * `"CAIRN.NUses.one"` in the same file collide — the loader throws "Cannot
 * create property 'one' on string" and abandons the WHOLE file, which is a
 * world with no interface strings at all. Measured, not reasoned about: the
 * first cut of this used dots and en.json stopped loading.
 *
 * @param {String} key   base key, e.g. "CAIRN.NUses" — the plural form
 * @param {Number} n
 * @param {Object} [data] extra format values
 * @return {String}
 */
export const formatCount = (key, n, data = {}) => {
  const lang = game.i18n?.lang ?? "en";
  const form = new Intl.PluralRules(lang).select(Number(n));
  if (form === "other") return game.i18n.format(key, { n, ...data });
  const specific = `${key}_${form}`;
  // `has(k, false)` — no English fallback — is what makes the order work: ask
  // the ACTIVE language for its form, then the active language's base key, and
  // only then let English answer. Asking with the fallback on would report a
  // form English has and Spanish does not as present, and render an English
  // string inside an otherwise Spanish sentence. A missing form should read as
  // the wrong plural, never as the wrong language.
  const inLang = (k) => game.i18n.has(k, false);
  const chosen = inLang(specific) ? specific
    : inLang(key) ? key
      : game.i18n.has(specific) ? specific : key;
  return game.i18n.format(chosen, { n, ...data });
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

/**
 * Sanitize a stored description and unwrap its leading paragraph, ready to assign
 * to `innerHTML`.
 *
 * Unwrapping the `<p>` ProseMirror always adds is cosmetic — an inline description
 * panel does not want a block. **The cleaning is not**, and it is why this stopped
 * being called `stripPar`: it was two literal `.replace()` calls and nothing else,
 * a name that sounds cosmetic on a helper that is now load-bearing for security.
 *
 * `system.features[]` is an `ArrayField(ObjectField)` (`data-models.js:171,205`), and
 * `htmlFields` in `system.json` addresses TOP-LEVEL SCHEMA PATHS: the server has no
 * schema for the interior of an ObjectField, so it can never sanitize what is stored
 * in there no matter what the manifest declares. A player writing raw HTML into a
 * feature description on their OWN character therefore had it stored byte-for-byte
 * and injected into the GM's DOM — a player→GM XSS, observed end-to-end 2026-07-30,
 * the same escalation as the declared-field hole closed the day before and NOT
 * fixable the same way.
 *
 * Cleaning at the SINK is the whole fix. Filtering our own dialog would be theatre:
 * the attacker owns the browser that writes the document and can call
 * `actor.update()` directly.
 *
 * `foundry.utils.cleanHTML` is core's own allow-list cleaner
 * (`client/utils/helpers.mjs:15`) — tags from `ALLOWED_HTML_TAGS`, attributes from
 * `ALLOWED_HTML_ATTRIBUTES`, which admits no `on*` handler and no `<script>`, and
 * validates URL schemes on href/src/cite. Core uses it for exactly this shape of
 * injection (`chat-bubbles.mjs:212`, `tooltip-manager.mjs:251`).
 *
 * Every caller assigns the result to `innerHTML` or tests it for emptiness, so this
 * stays ONE function rather than a safe variant beside an unsafe one — there is then
 * no unsafe helper left for future code to reach for by mistake.
 *
 * **The unwrap happens on the DOM, never on the string, and that is the whole
 * security property of this function.** The first version kept `stripPar`'s two
 * `.replace()` calls and ran them on `cleanHTML`'s SERIALIZED output, which
 * `innerHTML` then re-parses — and string surgery between a serialize and a parse
 * promotes inert text into live markup. `<iframe>` is an allowed tag whose content
 * is RAWTEXT, so the cleaner sees the inside as a single text node, copies it
 * untouched, and serializes it unescaped. That let a stored
 * `<iframe></ifra<p>me><img src=x onerror=…>` survive cleaning with its `<p>`
 * intact; deleting that `<p>` spliced `</ifra` + `me>` into `</iframe>`, ending the
 * frame early and turning the trailing `<img>` into a live element. Observed
 * executing in the GM's client through this exact sink, 2026-07-30, with the
 * unstripped string as the control. Unwrapping the first paragraph ELEMENT is
 * equivalent for every well-formed input and cannot splice anything, because the
 * output is re-serialized from a parsed tree rather than edited as text.
 *
 * @param {String} [text]
 * @return {String} sanitized HTML, safe to assign to innerHTML
 */
export const cleanDescription = (text) => {
  if (!text) return "";
  // A <template> and not a <div>: template content is INERT, so parsing here does
  // not fetch the images and media a description references. A detached div is not
  // inert — it cost a duplicate request per call, and `dev:feature-xss`'s 404
  // bookkeeping caught it. One caller only asks whether the result is empty
  // (actor-sheet.js, the crit line), which must not hit the network at all.
  const tpl = document.createElement("template");
  tpl.innerHTML = foundry.utils.cleanHTML(String(text));
  // Core's allow-list is calibrated for core's sinks — a chat bubble and a tooltip,
  // both plain <div>s. OURS is inside the sheet, and the sheet is a <form> that
  // submits on change, so two attributes core has no reason to strip are live
  // controls here. Both were OBSERVED working, 2026-07-30:
  //
  //   data-action  ApplicationV2 dispatches from one listener on the whole app
  //                element via closest("[data-action]") (application.mjs:1918-1921),
  //                so an injected <button data-action="itemCreate"> ran the action
  //                on the GM's click. Paired with the allowed `style`, an invisible
  //                full-sheet overlay makes that click any click.
  //   name         FormDataExtended reads every named control in the form, so an
  //                injected <input name="system.gold"> reached _processFormData
  //                (seen as [10,9999] — it only failed to overwrite because it
  //                collided with the real field; a path the sheet does not already
  //                render has nothing to collide with).
  //
  // Stripped here rather than at the two call sites so no future sink has to
  // remember. `style` and `id` are left: without a dispatchable action or a form
  // name, an overlay is cosmetic, and stripping them would break legitimate
  // ProseMirror output.
  for (const el of tpl.content.querySelectorAll("[data-action], [name]")) {
    el.removeAttribute("data-action");
    el.removeAttribute("name");
  }
  const first = tpl.content.firstElementChild;
  if (first?.tagName === "P") first.replaceWith(...first.childNodes);
  return tpl.innerHTML;
};

/* -------------------------------------------- */
/*  ProseMirror editors on a sheet              */
/* -------------------------------------------- */

/**
 * Commit every ACTIVE ProseMirror editor under `root`.
 *
 * `save()` dispatches a bubbling `change`, which the form's own listener turns
 * into a submit — and ApplicationV2 deliberately still accepts that while the
 * application is CLOSING (`application.mjs:2159-2161`), which is what makes this
 * safe to call from `_preClose`.
 *
 * Individual saves can be VETOED by the dirty guard in `bindEditorClickAwaySave`:
 * a pristine editor's `save()` is cancelled at its own `save` event and commits
 * nothing. See the guard for why that is load-bearing and not an optimisation.
 *
 * The `.active` filter is NOT belt-and-braces. `save()` on a TOGGLED editor
 * unconditionally calls `this.#editor.destroy()` (prosemirror-editor.mjs:325), and
 * a toggled editor that was never opened has no `#editor` — so saving it throws a
 * TypeError. An item sheet carries two of these (description and criticalDamage);
 * open one, close the sheet, and the untouched one takes the whole close down with
 * it. `.active` is the exact public proxy for the element's private `#active`
 * flag: set at the end of `#activateEditor` (:222) and cleared in `save()` (:326).
 * An inactive editor holds no unsaved edits by definition, so skipping it costs
 * nothing.
 *
 * @param {HTMLElement} [root]
 */
export const saveSheetEditors = (root) => {
  root?.querySelectorAll("prose-mirror.active").forEach((editor) => editor.save());
};

/**
 * Wire "mouse down anywhere outside an editor commits it".
 *
 * ProseMirror only commits through its own easily-missed save button, and
 * ApplicationV2 has no `submitOnClose`, so without this a player types a
 * description, closes the sheet, and the text is gone — silently: no error, and
 * the editor's own `disconnectedCallback` save (prosemirror-editor.mjs:130-138)
 * fires from an already-detached node.
 *
 * Selector is `prose-mirror`, NOT `prose-mirror[open]`: `open` is only an
 * ATTRIBUTE on a toggled editor. An always-active editor exposes `open` as a
 * getter and never writes the attribute, so the attribute selector matched
 * nothing and click-away silently stopped saving.
 *
 * **Bind once per application, from `_onFirstRender`.** `this.element` is the
 * FRAME and survives re-render, so binding from `_onRender` stacks another
 * listener on every redraw — and every one of them saves every editor.
 *
 * @param {HTMLElement} root  The application frame.
 */
export const bindEditorClickAwaySave = (root) => {
  // THE DIRTY GUARD: an editor nobody has edited must not save at all.
  //
  // `save()` opens with a CANCELABLE bubbling "save" event
  // (prosemirror-editor.mjs:310-312) before it diffs anything, so cancelling it
  // here is core's own designed veto point — and it covers BOTH spurious savers
  // at once: the click-away below, and core's disconnectedCallback save on
  // close (prosemirror-editor.mjs:130-138), which no wrapper around
  // saveSheetEditors could reach.
  //
  // Why a pristine editor must not save: `save()` fires `change` whenever
  // ProseMirror's canonical serialization differs from the STORED string
  // (prosemirror-editor.mjs:314-317) — not whenever the user edited something.
  // On a submitOnChange sheet that `change` is a real document WRITE plus a
  // re-render, triggered by a mousedown. The re-render replaces the element
  // under the pointer between mousedown and mouseup, and a real browser then
  // dispatches NO click at all (headless Chromium re-targets it, which is why
  // no headless run ever reproduced this) — so whatever control was pressed
  // silently does nothing. Measured 2026-08-01 in the live dev world: merely
  // clicking or closing unedited monster sheets rewrote 23 compendium
  // documents in one evening, and the portrait click that "did nothing" on
  // Acolyte / Blood Elk / Crypt Thing was each one's canonicalising write
  // eating its own click. Text containing "&" keeps a residue even after that
  // write: Foundry's StringSerializer emits it RAW (string-node.mjs:115-123
  // escapes only < and >) while storage holds `&amp;`, so every fresh editor
  // re-submits once — the server sanitizes before diffing, so that submit
  // no-ops in the database (measured, dev:phantom-save's convergence leg),
  // but it is still a network write per sheet-open that this guard deletes.
  // Gate: `npm run dev:phantom-save`.
  //
  // The guard never blocks a save that could carry anything:
  //   - a TOGGLED editor is exempt — `save()` is also what deactivates one
  //     (prosemirror-editor.mjs:321-331), and item sheets carry two;
  //   - a DIRTY editor saves. `isDirty` is "any ProseMirror transaction"
  //     (dirty-plugin.mjs:17-19): typing, pasting, even a bare click into the
  //     text, which is a selection transaction — coarse, but coarse in the
  //     losing-nothing direction;
  //   - source-code mode saves unconditionally: edits in the raw-HTML textarea
  //     never pass through a transaction, so dirtiness cannot vouch for them
  //     (`_getValue` reads `:scope > .source-editor` the same way,
  //     prosemirror-editor.mjs:188-190).
  root.addEventListener("save", (ev) => {
    const pm = ev.target;
    if (pm?.tagName !== "PROSE-MIRROR" || pm.hasAttribute("toggled")) return;
    if (pm.querySelector(":scope > .source-editor")) return;
    if (!pm.isDirty()) ev.preventDefault();
  });

  root.addEventListener("mousedown", (ev) => {
    if (ev.target.closest("prose-mirror")) return;
    saveSheetEditors(root);
  });
};
