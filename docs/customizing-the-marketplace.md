# Customizing the marketplace

The **Marketplace** is the shop a character opens from the **Inventory** page of
their sheet. It ships with four aisles: Weapons, Armor, Gear, and Transports &
Containers. Every row in it names an item, and the price, description, tags and
slot cost a shopper sees are read from that item each time the shop opens.

This page covers setting your own prices and stocking your own goods. You need
to be the Warden.

## How the shop works

Each aisle is a **rollable table**, and each row names one item:

- **Cost** is the price.
- **Bulky** and **Petty** set the slots it takes: Bulky takes two, Petty takes
  none, anything else takes one.
- The description is what a shopper reads when they click the name.

Change an item and the next person to open the shop sees the change, with no
reload.

A shopper can **Buy** an item, paying its cost in gold, or **Take** it for free.
A character with no free slot is refused anything but a Petty item or a
transport. Buying a mount, cart or pack creates a new actor, which Foundry lets
only the Warden do by default.

To close the shop to players, turn off **Let players buy and take from the
marketplace** under **Configure Inventory**, or run the shipped **Toggle Player
Marketplace** macro. The Warden can always shop.

## Do not edit the shipped compendiums

Foundry lets you unlock **Marketplace** or **Market Goods** and edit them in
place. Those edits are lost: a system compendium is replaced whole every time
Air Bladder updates.

An update never touches your world. Keep your version of the shop there, and
treat the shipped compendiums as templates to copy.

## Copy it into your world

Open the **Rollable Tables** sidebar tab and press **Create a Custom
Marketplace…** (Wardens only). A window explains what it will copy. Press
**Copy** and you get:

- the four **Market:** tables in your Rollable Tables, in a **Custom
  Marketplace** folder;
- every item they sell in your Items sidebar, in a **Custom Marketplace** folder
  with a subfolder per source compendium (Armor, Gear, Market Goods, Tools,
  Trinkets, Weapons);
- every mount and cart in a **Custom Marketplace** folder in your Actors
  sidebar;
- every row of the copied tables pointing at your copy.

A window then says what was copied, with a button for each new folder: **Show
the Custom Marketplace folder in Rollable Tables**, **Show the Custom Marketplace
folder in Items** and **Show the Custom Marketplace folder in Actors**.

From then on the shop reads your tables and your items, and your changes
survive every update.

- **Running it again never overwrites.** Anything already in your world is
  kept. Only what is missing is added, and the window says how many of each.
- **A table you imported by hand earlier is kept too.** It is found by name, so
  a `Market: Gear` you already had stays yours. Its rows still point at the
  shipped items, and the window says so. Delete it and run again to have it
  rebuilt pointing at your copies.
- **Items you imported earlier are used, not duplicated.** A copy made with
  Foundry's own Import is recognised, and the rows point at it at whatever price
  you gave it.

A mount copied this way is also what an encounter table places for a row that
points at the shipped one, because Foundry treats a world copy as the import of
its source.

## Replacing an aisle by hand

1. Open the **Compendium** sidebar tab → **Marketplace** → right-click
   **Market: Gear** → **Import**.
2. The copy lands in your **Rollable Tables** sidebar under the same name. Keep
   that name: it is how the shop finds your table.
3. Open the table and press **Edit** at the top of the window. Delete rows you
   do not stock, and drag in items you do, from the Items sidebar or a
   compendium, anywhere onto the table's window.

A note at the top of any `Market:` table in your world says which aisle it
stocks and how to add or remove a row. On a shipped table the note says it is a
template and names the button. Rename a table away from `Market:` and the note
disappears, because the shop has stopped reading it. If two tables in your world
share a name, both say so. Rename or delete one of them.

Your table stays in alphabetical order: drop an item in and the rows are
re-numbered by name. The shop shows the aisle in the same order.

The four names, spelled exactly:

- `Market: Weapons`
- `Market: Armor`
- `Market: Gear`
- `Market: Transports & Containers`

A world table **replaces** its aisle. Importing the shipped table first gives
you all of its rows to start from. Delete your table and the shipped aisle comes
back.

## An aisle of your own

Make a rollable table whose name begins with `Market: ` and it becomes a new
aisle, such as `Market: Poisons`. It appears after the four shipped ones, for
everybody.

## Your own prices

A price lives on the item. After **Create a Custom Marketplace…** every row
points at your copy, so open the item in the **Custom Marketplace** folder of
your Items sidebar (a mount or a cart is in the folder of the same name under
Actors) and set its **Cost**.

By hand, one item at a time:

1. Find the item in its compendium: **Market Goods**, **Gear**, **Tools**,
   **Trinkets**, **Weapons**, **Armor**, or **Companions & Transports** for a
   mount or a cart.
2. Right-click it → **Import**. It lands in your **Items** sidebar (a mount or a
   cart lands in **Actors**).
3. Set its **Cost** there.
4. Drag your copy into your market table, and delete the row pointing at the
   shipped one.

Items you write yourself work the same way: give one a Cost and drag it into an
aisle.

## What a row can point at

A row can point at an **item** of any kind, or at an **NPC actor** for a mount,
a wagon or a pack animal. The shop ignores anything else in a market table.

**The table a thing sits in decides its aisle.** A sword in `Market: Gear` is
sold from the Gear aisle.

Keep mounts, carts and packs in `Market: Transports & Containers`. Only a
player character's sheet is shown that aisle. The shop on any other sheet
leaves it out.

## What your players see

Your players get your prices and your stock the next time they open the shop.
Nobody needs to reload.

Bonds and omens are customized the same way, with a world table of the same
name. See [Customizing bonds](customizing-bonds.md).
