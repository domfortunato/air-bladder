# Sharing & moving custom backgrounds

A **custom background** is a Cairn 2e background you wrote yourself. It lives
in a world compendium named *Custom 2e Backgrounds*, and it is offered in the
background picker, under **Custom 2e Backgrounds**, while **Offer custom Cairn
2e backgrounds** is on (Game Settings → Configure Settings → Air Bladder →
Character Generation → Configure Character Generation).

> **Not *Backgrounds (Custom)*.** That compendium ships with Air Bladder inside
> the *Air Bladder - Backgrounds* folder. It holds seven third-party class
> backgrounds, is replaced on every system update, and is not where your own
> work goes. See
> [Where it lives](creating-custom-backgrounds.md#where-it-lives).

> **Writing one** is covered in
> [Creating a custom 2e background](creating-custom-backgrounds.md). This page
> is about moving one you already have.

A background carries its own copy of every item you dragged into it, and the
gear it lists by name is gear every Air Bladder install ships. So it works in
any other Air Bladder world. There are two ways to move one.

> **Check it first.** Open the background and click **Test ×10** on its Details
> tab. If the report says an item *resolves to nothing*, drag that item into
> the background before you share it. A background whose report reads *Looks
> self-contained — every grant resolves.* will arrive whole.

## Share a set: package a module

Foundry's **Module Maker** packs a set of backgrounds into a module. The
recipient installs it, turns custom backgrounds on, and every background in it
is offered.

1. On Foundry's setup screen, open the **Add-On Modules** tab and click
   **Create Module**.
2. **Basic Details**: give the module a title, identifier and version.
3. **Compendium Packs** → **Add Compendium Pack**: add one pack of document
   type **Item** (for example, label *Custom 2e Backgrounds*, required system
   **air-bladder**).
4. Finish the wizard. It creates the module in your user data folder.
5. Launch a world and enable the module. Open your world's *Custom 2e
   Backgrounds* compendium, unlock the module's compendium (right-click it →
   *Toggle Edit Lock*), and drag your backgrounds from one into the other.
6. Zip the module folder (`Data/modules/<your-module>`) and send it. The
   recipient puts it in their `Data/modules/`, enables it, and turns on
   **Offer custom Cairn 2e backgrounds**.

Air Bladder offers the 2e backgrounds in any installed module's Item
compendium. They cannot be edited there. A recipient who wants to change one
opens it and uses **Duplicate into Custom 2e Backgrounds**, which copies it
into their own world compendium.

See Foundry's [Module Maker article](https://foundryvtt.com/article/module-maker/)
for the wizard in detail.

## Share one: Export Data and Import Data

A compendium window offers neither Export Data nor Import Data, so both sides
go through the **Items** sidebar.

1. Open your *Custom 2e Backgrounds* compendium and drag the background into
   the **Items** sidebar (or right-click it → **Import Entry**). Right-click
   that copy → **Export Data** and send the `.json` file it saves. You can
   delete the sidebar copy afterwards.
2. The recipient creates a new Background in their **Items** sidebar,
   right-clicks it → **Import Data** and picks the file. Import Data replaces
   the item it is run on, so use a fresh one. They then open it and press
   **Duplicate into Custom 2e Backgrounds** on its Details tab. With custom
   backgrounds on, it appears in their picker.

## Notes

- **Dragged-in items are copies.** Later edits to the original item do not
  reach a background that already holds a copy. Gear listed by name is looked
  up on the recipient's install; Test ×10 confirms each name matches an item.
- **Do not repackage shipped backgrounds.** A hand-made duplicate of a shipped
  background counts as a different background, so both appear in the picker.
  A copy made by **Create Custom 2e Backgrounds and Tables…** is the
  exception: it stands in for the shipped one wherever it is shared, and the
  two never both appear.
- **Air Bladder only.** A background needs Air Bladder on the receiving side
  to find its gear.
