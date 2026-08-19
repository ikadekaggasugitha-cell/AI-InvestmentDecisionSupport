import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EntrySignalCard } from './EntrySignalCard'
import type { EntrySignal, TradePlanInfo } from '../hooks/useTechnicals'

const buyWatch: EntrySignal = {
  signal: 'buy_watch',
  signalId: 'Pantau Beli',
  reason: 'Tren uptrend, stop loss jelas',
  reasonEn: 'Uptrend, clear stop',
}

const plan: TradePlanInfo = {
  entryPrice: 2530,
  stopLoss: 2376,
  stopLossPct: -6.1,
  stopLossReason: 'Support fraktal',
  stopLossReasonEn: 'Fractal support',
  riskRewardRatio: 2.1,
}

describe('EntrySignalCard', () => {
  it('renders nothing without an entry signal', () => {
    const { container } = render(<EntrySignalCard entry={null} plan={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the signal label and reason', () => {
    render(<EntrySignalCard entry={buyWatch} plan={plan} locale="id" />)
    expect(screen.getByText('Pantau Beli')).toBeInTheDocument()
    expect(screen.getByText(/stop loss jelas/i)).toBeInTheDocument()
  })

  it('renders the trade plan: entry, stop and R:R', () => {
    render(<EntrySignalCard entry={buyWatch} plan={plan} locale="id" />)
    expect(screen.getByText('Rp 2.530')).toBeInTheDocument()
    expect(screen.getByText('Rp 2.376')).toBeInTheDocument()
    expect(screen.getByText('1 : 2.1')).toBeInTheDocument()
  })

  it('omits the plan grid when there is no entry price', () => {
    render(<EntrySignalCard entry={buyWatch} plan={null} locale="id" />)
    expect(screen.getByText('Pantau Beli')).toBeInTheDocument()
    expect(screen.queryByText(/Risk : Reward/)).not.toBeInTheDocument()
  })

  it('renders the avoid state', () => {
    render(
      <EntrySignalCard
        entry={{ signal: 'avoid', signalId: 'Hindari', reason: 'Distribusi', reasonEn: 'Distribution' }}
        plan={null}
        locale="id"
      />,
    )
    expect(screen.getByText('Hindari')).toBeInTheDocument()
  })
})
