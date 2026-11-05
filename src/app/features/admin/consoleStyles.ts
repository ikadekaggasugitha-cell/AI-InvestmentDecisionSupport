import type { CSSProperties } from 'react'

/**
 * One place the operator console's controls are defined.
 *
 * Before this file, each console section hand-copied its own recipe: an
 * `inputStyle` here, a `labelStyle` there, a button object written out again in
 * the next tab. Eight sites, drifting in the way duplicated styles drift — the
 * price inputs at 14px and every other input at 13px, one callout with a border
 * and the next without, `minHeight` present on some controls and absent on the
 * ones where it matters most. Nothing about that is a decision; it is eight
 * decisions that stopped being compared.
 *
 * The rules this file holds, and why each is the way it is:
 *
 *  - **`--control-border` on every control edge, `--border` on dividers only.**
 *    ADR-0007 gives an interactive boundary a contrast floor the divider token
 *    deliberately sits below. `src/app/test/contrast.test.ts` scans helper
 *    bodies whose *name* says they style a control — which is why these are
 *    called `controlStyle` and `buttonStyle` and not something the scanner would
 *    walk past. Naming was necessary and not sufficient: that guard's file list
 *    was `*.tsx` only, so the day these recipes moved into a `.ts` module,
 *    pointing `controlStyle` at `--border` passed all 23 of its tests. Measured,
 *    not inferred — the scan has since been widened to `.ts` and the mutation
 *    confirmed to fail again. A rename that dodges the check is a bug wearing a
 *    refactor's clothes, and so is a refactor that walks out of its sight.
 *  - **32px is the floor for anything you aim at.** Every button variant carries
 *    it. It is the number the console already used for its pagination and form
 *    actions, and the one the row actions in both tables fell short of at 28px —
 *    measured, not assumed.
 *  - **One type scale, five sizes, floor at 11px.** 11px is where this repo
 *    decided small text stops being honest, and `src/app/test/dataHonesty.test.ts`
 *    keeps it that way. The scale is named `text` rather than `typeScale` because
 *    it is five numbers, not a system.
 *  - **The accent is a fill for one action, never a status colour.** `primary`
 *    is the save button and nothing else. Money state is `--gain`/`--loss` with
 *    a word beside it, because a teal that sits 11 degrees from green cannot
 *    also be the colour of "approved".
 */

export const text = {
  meta: 11,
  body: 12,
  control: 13,
  heading: 15,
  title: 20,
  /** A figure in the overview list — bigger than its label, not than the page. */
  figure: 22,
  /** The one number on the console that leads a screen. `figure` plus four. */
  lead: 26,
} as const

/** Section heading inside a console panel. */
export const sectionTitleStyle: CSSProperties = {
  fontSize: text.heading,
  fontWeight: 600,
  margin: 0,
  color: 'var(--console-ink)',
}

/** The sentence under a heading: what the section writes, and where. */
export const sectionNoteStyle: CSSProperties = {
  fontSize: text.body,
  color: 'var(--console-secondary)',
  marginTop: 4,
  marginBottom: 0,
  lineHeight: 1.5,
}

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: text.control,
  color: 'var(--console-ink)',
  marginBottom: 4,
}

/** Helper text under a field. On a surface — see the meta-rung test. */
export const helpStyle: CSSProperties = {
  fontSize: text.meta,
  color: 'var(--console-meta)',
  marginTop: 3,
  marginBottom: 0,
  lineHeight: 1.45,
}

export const controlStyle: CSSProperties = {
  width: '100%',
  minHeight: 32,
  padding: '6px 10px',
  fontSize: text.control,
  fontFamily: 'var(--font-mono)',
  color: 'var(--console-ink)',
  background: 'var(--input-background)',
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius)',
  boxSizing: 'border-box',
}

/** A select is a control, but it is read as text, not typed as code. */
export const selectStyle: CSSProperties = {
  ...controlStyle,
  fontFamily: 'var(--font-display)',
}

export const searchStyle: CSSProperties = {
  ...controlStyle,
  fontFamily: 'var(--font-sans)',
}

export const textareaStyle: CSSProperties = {
  ...controlStyle,
  fontFamily: 'var(--font-sans)',
  lineHeight: 1.5,
  resize: 'vertical',
}

type ButtonVariant = 'primary' | 'quiet' | 'danger'

const buttonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minHeight: 32,
  padding: '7px 14px',
  fontSize: text.body,
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'center',
}

/**
 * `primary` is the one deliberate accent on a screen. A section that already has
 * a save button should reach for `quiet`, not a second teal rectangle.
 */
export function buttonStyle(variant: ButtonVariant = 'quiet'): CSSProperties {
  if (variant === 'primary') {
    return {
      ...buttonBase,
      fontWeight: 600,
      color: 'var(--console-accent-ink)',
      background: 'var(--console-accent)',
      border: '1px solid var(--console-accent)',
    }
  }
  if (variant === 'danger') {
    return {
      ...buttonBase,
      color: 'var(--loss)',
      background: 'transparent',
      border: '1px solid var(--loss)',
    }
  }
  return {
    ...buttonBase,
    color: 'var(--console-ink)',
    background: 'transparent',
    border: '1px solid var(--control-border)',
  }
}

/**
 * A row-level action: same tokens as the full-size buttons, at the 32px floor.
 *
 * `confirm` is navy, deliberately, and not the accent. The accent belongs to one
 * action per screen, and a queue has one button per row — teal on every row would
 * both flood the accent and read as "this is the important one" for twenty
 * different things. Navy is the brand's own primary surface and stays correct
 * when repeated.
 */
export function rowActionStyle(tone: 'confirm' | 'quiet' | 'danger' = 'quiet'): CSSProperties {
  const base: CSSProperties = {
    ...buttonStyle(tone === 'confirm' ? 'quiet' : tone),
    padding: '4px 8px',
    minHeight: 32,
    fontSize: text.meta,
  }
  if (tone !== 'confirm') return base
  return {
    ...base,
    fontWeight: 600,
    color: 'var(--primary-foreground)',
    background: 'var(--primary)',
    border: '1px solid var(--primary)',
  }
}

/** A checkbox is aimed at with a thumb, so the box itself stays generous. */
export const checkboxStyle: CSSProperties = {
  width: 16,
  height: 16,
  minHeight: 0,
  accentColor: 'var(--console-accent)',
  cursor: 'pointer',
  // The control boundary applies to the box's own outline too, so it stays
  // readable against the panel behind it (ADR-0007).
  border: '1px solid var(--control-border)',
}

export type AlertTone = 'warning' | 'loss' | 'gain' | 'neutral'

/**
 * A refusal, in the shape every refusal takes.
 *
 * The border and the text share a token on purpose: an alert that is only a
 * background tint is a message a reader with low vision does not receive, and
 * `--control-border` would be the wrong floor for something that has to be
 * noticed rather than clicked.
 */
export function alertStyle(tone: AlertTone = 'warning'): CSSProperties {
  const foreground = {
    warning: 'var(--warning)',
    loss: 'var(--loss)',
    gain: 'var(--gain)',
    neutral: 'var(--console-secondary)',
  }[tone]
  const background = {
    warning: 'var(--warning-bg)',
    loss: 'var(--loss-bg)',
    gain: 'var(--gain-bg)',
    neutral: 'var(--neutral-bg)',
  }[tone]
  return {
    fontSize: text.body,
    lineHeight: 1.5,
    color: foreground,
    background,
    border: `1px solid ${foreground}`,
    borderRadius: 'var(--radius)',
    padding: '8px 10px',
  }
}

/**
 * A status line that is not a box: loading, refused, and unreadable notices that
 * sit in text flow. Same floor as an alert, no frame, because a frame around a
 * sentence that is not an error makes everything look like a problem.
 */
export const statusLineStyle: CSSProperties = {
  fontSize: text.body,
  color: 'var(--console-secondary)',
}

/** A confirmation line. Deliberately not a box: it marks a fact, not a problem. */
export const savedStyle: CSSProperties = {
  fontSize: text.meta,
  color: 'var(--gain)',
  margin: 0,
}

export const th: CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left' as const,
  fontSize: text.body,
  fontWeight: 600,
  color: 'var(--console-secondary)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

export const td: CSSProperties = {
  padding: '12px',
  fontSize: text.control,
  // A table cell holds the values an operator decides on, so it reads in ink.
  // Column labels above are the secondary rung; timestamps inside go to `tdMeta`.
  color: 'var(--console-ink)',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
}

/** Timestamps and ids: present, not leading. Card-surface only. */
export const tdMeta: CSSProperties = {
  fontSize: text.meta,
  color: 'var(--console-meta)',
  marginTop: 2,
}

/**
 * The action column at a phone width: tried, measured, and put back.
 *
 * The gate asks that a row's action stay visible without side scrolling, and at
 * 390 both tables failed it — `Setujui`/`Tolak` and `Perpanjang`/`Blokir` sat past
 * the viewport inside their scroll region. Pinning the action column to
 * `right: 0` fixed that and was then screenshotted, because a pinned cell floats
 * over whatever occupies the scrollport's right edge, and at `scrollLeft: 0` that
 * is the Nominal column: the screenshot showed "Rp 44" and "Rp 252" with the
 * amount cut off by the buttons. Hiding the figure an operator decides on to
 * reach the button is the worse failure, and it is not fixable by padding — the
 * overlap is what `sticky` means.
 *
 * So the queue and the account list keep their scroll region, which is focusable
 * for exactly this reason, and the honest remaining work is the one this could
 * not do without changing the screens: a phone-width row that stacks. Recorded
 * in `tasks/plan-admin-panel.md` rather than left as a comment nobody reads.
 */

export const mono: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
}

/**
 * Mono that must not break: dates, ids, invoice codes, account numbers.
 *
 * Tabular figures so two rows line up in a column, and no wrapping so a date is
 * read as one object rather than two lines. A queue row whose dates break across
 * lines is a row the operator reads one at a time, which is the opposite of what
 * a table is for.
 */
export const monoCell: CSSProperties = {
  ...mono,
  whiteSpace: 'nowrap',
}

/**
 * Anything long enough to have pushed a row's action off-screen before: an
 * account number with a holder name, a hostname, an email. Wrapping is not
 * cosmetic here — a nowrap 13-digit snapshot widened a column until `Tolak`
 * sat outside the visible table at 1440.
 */
export const wrapStyle: CSSProperties = {
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  maxWidth: 320,
}

/** The console panel: solid paper, one hairline, no shadow. */
export const panelStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
}

/** The section a screen opens with, so its title and note read as one block. */
export const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
}

/** Stack for a whole console section: heading, fields, then the one action. */
export const sectionBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 560,
}
