import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Data-honesty regression tests.
 *
 * Each of these locks in a defect that was shipped and is now fixed. They are
 * source-level rather than render-level on purpose: the defects were fabricated
 * *content*, so the assertion that matters is that the content is absent from
 * the source, not that one component happens not to display it today.
 *
 * Defects covered:
 *  - news headlines attributed to real publications, merged into the live feed
 *  - `isFresh` derived from array position instead of filing time
 *  - fabricated analyst-consensus counts in the seed
 *  - "LightGBM + SHAP" provenance the API contract cannot support
 *  - "Last Updated" stamped with the browser clock on static seed data
 *  - a sidebar operator with a fabricated name, title and initials avatar
 */

const SRC = join(process.cwd(), 'src/app')

/** Every .ts/.tsx source file under src/app, so a check cannot pass by
 *  inspecting one file. Test files are excluded: this one necessarily contains
 *  the very strings it asserts are absent, and `Sidebar.test.tsx` documents the
 *  fabricated name it guards against. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const ALL = sourceFiles()

/** Readable content of every source file, with comments stripped so a file may
 *  explain the defect it used to contain without tripping its own assertion. */
function codeOnly(): string {
  return ALL.map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n')
}

/** Readable content including comments, for files where the comment itself is
 *  the thing under test (the offline harness documentation). */
function raw(): string {
  return ALL.map((f) => readFileSync(f, 'utf8')).join('\n')
}

describe('fabricated news attributed to real publications', () => {
  const REAL_OUTLETS = [
    'Kontan',
    'Bisnis.com',
    'Reuters Indonesia',
    'CNBC Indonesia',
    'Bloomberg Indonesia',
    'Reuters',
  ]

  it.each(REAL_OUTLETS)('no source names %s as the origin of a headline', (outlet) => {
    // A literal `source: "<outlet>"` next to headline text is the defect. A
    // comment naming it as the reason for removal is not, hence codeOnly().
    expect(codeOnly()).not.toMatch(new RegExp(`source:\\s*["'\`]${outlet.replace('.', '\\.')}`))
  })

  it('has no bundled news array left to seed or append', () => {
    expect(codeOnly()).not.toMatch(/\bALL_NEWS\b/)
    expect(codeOnly()).not.toMatch(/\bEXTRA_HEADLINES\b/)
    expect(codeOnly()).not.toMatch(/\bSEED_NEWS\b/)
  })
})

describe('recency badge derived from filing time', () => {
  it('does not mark the first array element as fresh', () => {
    expect(codeOnly()).not.toMatch(/isFresh:\s*i\s*===\s*0/)
    expect(codeOnly()).not.toMatch(/isFresh:\s*index\s*===\s*0/)
  })

  it('compares minutes against the agreed 60 minute window', () => {
    const hook = readFileSync(join(SRC, 'hooks/useNews.ts'), 'utf8')
    expect(hook).toMatch(/FRESH_WINDOW_MIN\s*=\s*60/)
    expect(hook).toMatch(/isFresh:\s*minsAgo\s*<=\s*FRESH_WINDOW_MIN/)
  })
})

describe('fabricated analyst-consensus counts', () => {
  it('no Buy/Hold/Sell tallies anywhere in the source', () => {
    expect(codeOnly()).not.toMatch(/(Beli|Buy):\s*\d+\s*\|/)
    expect(codeOnly()).not.toMatch(/(Jual|Sell):\s*\d+\s*\|/)
  })
})

describe('model provenance the contract cannot support', () => {
  it('does not claim a named algorithm', () => {
    expect(codeOnly()).not.toMatch(/LightGBM/)
    expect(codeOnly()).not.toMatch(/XGBoost/)
    expect(codeOnly()).not.toMatch(/CatBoost/)
  })

  it('derives the provenance line from the source field', () => {
    const view = readFileSync(join(SRC, 'components/AIAdvisorView.tsx'), 'utf8')
    expect(view).toMatch(/servingSource\s*===\s*"live"/)
    expect(view).toMatch(/servingSource\s*===\s*"mock"/)
  })

  it('exposes servingSource from the signals hook', () => {
    const hook = readFileSync(join(SRC, 'hooks/useAISignals.ts'), 'utf8')
    expect(hook).toMatch(/servingSource/)
    expect(hook).toMatch(/source\s*===\s*"live"\s*\|\|\s*env\.source\s*===\s*"mock"|env\.source/)
  })
})

describe('"Last Updated" is never the browser clock', () => {
  it('does not seed the timestamp from Date.now()', () => {
    const hook = readFileSync(join(SRC, 'hooks/useAISignals.ts'), 'utf8')
    expect(hook).not.toMatch(/useState[^)]*new Date\(\)\.toISOString\(\)/)
    expect(hook).not.toMatch(/setLastFetched/)
  })

  it('reads generatedAt from the response envelope instead', () => {
    const hook = readFileSync(join(SRC, 'hooks/useAISignals.ts'), 'utf8')
    expect(hook).toMatch(/generatedAt/)
  })
})

describe('fabricated operator identity', () => {
  it('names no person and no job title', () => {
    expect(codeOnly()).not.toMatch(/James Davidson/)
    expect(codeOnly()).not.toMatch(/Portfolio Manager|Manajer Portofolio/)
  })

  it('has no initials avatar built from a name', () => {
    const sidebar = readFileSync(join(SRC, 'components/Sidebar.tsx'), 'utf8')
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/>\s*JD\s*</)
  })
})

describe('transaction ledger provenance', () => {
  it('labels the seed rows rather than passing them off as the user own trades', () => {
    const view = readFileSync(join(SRC, 'components/DashboardView.tsx'), 'utf8')
    expect(view).toMatch(/Data contoh/)
    expect(view).toMatch(/txIsSample/)
  })
})

describe('offline harness is documented, not branded', () => {
  it('names the five call sites that honour the flag', () => {
    const api = raw()
    for (const hook of ['useNews', 'useAISignals', 'useAlerts', 'useAdvisorChat', 'StockDetailPanel']) {
      expect(api).toContain(hook)
    }
  })

  it('calls it a UI harness rather than a demo mode', () => {
    const api = raw()
    expect(api).toMatch(/OFFLINE UI HARNESS/)
    expect(api).toMatch(/not a demo mode/)
  })
})

describe('no text characters used as icons', () => {
  /* A raw Unicode pictograph in UI text has the same failure modes as an emoji:
     unsizeable, no token colour, no aria-hidden, and a baseline that shifts
     between platforms.

     Scope is pictographic blocks only. Typographic characters are deliberately
     excluded and are NOT defects: middle dot as a separator, en dash in a range,
     multiplication in "1.2x average", and a mid-dot bullet are punctuation doing
     punctuation's job. Drawing that line is what keeps this test useful instead
     of noise. */
  const PICTOGRAPH =
    // U+FE0F (variation selector) and U+20E3 (combining keycap) are combining
    // marks, so they are matched outside the class rather than inside it.
    /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3}/u

  /** Source with comments stripped, so a file may explain a glyph it removed. */
  function code(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
  }

  it('finds no pictographic glyph in any source file', () => {
    const offenders: string[] = []
    for (const file of ALL) {
      const hits = code(file).match(PICTOGRAPH)
      if (hits) offenders.push(`${file.split('/').pop()}: ${[...new Set(hits)].join(' ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('keeps the watchlist affordance on the Star SVG, not a text glyph', () => {
    const view = code(join(SRC, 'components/MarketsView.tsx'))
    expect(view).not.toMatch(PICTOGRAPH)
    // Three sites: the quick-view tab, the column header, the empty-state hint.
    expect((view.match(/<Star\b/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('marks every decorative icon in MarketsView aria-hidden', () => {
    const view = code(join(SRC, 'components/MarketsView.tsx'))
    const icons = [...view.matchAll(/<(Star|ChevronsUpDown|ChevronUp|ChevronDown|ArrowUpRight|ArrowDownRight)\b[^>]*\/>/g)].map((m) => m[0])
    expect(icons.length).toBeGreaterThan(0)
    const missing = icons.filter((i) => !/aria-hidden|aria-label|role=/.test(i))
    expect(missing).toEqual([])
  })

  it('colours icons from a token, never a hex value', () => {
    for (const file of ALL) {
      const text = code(file)
      const icons = [...text.matchAll(/<\w+\b[^>]*\bcolor:\s*"[^"]*"[^>]*\/>/g)].map((m) => m[0])
      for (const icon of icons) {
        if (/color:/.test(icon)) expect(icon).toMatch(/var\(--|currentColor/)
      }
    }
  })

  it('uses SVG icons for the sort affordance in both states', () => {
    const view = code(join(SRC, 'components/MarketsView.tsx'))
    // The unsorted state used a bare U+2195 next to real Chevron SVGs, so the
    // header visibly jumped between states.
    expect(view).toMatch(/<ChevronsUpDown/)
    expect(view).toMatch(/<ChevronUp/)
    expect(view).toMatch(/<ChevronDown/)
  })
})

describe('palette follows the theme', () => {
  it('hardcodes no dark-palette hex on a theme-following surface', () => {
    // Sidebar is Midnight Navy by design and is exempt; these values were tuned
    // for the dark ground and the dark card and would sit wrong on Cool Ivory.
    // Assembled at runtime so this file does not itself contain the literals it
    // is asserting are absent from the app.
    const darkPalette = [
      '#0e' + '1726', '#d7' + 'e1ec', '#33' + '507a', '#1c' + '2c42',
      '#16' + '273c', '#93' + 'a6ba', '#14' + '3a2f', '#6f' + 'e0bd',
      '#e2' + '6a6a', '#6e' + '7c8d', '#2a' + '3c55', '#7f' + 'b0e0',
      '#34' + 'c79f', '#a9' + 'bcd0',
    ]
    const offenders: string[] = []
    for (const file of ALL) {
      if (file.endsWith('Sidebar.tsx')) continue
      const text = readFileSync(file, 'utf8')
      for (const hex of darkPalette) {
        if (text.includes(hex)) offenders.push(`${file.split('/').pop()}: ${hex}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('references no token that no stylesheet declares', () => {
    // fonts.css declares the font tokens, so every stylesheet has to be read.
    const stylesDir = join(process.cwd(), 'src/styles')
    const css = readdirSync(stylesDir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(stylesDir, f), 'utf8'))
      .join('\n')
    const declared = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))
    const used = new Set(ALL.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])))
    // --info and --primary-bg were both referenced with a fallback while being
    // declared nowhere, so the fallback was always what rendered. Framework-owned
    // variables (Tailwind's --spacing, Radix's --select-trigger-height and
    // friends) are set by the library at runtime and are not ours to declare.
    const FRAMEWORK_OWNED = /^--(radix-|spacing$|tw-|sidebar-width)/
    expect([...used].filter((u) => !declared.has(u) && !FRAMEWORK_OWNED.test(u))).toEqual([])
  })

  it('gives every donut cell an explicit stroke', () => {
    for (const view of ['PortfolioView.tsx', 'DashboardView.tsx']) {
      const text = readFileSync(join(SRC, 'components', view), 'utf8')
      const cells = [...text.matchAll(/<Cell[^>]*>/g)].map((m) => m[0])
      const donutCells = cells.filter((c) => c.includes('fill={s.color}') || c.includes('PIE_COLORS'))
      if (donutCells.length === 0) continue
      for (const c of donutCells) {
        expect(c).toMatch(/stroke=/)
      }
    }
  })

  it('uses the accent-foreground token rather than white on a coloured button', () => {
    for (const view of ['PortfolioView.tsx', 'PositionModal.tsx', 'AdvisorChat.tsx']) {
      const text = readFileSync(join(SRC, 'components', view), 'utf8')
      expect(text).not.toMatch(/color:\s*"#fff"/)
    }
  })
})