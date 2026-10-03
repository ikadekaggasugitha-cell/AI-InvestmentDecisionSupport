# DESIGN.md

Design direction for this project. Owned by the product owner. `antislop.md` is the
filter that runs on top of this file; this file is the soul. It never overrides this one.

This file is a transcription of the owner's answers. Where the owner left a detail open,
it is marked `[OWNER TO NAME]` and must not be invented by an agent.

## Identity

- **Product**: `[OWNER TO NAME]`. The working repository name is
  `AI-InvestmentDecisionSupport`, which is not confirmed as the product name.
- **What it does**: decision support. It surfaces a scored BUY/HOLD/SELL call together
  with the reasoning and the data behind it.
- **Who it is for**: self-directed investors making their own investment decisions. Not a
  desk, not a team. The reader owns the capital and the consequence.
- **Source**: owner's own answer, 2026-10-02.

## Personality

Restrained and analytical. Quiet, dense, unfussy. Data leads and decoration stays out of
the way. Nothing in the interface tries to impress the reader.

This is an owner's stated direction and is entitled to the whole design. It means the
product is allowed to be boring where a landing page is not allowed to be boring, and
allowed to withhold decoration where a landing page is required to sell.

- **Source**: owner's own answer, 2026-10-02.

## Color

Two core colors plus one accent, on a neutral ground. Neutrals do not count against that
budget.

- **Core color 1**: `[OWNER TO NAME]`
- **Core color 2**: `[OWNER TO NAME]`
- **Accent, used at the key moment and nowhere else**: `[OWNER TO NAME]`
- **Ground and text**: `[OWNER TO NAME]`

Semantics for gain and loss must be legible in both themes, and are distinct from the
accent. An accent that reads as "up" or "down" is not an accent, it is a semantic color
wearing the wrong label.

- **Source**: owner's own answer, 2026-10-02.

## Typography

A characterful display face for headings and figures, plus a workhorse sans for interface
and controls.

- **Display face**: `[OWNER TO NAME]`
- **Workhorse sans**: `[OWNER TO NAME]`
- **Tabular figures**: `[OWNER TO NAME]`. Numeric columns and price ladders need tabular
  figures or they do not scan.

Figures must read as figures. A display face without usable tabular figures cannot carry
the numbers, and the numbers are the product.

- **Source**: owner's own answer, 2026-10-02.

## Theme

Light default, with a working dark toggle. Both modes fully functional, both verified by
contrast check and by click-through before delivery. A mode that breaks the other is a
defect, not a preference.

The admin portal follows this same rule. It is not a separate dark surface, and it gets no
theme of its own. An operator is doing the same job as a subscriber, so the two portals
share one ground.

- **Source**: owner's own answer, 2026-10-02, extended by the owner's decision on
  2026-10-02 that the admin portal follows the light default.

## Dials

> Reading this as: investment decision support for self-directed investors, in a
> restrained analytical language, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

- **ENERGY 1**: inferred from "restrained, nothing tries to impress you".
- **RHYTHM 2**: inferred, not stated. A multi-view analytical tool whose views all
  compose identically reads as a template, so composition varies between views while the
  voice stays level. If the owner wants flat uniformity, this is the dial to correct.
- **MOTION 1**: inferred from "unfussy". Hover and state feedback only. Motion used to
  direct attention to a signal is still permitted under ENERGY 1, and still needs its
  purpose written down.

## Open before build

These are the owner's to decide. An agent must not pick them silently.

1. Product name.
2. The two core colors and the accent.
3. The display face and the workhorse sans.
4. The tabular figures face.
5. The icon set. None is named yet. Until it is, a new surface takes either text labels
   alone or glyphs already used elsewhere in the app, and a new icon family is not
   introduced as a side effect of a feature.

Until these are named, any UI built against this file is a draft, not a deliverable.
