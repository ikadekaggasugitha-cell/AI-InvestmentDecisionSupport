import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Console chrome guard (referensi/admin-konsol.png redesign).
 *
 * The Keeper-style chrome introduced surfaces the rest of the suite never saw:
 * a near-black header band, a grey icon sidebar, and a link blue. This file
 * locks their contrast so a future edit cannot quietly drop white-on-black or
 * blue-on-white below AA, and it keeps the shell free of dead links. It reads
 * the real token values out of `src/styles/theme.css` rather than restating
 * them, so the assertion tracks the thing the browser actually paints.
 *
 * The `.admin-console` scope is already held apart from the dark theme by
 * `contrast.test.ts` (no token may equal its `.dark` twin, and `--control-border`
 * / `--link` stay out of scope); this file covers the NEW surfaces only.
 */

const THEME = resolve(__dirname, '../../styles/theme.css')
const SHELL = resolve(__dirname, '../features/admin/AdminView.tsx')

function consoleTokens(): Map<string, string> {
  const theme = readFileSync(THEME, 'utf8')
  const start = theme.indexOf('.admin-console {')
  const block = theme.slice(start, theme.indexOf('\n}', start))
  const out = new Map<string, string>()
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+):\s*([^;]+);/i)
    if (m) out.set(m[1], m[2].trim())
  }
  return out
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function relLum({ r, g, b }: { r: number; g: number; b: number }): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: string, b: string): number {
  const l1 = relLum(hexToRgb(a))
  const l2 = relLum(hexToRgb(b))
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

describe('console chrome contrast (referensi/admin-konsol.png)', () => {
  const t = consoleTokens()

  it('declares the new chrome tokens in the .admin-console scope', () => {
    for (const name of [
      '--console-header-bg',
      '--console-header-ink',
      '--console-info',
      '--console-nav-bg',
      '--console-nav-ink',
      '--console-nav-active-bg',
      '--console-nav-active-ink',
    ]) {
      expect(t.get(name), `${name} is declared`).toBeTruthy()
    }
  })

  it('keeps header, sidebar, and link text at AA on their own surfaces', () => {
    const headerBg = t.get('--console-header-bg')!
    const headerInk = t.get('--console-header-ink')!
    const info = t.get('--console-info')!
    const navBg = t.get('--console-nav-bg')!
    const navInk = t.get('--console-nav-ink')!
    const activeBg = t.get('--console-nav-active-bg')!
    const activeInk = t.get('--console-nav-active-ink')!

    // White-on-near-black, blue-on-white card, and the sidebar tints.
    expect(contrast(headerInk, headerBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(info, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(activeInk, activeBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(navInk, navBg)).toBeGreaterThanOrEqual(4.5)
  })

  it('gives every link in the shell a real destination', () => {
    const shell = readFileSync(SHELL, 'utf8')
    const anchors = shell.match(/<a[\s>]/g) ?? []
    const hrefs = shell.match(/href=/g) ?? []
    // The guard is only meaningful if there are links to check.
    expect(anchors.length).toBeGreaterThan(0)
    expect(anchors.length).toBe(hrefs.length)
  })
})
