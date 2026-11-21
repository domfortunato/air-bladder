# How to use GLoG Magic in Air Bladder

Air Bladder ships with the optional [GLoG Magic hack](https://cairnrpg.com/hacks/glog-magic/) for Cairn, based on Goblin Punch's **Goblin Laws of Magic** and its [2016 blogpost](https://goblinpunch.blogspot.com/2016/05/the-glog.html). The Warden switches it on in the world's settings.

Yochai Gal's adaptation of the rules covers casting, Fatigue, Mishaps, and copying and creating Grimoires. It ships as the **GLoG Magic — Player Rules** journal in the **Journals (GLoG)** compendium, with all 100 spells beside it in **GLoG Magic — Spells**.

## Overview

**Magic Dice** — every cast invests one to four Magic Dice, and never more than the caster has free inventory slots. More dice make a stronger spell, and they also raise the risk of Fatigue and Mishaps.

**Spellbooks and Spellscrolls** — with only GLoG Magic on, spellbooks stay spellbooks. Each one gets its spell's GLoG wording, and you cast it from the inventory with Magic Dice.

**Grimoires** — these are a separate option. With **Use Grimoires** on, every spellbook becomes a single-use Spellscroll, and a character can bind scrolls into a Grimoire as pages. A page isn't used up when it's cast.

## Turning it on

**Game Settings → Configure Settings → Air Bladder → Configure Hacks → Use GLoG Magic**

Turning this on rewrites the whole world, once:

- Every canon spell, wherever it is, gets its GLoG wording. A spellbook stays a spellbook and a scroll stays a scroll, whether it's spent or not.
- Spells that show up later get it too.
- Generation only hands out GLoG and custom spells. They come as spellbooks, or as scrolls with Grimoires on. They're rolled on the shipped **Spells — GLoG** table in **Tables (GLoG)**. If your world has a table with that name, it's rolled instead. **Create a Custom Spell Table…** on the Rollable Tables sidebar makes that copy while the hack is on (see [Generating Characters](generating-characters.md)).

**Turning GLoG Magic off doesn't change spells back to their Cairn wording, and turning Grimoires off doesn't turn spellscrolls back into spellbooks.** Treat each switch as a campaign decision.

## Grimoires (optional)

**Use Grimoires (converts all spellbooks!)**, just under Use GLoG Magic, is off by default, and it's greyed out while GLoG Magic is off. Turning it on converts the whole world, once. Every spellbook becomes a single-use Spellscroll, new spells arrive as scrolls, and you can use Grimoires, Transmute and casting from a Grimoire. Turning it off doesn't convert anything back. A world that used GLoG Magic before this option existed keeps Grimoires on.

The next three sections only apply while Use Grimoires is on.

## Getting a Grimoire into a character's inventory

The Grimoire is an item in the **Reliquary** compendium, in the **Air Bladder - Items** folder.

1. Open the **Reliquary** compendium.
2. Drag the **Grimoire** onto a character's sheet.

It's Bulky (two slots), and a character can only carry **one**. If you drop a second onto the same character, it's refused. An NPC, crate or pile can hold any number of Grimoires, but only a player character's sheet shows the Transmute and Cast controls.

The shipped marketplace doesn't sell Grimoires. The Player Rules journal explains how a character makes one.

A Grimoire holds 10 pages by default. To make the book larger or smaller, change **Pages** on its item sheet. Each page holds one spell.

The **Grimoire** box and its **Pages** field only show up on a Grimoire's sheet, and only while Use Grimoires is on. Other items don't offer to become one. A spellbook's **GLoG** box marks a spell written in the hack's wording, and it only shows up while GLoG Magic is on. Its **Scroll** box is Cairn 2e's, so it's always there.

## Moving a Grimoire between sheets

**A Grimoire's pages travel with it.** When you drag a Grimoire from one sheet to another, its pages go along, whether that's to another character or into a crate. You can't drag a page on its own. If a sheet holds several Grimoires, each one keeps its own pages.

A player can't offer a Grimoire to another character. The Warden has to move it.

There's one exception, for pages bound in an early version of Air Bladder, before a page kept track of which Grimoire it was in. Your world is repaired the first time you open it after updating, wherever a sheet holds a single Grimoire. If two or more of those older Grimoires are on the *same* sheet, their pages stay where they are when either one leaves. Move the Grimoires off one at a time, and the last one out takes the pages that are left. The repair lists any sheet like that in the browser console (F12).

## Transmuting spells into a Grimoire's pages

While a character is carrying a Grimoire that isn't full, every spellscroll or spellbook in their inventory that isn't already a page shows a **Transmute into the Grimoire** control on its row. Click it and confirm, and the spell becomes a page:

- It's Petty, so it doesn't take up an inventory slot.
- It's listed under the Grimoire, indented, with a page icon.
- It isn't single-use any more. You can cast a page any number of times.
- You can never take it out of the Grimoire.

The confirmation for a scroll tells you the cost, which is 50 gold and 6 hours of downtime. The system doesn't deduct either one, so mark them yourselves.

You can still transmute a spent scroll, and its page casts like any other.

## Equipping a spellbook, scroll or Grimoire

A spellbook, a scroll or a Grimoire can be equipped, one at a time, with the hand on its inventory row or the **Equip Spell** badge under Armor on the sheet's first page. The badge's label names what you've got, like **Equip scroll** or **Grimoire equipped**. You don't need to equip something to cast from it. A Grimoire's pages can't be equipped on their own.

## Casting

Every cast invests **Magic Dice**. You can invest up to one for each free inventory slot the caster has, and never more than 4. A character who doesn't have a free slot doesn't have any dice, so they can't cast.

**From a Grimoire (Grimoires on):** once the Grimoire holds a page, its inventory row shows **Cast**. Pick the spell and the number of dice.

**From a scroll:** an unspent scroll that isn't a page shows its own cast control. Casting spends the scroll, and it stays in the inventory, struck through.

**From a spellbook (Grimoires off):** each spellbook's row shows **Cast**. The spellbook isn't used up.

The roll is a Foundry roll, so Dice So Nice animates it. Two messages follow:

- **A public card** with the spell's text filled in. `[dice]`, `[sum]` and the per-power blocks are replaced by the rolled values. Hover over a number to see what it replaced.
- **A whisper to the caster** with the rolled dice. If any die shows 4–6, an **Add N Fatigue** button adds one Fatigue for each of those dice. It's never refused, even when the inventory is full. If the dice show doubles, the whisper says a Mishap has happened and gives the Mishaps table's entry for the dice's sum.

## Customizing the Mishaps

Import **GLoG Magic: Mishaps** from the **Tables (GLoG)** compendium into your world and edit your copy. A cast reads your world's table before the shipped one.

## What is not automated

The whisper only tells you what happened. It doesn't apply anything for you, apart from the one Fatigue button. Everything a Mishap or a spell *does* stays as text for the table to act out.
