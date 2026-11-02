import type { ViewType } from '@/app/components/Sidebar'

/**
 * Which in-session screens stand on the glass ground, and what that means.
 *
 * This is the single answer to "is this screen glassy?" — App reads it and
 * glassContrast.test.ts asserts against it, so a view cannot be quietly added
 * to the app without the contrast guard learning about it, and cannot be
 * quietly dropped while still painting glass.
 *
 * Two separate questions, deliberately not merged:
 *
 *   - `isGlassView` — the screen gets the pastel ground and its cards use the
 *     translucent surface class. Its own scroll behaviour is untouched.
 *   - `isGlassShell` — the screen additionally hands scrolling to the shell
 *     column so the header can sit sticky over moving content. Only the
 *     dashboard does this, because that is the one place `backdrop-filter`
 *     has dark content to refract; everywhere else blur would be GPU cost for
 *     no visible difference.
 *
 * Screens outside this file — sign-in, suspension, the admin portal, the
 * public price sheet — keep the opaque paper surface they were built on.
 * A view enters this list in the same commit that converts its cards to
 * SURFACE_CLASS — glassContrast.test.ts fails if the list claims a view whose
 * source does not paint the surface, and also if a view sits on the pastel
 * ground while still holding opaque cards.
 */
export const GLASS_VIEWS: readonly ViewType[] = ['dashboard', 'portfolio', 'risk', 'news']

const GLASS_SHELL_VIEWS: readonly ViewType[] = ['dashboard']

export function isGlassView(view: ViewType): boolean {
  return GLASS_VIEWS.includes(view)
}

export function isGlassShell(view: ViewType): boolean {
  return GLASS_SHELL_VIEWS.includes(view)
}

/** Class name for a translucent card surface. Kept here so the guard test and
 *  the components ask for the same thing by name. */
export const SURFACE_CLASS = 'surface-glass'

/**
 * Surfaces that must never become translucent, whatever else is glassy:
 * dialogs and drawers sit over a scrim with small text, the search dropdown is
 * a control, and the skeleton and error boundary are states a reader needs to
 * parse instantly. glassContrast.test.ts asserts these files stay on --card.
 */
export const OPAQUE_ONLY_FILES: readonly string[] = [
  'features/portfolio/PositionModal.tsx',
  'features/market/StockDetailPanel.tsx',
  'features/identity/ConsentGate.tsx',
  'components/ViewSkeleton.tsx',
  'components/ErrorBoundary.tsx',
]
