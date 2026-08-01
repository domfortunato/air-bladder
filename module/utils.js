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
  root.addEventListener("mousedown", (ev) => {
    if (ev.target.closest("prose-mirror")) return;
    saveSheetEditors(root);
  });
};
