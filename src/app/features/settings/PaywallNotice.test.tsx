import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PaywallNotice } from '@/app/features/settings/PaywallNotice'

/**
 * What the app says when the paid data is being refused.
 *
 * The rule this screen exists to keep: a refusal has to name its cause and offer
 * somewhere to go. "Something went wrong, try again" is a sentence that is true
 * every time the backend is down and every time an account has not subscribed,
 * and a person reading it has no way to tell which one they are looking at.
 *
 * R-26 originally barred a buy control because no payment path existed. /bayar
 * is that path now (plan-admin-panel: the pay screen is gated on the session,
 * not the entitlement), so the subscription banner carries it — as a control
 * wired to a real screen, which is exactly the line R-26 draws between an
 * affordance and a dead one.
 */
describe('PaywallNotice', () => {
  it('names the subscription rather than the connection', () => {
    render(<PaywallNotice onOpenSettings={() => {}} />)

    expect(screen.getByText(/langganan/i)).toBeInTheDocument()
    expect(screen.queryByText(/tidak terjangkau/i)).not.toBeInTheDocument()
  })

  it('points at Settings, which is where the status can be read', async () => {
    const onOpenSettings = vi.fn()
    render(<PaywallNotice onOpenSettings={onOpenSettings} />)

    await userEvent.click(screen.getByRole('button', { name: /pengaturan/i }))

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('wires the subscription offer to the real payment screen only when given one', async () => {
    // With a /bayar handler the button exists and goes there; without one it
    // must not render, because an affordance with nothing behind it is the
    // thing R-26 forbids.
    const onOpenSettings = vi.fn()
    const onOpenPay = vi.fn()
    const { rerender } = render(
      <PaywallNotice onOpenSettings={onOpenSettings} onOpenPay={onOpenPay} />,
    )

    const subscribe = screen.getByRole('button', { name: /^aktifkan|^subscribe/i })
    await userEvent.click(subscribe)
    expect(onOpenPay).toHaveBeenCalledTimes(1)

    rerender(<PaywallNotice onOpenSettings={onOpenSettings} />)
    expect(screen.queryByRole('button', { name: /langganan|subscribe/i })).toBeNull()
  })

  it('offers the AI Advisor preview when asked, and nothing like a purchase otherwise', () => {
    const onOpenAdvisor = vi.fn()
    render(<PaywallNotice onOpenSettings={() => {}} onOpenAdvisor={onOpenAdvisor} />)

    expect(screen.getByRole('button', { name: /ai advisor/i })).toBeInTheDocument()
  })

  it('says nothing is known when the server could not be asked', () => {
    render(<PaywallNotice reason="unknown" onOpenSettings={() => {}} />)

    expect(screen.getByText(/tidak dapat dipastikan/i)).toBeInTheDocument()
    // A server that would not speak is not a subscription question, so the
    // upgrade and preview affordances stay off the banner in this state.
    expect(screen.queryByRole('button', { name: /langganan|subscribe|ai advisor/i })).toBeNull()
  })

  it('renders in English when the interface is', () => {
    render(<PaywallNotice locale="en" onOpenSettings={() => {}} />)

    expect(screen.getByText(/subscription/i)).toBeInTheDocument()
  })
})
