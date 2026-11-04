import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The gateway's brand stays off the screens a customer reads.
 *
 * The owner's decision (2026-11): someone choosing how to pay should not be
 * reading the name of the company processing it. What they are choosing is an
 * instrument — a card, a QR code, a bank transfer — and the processor is this
 * install's business, not a fact the payer needs to decide with.
 *
 * This is a source-level guard, and deliberately the only kind that would work.
 * The promise is about strings nobody should ever write, and a render test can
 * only check the components it knows about. A change next month that adds
 * "Bayar via Midtrans" to a new panel would pass every existing test.
 *
 * The boundary is exact, because getting it wrong cuts both ways:
 *
 *  - **What is scanned** is everything that reaches a payer: the payment screen,
 *    the billing tab, the signed-out surfaces, and the auth copy. Comments are
 *    stripped first, so a file may explain the rule it follows — and so the
 *    sentence "the gateway is Midtrans" can live in a docstring above a screen
 *    that never prints it.
 *  - **What is not scanned** is the admin console. An operator reading which
 *    integration is wired needs the real name; `AdminIntegrationsView` says
 *    "Midtrans" on purpose, and renaming it there would make the console less
 *    informative to buy nothing.
 *  - **What this cannot promise** is that the word never appears on a screen at
 *    all. The page that opens after a payer chooses to pay online belongs to the
 *    gateway, and it says so. `docs/status.md` records that limit rather than
 *    pretending the guard covers it.
 */

const SRC = join(process.cwd(), 'src/app')

/** The payer-facing surfaces. A new file that shows a customer how to pay
 *  belongs in this list; the guard is only as wide as its scope. */
const PAYER_SURFACES = [
  'features/payment/PayView.tsx',
  'features/payment/usePaymentOptions.ts',
  'features/settings/TabSubscription.tsx',
  'features/settings/usePayments.ts',
  'features/settings/constants.ts',
  'features/settings/PaywallNotice.tsx',
  'features/identity/AuthScreen.tsx',
  'features/identity/SuspensionScreen.tsx',
  'i18n/translations.ts',
  'config/api.ts',
]

/** Every public marketing surface, found by directory rather than by name so a
 *  new one is covered the day it is added. */
function publicFiles(): string[] {
  return readdirSync(join(SRC, 'features/public'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `features/public/${f}`)
}

/** Comments out, so explaining the rule cannot trip it. */
function code(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const BRAND = /midtrans/i

describe('no gateway brand on the payer’s screens', () => {
  const files = [...PAYER_SURFACES, ...publicFiles()]

  it('covers the surfaces it claims to', () => {
    /* A guard whose scope silently empties out is worse than no guard: it reads
       as passing. Every named file has to exist. */
    for (const file of PAYER_SURFACES) {
      expect(() => readFileSync(join(SRC, file), 'utf8')).not.toThrow()
    }
    expect(publicFiles().length).toBeGreaterThan(0)
  })

  it('finds the gateway name in no payer-facing string', () => {
    /* The scan is of code with comments stripped, so this is a check on what a
       file can print, not on what it is allowed to explain. */
    const offenders = files
      .filter((file) => BRAND.test(code(file)))
      .map((file) => file.split('/').pop())
    expect(offenders).toEqual([])
  })

  it('says what the payment screen says instead', () => {
    /* The substitution is the point, so it is asserted positively. A screen that
       dropped the word and offered nothing in its place would be a payment page
       that cannot be read. */
    const view = code('features/payment/PayView.tsx')
    expect(view).toMatch(/Bayar online/)
    expect(view).toMatch(/Transfer langsung/)
    expect(view).toMatch(/pembayaran online|Bayar online/i)
  })
})

describe('the limit of the promise', () => {
  it('keeps the name where an operator needs it', () => {
    /* Not an oversight: the console's job is to say which integration is wired.
       Pinning this here keeps a well-meaning future sweep from flattening the
       admin screen into the customer's vocabulary. */
    const integrations = readFileSync(join(SRC, 'features/admin/AdminIntegrationsView.tsx'), 'utf8')
    expect(integrations).toMatch(/label="Midtrans"/)
  })

  it('keeps the registry’s gateway codes off the payer’s side', () => {
    /* The codes are the gateway's vocabulary. They belong in the service that
       maps them and in the admin form that shows what will be sent outward — a
       browser that knows `bca_va` is a browser that can ask for a method the
       operator switched off. */
    const view = code('features/payment/PayView.tsx')
    const options = code('features/payment/usePaymentOptions.ts')
    for (const codeWord of ['qris', 'gopay', 'shopeepay', 'bca_va', 'echannel']) {
      // The QRIS label is an instrument name a payer reads, so only the gateway's
      // own identifier spellings are what this guards against.
      if (codeWord.includes('_') || codeWord === 'echannel') {
        expect(view + options).not.toContain(codeWord)
      }
    }
  })
})
