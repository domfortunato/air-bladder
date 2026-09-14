# Customizing the marketplace

The **Marketplace** is the shop a character opens from the **Items** tab of their
sheet. It arrives with four aisles — Weapons, Armor, Gear, and Transports &
Containers — and every row in it points at a real item somewhere in your world.
Nothing in the shop is a price list: the price, the description, the tags and
the slot cost a shopper sees are read off the item itself, every time the shop
opens.

This page is about setting your own prices and stocking your own goods.

You need to be the Warden (GM).

---

## Where a price comes from

Each aisle is a **rollable table**, and each of its rows names one item. When a
shopper opens the shop, every row is looked up fresh. So an item's own fields
are the shop:

- **Cost** is the price.
- **Bulky** and **Petty** are the slots it takes — bulky costs two, petty or
  weightless costs none, anything else costs one.
- The description is what a shopper reads when they click the name.

Nothing is cached. Change an item and the next person to open the shop sees the
change, with no reload.

---

## Do not edit the shipped compendiums

Foundry will let you unlock **Marketplace**, or **Market Goods**, and edit them
in place. It also warns you, in the dialog that unlocking raises, that your
changes may be lost — and here they certainly will be. A system compendium is
overwritten wholesale when Air Bladder updates: the old copy is deleted before
the new one is written, and everything you typed into it goes with it.

Your world is never touched by an update. So the durable way to change the shop
is to keep your version of it in your world, which is what the rest of this page
describes.

---

## Replacing an aisle

1. Open the **Compendium** sidebar tab → **Marketplace** → right-click
   **Market: Gear** → **Import**.
2. The copy lands in your **Rollable Tables** sidebar under the same name. That
   name is the whole mechanism — keep it.
3. Edit it freely. Delete rows you do not stock, and drag in items you do.

Your table keeps itself in alphabetical order: drop an item in and every row
is re-numbered by name, so the newcomer lands where it belongs rather than at
the bottom, and the shop shows the aisle in the same order.

The four names, spelled exactly:

- `Market: Weapons`
- `Market: Armor`
- `Market: Gear`
- `Market: Transports & Containers`

A world table **replaces** its aisle rather than adding to it. That is what lets
you take something off the shelves — and it is why importing the shipped table
first is the easy way to begin, since you start with all of its rows in front of
you.

Delete your table and the shipped aisle comes straight back. There is nothing
else to configure, and no setting to find.

---

## An aisle of your own

Make a rollable table whose name begins with `Market: ` and it becomes a new
aisle — `Market: Poisons`, `Market: Black Market`, whatever your table needs.
It appears after the four shipped ones, for everybody.

---

## Your own prices, kept

A price lives on the item, and the shipped items are in shipped compendiums, so
re-pricing one in place has the same fate as everything else in there. To keep a
price:

1. Find the item in its compendium — **Market Goods**, **Expeditionary Gear**,
   **Weapons**, **Armor**, or **Mounts & Transports** for a mount or a cart.
2. Right-click it → **Import**. It lands in your **Items** sidebar (a mount or a
   cart lands in **Actors**).
3. Set its **Cost** there.
4. Drag your copy into your market table, and delete the row pointing at the
   shipped one.

Items you write yourself work exactly the same way: give one a Cost, drag it
into an aisle, and it is on the shelves.

---

## What a row can point at

An **item** of any kind, and an **NPC actor** for a mount, a wagon or a pack
animal — those carry a stat block and their own capacity, so they cannot be
plain items. Anything else dragged into a market table is ignored by the shop.

**Which aisle a thing is in is decided by the table it sits in**, not by what
kind of thing it is. A sword filed under Gear is sold from the Gear aisle.

One exception is worth knowing: a character's **Containers** tab offers the
Transports & Containers aisle and only that one. A mule filed under Gear can
still be bought from the main shop, but it will not appear on that tab, so put
carriers where they belong.

---

## What your players see

The shop is read fresh every time it opens, on whoever's screen it opens. Your
players get your prices and your stock the next time they open it — there is
nothing to hand out, and nobody needs to reload.

---

The same trick — a world table beating a shipped one by name — is how bonds and
omens are customized. See [Customizing bonds](customizing-bonds.md).
