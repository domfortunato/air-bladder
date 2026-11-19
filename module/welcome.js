/**
 * The welcome window, modelled on Base Knavery's (user ask 2026-11-19): what this
 * system is, that it is unofficial, which rules it carries (Cairn 2e, Cairn
 * Barebones, custom backgrounds), the AI disclosure, where to buy the books, the
 * guide and the rules, and the licences.
 *
 * NO IMPORT STEP, unlike Base Knavery's: Cairn 2e and Barebones are CC BY-SA 4.0
 * and already ship in the system, so there is no book for a Warden to bring.
 *
 * It opens by itself at every Warden login while "Show each time a Game Master
 * loads the world" (`welcome-on-start`, default ON) stays ticked. Players are
 * never shown it unasked; anyone opens it from the Settings sidebar or
 * `game.cairn.openWelcome()`. The probes' `dismissChrome` asks `welcomeDue()` and
 * closes it, so a window nobody asked for never sits over what a probe clicks.
 *
 * Its lists (portraits, links, credits, the rules and AI lines) live in
 * welcome-data.js, which the README builder reads too: README.md's top and
 * bottom are this window's words (tools/build-readme.mjs, check:readme).
 */
import { SETTINGS_NS } from "./settings.js";
import {
  AI_LINES, ART_CREDITS, BUY_LINKS, CC_BY_SA_URL, LICENCE_FOLDS, MARK_NAME, RULES, WELCOME_BOOKENDS, WELCOME_MARKS,
} from "./welcome-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = (k) => game.i18n.localize(k);
const F = (k, d) => game.i18n.format(k, d);

const SYS_PATH = "systems/air-bladder";
const WELCOME_ID = "air-bladder-welcome";
const sys = (p) => `${SYS_PATH}/${p}`;

/** The background sources this world offers, in the Character Generation menu's order. */
const SOURCES = [
  ["content-source-2e", "CAIRN.Welcome.Source2e"],
  ["content-source-custom", "CAIRN.Welcome.SourceCustom"],
  ["content-source-barebones", "CAIRN.Welcome.SourceBarebones"],
];

/** "This world offers Cairn 2e and Cairn Barebones backgrounds." from the three switches. */
const thisWorldLine = () => {
  const on = SOURCES.filter(([key]) => game.settings.get(SETTINGS_NS, key) === true).map(([, label]) => L(label));
  if (!on.length) return L("CAIRN.Welcome.ThisWorldNone");
  const list = new Intl.ListFormat(game.i18n.lang, { style: "long", type: "conjunction" }).format(on);
  return F("CAIRN.Welcome.ThisWorld", { sources: list });
};

/** A pack this user can open, or null. */
const visiblePack = (name) => {
  const pack = game.packs.get(`air-bladder.${name}`);
  return pack?.visible ? pack : null;
};

export class WelcomeWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: WELCOME_ID,
    classes: ["cairn", "air-bladder-welcome"],
    window: { title: "CAIRN.Welcome.Title", icon: "fa-solid fa-dungeon" },
    // Wide, in two columns, as Base Knavery's.
    position: { width: 800, height: "auto" },
    actions: {
      openGuide: () => visiblePack("journals-docs")?.render({ force: true }),
      openRulebook: () => visiblePack("journals-2e")?.render({ force: true }),
    },
  };

  static PARTS = {
    body: { template: `${SYS_PATH}/templates/ui/welcome.html` },
  };

  async _prepareContext() {
    // The maintainer by name: system.json lists the inherited authors first, so
    // the first entry is Yochai Gal's, not the person this window speaks for.
    const author = [...(game.system.authors ?? [])].find((a) => a.name === "Dom Bosco") ?? { name: "Dom Bosco" };
    const translator = [...(game.system.authors ?? [])].find((a) => a.name === "Malecho") ?? { name: "Malecho" };
    return {
      title: MARK_NAME,
      byline: F("CAIRN.Welcome.By", { author: author.name, version: game.system.version }),
      authorUrl: author.url ?? "",
      // The Spanish translator under the byline (user, 2026-11-19), linked from
      // the same system.json entry the release credits.
      translator: F("CAIRN.Welcome.Translation", { translator: translator.name }),
      translatorUrl: translator.url ?? "",
      bookends: { left: sys(WELCOME_BOOKENDS.left), right: sys(WELCOME_BOOKENDS.right) },
      stamp: sys(WELCOME_MARKS.stamp),
      logo: sys(WELCOME_MARKS.logo),
      logoDark: sys(WELCOME_MARKS.logoDark),
      thisWorld: thisWorldLine(),
      rules: RULES,
      ai: AI_LINES,
      // The licence links are built here: the strings carry only their words.
      folds: LICENCE_FOLDS.map((f) => ({ cls: f.cls, heading: L(f.heading), body: F(f.body, { license: this.#licenseLink() }) })),
      buyLinks: BUY_LINKS,
      art: ART_CREDITS.map((a) => ({
        ...a,
        name: a.nameKey ? L(a.nameKey) : a.name,
        by: a.byKey ? L(a.byKey) : a.by,
        license: a.licenseKey ? L(a.licenseKey) : a.license,
      })),
      canOpenGuide: !!visiblePack("journals-docs"),
      canOpenRulebook: !!visiblePack("journals-2e"),
      // The box writes a world setting, so only a GM who may write one sees it.
      isGM: game.user.isGM && game.user.can("SETTINGS_MODIFY"),
      showOnStart: game.settings.get(SETTINGS_NS, "welcome-on-start"),
    };
  }

  #licenseLink() {
    return `<a href="${CC_BY_SA_URL}" target="_blank" rel="noopener">${L("CAIRN.Welcome.CcBySa")}</a>`;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('input[name="welcome-on-start"]')?.addEventListener("change", (event) => {
      game.settings.set(SETTINGS_NS, "welcome-on-start", event.currentTarget.checked);
    });
  }
}

/** Open the welcome window, or bring the open one forward. */
export const openWelcome = () => {
  const open = foundry.applications.instances.get(WELCOME_ID);
  if (open) return open.render({ force: true });
  return new WelcomeWindow().render({ force: true });
};

/** Whether this login opens the welcome window by itself (the probes ask too). */
export const welcomeDue = () => {
  // Only for a GM who may write world settings: an Assistant GM whose
  // "Modify Configuration Settings" was taken away could not switch it off.
  if (!game.user.isGM || !game.user.can("SETTINGS_MODIFY")) return false;
  return game.settings.get(SETTINGS_NS, "welcome-on-start") === true;
};

/** From `ready`: at each Warden login, unless the box was unticked. */
export const maybeOpenWelcome = () => {
  if (!welcomeDue()) return;
  openWelcome().catch((err) => console.warn("air-bladder | the welcome window did not open:", err));
};
