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
