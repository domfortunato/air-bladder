# Theming: the sheets follow the viewer's colour scheme

**Decided 2026-07-28.** Air Bladder's sheets render in whichever colour scheme the player
picked — light or dark. They are **not** pinned to `theme-light`.

This is a rule, not a preference. If you are adding a colour, the last section tells you
what to do.

---

## Why there was a decision to make at all

Foundry has two application frameworks, and they disagree about theming.

**ApplicationV1 force-tags every window `themed theme-light`** — `client/appv1/api/application-v1.mjs:79-81`:

```js
if ( !this.options.classes.includes("theme-dark") && !isSetup )
  this.options.classes.push("themed", "theme-light");
```

**ApplicationV2 does not.** A V2 sheet inherits the scheme from `<body>`, which
`Game##configureUI` sets from the player's Colour Scheme setting, falling back to the
browser's `prefers-color-scheme` (`client/game.mjs:1849-1855`).

So for as long as a sheet was AppV1, dark mode could not reach it, and the stylesheet was
free to assume parchment — which it did, in about a hundred places. Porting a sheet to
ApplicationV2 hands us a dark mode whether we want one or not. That made it a real fork in
the road, and it had to be settled **before** the actor sheet was ported rather than
during: Shadowdark tracks "restructure CSS ready for converting sheets to ApplicationV2"
as a *separate, blocking* issue, and WWN's release notes say plainly that "the sheet was
never designed with v13's theming in mind and it turned out to be pretty difficult to
attempt". Doing the CSS and the port in one change is how that becomes difficult.

## The two options, and why this one

**Pin the light classes** — `classes: ['themed', 'theme-light']` on each sheet. DCC's
migration guide lists this, and lists it as a *workaround*. It is one line, it is
guaranteed not to regress anything, and it means shipping a sheet that visibly ignores a
setting the player chose, forever, on the one surface they look at every session.

**Follow the scheme** — style both. More work up front, and the work is bounded and
measurable, which is the part that decided it.

The measurement, taken before committing to either (`tools/dev/probe-theme.mjs`):

| | light | dark |
|---|---|---|
| character sheet | clean | **28 unreadable elements** |
| item sheet | clean | 4 invisible borders |

28 sounds like a lot. It is not, because they were not 28 problems — they were **three**:
one ink colour, one muted colour, and `border: 2px solid black`, each repeated. The whole
fix is a token table.

## What was actually built

`css/cairn.css` opens with a palette block: every colour the system chooses for itself is
a named custom property, defined once for light and once for dark. The light values are
byte-for-byte the ones that shipped, so the default appearance did not change — verified
by screenshot, and by the probe reporting light identical before and after.

The dark block is scoped deliberately:

```css
.theme-dark :is(.cairn, .application, .chat-message):not(.theme-light),
:is(.cairn, .application, .chat-message).theme-dark { … }
```

Two things about that selector are load-bearing while the migration is half done:

- **It is not on `<body>`.** Custom properties inherit. An AppV1 window force-tags *itself*
  `theme-light` while still living inside a dark `<body>`, so tokens set on body would leak
  into a sheet that is demonstrably still on parchment.
- **`:not(.theme-light)`** is what excludes those windows. It can be deleted once no AppV1
  sheet is left.

## The two exceptions to "no literal colours"

Both are colours that carry **their own foreground and background**, and are therefore
scheme-independent by construction:

- the status banners (`.status-dead`, `.status-critical`, …) — a fixed background with
  `#fff` text on it;
- the black label bars (`--ab-bar` / `--ab-on-bar`) — the sheet's signature, and legible on
  either scheme, so they are deliberately *not* flipped.

## Two Foundry facts that cost time, recorded so they don't again

**1. The light backdrop is an image, not a colour.** Foundry's light theme sets
`--background: url(ui/parchment.jpg)`; only dark resolves it to a colour
(`rgba(11, 10, 19, 0.9)`). Any contrast check that walks ancestors looking for a
background-*colour* therefore falls through parchment to `<body>`'s black and reports every
dark-on-parchment label as unreadable — **in both schemes**, which is the tell that it has
happened. The probe samples the image's average pixel instead.

**2. `body.game .app` is a legacy layer that evaporates on port.** It is keyed on the
AppV1 class, and an AppV2 window is `.application`, never `.app`. Two of its rules reach
into sheet content:

```css
body.game .app.window-app .window-content { color: var(--color-text-dark-primary) }  /* fixed #191813 */
body.game .app img { border: 1px solid var(--color-border-dark) }
```

Both resolve through fixed-dark variables defined *only inside that block*, so overriding
`--color-text-primary` does nothing. This matters beyond the probe: **most of the original
28 findings were this, not our stylesheet**, and they fix themselves the moment the class
is gone. Our real debt was the three colours above.

## How this is kept honest

`npm run dev:theme` renders a generated character and an item sheet, in both schemes, on
every tab, and measures each text and border colour against its actual backdrop.

- **Light is the baseline.** Only a finding that appears in dark and *not* in light fails
  the run — otherwise Foundry's own chrome (a 1.24:1 button border on parchment) would make
  green unreachable, and none of that is ours to fix.
- For a sheet still on AppV1 it **simulates** the post-port state, because tagging an AppV1
  window `theme-dark` does not preview anything: its chrome keeps parchment regardless, and
  only the variables flip. The simulation drops the forced `theme-light`, paints on the
  backdrop a real AppV2 window was *measured* to get, and redirects the two legacy
  variables above. Everything it substitutes is read from a live V2 sheet rather than
  hardcoded, so it cannot drift when Foundry restyles.
- Confirmed to fail with the fix removed (disabling the dark block: 30 regressions on the
  character sheet, 4 on the item sheet), per the house rule in `release-testing.md`.

`-- --shots` writes `theme-{actor,item}-{light,dark}.png` to `tools/dev/out/`. Numbers
catch regressions; look at the screenshots when judging whether something merely *passes*
also looks right.

---

## Adding a colour

1. **Is it a pair that carries its own foreground and background?** Then it is
   scheme-independent — use it literally, and say so in a comment.
2. Otherwise **add a token** to the `:root` block in `css/cairn.css`, and a dark value to
   the block below it. Do not put a literal colour in a rule.
3. Run `npm run dev:theme -- --shots` and look at both screenshots.

If you find yourself wanting a dark value that is just the light one dimmed, check the
contrast first: the dark backdrop is `rgb(10, 9, 17)`, which is much darker than most
"dark mode" palettes assume, and mid-greys that look safe disappear on it.
