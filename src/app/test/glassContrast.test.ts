import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The glass blend, enforced rather than commented.
 *
 * contrast.test.ts compares a declared token hex against a declared surface hex.
 * That is the right check for opaque surfaces, and it is blind to the one thing
 * translucent surfaces actually do: a card at alpha 0.5 paints a colour that is
 * neither its own token nor the ground beneath it. Both numbers are real and
 * neither is what the reader sees.
 *
 * That blindness cost real money here — a first pass at this skin shipped a
 * comment claiming a contrast ratio that the composited surface did not have,
 * and no test could have caught it. So this file composites the glass the way
 * the browser would and holds the result to WCAG AA.
 *
 * Approximation, stated honestly: CSS interpolates a colour toward `transparent`
 * in premultiplied space, and the ramp here is linear in alpha. On the low-alpha
 * pastel gradients this skin uses the difference is well under a point of
 * contrast; the margins asserted below are not razor-thin, so the approximation
 * does not decide any outcome.
 */

const ROOT = resolve(__dirname, '../..')
const css = readFileSync(resolve(ROOT, 'styles/theme.css'), 'utf8')

/** The app's own light and dark blocks — the first `:root` and the `.dark`. */
function block(selector: string, from = 0): string {
  const start = css.indexOf(selector, from)
  if (start === -1) throw new Error(`${selector} not found in theme.css`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`unterminated ${selector} block`)
}

const LIGHT = block(':root')
const DARK = block('.dark')

function token(source: string, name: string): string {
  const m = source.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`--${name} is not declared`)
  return m[1].replace(/\s+/g, ' ').trim()
}

type RGBA = { r: number; g: number; b: number; a: number }

function parseColor(value: string): RGBA {
  const rgba = value.match(/rgba?\(([^)]+)\)/)
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((s) => s.trim())
    return { r: +r, g: +g, b: +b, a: +a }
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1]
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    }
  }
  throw new Error(`unsupported colour: ${value}`)
}

/** One `radial-gradient(rx ry at x% y%, rgba(...) , transparent s%)`. */
type Sweep = { rx: number; ry: number; cx: number; cy: number; color: RGBA; stop: number }

function parseSweeps(source: string): Sweep[] {
  const re =
    /radial-gradient\(\s*([\d.]+)px\s+([\d.]+)px\s+at\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*,\s*(rgba?\([^)]+\))\s*,\s*transparent\s+([\d.]+)%\s*\)/g
  return [...source.matchAll(re)].map((m) => ({
    rx: +m[1],
    ry: +m[2],
    cx: +m[3],
    cy: +m[4],
    color: parseColor(m[5]),
    stop: +m[6] / 100,
  }))
}

/**
 * Two real column boxes, not a guess at one: the 1440 desktop content column
 * (window minus the 220px sidebar) and the 390 phone column. A skin that only
 * holds AA at one width is not holding AA.
 */
const CANVASES = [
  { name: 'desktop 1440 column', w: 1220, h: 900 },
  { name: 'phone 390 column', w: 390, h: 844 },
]

/** Where a sweep still contributes, as a fraction of its own centre alpha. */
function sweepAt(s: Sweep, x: number, y: number, w: number, h: number): number {
  const d = Math.hypot((x - (s.cx / 100) * w) / s.rx, (y - (s.cy / 100) * h) / s.ry)
  return Math.max(0, (s.stop - d) / s.stop)
}

function over(top: RGBA, bottom: RGBA) {
  const a = top.a
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  }
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(c: RGBA): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** CIE76 ΔE, for the one question alpha ratios cannot answer: is it visible? */
function lab(c: RGBA): [number, number, number] {
  const r = channel(c.r)
  const g = channel(c.g)
  const b = channel(c.b)
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const fx = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
  const fy = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
  const fz = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function deltaE(a: RGBA, b: RGBA): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** A 7x7 grid across the column: the worst card is somewhere in here. */
function cardColours(source: string): { cards: RGBA[]; canvas: string } {
  const surface = parseColor(token(source, 'glass-surface'))
  const base = parseColor(token(source, 'background'))
  const sweeps = parseSweeps(token(source, 'glass-page'))
  const canvas = CANVASES[0]
  const cards: RGBA[] = []
  for (const { w, h } of CANVASES) {
    for (let iy = 0; iy < 7; iy++) {
      for (let ix = 0; ix < 7; ix++) {
        const x = ((ix + 0.5) / 7) * w
        const y = ((iy + 0.5) / 7) * h
        let ground = base
        for (const s of sweeps) {
          const t = sweepAt(s, x, y, w, h)
          if (t <= 0) continue
          ground = over({ ...s.color, a: s.color.a * t }, ground)
        }
        cards.push(over(surface, ground))
      }
    }
  }
  return { cards, canvas: canvas.name }
}

// The inks this skin actually paints inside a glass card. The two `glass`
// variants exist because a translucent surface needs darker ink than the same
// surface painted opaque; the app tokens are checked too, wherever they appear.
const INKS = {
  light: {
    foreground: 'foreground',
    'glass-ink-muted': 'glass-ink-muted',
    'glass-loss': 'glass-loss',
    gain: 'gain',
    warning: 'warning',
    link: 'link',
  },
  dark: {
    foreground: 'foreground',
    'glass-ink-muted': 'glass-ink-muted',
    'glass-loss': 'glass-loss',
    gain: 'gain',
    warning: 'warning',
    link: 'link',
  },
} as const

describe('the checker itself', () => {
  it('finds the glass tokens it is supposed to read', () => {
    for (const source of [LIGHT, DARK]) {
      expect(token(source, 'glass-surface')).toMatch(/rgba?\(/)
      expect(token(source, 'glass-radius')).toMatch(/px$/)
      expect(parseSweeps(token(source, 'glass-page')).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('composites a real spread of cards, not a sample of one', () => {
    const { cards } = cardColours(LIGHT)
    expect(cards.length).toBe(98) // 2 canvases x 7x7
    expect(cards.every((c) => c.a === 1)).toBe(true)
  })

  it('is not a test that cannot fail', () => {
    // A guard that passes for every input is worse than no guard. Feed the
    // machinery an obviously broken skin — an almost-clear card over a near-black
    // ground — and it must reject it. Written as its own block rather than a
    // patch of the real CSS, so retuning the real tokens can never quietly
    // disable this check.
    const broken = `
      --background: #f5f7fa;
      --glass-surface: rgba(255, 255, 255, 0.02);
      --glass-ink-muted: #4e5b6b;
      --glass-page: radial-gradient(1200px 900px at 50% 50%, rgba(20, 36, 58, 0.95), transparent 80%);
    `
    const { cards } = cardColours(broken)
    const muted = parseColor(token(broken, 'glass-ink-muted'))
    const worst = Math.min(...cards.map((c) => contrast(muted, c)))
    expect(worst).toBeLessThan(4.5)
  })
})

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('the %s glass blend', (_name, source) => {
  const { cards } = cardColours(source)

  it('keeps every ink at AA or better on the worst card in the column', () => {
    const failures: string[] = []
    for (const [label, tokenName] of Object.entries(INKS[_name as 'light' | 'dark'])) {
      const ink = parseColor(token(source, tokenName))
      const worst = Math.min(...cards.map((c) => contrast(ink, c)))
      if (worst < 4.5) failures.push(`${label} (--${tokenName}) at ${worst.toFixed(2)}:1`)
    }
    expect(failures).toEqual([])
  })

  it('is visibly glass: cards differ by position, not by luck', () => {
    const spread = Math.max(...cards.flatMap((a, i) => cards.slice(i + 1).map((b) => deltaE(a, b))))
    // ~2.3 ΔE76 is the usual just-noticeable difference for adjacent flat
    // colours. Below this the "glass" is a story told by a stylesheet.
    expect(spread).toBeGreaterThanOrEqual(2.3)
  })
})
