/**
 * The welcome window's data, in a module with no Foundry in it, because two
 * readers need it: the window (module/welcome.js) and the README builder
 * (tools/build-readme.mjs), which writes README.md's top and bottom from the
 * window's own words and these lists (user, 2026-11-19, as Base Knavery's). So a
 * credit or a link changes here once, and the README follows.
 *
 * Paths are relative to the system's root: the window prefixes
 * `systems/air-bladder/`, the README uses them as they are.
 */

/**
 * The name the masthead marks with ™ (user, 2026-11-19): the name alone. Not
 * system.json's title, "Air Bladder — Cairn 2e", which is the package listing's
 * and names Cairn 2e — not the user's to put in their trade mark.
 */
export const MARK_NAME = "Air Bladder";

export const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const LYDIA_URL = "https://linktr.ee/lydiadidmyink";

/**
 * Two portraits by Lydia Comer either side of the title, chosen by the user
 * (2026-11-19): the knight on the left, facing out of the page; Femme20 on the
 * right. Her white-filled transparent versions, shrunk from 1000px to 250px and
 * changed in no other way (house practice: never crop her work).
 */
export const WELCOME_BOOKENDS = {
  left: "art/lydia-comer/welcome/Knight12w-t.webp",
  right: "art/lydia-comer/welcome/Femme20w-t.webp",
};

/**
 * The marks at the foot of the side column (user, 2026-11-19): the Air Bladder
 * logo, black lettering on light and white on dark (art/lydia-comer/license.txt,
 * LOGO), and the "For Use With Cairn" stamp the sheets show, a white JPG shown
 * whole and opaque on both themes (logo/README.md rules out altering the mark).
 */
export const WELCOME_MARKS = {
  logo: "art/lydia-comer/Airbladder02.webp",
  logoDark: "art/lydia-comer/Airbladder06.webp",
  stamp: "logo/Cairn_Stamp.jpg",
};

/** Where to buy Cairn: Yochai Gal's own site (user ask 2026-11-19), its three doors. */
export const BUY_LINKS = [
  { label: "CAIRN.Welcome.BuyPdf", icon: "fa-solid fa-file-pdf", href: "https://cairnrpg.com/second-edition/game-files/" },
  { label: "CAIRN.Welcome.BuyPrint", icon: "fa-solid fa-book", href: "https://cairnrpg.com/second-edition/print-copies/" },
  { label: "CAIRN.Welcome.BuyStore", icon: "fa-solid fa-cart-shopping", href: "https://cairnrpg.com/store/books/" },
];

/**
 * The art that ships, for the folded Art licensing (window and README alike).
 * Names and licences are proper names and stay as they are; a credit's words
 * that are not names are language keys. LICENSE.txt is the full, canonical
 * list: change both together (check:licence holds the licences in step).
 */
export const ART_CREDITS = [
  { nameKey: "CAIRN.Welcome.Credit.LydiaGallery", by: "Lydia Comer", url: LYDIA_URL, license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/" },
  { name: "Lemur's Portraits", by: "Jon Aspeheim", url: "https://jonaspeheim.itch.io/lemurs-portraits", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
  { name: "Tlomdev's Tokens", by: "tlomdev", url: "https://tlomdev.itch.io/tlomdevs-tokens", license: "CC BY-SA 4.0", licenseUrl: CC_BY_SA_URL },
  { name: "Game-icons.net", byKey: "CAIRN.Welcome.Credit.GameIconsBy", url: "https://game-icons.net", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/" },
  { nameKey: "CAIRN.Welcome.Credit.Bookends", by: "Lydia Comer", url: LYDIA_URL, license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/" },
  { nameKey: "CAIRN.Welcome.Credit.Logo", by: "Lydia Comer", url: LYDIA_URL, licenseKey: "CAIRN.Welcome.Credit.AllRightsReserved", licenseUrl: null },
  { nameKey: "CAIRN.Welcome.Credit.CairnMarks", by: "Yochai Gal", url: "https://cairnrpg.com/resources/logos", license: "CC BY-SA 4.0", licenseUrl: CC_BY_SA_URL },
  { nameKey: "CAIRN.Welcome.Credit.Alegreya", by: "The Alegreya Project Authors", url: "https://github.com/huertatipografica/Alegreya", license: "SIL OFL 1.1", licenseUrl: "https://openfontlicense.org/" },
];

/** The three licence folds above the art one: heading key, body key (with {license}). */
export const LICENCE_FOLDS = [
  { cls: "ab-welcome-cairn", heading: "CAIRN.Welcome.CairnLicenseHeading", body: "CAIRN.Welcome.CairnLicenseBody" },
  { cls: "ab-welcome-backgrounds", heading: "CAIRN.Welcome.BackgroundsLicenseHeading", body: "CAIRN.Welcome.BackgroundsLicenseBody" },
  { cls: "ab-welcome-glog", heading: "CAIRN.Welcome.GlogLicenseHeading", body: "CAIRN.Welcome.GlogLicenseBody" },
];

/** The System Rules bullets, in order: title key, body key. */
export const RULES = [
  ["CAIRN.Welcome.Rules2eTitle", "CAIRN.Welcome.Rules2eBody"],
  ["CAIRN.Welcome.RulesBarebonesTitle", "CAIRN.Welcome.RulesBarebonesBody"],
  ["CAIRN.Welcome.RulesCustomTitle", "CAIRN.Welcome.RulesCustomBody"],
];

/** The AI disclosure, in Base Knavery's order: icon (window, README), title key, body key. */
export const AI_LINES = [
  { cls: "", fa: "fa-solid fa-paintbrush", emoji: "🖌️", title: "CAIRN.Welcome.NoAiArt", body: "CAIRN.Welcome.NoAiArtBody" },
  { cls: "ab-welcome-notext", fa: "fa-solid fa-scroll", emoji: "📜", title: "CAIRN.Welcome.NoAiText", body: "CAIRN.Welcome.NoAiTextBody" },
  { cls: "ab-welcome-aicode", fa: "fa-solid fa-brain-circuit", emoji: "🧠", title: "CAIRN.Welcome.AiCode", body: null },
];
