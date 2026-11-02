import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { GLASS_VIEWS, OPAQUE_ONLY_FILES, SURFACE_CLASS } from '@/app/surfaces'

/**
 * The glass blend, enforced rather than commented.
 *
 * contrast.test.ts compares a declared token hex against a declared surface hex.
 * That is the right check for opaque surfaces and blind to the one thing
 * translucent surfaces actually do: a card at alpha 0.60 paints a colour that is
 * neither its own token nor the ground beneath it. Both numbers are real and
 * neither is what the reader sees.
 *
 * That blindness cost real work here. A first pass at this skin shipped a comment
 * claiming the composited card could not reach AA without darker ink, and the
 * claim was produced by a Lab function that divided the sRGB channels by 255
 * twice — it reported a real ΔE of 4.7 as 0.03. Nothing in the suite could catch
 * that, so the arithmetic moved out of prose and into this file.
 *
 * Approximation, stated honestly: CSS interpolates a colour toward `transparent`
 * in premultiplied space; the ramp below is linear in alpha across the gradient's
 * own radius.
 *
 * That approximation was first described as "a fraction of a point of contrast"
 * and "does not decide any outcome". Measured against real screenshot pixels it
 * decided one: it modelled a card at 4.62 where Chrome painted 4.40, i.e. 0.15 to
 * 0.22 optimistic, and a 4.5 bar would have waved through a pairing that is below
 * AA on screen. The threshold below carries that error instead of arguing with it.
 */

const ROOT = resolve(__dirname, '../..')
const css = readFileSync(resolve(ROOT, 'styles/theme.css'), 'utf8')

/**
 * The bar every text assertion in this file uses: AA for normal text plus the
 * measured model-vs-render error of the blend maths above.
 */
const AA = 4.65

/**
 * The app's own light and dark blocks.
 *
 * The dark selector is anchored to the start of a line on purpose. `css.indexOf('.dark')`
 * finds `@custom-variant dark (&:is(.dark *))` on line 1 instead, and the block that
 * follows is the LIGHT `:root` — a mutation of the light card then "fails the dark
 * tests" while the real dark values are never read. Found exactly that way.
 */
function block(selector: string): string {
  const start = css.search(new RegExp(`^${selector}\\s*\\{`, 'm'))
  if (start === -1) throw new Error(`${selector} block not found in theme.css`)
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
  const hex = value.match(/^(#[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].slice(1)
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    }
  }
  throw new Error(`unsupported colour: ${value}`)
}

/** One `radial-gradient(rx ry at x% y%, rgba(...), transparent s%)`. */
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
 * The nine glass cards, measured in the running app at 1440x900: four KPI cards
 * across the top, the intraday chart and the sector list in the middle band, and
 * the three bottom cards. Centres are relative to the painted column box (1220 x
 * 900 — the window minus the 220px sidebar), which is what `background-attachment:
 * scroll` anchors the sweeps to.
 */
const CARD_CENTRES: [number, number][] = [
  [161.6, 251.5],
  [456.9, 251.5],
  [752.1, 251.5],
  [1047.4, 251.5],
  [604.5, 357.6],
  [604.5, 558.7],
  [210.8, 794.8],
  [604.5, 897.1],
  [998.2, 952.3],
]
const COLUMN = { w: 1220, h: 900 }

/**
 * A coarse sweep of the whole column, at desktop and phone width. The nine
 * centres are what a reader sees today; this is the guard against a future card
 * layout sitting on a worse patch of ground than any of them.
 */
const COLUMN_PROBES: { w: number; h: number }[] = [
  { w: 1220, h: 900 },
  { w: 390, h: 844 },
]

function sweepAlpha(s: Sweep, x: number, y: number, w: number, h: number): number {
  const d = Math.hypot((x - (s.cx / 100) * w) / s.rx, (y - (s.cy / 100) * h) / s.ry)
  return Math.max(0, (s.stop - d) / s.stop)
}

function over(top: RGBA, bottom: RGBA): RGBA {
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

function lab(c: RGBA): [number, number, number] {
  const r = channel(c.r)
  const g = channel(c.g)
  const b = channel(c.b)
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

function deltaE(a: RGBA, b: RGBA): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** The inks a glass card actually paints, read from the theme, not hardcoded. */
const CARD_INKS = ['foreground', 'muted-foreground', 'gain', 'loss', 'warning', 'link'] as const

function cardAt(source: string, x: number, y: number, w: number, h: number): RGBA {
  return over(parseColor(token(source, 'glass-surface')), groundAt(source, x, y, w, h))
}

/** The painted page, before any card sits on it — what the sticky bar sees between cards. */
function groundAt(source: string, x: number, y: number, w: number, h: number): RGBA {
  let ground = parseColor(token(source, 'background'))
  for (const s of parseSweeps(token(source, 'glass-page'))) {
    const t = sweepAlpha(s, x, y, w, h)
    if (t <= 0) continue
    ground = over({ ...s.color, a: s.color.a * t }, ground)
  }
  return ground
}

function cardColours(source: string): RGBA[] {
  return CARD_CENTRES.map(([x, y]) => cardAt(source, x, y, COLUMN.w, COLUMN.h))
}

function probeColours(source: string): RGBA[] {
  const out: RGBA[] = []
  for (const { w, h } of COLUMN_PROBES) {
    for (let iy = 0; iy < 7; iy++) {
      for (let ix = 0; ix < 7; ix++) {
        out.push(cardAt(source, ((ix + 0.5) / 7) * w, ((iy + 0.5) / 7) * h, w, h))
      }
    }
  }
  return out
}

function groundProbes(source: string): RGBA[] {
  const out: RGBA[] = []
  for (const { w, h } of COLUMN_PROBES) {
    for (let iy = 0; iy < 7; iy++) {
      for (let ix = 0; ix < 7; ix++) {
        out.push(groundAt(source, ((ix + 0.5) / 7) * w, ((iy + 0.5) / 7) * h, w, h))
      }
    }
  }
  return out
}

describe('the checker itself', () => {
  it('proves its own colour maths against known answers', () => {
    // Every number in this file descends from these two functions. A doubled
    // /255 in either one is what produced the wrong claim this test replaces,
    // so the maths is checked before its output is trusted.
    const white = parseColor('#ffffff')
    const black = parseColor('#000000')
    expect(lab(white)[0]).toBeCloseTo(100, 2)
    expect(lab(black)[0]).toBe(0)
    expect(deltaE(white, black)).toBeCloseTo(100, 1)
    expect(contrast(white, black)).toBeCloseTo(21, 1)
    // The published WCAG figure for #767676 on white is 4.54.
    expect(contrast(parseColor('#767676'), white)).toBeCloseTo(4.54, 2)
  })

  it('reads the glass tokens it is supposed to read', () => {
    // The two blocks must actually differ, or every "dark" assertion below has
    // been reading light values in disguise.
    expect(token(DARK, 'background')).not.toBe(token(LIGHT, 'background'))
    expect(token(DARK, 'glass-surface')).not.toBe(token(LIGHT, 'glass-surface'))
    for (const source of [LIGHT, DARK]) {
      expect(token(source, 'glass-surface')).toMatch(/rgba?\(/)
      expect(parseSweeps(token(source, 'glass-page'))).toHaveLength(2)
    }
    // Radius is not a per-theme value, so it is declared once and read once.
    expect(token(LIGHT, 'glass-radius')).toBe('16px')
    // Nine cards, as measured — not a sample of one.
    expect(CARD_CENTRES).toHaveLength(9)
    expect(cardColours(LIGHT)).toHaveLength(9)
  })

  it('does not disturb the tokens contrast.test.ts counts', () => {
    // That file asserts exactly two declarations of each across the stylesheet.
    // Glass tokens must not be named anything it is already holding to a count.
    expect((css.match(/^\s*--control-border:/gm) ?? []).length).toBe(2)
    expect((css.match(/^\s*--link:/gm) ?? []).length).toBe(2)
  })

  it('rejects a skin it is shown to be broken', () => {
    // A guard that passes for every input is worse than no guard. Its own block,
    // so retuning the real tokens can never quietly disable this check.
    const broken = `
      --background: #f5f7fa;
      --glass-surface: rgba(255, 255, 255, 0.02);
      --muted-foreground: #5e6c7e;
      --glass-page: radial-gradient(1200px 900px at 50% 50%, rgba(20, 36, 58, 0.95), transparent 100%);
    `
    const muted = parseColor(token(broken, 'muted-foreground'))
    const worst = Math.min(...probeColours(broken).map((c) => contrast(muted, c)))
    expect(worst).toBeLessThan(4.5)
  })
})

describe('the glass surface contract', () => {
  /**
   * Where each screen's card surfaces live. A view is only allowed into
   * GLASS_VIEWS when its own source paints the shared surface class, so this
   * map is what makes the list and the code move together instead of drifting.
   */
  const VIEW_SOURCE: Record<string, string> = {
    dashboard: 'app/features/dashboard/DashboardView.tsx',
    markets: 'app/features/market/MarketsView.tsx',
    portfolio: 'app/features/portfolio/PortfolioView.tsx',
    advisor: 'app/features/advisor/AIAdvisorView.tsx',
    risk: 'app/features/risk/RiskView.tsx',
    news: 'app/features/news/NewsView.tsx',
    reports: 'app/features/reports/ReportsView.tsx',
    alerts: 'app/features/reports/AlertsView.tsx',
    settings: 'app/features/settings/tabPrimitives.tsx',
  }

  it('only claims views that actually paint the surface', () => {
    const lying: string[] = []
    for (const view of GLASS_VIEWS) {
      const file = VIEW_SOURCE[view]
      if (!file) {
        lying.push(`${view} (no known source file — add it to VIEW_SOURCE)`)
        continue
      }
      const src = readFileSync(resolve(ROOT, file), 'utf8')
      if (!src.includes(SURFACE_CLASS) && !src.includes('glass-card')) {
        lying.push(`${view} still uses opaque cards in ${file}`)
      }
    }
    expect(lying).toEqual([])
  })

  it('leaves no glassy view unlisted', () => {
    // The other direction, and the one the spec's mutation actually tests: drop
    // 'news' from GLASS_VIEWS while NewsView still paints surfaces and the screen
    // keeps its translucent cards — over an opaque ground, so they read as grey
    // sheets with nothing behind them. A list that is only checked one way can
    // drift half-in, and the app would still look intentional while the guard
    // stayed green.
    const unlisted: string[] = []
    for (const [view, file] of Object.entries(VIEW_SOURCE)) {
      const src = readFileSync(resolve(ROOT, file), 'utf8')
      const paints = src.includes(SURFACE_CLASS) || src.includes('glass-card')
      if (paints && !GLASS_VIEWS.includes(view as (typeof GLASS_VIEWS)[number])) {
        unlisted.push(`${view} paints ${SURFACE_CLASS} but is not in GLASS_VIEWS`)
      }
    }
    expect(unlisted).toEqual([])
  })

  it('keeps dialogs, drawers, skeletons and the error state opaque', () => {
    // These sit over a scrim, or carry text a reader must parse instantly.
    // Asserted rather than trusted, because the cheapest way to "extend the
    // glass" is a global --card change that sweeps them along.
    const offenders: string[] = []
    for (const file of OPAQUE_ONLY_FILES) {
      // Paths in surfaces.ts are relative to src/app; VIEW_SOURCE above is
      // relative to src. Kept explicit here rather than silently normalised.
      const src = readFileSync(resolve(ROOT, 'app', file), 'utf8')
      if (src.includes(SURFACE_CLASS) || src.includes('glass-card')) {
        offenders.push(`${file} paints a translucent surface`)
      }
      if (!src.includes('var(--card)')) {
        offenders.push(`${file} no longer uses the opaque card token`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never puts the surface class on a dialog, drawer or scrim layer', () => {
    /* OPAQUE_ONLY_FILES covers the known files by name. It cannot cover a surface
       class landing on the dialog *inside* an otherwise-glassy file — the
       rebalance dialog lives in AllocationPanel, which legitimately converted.

       Window-based rather than a JSX parser, and stated as such: it reads the
       props around each surface-class use, which is where a dialog's role=,
       aria-modal= or a drawer's position: 'fixed' would have to sit. That is a
       heuristic; what it is not is a grep someone has to remember to run. */
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.tsx')) files.push(full)
      }
    }
    walk(resolve(ROOT, 'app'))
    const markers = ['role="dialog"', 'aria-modal', "position: 'fixed'"]
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      let at = src.indexOf(SURFACE_CLASS)
      while (at !== -1) {
        const around = src.slice(Math.max(0, at - 500), at + 500)
        const hit = markers.find((m) => around.includes(m))
        if (hit) offenders.push(`${file.replace(ROOT, 'src')} paints the surface near ${hit}`)
        at = src.indexOf(SURFACE_CLASS, at + 1)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the search dropdown on the opaque card token', () => {
    // It is a control, it floats over whatever is beneath it, and its option text
    // is 11-12px: the one place the app deliberately refuses glass on a screen
    // that is otherwise glassy. Asserted because it was a decision, not an
    // oversight — and decisions that are not written down get "cleaned up".
    const header = readFileSync(resolve(ROOT, 'app/components/Header.tsx'), 'utf8')
    expect(header).toContain("background: 'var(--card)'")
    expect(header).not.toContain(SURFACE_CLASS)
    expect(header).not.toContain('glass-card')
  })

  it('declares the surface hairline once per theme', () => {
    // --border was tuned against an opaque white card (~12 ΔE from it). On a
    // translucent surface the composite sits close to it and measured row
    // dividers in Pasar fell to 0.94 ΔE, i.e. invisible. --surface-hairline is a
    // translucent dark instead, so it composites against whatever it is drawn
    // on. --border itself stays untouched: it is the edge of every control.
    for (const src of [LIGHT, DARK]) {
      expect((src.match(/--surface-hairline:/g) ?? []).length).toBe(1)
    }
  })

  it('keeps blur on the shell-scrolled screen only', () => {
    // .surface-glass must be tint-only: outside the dashboard nothing slides
    // under a card, so every extra backdrop-filter layer is GPU cost with no
    // visible difference. Read the rule itself, not a comment claiming it.
    const rule = css.match(/\.surface-glass,\s*\.glass-card\s*\{[^}]*\}/)
    expect(rule).not.toBeNull()
    expect(rule![0]).not.toMatch(/backdrop-filter/)
    expect(rule![0]).toMatch(/var\(--glass-surface\)/)
    // And the alpha lives in one rule, so a retune cannot miss a class.
    const blurRule = css.match(/\.glass-card\s*\{[^}]*backdrop-filter[^}]*\}/)
    expect(blurRule).not.toBeNull()
    expect(blurRule![0]).not.toMatch(/--glass-surface:/)
  })
})

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('the %s glass blend', (_theme, source) => {
  const cards = cardColours(source)
  const probes = probeColours(source)

  it('keeps every ink the cards use at AA on the worst card', () => {
    const failures: string[] = []
    for (const name of CARD_INKS) {
      const ink = parseColor(token(source, name))
      const worst = Math.min(...cards.map((c) => contrast(ink, c)))
      if (worst < AA) failures.push(`--${name} at ${worst.toFixed(2)}:1`)
    }
    expect(failures).toEqual([])
  })

  it('holds every ink the dense tables paint on a surface at AA, at their real sizes', () => {
    /* The plan asked for an explicit assertion on small text inside table rows.
       Hand-picking one pair would repeat the mistake that hid --loss: the guard
       only ever tested the colours someone thought to list. So this reads which
       colours the table sources actually paint with, and which sizes, and holds
       every colour that sits directly on the surface to normal-text AA — the
       strictest bar any of those sizes gets to claim.

       Colours written next to a `background` are chip and button ink, tested
       against their own fill elsewhere, not against the card. */
    const TABLE_SOURCES = [
      'app/features/market/MarketsView.tsx',
      'app/features/reports/AlertsView.tsx',
      'app/features/reports/ReportsView.tsx',
      'app/features/risk/RiskView.tsx',
      'app/features/portfolio/PortfolioView.tsx',
      'app/features/news/NewsView.tsx',
      'app/features/settings/tabPrimitives.tsx',
      'app/features/advisor/signalCard.tsx',
    ]
    const onSurface = new Map<string, RGBA>()
    const seenMixes: string[] = []
    const sizes: number[] = []
    /** The object literal a match sits in, by brace depth — a character window
     *  was wrong: a comment between `background:` and `color:` pushed an accent
     *  button's ink out of the window and made it look like surface text. */
    const enclosingBlock = (src: string, index: number): string => {
      let depth = 0
      let start = index
      for (; start >= 0; start--) {
        const c = src[start]
        if (c === '}') depth++
        else if (c === '{') {
          if (depth === 0) break
          depth--
        }
      }
      let d2 = 0
      let end = index
      for (; end < src.length; end++) {
        const c = src[end]
        if (c === '{') d2++
        else if (c === '}') {
          d2--
          if (d2 === 0) break
        }
      }
      return src.slice(start, end)
    }
    for (const file of TABLE_SOURCES) {
      const src = readFileSync(resolve(ROOT, file), 'utf8')
      /** An ink with a fill of its own is measured against that fill elsewhere, so
       *  only the ones sitting straight on the surface belong to this rule. `bg:`
       *  counts as a fill; `bg: 'transparent'` does not. */
      const hasOwnFill = (block: string) => {
        const m = block.match(/(?:background|bg)(?:Color)?:\s*'([^']+)'/)
        return !!m && m[1] !== 'transparent'
      }
      for (const m of src.matchAll(/color: 'var\(--([a-z0-9-]+)\)'/g)) {
        const block = enclosingBlock(src, m.index ?? 0)
        if (!hasOwnFill(block)) onSurface.set(`--${m[1]}`, parseColor(token(source, m[1])))
      }
      /* colour-mix() inks, resolved the way the browser resolves them. Without
       * this the guard is blind to the market table's tier ramp, which turned out
       * to hold the worst real text on a glass surface. The closing `))'` is part
       * of the pattern: a regex that silently matches nothing reports a clean
       * pass forever, which is how the first version of this rule shipped. */
      const MIX =
        /color: 'color-mix\(in srgb, var\(--([a-z0-9-]+)\) (\d+)%, var\(--([a-z0-9-]+)\)\)'/g
      for (const m of src.matchAll(MIX)) {
        const a = parseColor(token(source, m[1]))
        const b = parseColor(token(source, m[3]))
        const p = Number(m[2]) / 100
        const name = `--${m[1]} ${m[2]}% over --${m[3]}`
        // Recorded before the fill check so the "did this scan run" assertion
        // counts every expression found, not only the ones policed here.
        seenMixes.push(name)
        if (hasOwnFill(enclosingBlock(src, m.index ?? 0))) continue
        /* Pre-existing debt, named so it cannot quietly grow or drift: the tier
           ramp was built against an opaque white card, where its quietest step
           already measured 1,75:1. Glass did not create it and cannot fix it;
           clearing AA here means redesigning a three-step semantic ramp, which is
           the owner's decision, not a side effect of a restyle. Adding a colour to
           this list is a decision, and the test below proves the two entries are
           still the exact expressions in the source. */
        const KNOWN_DEBT = [
          '--accent-foreground 35% over --card',
          '--accent-foreground 65% over --card',
        ]
        if (KNOWN_DEBT.includes(name)) continue
        onSurface.set(name, {
          r: Math.round(a.r * p + b.r * (1 - p)),
          g: Math.round(a.g * p + b.g * (1 - p)),
          b: Math.round(a.b * p + b.b * (1 - p)),
          a: 1,
        })
      }
      for (const m of src.matchAll(/fontSize: (\d+)/g)) sizes.push(Number(m[1]))
    }
    // 11px is the app's stated floor; a smaller size in a table would fail here
    // rather than silently inherit a contrast budget written for larger text.
    expect(sizes.filter((s) => s < 11)).toEqual([])
    const failures: string[] = []
    for (const [name, ink] of onSurface) {
      const worst = Math.min(...cards.map((c) => contrast(ink, c)))
      if (worst < AA) failures.push(`${name} at ${worst.toFixed(2)}:1`)
    }
    // The scan has to prove it saw what it is written to police.
    expect(seenMixes).toEqual(
      expect.arrayContaining([
        '--accent-foreground 35% over --card',
        '--accent-foreground 65% over --card',
      ]),
    )
    // A guard that quietly stops testing anything is not a guard. The named ink is
    // the row-label colour the whole question is about: if the scan ever stops
    // finding it, the scan has broken, not the palette.
    expect([...onSurface.keys()]).toContain('--muted-foreground')
    expect(onSurface.size).toBeGreaterThanOrEqual(3)
    expect(failures).toEqual([])
  })

  it('holds across the whole column, not only where cards sit today', () => {
    const failures: string[] = []
    for (const name of CARD_INKS) {
      const ink = parseColor(token(source, name))
      const worst = Math.min(...probes.map((c) => contrast(ink, c)))
      if (worst < AA) failures.push(`--${name} at ${worst.toFixed(2)}:1`)
    }
    expect(failures).toEqual([])
  })

  it('is visibly glass: the cards differ by position', () => {
    const spread = Math.max(...cards.flatMap((a, i) => cards.slice(i + 1).map((b) => deltaE(a, b))))
    // ~2.3 ΔE76 is the usual just-noticeable difference between adjacent flat
    // colours. Below this the "glass" is a story a stylesheet tells about itself.
    expect(spread).toBeGreaterThanOrEqual(2.5)
  })

  it('keeps the sticky bar legible over both things that pass behind it', () => {
    // The bar is glass over a moving page: its own text sits on the bare ground
    // half the time and on a card the rest of the time. Both are checked, and
    // neither was checked at all before — the bar's alpha was changed by eye.
    const raised = parseColor(token(source, 'glass-surface-raised'))
    // Everything the bar can actually sit over: bare ground, the most saturated
    // patch of it, and a card sliding underneath.
    const backdrops = [...groundProbes(source), ...cardColours(source)]
    const failures: string[] = []
    for (const name of CARD_INKS) {
      const ink = parseColor(token(source, name))
      const worst = Math.min(...backdrops.map((b) => contrast(ink, over(raised, b))))
      if (worst < AA) failures.push(`--${name} at ${worst.toFixed(2)}:1`)
    }
    expect(failures).toEqual([])
  })

  it('keeps the sheet visibly separate from the ground it sits on', () => {
    // This test used to compare the card with --background — the colour
    // *underneath* the gradient. That is not what a reader compares: on a glass
    // screen the card sits on tinted ground, so the separation that matters is
    // card against its own local ground. The old pair was also blind to the
    // failure it claimed to guard: a fully opaque white card is ~3 ΔE from
    // #f5f7fa, so it would have passed here while showing no glass at all.
    const grounds = CARD_CENTRES.map(([x, y]) => groundAt(source, x, y, COLUMN.w, COLUMN.h))
    const edges = cards.map((c, i) => deltaE(c, grounds[i]))
    expect(Math.min(...edges)).toBeGreaterThanOrEqual(4)
  })

  it('keeps a hairline that survives the surface it is drawn on', () => {
    const hair = parseColor(token(source, 'surface-hairline'))
    const gaps = cards.map((c) => deltaE(over(hair, c), c))
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(8)
  })

  it('proves the ground actually shows through the card', () => {
    // The other half of "is this glass": a card that resolves to pure white is a
    // solid card no matter how pretty the page behind it is. Aimed at the right
    // pair, this catches the opaque-card case the old assertion could not.
    const white = { r: 255, g: 255, b: 255, a: 1 }
    const through = cards.map((c) => deltaE(c, white))
    expect(Math.min(...through)).toBeGreaterThanOrEqual(2.5)
  })
})
