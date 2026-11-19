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
 */
import { SETTINGS_NS } from "./settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = (k) => game.i18n.localize(k);
const F = (k, d) => game.i18n.format(k, d);

const SYS_PATH = "systems/air-bladder";
const WELCOME_ID = "air-bladder-welcome";
const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const LYDIA_URL = "https://linktr.ee/lydiadidmyink";

/**
 * Two portraits by Lydia Comer either side of the title, chosen by the user
 * (2026-11-19): the knight on the left, facing out of the page; the woman on the
 * right, turned in toward the title. Her white-filled transparent versions, shrunk
 * from 1000px to 250px and changed in no other way (house practice: never crop
 * her work).
 */
const WELCOME_BOOKENDS = {
  left: `${SYS_PATH}/art/lydia-comer/welcome/Knight12w-t.webp`,
  right: `${SYS_PATH}/art/lydia-comer/welcome/Femme21w-t.webp`,
};

/** Where to buy Cairn: Yochai Gal's own site (user ask 2026-11-19), its three doors. */
const BUY_LINKS = [
  { label: "CAIRN.Welcome.BuyPdf", icon: "fa-solid fa-file-pdf", href: "https://cairnrpg.com/second-edition/game-files/" },
  { label: "CAIRN.Welcome.BuyPrint", icon: "fa-solid fa-book", href: "https://cairnrpg.com/second-edition/print-copies/" },
  { label: "CAIRN.Welcome.BuyStore", icon: "fa-solid fa-cart-shopping", href: "https://cairnrpg.com/store/books/" },
];

/**
 * The art that ships, for the folded Art licensing. Names and licences are proper
 * names and stay as they are; a credit's words that are not names are language
 * keys. README.md "Credits & licenses" is canonical: change both together.
 */
const ART_CREDITS = [
  { nameKey: "CAIRN.Welcome.Credit.LydiaGallery", by: "Lydia Comer", url: LYDIA_URL, license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/" },
  { name: "Lemur's Portraits", by: "Jon Aspeheim", url: "https://jonaspeheim.itch.io/lemurs-portraits", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
  { name: "Tlomdev's Tokens", by: "tlomdev", url: "https://tlomdev.itch.io/tlomdevs-tokens", license: "CC BY-SA 4.0", licenseUrl: CC_BY_SA_URL },
  { name: "Game-icons.net", byKey: "CAIRN.Welcome.Credit.GameIconsBy", url: "https://game-icons.net", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/" },
  { nameKey: "CAIRN.Welcome.Credit.Bookends", by: "Lydia Comer", url: LYDIA_URL, license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/" },
  { nameKey: "CAIRN.Welcome.Credit.Logo", by: "Lydia Comer", url: LYDIA_URL, licenseKey: "CAIRN.Welcome.Credit.AllRightsReserved", licenseUrl: null },
  { nameKey: "CAIRN.Welcome.Credit.CairnMarks", by: "Yochai Gal", url: "https://cairnrpg.com/resources/logos", license: "CC BY-SA 4.0", licenseUrl: CC_BY_SA_URL },
  { nameKey: "CAIRN.Welcome.Credit.Alegreya", by: "The Alegreya Project Authors", url: "https://github.com/huertatipografica/Alegreya", license: "SIL OFL 1.1", licenseUrl: "https://openfontlicense.org/" },
];

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
    return {
      title: game.system.title,
      byline: F("CAIRN.Welcome.By", { author: author.name, version: game.system.version }),
      authorUrl: author.url ?? "",
      bookends: WELCOME_BOOKENDS,
      // The "For Use With Cairn" stamp at the foot of the side column, where Base
      // Knavery shows its own compatibility mark: the same file the character
      // sheet and the printed page show (user ask 2026-11-19). A white JPG, so
      // one file on both themes (a white card on the dark one, as on the sheet),
      // shown whole and opaque: logo/README.md rules out altering the mark.
      stamp: `${SYS_PATH}/logo/Cairn_Stamp.jpg`,
      // And the Air Bladder logo beside it, at full strength (user, 2026-11-19:
      // both, and "does not need to be a watermark"): black lettering on the
      // light theme, white on the dark (art/lydia-comer/license.txt, LOGO).
      logo: `${SYS_PATH}/art/lydia-comer/Airbladder02.webp`,
      logoDark: `${SYS_PATH}/art/lydia-comer/Airbladder06.webp`,
      thisWorld: thisWorldLine(),
      // The licence links are built here: the strings carry only their words.
      cairnBody: F("CAIRN.Welcome.CairnLicenseBody", { license: this.#licenseLink() }),
      backgroundsBody: F("CAIRN.Welcome.BackgroundsLicenseBody", { license: this.#licenseLink() }),
      glogBody: F("CAIRN.Welcome.GlogLicenseBody", { license: this.#licenseLink() }),
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
