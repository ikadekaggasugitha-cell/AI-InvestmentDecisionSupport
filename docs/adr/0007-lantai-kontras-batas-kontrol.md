# Batas kontrol punya lantai kontras; pembatas tidak

`--border` was `rgba(0,0,0,0.08)`, which measures **1.20:1** against both surfaces
it was painted on. That is correct for a divider, which carries no information by
its edge. It is not correct for a control, where the edge is the whole affordance:
WCAG 1.4.11 asks 3:1 for a component boundary, and a field nobody can see is a
field nobody fills in.

`--control-border` is that floor. `#7d8794` in light (3.42:1 on the background,
3.64:1 on the card) and `#606c7b` in dark (3.71:1 and 3.55:1). Both carry the same
cool cast as the greys already in the palette, so they read as part of the system
rather than as a correction. Both values were solved for and then measured with
the contrast checker, not estimated.

Two more defects were in the same family and are fixed with it:

- **Four controls set `outline: "none"` and had no replacement** (`PositionModal`,
  `AdvisorChat`, and the two search boxes). There was no `:focus-visible` rule
  anywhere in the app, so keyboard focus was invisible on all of them.
- **The focus ring drawn inside the primary button measured 1.00:1**, because it
  was `--ring` on `--primary`. With `outline-offset: 2px` it lands on the page
  background instead, where `--ring` clears 4.5:1.

## Consequences

- **`--border` still exists and is still used**, for table rules and section
  dividers. The split is deliberate and the two tokens must not converge: a test
  asserts that `--control-border` still fails the text threshold, which is what
  makes the distinction meaningful.
- **The focus rule is global**, in `styles/focus.css`, rather than per component.
  One line that cannot be forgotten when a component is added later is worth more
  than five correct ones. It uses `:focus-visible`, so a pointer click leaves no
  ring behind.
- **Inline styles cannot rescue an element that removes its own outline.** The
  four `outline: "none"` declarations were deleted rather than overridden, and a
  test scans for them because that is the only way they can come back.
- **The checker that verifies this asserts it is not vacuous.** Its first version
  globbed from the wrong root, matched zero files, and passed while every
  violation above was still present. `src/app/test/contrast.test.ts` now asserts
  the file list is non-empty before asserting anything about its contents.

## Rujukan

- `src/styles/theme.css` for both token values
- `src/styles/focus.css` for the ring
- `src/app/test/contrast.test.ts` for the numbers, computed rather than quoted