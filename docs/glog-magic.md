# How to use GLoG Magic in Air Bladder

Air Bladder ships with the optional [GLoG Magic hack](https://cairnrpg.com/hacks/glog-magic/) for Cairn, based on Goblin Punch's **Goblin Laws of Magic** and its [2016 blogpost](https://goblinpunch.blogspot.com/2016/05/the-glog.html). The Warden switches it on in the world's settings.

Yochai Gal's adaptation of the rules — casting, Fatigue, Mishaps, copying and creating Grimoires — ships as the **GLoG Magic — Player Rules** journal in the **Journals (GLoG)** compendium, with all 100 spells beside it in **GLoG Magic — Spells**.

## Overview

**Magic Dice** — every cast invests one to four Magic Dice, and never more than the caster's free inventory slots. More dice make a stronger spell and raise the risk of Fatigue and Mishaps.

**Spellbooks and Spellscrolls** — with GLoG Magic alone, spellbooks stay spellbooks. Each takes its spell's GLoG wording and casts from the inventory with Magic Dice.

**Grimoires** — an option of their own. With **Use Grimoires** on, every spellbook becomes a single-use Spellscroll, and a character can bind scrolls into a Grimoire as pages that cast without being used up.

## Turning it on

**Game Settings → Configure Settings → Air Bladder → Configure Hacks → Use GLoG Magic**

Turning this on rewrites the whole world, once:

- Every canon spell anywhere takes its GLoG wording. A spellbook stays a spellbook and a scroll stays a scroll, spent or not.
- Spells that arrive later take it too.
- Generation hands out only GLoG and custom spells, as spellbooks (as scrolls with Grimoires on). They are rolled on the shipped **Spells — GLoG** table in **Tables (GLoG)**. A table of that name in your world is rolled instead. **Create a Custom Spell Table…** on the Rollable Tables sidebar makes that copy while the hack is on (see [Generating Characters](generating-characters.md)).

**Turning GLoG Magic off does not change spells back to their Cairn wording, and turning Grimoires off does not turn spellscrolls back into spellbooks.** Treat each switch as a campaign decision.

## Grimoires (optional)

**Use Grimoires (converts all spellbooks!)**, just under Use GLoG Magic, is off by default and greyed out while GLoG Magic is off. Turning it on converts the whole world, once: every spellbook becomes a single-use Spellscroll, new arrivals land as scrolls, and Grimoires, Transmute and casting from a Grimoire come into play. Turning it off converts nothing back. A world that used GLoG Magic before this option existed keeps Grimoires on.

The next three sections apply only while Use Grimoires is on.

## Getting a Grimoire into a character's inventory

The Grimoire is an item in the **Reliquary** compendium, in the **Air Bladder - Items** folder.

1. Open the **Reliquary** compendium.
2. Drag the **Grimoire** onto a character's sheet.

It is Bulky (two slots), and a character can carry **one**: a second dropped onto the same character is refused. An NPC, crate or pile can hold any number of Grimoires, but only a player character's sheet shows the Transmute and Cast controls.

The shipped marketplace does not sell Grimoires. How a character makes one is in the Player Rules journal.

A Grimoire holds 10 pages by default. Change **Pages** on its item sheet for a larger or smaller book. Each page holds one spell.

The **Grimoire** box and its **Pages** field appear only on a Grimoire's sheet, and only while Use Grimoires is on. No other item offers to become one. A spellbook's **GLoG** box, which marks a spell written in the hack's wording, appears only while GLoG Magic is on. Its **Scroll** box is Cairn 2e's and is always there.

## Moving a Grimoire between sheets

**A Grimoire's pages travel with it.** Drag a Grimoire from one sheet to another and its pages go along, to another character or into a crate. A page cannot be dragged on its own. A sheet holding several Grimoires keeps each one's pages with it.

A player cannot offer a Grimoire to another character. The Warden moves it.

One exception concerns pages bound in an early version of Air Bladder, before a page recorded which Grimoire it was in. Your world is repaired the first time you open it after updating, wherever a sheet holds a single Grimoire. If two or more of those older Grimoires sit on the *same* sheet, their pages stay where they are when either one leaves. Move the Grimoires off one at a time and the last one out takes what remains. The repair names any such sheet in the browser console (F12).

## Transmuting spells into a Grimoire's pages

While a character carries a Grimoire that is not full, every spellscroll or spellbook in their inventory that is not already a page shows a **Transmute into the Grimoire** control on its row. Click it, confirm, and the spell becomes a page:

- It is Petty: pages take no inventory slots.
- It is listed under the Grimoire, indented, with a page icon.
- It is no longer single-use. A page can be cast any number of times.
- It can never be removed from the Grimoire.

The confirmation for a scroll names the cost: 50 gold and 6 hours of downtime. The system does not deduct either. Mark them yourselves.

A spent scroll can still be transmuted, and its page casts like any other.

## Casting

Every cast invests **Magic Dice**: up to the caster's free inventory slots, and at most 4. A character with no free slot has no dice and cannot cast.

**From a Grimoire (Grimoires on):** once the Grimoire holds a page, its inventory row shows **Cast**. Pick the spell and the number of dice.

**From a scroll:** an unspent scroll that is not a page shows its own cast control. The cast spends the scroll. It stays in the inventory, struck through.

**From a spellbook (Grimoires off):** each spellbook's row shows **Cast**. The spellbook is not used up.

The roll is a Foundry roll, so Dice So Nice animates it. Two messages follow:

- **A public card** with the spell's text filled in: `[dice]`, `[sum]` and the per-power blocks are replaced by the rolled values. Hover a number to see what it replaced.
- **A whisper to the caster** with the rolled dice. If any die shows 4–6, an **Add N Fatigue** button adds one Fatigue per such die. It is never refused, even with a full inventory. If the dice show doubles, the whisper says a Mishap has occurred and gives the Mishaps table's entry for the dice's sum.

## Customizing the Mishaps

Import **GLoG Magic: Mishaps** from the **Tables (GLoG)** compendium into your world and edit your copy. A cast reads your world's table before the shipped one.

## What is not automated

The whisper reports and does not apply. Fatigue has the one button. Everything a Mishap or a spell *does* stays text for the table to act out.
