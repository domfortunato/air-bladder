<!-- Not in the System Docs journal roster (tools/import/system-docs.mjs) —
     it is about a third-party module, and adding it would mean a pack build. -->

# Lighting torches with the Torch module

[Torch](https://github.com/League-of-Foundry-Developers/Torch) is a third-party
module by the League of Foundry Developers. It puts a light button on a token's
HUD: press it and the token starts shedding light from a light source the
character is carrying, press it again and the light goes out. Torch knows about
a dozen game systems out of the box, and Air Bladder is not one of them — so on
its own it offers an Air Bladder token nothing. This page gives it what it needs.

Air Bladder does not light anything itself, and nothing here changes that. The
file below only tells Torch which inventory items are lights and how far they
reach. Whether to run Torch at all is the Warden's call.

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

| Item | Bright / dim | Burns |
|---|---|---|
| Torch | 20 / 40 ft | one use each time it goes out |
| Lantern | 20 / 40 ft, steadier flame | never — spend the Oil Can by hand |
| Candle | 5 / 10 ft | one use each time it goes out |
| Candle Helmet | 5 / 10 ft, hands free | one use each time it goes out |
| Torch Fungus | 10 / 20 ft, pale and heatless | one use each time it goes out |
| Wisp Lantern | dim only, 15 ft, blue | never |
| Glowsnail | dim only, 10 ft, green | never |
| Sun Stick | 20 / 40 ft, warm | one use each time it goes out |
| Lightsucker Candle | sheds *darkness* 10 / 20 ft | one use each time it goes out |
| Heatless Torch (spell) | 20 / 40 ft, cold white | never |
| Lamp's Hue (spell) | 20 / 40 ft | never |

Left out on purpose: the **Oil Can** (fuel, not a light), **Fire Oil** and
**Miracle Oil** (not lights), the **Candle of Ward** (a ward that happens to be
a candle) and the **Wraith Lantern** (it reveals a path; it does not shine).

## How burning works

Each time a light goes **out**, Torch spends **one use** of the item — the same
counter the sheet's −/+ pips show. Lighting it costs nothing; putting it out is
what uses it up, so a torch that burns until the scene ends is still whole
until somebody extinguishes it. A Torch has three uses, so it burns out three
times and is then exhausted: Torch stops offering it until the player rolls the
next one from the stack on the sheet, or edits the uses. Torch never refills
anything.

The Lantern has no counter of its own. Its fuel is the **Oil Can**, and Torch
cannot see one item as another's fuel, so the Lantern lights for free and the
oil is spent by hand — which is what the rules text asks for anyway.

Two Torch settings decide who burns anything: **players consume inventory** is
on by default, **the GM consumes inventory** is off. A Warden's own tokens
light without spending a use unless you switch the second one on.

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
