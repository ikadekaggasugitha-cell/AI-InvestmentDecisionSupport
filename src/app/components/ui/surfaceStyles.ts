/**
 * Floating-surface tokens.
 *
 * Single source for the overlay scrim and panel shadow that every modal, drawer,
 * and inline sheet paints when it lifts above the page. These values were repeated
 * verbatim across PositionModal, StockDetailPanel, and AllocationPanel; pulling them
 * here means a retune is one line, not a hunt, and no control re-declares a magic
 * number the design system already owns (docs/adr/design.md, "shadows minimal":
 * elevation belongs to surfaces that truly float, which these do).
 *
 * The scrim is a neutral dark veil under a floating panel, so it is deliberately a
 * fixed rgba rather than a --token: it sits over arbitrary page content in both
 * themes and must not inherit a theme colour.
 */

/** Veil behind a right-edge drawer or an inline sheet (lighter). */
export const overlayScrim = 'rgba(0,0,0,0.5)'

/** Veil behind a centered modal (one step stronger than the drawer scrim). */
export const modalScrim = 'rgba(0,0,0,0.6)'

/** Elevation for a centered modal box floating on `modalScrim`. */
export const modalPanelShadow = '0 16px 40px rgba(9,16,26,0.28)'

/** Elevation for a drawer sliding in from the right edge, cast to its left. */
export const drawerPanelShadow = '-16px 0 40px rgba(9,16,26,0.28)'
