import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { globSync } from 'node:fs'

/**
 * The contrast floor, enforced rather than asserted.
 *
 * `--border` measures 1.20:1 against both surfaces it is painted on. That is fine
 * for a divider, which carries no information by its edge. It is not fine for a
 * control, where the edge is the thing that tells you where to click or to put
 * the caret. WCAG 1.4.11 asks 3:1 there, so `--control-border` exists and this
 * file makes sure it is used, and used correctly.
 *
 * The contrast numbers themselves are computed here rather than quoted, because
 * a comment claiming a token passes is worth nothing: a token value can be
 * changed and the comment would keep claiming the old ratio.
 */

const ROOT = resolve(__dirname, '../..')
const theme = readFileSync(resolve(ROOT, 'styles/theme.css'), 'utf8')

const TOKEN_LIGHT = '#7d8794'
const TOKEN_DARK = '#606c7b'
const SURFACES_LIGHT = ['#f6f8fa', '#ffffff']
const SURFACES_DARK = ['#060a0f', '#0b1118']
const FLOOR = 3

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const parts = hex.replace('#', '')
  const r = channel(parseInt(parts.slice(0, 2), 16))
  const g = channel(parseInt(parts.slice(2, 4), 16))
  const b = channel(parseInt(parts.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function sourceFiles(): string[] {
  return globSync('app/components/**/*.tsx', { cwd: resolve(ROOT) })
    .filter((p) => !p.includes('/ui/'))
    .map((p) => resolve(ROOT, p))
}

/**
 * A guard against the check that checks nothing.
 *
 * The first version of this file globbed 'components/**' from the wrong root,
 * matched zero files, and every assertion below passed vacuously while four real
 * violations sat in the code. A test that cannot fail is worse than no test,
 * because it reports coverage it does not have. So the file list is asserted
 * non-empty, and asserted to contain the components the rules exist for.
 */
describe('the checker itself', () => {
  it('finds the component files it is supposed to scan', () => {
    const files = sourceFiles().map((f) => relative(ROOT, f))
    expect(files.length).toBeGreaterThan(15)
    expect(files).toContain('app/components/PositionModal.tsx')
    expect(files).toContain('app/components/AuthScreen.tsx')
  })

  it('reads a real file rather than an empty one', () => {
    const first = sourceFiles()[0]
    expect(readFileSync(first, 'utf8').length).toBeGreaterThan(500)
  })
})

describe('the control border token', () => {
  it('is declared in both themes', () => {
    const declarations = theme.match(/--control-border:\s*(#[0-9a-f]{6})/gi) ?? []
    expect(declarations.length).toBe(2)
  })

  it('clears 3:1 on every surface it is painted over, in light mode', () => {
    for (const surface of SURFACES_LIGHT) {
      expect(contrast(TOKEN_LIGHT, surface)).toBeGreaterThanOrEqual(FLOOR)
    }
  })

  it('clears 3:1 on every surface it is painted over, in dark mode', () => {
    for (const surface of SURFACES_DARK) {
      expect(contrast(TOKEN_DARK, surface)).toBeGreaterThanOrEqual(FLOOR)
    }
  })

  it('still fails as a divider colour, which is why --border still exists', () => {
    // The point of the split. If this ever passes, the two tokens have converged
    // and the distinction the split was built on has stopped existing.
    expect(contrast(TOKEN_LIGHT, '#f6f8fa')).toBeLessThan(4.5)
  })
})

/** Split a component file into `name -> body` for each top-level function. */
function helpersIn(file: string): Map<string, string> {
  const src = readFileSync(file, 'utf8')
  const out = new Map<string, string>()
  // `function name(...)`, `const name = (...) =>`, and `const name = {`.
  const re = /function\s+(\w+)\s*\(|const\s+(\w+)\s*(?::[^=]*)?=/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const start = m.index
    let depth = 0
    let i = src.indexOf('{', start)
    if (i === -1) continue
    // Skip an arrow parameter list so its braces are not counted.
    const arrow = src.indexOf('=>', start)
    const paren = src.indexOf('(', start)
    if (arrow !== -1 && paren !== -1 && paren < arrow && arrow < i) i = arrow
    const bodyStart = i
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    out.set(m[1] ?? m[2], src.slice(bodyStart, i))
  }
  return out
}

// A helper whose name says it styles a control. Divider helpers are deliberately
// not in this list: a line between two table rows carries no information by edge,
// so --border is the correct token there and must stay reachable.
const CONTROL_HELPER = /field|input|control|button|toggle|chip|search|box/i

describe('no control is left at the divider contrast', () => {
  it('finds no interactive control whose boundary is --border', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!line.includes('var(--border)')) return
        const before = lines.slice(Math.max(0, i - 10), i + 2).join('\n')
        if (/<button|<input|<select|<textarea/i.test(before)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('finds no control style helper still pointing at --border', () => {
    // The proximity check above cannot see a shared helper: fieldStyle() lives
    // 160 lines away from the <input> that calls it, which is how three position
    // fields slipped through the first version of this test.
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      for (const [name, body] of helpersIn(file)) {
        if (!CONTROL_HELPER.test(name)) continue
        if (body.includes('var(--border)')) {
          offenders.push(`${relative(ROOT, file)}: ${name}()`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('no control removes its own focus ring', () => {
  it('finds no outline:none anywhere in a component that renders controls', () => {
    // Strict, with no proximity window. focus.css covers every control app-wide,
    // so there is never a reason to remove an outline locally, and an inline
    // outline:none beats the stylesheet rule that would otherwise save it.
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8')
      if (!/<button|<input|<select|<textarea/i.test(src)) continue
      src.split('\n').forEach((line, i) => {
        if (/outline:\s*["']?none/i.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('ships a focus rule that covers every control', () => {
    const focus = readFileSync(resolve(ROOT, 'styles/focus.css'), 'utf8')
    expect(focus).toMatch(/:focus-visible\s*\{/)
    expect(focus).toMatch(/outline:\s*2px solid var\(--ring\)/)
    expect(focus).toMatch(/outline-offset:\s*2px/)
  })
})

describe('the focus ring is visible where it lands', () => {
  it('is not drawn inside the primary button, where it would be invisible', () => {
    // --ring on --primary is 1.00:1. The offset is what puts the ring on the page
    // background instead, where --ring clears 4.5:1.
    expect(contrast('#0b7c5e', '#0b7c5e')).toBeCloseTo(1, 5)
    expect(contrast('#0b7c5e', '#f6f8fa')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#00d4aa', '#060a0f')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the auth form text pairings', () => {
  it('keeps error text readable on the surface it is painted on', () => {
    // --destructive on --loss-bg over --background measured 4.23:1 and failed.
    // The box now uses --card, which clears the bar in both themes.
    expect(contrast('#d52525', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ff4f5f', '#0b1118')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps muted helper text readable on the page background', () => {
    expect(contrast('#686e7c', '#f6f8fa')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#7892ad', '#060a0f')).toBeGreaterThanOrEqual(4.5)
  })
})