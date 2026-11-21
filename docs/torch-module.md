<!-- Not in the System Docs journal roster (tools/import/system-docs.mjs) —
     it is about a third-party module, and adding it would mean a pack build. -->

# Lighting torches with the Torch module

[Torch](https://github.com/League-of-Foundry-Developers/Torch) is a third-party
module by the League of Foundry Developers. It puts a light button on a token's
HUD: press it and the token starts shedding light from a light source the
character is carrying, press it again and the light goes out. Torch knows about
a dozen game systems out of the box, and Air Bladder is not one of them — so on
its own it offers an Air Bladder token nothing. This page gives it what it needs.

Air Bladder never lights a token on its own. The file below tells Torch which
inventory items are lights and how far they reach, and the character sheet's
**Equip light** badge asks Torch to light the one a character equips. Whether to
run Torch at all is the Warden's call.

## Install

1. Install and enable **Torch** (3.3.0 or later) in your world.
2. Download
   [`torch-light-sources.json`](https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/torch-light-sources.json)
   and upload it into your Foundry user data — anywhere the file picker can
   reach, for example a `torch/` folder next to `worlds/`. The setting is a
   file picker, so a file elsewhere on your disk will not do.
3. **Game Settings → Module Settings → Torch → Additional Light Sources**, pick
   the file, save, and reload.

From then on, a token whose actor carries a Torch, Lantern, Candle or any of
the other lights listed below gets Torch's light button on its HUD.

## What lights, and how far

Cairn gives no light radii, so these are a Warden's numbers, in feet on the
5 ft grid. Edit them in the file if your table sees things differently.

| Item | Bright / dim | Lighting it spends |
|---|---|---|
| Torch | 20 / 40 ft | one of its uses |
| Lantern | 20 / 40 ft, steadier flame | one use of an Oil Can, or of a Candle |
| Candle | 5 / 10 ft | one of its uses |
| Candle Helmet | 5 / 10 ft, hands free | nothing (it's worn, not equipped) |
| Torch Fungus | 10 / 20 ft, pale and heatless | one of its uses, if it counts them |
| Wisp Lantern | dim only, 15 ft, blue | nothing |
| Glowsnail | dim only, 10 ft, green | nothing |
| Sun Stick | 20 / 40 ft, warm | one of its uses, if it counts them |
| Lightsucker Candle | sheds *darkness* 10 / 20 ft | one of its uses, if it counts them |

Left out on purpose: the **Oil Can** (fuel, not a light), **Fire Oil** and
**Miracle Oil** (not lights), the **Candle of Ward** (a ward that happens to be
a candle) and the **Wraith Lantern** (it reveals a path; it does not shine).

## How burning works

Air Bladder spends the use, not Torch, and it does it when the light is **lit**:
equipping a Torch marks off one of its uses, the same counter the sheet's −/+
pips show. A Torch has three, so it lights three times. With none left you
can't equip it, and the sheet tells you it's used up.

The Lantern doesn't have uses of its own. Lighting it marks off one use of an
**Oil Can** you're carrying, or of a **Candle** if you don't have oil. Without
either, you can't light it.

Everyone at the table sees a chat message when a light is lit and when it goes
out. When the Warden puts out a player's light, the message says the Warden did
it.

The file marks nothing as consumable, so Torch never spends a second use when
the light goes out. Its **players consume inventory** and **GM consumes
inventory** settings don't matter here.

## Equip light

Under the Armor box on a character's or a creature's sheet is the **Equip
light** badge. It shows the light you're carrying (a torch, a lantern, a
candle), and it glows while one is equipped, with how far it reaches written
underneath. Pressing it equips a light, and its label changes from **Equip
light** to **Light equipped**. That's the same as pressing that light's hand in
the inventory. With more than one light carried, it asks which. Pressing it
again puts every equipped light away. Only one light is equipped at a time, so
equipping another by its hand puts the first away. With no light at all, the
badge is greyed out and reads **No Light**.

With Torch active and the character's token on the scene you're viewing,
equipping a light also lights the token, and putting it away puts the light
out. A light that leaves the hand any other way (marked Broken, given away,
dropped or deleted) is put out too. It only works one way: Torch's own button
on the token HUD doesn't move the badge, and lighting it there doesn't spend a
use. A light Torch doesn't know (a name missing from the file) is still
equipped, but it doesn't shine. Without Torch, or with no token on the scene,
the badge only equips the item and spends the use.

## Names are what match

Torch finds a light by the item's **name**, ignoring case. Rename a Torch to
"Brand" and it is no longer a light. The file's `aliases` block covers the
plural spelling a background grant can carry (`Torches`) and the Spanish
content names (`Antorcha`, `Linterna`, `Vela` …); add your own there for house
items — an alias is a new name pointing at an existing entry:

```json
"aliases": { "Bullseye Lantern": "Lantern" }
```

The Lightsucker Candle uses Foundry's darkness sources (the `negative` light
flag), which exist since Foundry 12 — fine on the version Air Bladder runs.
