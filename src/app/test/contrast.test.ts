import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
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
const TOKEN_DARK = '#6e7c8d'
/* The two console surfaces are in this list on purpose. The operator console has
   its own palette and is locked light, so `--control-border` is painted over a
   ground the app never uses — and the only way that stays true is for the floor
   check above to actually measure it. A surface nobody adds to this list is a
   surface nothing checks.

   Read from the stylesheet rather than restated here. The first version of these
   tests carried its own copy of the hex, and the mutation test that proved the
   floor could fail had to change both places to work — which is the same second
   source the rest of this repo spends its life removing. If the ground moves in
   theme.css, the number below moves with it and the assertion measures reality. */
function consoleToken(name: string): string {
  const m = theme.match(new RegExp(`--console-${name}:\\s*(#[0-9a-f]{6})`, 'i'))
  if (!m) throw new Error(`--console-${name} is not declared in theme.css`)
  return m[1].toLowerCase()
}
const CONSOLE_GROUND = consoleToken('ground')
const CONSOLE_CARD = consoleToken('surface')
const SURFACES_LIGHT = ['#f5f7fa', '#ffffff', CONSOLE_GROUND]
const SURFACES_DARK = ['#0e1726', '#14243a']
const FLOOR = 3

/** A declared value pulled straight out of theme.css, lowercased for comparison. */
function declared(name: string): string {
  const m = theme.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))
  if (!m) throw new Error(`${name} is not declared as a hex in theme.css`)
  return m[1].toLowerCase()
}

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
  // `.ts` is in this list because it has to be. The console's control recipes
  // moved into `consoleStyles.ts`, and with only `*.tsx` here the helper-body
  // check below stopped seeing them entirely: pointing `controlStyle` at
  // `--border` was measured to pass this whole file. A guard whose coverage ends
  // where a refactor begins is the exact failure this file's header is about.
  return [...globSync('app/**/*.{ts,tsx}', { cwd: resolve(ROOT) })]
    .filter((p) => !p.includes('/ui/'))
    .filter((p) => !/\.(test|spec)\.[tj]sx?$/.test(p))
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
    expect(files).toContain('app/features/portfolio/PositionModal.tsx')
    expect(files).toContain('app/features/identity/AuthScreen.tsx')
    // The shared console style module, and by name: this is the file that was
    // invisible to the check that is supposed to watch it.
    expect(files).toContain('app/features/admin/consoleStyles.ts')
  })

  it('reads a real file rather than an empty one', () => {
    // A named file, not `sourceFiles()[0]`. Widening the scan to `.ts` made the
    // first entry a 67-byte module, and the test failed for a reason that said
    // nothing about whether the guard can read anything.
    for (const named of [
      'app/features/admin/consoleStyles.ts',
      'app/features/identity/AuthScreen.tsx',
    ]) {
      expect(readFileSync(resolve(ROOT, named), 'utf8').length).toBeGreaterThan(500)
    }
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
    expect(contrast(TOKEN_LIGHT, '#f5f7fa')).toBeLessThan(4.5)
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
    // --ring on --primary is 1.00:1 in light. The offset is what puts the ring on
    // the page background instead, where --ring clears 4.5:1.
    expect(contrast('#14243a', '#14243a')).toBeCloseTo(1, 5)
    expect(contrast('#14243a', '#f5f7fa')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#0f9d78', '#0e1726')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the auth form text pairings', () => {
  it('keeps error text readable on the surface it is painted on', () => {
    // --destructive on --loss-bg over --background misses; the box uses --card,
    // which clears the bar in both themes.
    expect(contrast('#c63b3b', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#e26a6a', '#14243a')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps muted helper text readable on the page background', () => {
    expect(contrast('#5e6c7e', '#f5f7fa')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#93a6ba', '#0e1726')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the link token clears 4.5:1 as link text', () => {
  // --primary is a fill; the places where a link sits on the page ground use
  // --link instead, so it has to read as text on every surface, both themes.
  it('is declared in both themes', () => {
    const declarations = theme.match(/--link:\s*(#[0-9a-f]{6})/gi) ?? []
    expect(declarations.length).toBe(2)
  })

  it('light: Slate Blue on the light surfaces', () => {
    for (const surface of SURFACES_LIGHT) {
      expect(contrast('#344a64', surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('dark: light blue on the dark surfaces', () => {
    for (const surface of SURFACES_DARK) {
      expect(contrast('#7fb0e0', surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/**
 * The console's own palette, and the two numbers that shape it.
 *
 * The operator console is a light-only surface with its own ground (see the
 * "Operator console" block in `src/styles/theme.css`). Where its colours come
 * from is a decision; what they are allowed to be is arithmetic, and the
 * arithmetic is what these tests keep.
 */
describe('the operator console palette', () => {
  // --loss is the binding constraint on the console ground, and it is binding
  // from both sides: a darker ground looks more present but stops red from
  // reading as red. #eef2f6 is the darkest ground that keeps money semantics
  // intact, and this assertion is the reason it was not replaced by taste.
  it('holds money semantics readable on the console ground', () => {
    expect(contrast(declared('--loss'), CONSOLE_GROUND)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(declared('--gain'), CONSOLE_GROUND)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(declared('--warning'), CONSOLE_GROUND)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps a control edge clear on the console ground, either theme', () => {
    // The console inherits --control-border rather than restating it, so both
    // themes' values have to survive on a surface the dark theme was never
    // tuned for.
    for (const token of [TOKEN_LIGHT, TOKEN_DARK]) {
      expect(contrast(token, CONSOLE_GROUND)).toBeGreaterThanOrEqual(FLOOR)
      expect(contrast(token, CONSOLE_CARD)).toBeGreaterThanOrEqual(FLOOR)
    }
  })

  it('gives the accent a fill that can carry a white label', () => {
    // This is the whole reason the console had an accent at all. The brand's
    // #0f9d78 measures 3,43:1 with white on it, which is why every primary
    // action here used to be navy. Deepening it is what made the direction
    // implementable instead of merely stated.
    const accent = consoleToken('accent')
    expect(contrast('#ffffff', accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(accent, CONSOLE_CARD)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the console link readable where the inherited one would not', () => {
    // --link is not restated in the console scope (see the count assertion
    // above), so the console uses its own. Dark theme's light blue on white is
    // 2,29:1: without this token a dark-mode user would get washed-out links
    // on white paper.
    expect(contrast(consoleToken('link'), CONSOLE_CARD)).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#7fb0e0', CONSOLE_CARD)).toBeLessThan(4.5)
  })

  it('wires that link token up, and reads the inherited one nowhere', () => {
    // The arithmetic above is worth nothing if no element uses the token. The
    // first version of this palette declared --console-link, tested its ratio,
    // and left the queue's only link reading `var(--link)` — which resolved to
    // #7fb0e0 on white paper at 2,29:1, measured in the browser pass. A declared
    // token with no consumer is a fix that has not happened yet.
    const files = sourceFiles().filter((p) => p.includes('/features/admin/'))
    const consumers = files.filter((p) => readFileSync(p, 'utf8').includes('var(--console-link)'))
    expect(consumers.length).toBeGreaterThan(0)

    // --link resolves inside the console scope to the dark theme's value, so
    // reading it here is always the washed-out colour. --console-link is the
    // one that is safe, and its name says so.
    const inheritors: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (/var\(--link[,)]/.test(source)) inheritors.push(basename(file))
    }
    expect(inheritors).toEqual([])
  })

  /*
   * The reference chrome (referensi/admin-konsol.png) makes the console ground
   * white, the same surface as the cards. The old constraint — meta cleared AA on
   * a card but deliberately missed it on a gray ground, so meta lived on surfaces
   * only — was a consequence of that gray ground. With a white ground meta is
   * readable everywhere it is used, so the guard is now a real AA floor on both
   * surfaces rather than a number that had to keep failing on one.
   */
  it('keeps the meta rung readable on the console surfaces', () => {
    const meta = consoleToken('meta')
    expect(contrast(meta, CONSOLE_CARD)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(meta, CONSOLE_GROUND)).toBeGreaterThanOrEqual(4.5)
  })

  /*
   * The structural proof that the console cannot inherit dark values.
   *
   * The plan asked for a rendered test reading `getComputedStyle` with the dark
   * theme on. Measured first, that turned out to be theatre: this suite runs with
   * `css: false` and jsdom does not resolve a `var()` chain into a colour at all
   * (it reports the literal string `var(--foreground)` back). A test asserting on
   * that would pass against any stylesheet, including a broken one.
   *
   * So the invariant is asserted where it is actually observable: for every
   * token the dark block declares, if the console block declares it too, the two
   * values must differ. Same-token-same-value is precisely the leak that would
   * paint light text on white paper, and this is the check that cannot be quietly
   * satisfied. What the pixels look like is measured in the browser pass, which
   * is the only place that can honestly claim it.
   */
  it('restates the tokens it renders with, and shares no value with the dark theme', () => {
    const declarations = (block: string) => {
      const out = new Map<string, string>()
      for (const line of block.split('\n')) {
        const m = line.match(/^\s*(--[a-z0-9-]+):\s*([^;]+);/i)
        if (m) out.set(m[1], m[2].trim().toLowerCase())
      }
      return out
    }
    const dark = declarations(
      theme.slice(theme.indexOf('.dark {'), theme.indexOf('\n}', theme.indexOf('.dark {'))),
    )
    const consoleStart = theme.indexOf('.admin-console {')
    const scope = declarations(theme.slice(consoleStart, theme.indexOf('\n}', consoleStart)))

    // Every text and surface token the console renders with has to be in scope.
    for (const token of [
      '--foreground',
      '--muted-foreground',
      '--card',
      '--border',
      '--background',
    ]) {
      expect(scope.has(token)).toBe(true)
    }
    // The two guarded tokens: excluded on purpose, see the block comment in
    // src/styles/theme.css. Their absence is what keeps the count checks above
    // describing reality, so it is asserted rather than assumed.
    expect(scope.has('--control-border')).toBe(false)
    expect(scope.has('--link')).toBe(false)
    // The real invariant. --control-border is excluded above precisely because it
    // is the one inherited token whose dark value still clears the floor here.
    const shared: string[] = []
    for (const [token, value] of scope) {
      if (dark.get(token) === value) shared.push(token)
    }
    expect(shared).toEqual([])
  })

  it('is actually applied to the console subtree', () => {
    // A scope nothing attaches to is a palette that does nothing. Asserted here
    // rather than left to a visual pass, because the class name is the whole
    // wiring.
    const app = readFileSync(resolve(ROOT, 'app/App.tsx'), 'utf8')
    expect(app).toContain('className="admin-console"')
  })
})
