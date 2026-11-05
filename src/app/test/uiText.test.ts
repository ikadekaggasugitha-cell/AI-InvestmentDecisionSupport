import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * In-session UI-text & motion conformance (docs/adr/design.md).
 *
 * These lock the three design-system rules that the earlier data-honesty and
 * contrast suites do NOT cover, for the nine in-session modules and the shared
 * components they render:
 *
 *  1. No prose em/en dash in a rendered string. The project UI-text convention
 *     forbids em/en dashes in UI copy; a lone "—" empty-value placeholder and a
 *     numeric range ("09:00–12:00", "45–145") are typographic, not prose, and are
 *     allowed — the same carve-out dataHonesty.test.ts draws for pictographs.
 *  2. MOTION 1: no inline `... infinite` animation, and every loader is
 *     reduced-motion aware.
 *  3. The dashboard reference pattern: signed financial deltas never rely on
 *     colour alone (they carry a chevron), and figures use the tabular-figures face.
 *
 * Source-level rather than render-level on purpose: like dataHonesty, the thing
 * under test is what the source is allowed to contain, across every in-scope file
 * at once, so a check cannot pass by inspecting one lucky component.
 */

const SRC = join(process.cwd(), 'src/app')

const IN_SCOPE_DIRS = [
  'features/dashboard',
  'features/portfolio',
  'features/risk',
  'features/news',
  'features/reports',
  'features/settings',
  'features/advisor',
  'features/signals',
  'features/market',
]

/** Shared components rendered inside those screens. Admin, public, payment, and
 *  identity surfaces keep their own copy and are out of this pass's scope. */
const IN_SCOPE_FILES = [
  'components/ViewError.tsx',
  'components/Header.tsx',
  'components/Sidebar.tsx',
  'components/DataFreshnessBadge.tsx',
  'components/ui/surfaceStyles.ts',
]

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
}

const files: string[] = []
for (const d of IN_SCOPE_DIRS) {
  const abs = join(SRC, d)
  if (statSync(abs).isDirectory()) walk(abs, files)
}
for (const f of IN_SCOPE_FILES) {
  if (statSync(join(SRC, f)).isFile()) files.push(join(SRC, f))
}

/** A file with comments stripped, so a screen may document a pattern it removed
 *  without tripping its own assertion (same convention as dataHonesty.test.ts). */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

/** Run `test` over every in-scope source line, collecting `file:line` offenders. */
function scanLines(test: (line: string) => boolean): string[] {
  const offenders: string[] = []
  for (const f of files) {
    code(f)
      .split('\n')
      .forEach((line, i) => {
        if (test(line)) offenders.push(`${relative(SRC, f)}:${i + 1}`)
      })
  }
  return offenders
}

describe('in-session UI-text & motion conformance', () => {
  it('has a non-empty scope that includes the screens this pass touched', () => {
    const scoped = files.map((f) => relative(SRC, f))
    expect(scoped.length).toBeGreaterThan(25)
    expect(scoped).toContain('features/dashboard/DashboardView.tsx')
    expect(scoped).toContain('features/news/NewsView.tsx')
    expect(scoped).toContain('features/settings/TabSubscription.tsx')
    expect(scoped).toContain('components/ViewError.tsx')
  })

  it('the dash detector itself bites', () => {
    // Prove the rule is not a no-op: prose dashes are caught, while a numeric
    // range and a quote-isolated placeholder are not.
    const hits = (s: string) => /\s[—–]\s/.test(s) || /\p{L}[—–]|[—–]\p{L}/u.test(s)
    expect(hits('Server berjalan baik — ini bukan')).toBe(true)
    expect(hits('kata–kata')).toBe(true)
    expect(hits('09:00–12:00 · 13:30–15:50 WIB')).toBe(false)
    expect(hits('{symbol} · {name}')).toBe(false)
    expect(hits("value={x != null ? x : '—'}")).toBe(false)
  })

  it('renders no prose em/en dash in any in-session string', () => {
    const offenders = scanLines(
      (line) =>
        // spaced dash between words ("baik — ini"), or a dash glued to a letter
        // ("word—word"). Digit ranges and quote-isolated placeholders miss both.
        /\s[—–]\s/.test(line) || /\p{L}[—–]|[—–]\p{L}/u.test(line),
    )
    expect(offenders).toEqual([])
  })

  it('keeps loaders reduced-motion aware and free of inline infinite loops (MOTION 1)', () => {
    const spinners = scanLines(
      (line) => line.includes('animate-spin') && !line.includes('motion-reduce'),
    )
    const inlineLoops = scanLines((line) => /animation:\s*['"`][^'"`]*\binfinite\b/i.test(line))
    expect(spinners).toEqual([])
    expect(inlineLoops).toEqual([])
  })

  it('never shows a financial delta as colour alone and keeps the key figure mono', () => {
    const view = readFileSync(join(SRC, 'features/dashboard/DashboardView.tsx'), 'utf8')
    // Signed KPI deltas pair colour with a directional chevron, and the key
    // number is drawn in the tabular-figures face ("the numbers are the product").
    expect(view).toMatch(/ChevronUp/)
    expect(view).toMatch(/ChevronDown/)
    expect(view).toMatch(/fontFamily:\s*'var\(--font-mono\)'/)
  })
})
