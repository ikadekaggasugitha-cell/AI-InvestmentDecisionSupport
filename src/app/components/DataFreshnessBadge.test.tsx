import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataFreshnessBadge } from './DataFreshnessBadge'
import type { DataFreshness } from '../hooks/useLiveMarket'

function freshness(overrides: Partial<DataFreshness> = {}): DataFreshness {
  return {
    provider: 'yahoo',
    label: 'Delayed Quote',
    asOf: new Date('2026-08-17T09:00:00Z'),
    isSimulated: false,
    isDelayed: false,
    delaySeconds: 0,
    isIntradaySimulated: false,
    outdatedSymbols: [],
    ...overrides,
  } as DataFreshness
}

describe('DataFreshnessBadge', () => {
  it('shows OFFLINE when the backend is unreachable', () => {
    render(<DataFreshnessBadge freshness={freshness()} isConnected={false} locale="en" />)
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
  })

  it('shows SIMULATED for the seed path — never presenting it as market data', () => {
    render(
      <DataFreshnessBadge
        freshness={freshness({ isSimulated: true })}
        isConnected
        locale="en"
      />,
    )
    expect(screen.getByText('SIMULATED')).toBeInTheDocument()
    expect(screen.getByText('not market prices')).toBeInTheDocument()
  })

  it('surfaces the vendor delay interval', () => {
    render(
      <DataFreshnessBadge
        freshness={freshness({ isDelayed: true, delaySeconds: 600 })}
        isConnected
        locale="en"
      />,
    )
    expect(screen.getByText('DELAYED 10 MIN')).toBeInTheDocument()
  })

  it('shows LIVE for a real-time feed', () => {
    render(<DataFreshnessBadge freshness={freshness()} isConnected locale="en" />)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('renders Indonesian labels when locale is id', () => {
    render(<DataFreshnessBadge freshness={freshness()} isConnected locale="id" />)
    expect(screen.getByText('LANGSUNG')).toBeInTheDocument()
  })
})
  it('lists securities that have not traded for over a week', () => {
    // The age shown is the median quote, so without this line a robust number
    // reads as "nothing is out of date" — the finding would be averaged away.
    const f = freshness({ outdatedSymbols: ['PLIN', 'SUPR', 'FASW'] })
    render(<DataFreshnessBadge freshness={f} isConnected locale="en" />)
    const badge = screen.getByText(/LIVE|DELAYED|SIMULATED|OFFLINE/).closest('[title]')
    expect(badge).not.toBeNull()
    expect(badge!.getAttribute('title')).toContain('3 securities have not traded')
    expect(badge!.getAttribute('title')).toContain('PLIN')
  })

  it('omits the line when every quote is current', () => {
    const f = freshness({ outdatedSymbols: [] })
    render(<DataFreshnessBadge freshness={f} isConnected locale="en" />)
    const badge = screen.getByText(/LIVE|DELAYED|SIMULATED|OFFLINE/).closest('[title]')
    expect(badge!.getAttribute('title') ?? '').not.toContain('have not traded')
  })

  it('still renders when a backend predates the outdatedSymbols field', () => {
    // Frontend and backend deploy independently. A new bundle served by an old
    // backend gets no such field; the badge must degrade to the other lines
    // rather than blank out.
    const legacy = { ...freshness() } as Partial<DataFreshness>
    delete legacy.outdatedSymbols
    render(
      <DataFreshnessBadge
        freshness={legacy as DataFreshness}
        isConnected
        locale="en"
      />,
    )
    expect(screen.getByText(/LIVE|DELAYED|SIMULATED|OFFLINE/)).toBeInTheDocument()
  })

