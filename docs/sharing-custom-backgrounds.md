# Sharing & moving custom backgrounds

A **custom background** is a Warden-authored Cairn 2e background — a background
Item carrying its own tagline, example names, starting gear, and two d6
question tables. It lives in a **world compendium** named *Custom Backgrounds*, and
whenever the custom content source is toggled on (Game Settings → Air Bladder →
Character Generation → *Offer custom Cairn 2e backgrounds*) it joins the **Custom**
section of the character-generation picker.

> **Not to be confused with *Backgrounds (Custom)***, the pack Air Bladder ships
> inside the *Air Bladder - Backgrounds* folder. That one holds seven third-party
> class backgrounds, is replaced on every system update, and is not where your own
> work goes. See
> [Where it lives](creating-custom-backgrounds.md#where-it-lives).

> **Writing one is covered separately** — see
> [Creating a custom 2e background](creating-custom-backgrounds.md). This page
> assumes you already have one and want to move it.

Because a custom background is a **self-contained snapshot** — gear you drag into
it is frozen into the background, and its by-name references point at gear every
Air Bladder install already ships — it travels cleanly to any other Air Bladder
world or install. This page covers the two ways to move or share them.

> **Check it travels first.** Open the background's sheet and click **Test ×10**.
> The report doubles as a self-contained linter: if it flags a *missing* item
> (a name-only reference that won't resolve on another install), fix that before
> sharing — re-drag the item into the background so it snapshots. A background
> that lints clean will arrive intact.

## Share a whole set — package a module (recommended)

The cleanest way to hand a friend (or another of your own worlds) a *set* of
custom backgrounds is Foundry's built-in **Module Maker**. The recipient installs
one module, toggles the Custom source on, and every background appears — no files
to import one by one.

1. From Foundry's main setup screen, open the **Add-On Modules** tab and click
   **Create Module**.
2. **Basic Details** — give the module a title, identifier, and version.
3. **Compendium Packs** → **Add Compendium Pack** — add one pack of document type
   **Item** (e.g. label *Custom Backgrounds*, required system **air-bladder**).
4. Finish the wizard. This creates the module shell in your user data folder.
5. Launch any world, enable the new module, and copy your backgrounds into its
   compendium: open your world *Custom Backgrounds* compendium, **unlock** the
   module's compendium (its context menu → *Toggle Edit Lock*), then drag your
   backgrounds from one compendium into the other.
6. Zip the module folder from your user data (`Data/modules/<your-module>`) and
   send it. The recipient drops it into their `Data/modules/`, enables it, and
   turns the **Custom** content source on.

Air Bladder discovers source-2e backgrounds in **any** installed module's Item
compendium, so a module delivered this way is a first-class content source. It is
read-only by default; a recipient who wants to tweak one uses **Duplicate into
Custom Backgrounds** on its sheet, which copies it into their own editable world
pack.

See Foundry's own [Module Maker article](https://foundryvtt.com/article/module-maker/)
for the wizard in detail.

## Share one — Export / Import Data

For a one-off, use Foundry's per-document JSON:

1. Open your *Custom Backgrounds* compendium, right-click the background →
   **Export Data**. This saves a `.json` you can send.
2. The recipient imports it into a world *Custom Backgrounds* compendium
   (right-click a background → **Import Data**, or create the compendium first if
   they have none). As long as it lands in a **world** compendium with the Custom
   source on, it shows up in their picker.

## Notes & caveats

- **Portability is a snapshot, not a link.** A background freezes the gear you
  dropped into it, so later edits to the *real* item do not propagate — that is
  the price of a shareable, self-contained unit. Name-only references (kept for
  shipped gear that every install has) resolve on the far side; the Test ×10
  linter is what confirms none are dangling.
- **Module packs are read-only.** They work as a *source*; editing goes through
  **Duplicate into Custom Backgrounds**.
- **De-dup is by document id.** If a module re-ships a background that is byte-for-byte
  a copy of a shipped one but with a new id, both can appear in the picker. Share
  genuinely custom backgrounds, not re-packaged shipped ones.
- Sharing only makes sense **between Air Bladder installs** — a background is an
  Air Bladder Item type and needs the system to resolve its gear.
