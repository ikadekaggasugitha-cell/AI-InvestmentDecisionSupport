import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AppProvider, useApp } from '@/app/context/AppContext'
import { PaywallNotice } from '@/app/features/settings/PaywallNotice'

/**
 * The combination that hid every other bug in this change.
 *
 * `AUTH_BYPASS=true` is the development default, so in a normal local run the
 * entitlement gate never fires, every paid route answers 200, and the refusal
 * paths are unreachable. A frontend that mishandles a 403 therefore looks
 * perfectly correct on the machine you develop on.
 *
 * These tests drive the refusal directly, which is the closest a frontend test
 * can get to the deployment that actually matters.
 */

const fetchMock = vi.fn()

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('a refusal, with the gate actually firing', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('produces a banner that names the subscription and nothing else', async () => {
    // Rendered through the same gate the shell uses, so this exercises
    // refusal → AppContext → banner rather than just the component.
    respond(200, { active: false })
    const api = await import('@/app/config/api')

    function Shell() {
      const { locked, subscription } = useApp()
      if (locked) return <PaywallNotice onOpenSettings={() => {}} />
      if (subscription.kind === 'unknown') {
        return <PaywallNotice reason="unknown" onOpenSettings={() => {}} />
      }
      return null
    }

    render(
      <AppProvider>
        <Shell />
      </AppProvider>,
    )
    // Nothing yet: the server has only said the account is not subscribed, and
    // no refusal has actually happened.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      api.signalPaywalled()
    })

    await waitFor(() => expect(screen.getByText(/Langganan Anda belum aktif/i)).toBeInTheDocument())
    expect(within(screen.getByRole('status')).queryByText(/tidak terjangkau/i)).toBeNull()
  })

  it('keeps the banner quiet about payment until a real path is handed to it', () => {
    // /bayar is the payment path now, but it must arrive as a handled
    // navigation. A shell rendering this banner without the handler gets the
    // status affordances only — no button that looks live with nothing behind it.
    respond(200, { active: false })
    render(
      <AppProvider>
        <PaywallNotice onOpenSettings={() => {}} />
      </AppProvider>,
    )

    const banner = screen.getByRole('status')
    expect(within(banner).queryByRole('button', { name: /langganan|subscribe|ai advisor/i })).toBeNull()
    expect(within(banner).getByRole('button', { name: /pengaturan/i })).toBeInTheDocument()
  })

  it('exposes the real escalations when the shell hands them over', async () => {
    respond(200, { active: false })
    const onOpenPay = vi.fn()
    render(
      <AppProvider>
        <PaywallNotice onOpenSettings={() => {}} onOpenPay={onOpenPay} />
      </AppProvider>,
    )

    const banner = screen.getByRole('status')
    await userEvent.click(within(banner).getByRole('button', { name: /^aktifkan|^subscribe/i }))
    expect(onOpenPay).toHaveBeenCalledTimes(1)
  })

  it('shows nothing once a subscription exists', async () => {
    respond(200, {
      active: true,
      expiresAt: '2027-01-01T00:00:00Z',
      daysRemaining: 30,
    })
    const api = await import('@/app/config/api')

    function Shell() {
      return useApp().locked ? <PaywallNotice onOpenSettings={() => {}} /> : null
    }

    render(
      <AppProvider>
        <Shell />
      </AppProvider>,
    )
    act(() => {
      api.signalPaywalled()
    })

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('stays silent about the subscription when the server cannot be asked', async () => {
    // A 503 is not "you have none". Showing a billing message off a failed
    // lookup would be inventing a cause, which is the mistake this change exists
    // to stop making.
    respond(503, {})

    function Probe() {
      return <span data-testid="locked">{String(useApp().locked)}</span>
    }

    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('locked')).toHaveTextContent('false'))
  })

  it('does not sign the account out when a paid request is refused', async () => {
    const api = await import('@/app/config/api')
    const authExpired = vi.fn()
    const off = api.onAuthExpired(authExpired)
    respond(200, { active: false })

    render(
      <AppProvider>
        <PaywallNotice onOpenSettings={() => {}} />
      </AppProvider>,
    )

    act(() => {
      api.signalPaywalled()
    })
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())

    expect(authExpired).not.toHaveBeenCalled()
    off()
  })
})
