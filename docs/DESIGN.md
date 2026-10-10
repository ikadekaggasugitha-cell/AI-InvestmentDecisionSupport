# DESIGN.md

Design direction for this project. Owned by the product owner. `antislop.md` is the
filter that runs on top of this file; this file is the soul, and the filter never
overrides it.

This file transcribes the owner's answers. All identity fields are named by the
owner; no agent-invented value is present.

## Identity

- **Product name:** AIDSS, AI Investment Decision Support System.
- **Category:** investment analytics and decision support.
- **Design direction:** Institutional Finance x Modern Intelligence.
- **What it does:** decision support. It surfaces a scored BUY/HOLD/SELL call
  together with the reasoning and the data behind it.
- **Who it is for:** self-directed investors making their own investment decisions.
  Not a desk, not a team. The reader owns the capital and the consequence.
- **Source:** owner's own answer, transcribed 2026-10-10.

## Personality

Analytical, trustworthy, precise, restrained, and forward-looking.
Restrained and analytical: quiet, dense, unfussy. Data leads and decoration stays
out of the way. Nothing in the interface tries to impress the reader.

Visual principle: data-first. Clarity over decoration. Confidence without visual
noise.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Color

Two core colors plus one accent, on a neutral ground. Neutrals do not count against
that budget.

- **Core color 1, Midnight Navy:** `#14243A`. Primary brand color, navigation, major
  headings, and dark surfaces.
- **Core color 2, Slate Blue:** `#344A64`. Secondary navigation, supporting surfaces,
  selected states, and visual hierarchy.
- **Accent, Emerald Teal:** `#0F9D78`. Primary actions, selected key moments, and
  important positive highlights. Use sparingly; never turn the interface into a
  green-heavy financial dashboard. Held to a contrast floor: on the light ground it
  is a fill with dark text and never white-on-teal, because white on `#0F9D78`
  measures about 3.4:1 and fails R-25 for normal text.
- **Ground, Cool Ivory:** `#F5F7FA`. Default application background.
- **Text, Graphite Ink:** `#17212F`. Primary text, figures, labels, and headings.

Supporting neutrals: surface `#FFFFFF`, border `#DCE2EA`, secondary text `#64748B`
(nudged darker to `#5E6C7E` so body text clears 4.5:1 on Cool Ivory), muted surface
`#EDF1F5`. Inline text links use a dedicated `--link` token — Slate Blue `#344A64`
on light, light blue `#7FB0E0` on dark — because `--primary` is a fill and reads
below 3:1 where its value would double as link text on the dark ground.

Financial semantics, distinct from the accent:

- **Positive:** `#16845B` (nudged to `#14764A`: `#15804F` measured 4.37:1 on the muted
  surface `#EDF1F5`, so the text colour is taken darker until gain clears 4.5:1 on both
  Cool Ivory and the muted surface).
- **Negative:** `#D14343` (nudged to `#C63B3B` for text on the light ground).
- **Neutral:** `#64748B` (nudged to `#5E6C7E` for text on the light ground).

Financial status colors are semantic, not decorative. Never communicate gain or loss
through color alone; include the sign, value, or label.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Typography

- **Display face, Manrope (Google Fonts):** page titles, key metrics, section
  headings, and prominent summaries. Weights 500, 600, 700.
- **Workhorse sans, Inter (Google Fonts):** body text, navigation, forms, tables,
  labels, and analytical explanations. Weights 400, 500, 600.
- **Tabular-figures face, IBM Plex Mono (Google Fonts):** stock prices, portfolio
  values, percentages, timestamps, financial tables, and technical identifiers.
  Weights 400, 500. Tabular numerals enabled where supported so numeric columns and
  price ladders scan.

Figures must read as figures. The numbers are the product.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Iconography

- **Library:** Lucide (`lucide-react`), minimal consistent outline icons.
- **Default stroke width:** 1.75 to 2px.
- **Usage:** icons must improve recognition or navigation, not fill empty space.
- **Restrictions:** no emoji icons, no decorative icon clusters, no gratuitous
  gradients, no mixed icon styles.
- **Fallback:** use clear text labels when an icon does not improve usability.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Theme

Light default, with a working dark toggle. Both modes fully functional, both verified
by contrast check and by click-through before delivery. A mode that breaks the other
is a defect, not a preference.

Navigation is Midnight Navy in both themes: it is a brand surface, not a dark-mode
default. The admin portal follows this same rule. It is not a separate surface, and
it gets no theme of its own. An operator does the same job as a subscriber, so the
two portals share one ground.

- **Source:** owner's own answer, transcribed 2026-10-10, extended by the owner's
  decision on 2026-10-02 that the admin portal follows the light default.

## Dials

> Reading this as: investment decision support for self-directed investors, in an
> institutional-finance language, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

- **ENERGY 1:** restrained, nothing tries to impress the reader.
- **RHYTHM 2:** composition varies between views while the voice stays level. A
  multi-view analytical tool whose views all compose identically reads as a template.
- **MOTION 1:** unfussy. Hover and state feedback only. Motion used to direct
  attention to a signal is still permitted under ENERGY 1, and still needs its
  purpose written down.

## Implementation Principles

- Prioritize information hierarchy and readable financial data.
- Midnight Navy and Slate Blue are the primary visual foundation.
- Reserve Emerald Teal for a limited number of meaningful interactions.
- Surfaces stay restrained, borders subtle, shadows minimal.
- Consistent spacing and alignment across tables and dashboards.
- Prefer explicit labels, units, and timestamps over ambiguous visual indicators.
- Ensure accessible contrast; never rely on color alone to convey financial outcomes.
- Avoid excessive rounded cards, ornamental gradients, glowing effects, and
  unnecessary animation.
