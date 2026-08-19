import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AccumulationBadge } from './AccumulationBadge'
import type { AccumulationBadgeData } from '../hooks/useAccumulationMap'

const acc = (over: Partial<AccumulationBadgeData> = {}): AccumulationBadgeData => ({
  symbol: 'BBCA',
  phase: 'accumulation',
  phaseId: 'Akumulasi',
  score: 43.7,
  strength: 44,
  consistencyDays: 4,
  ...over,
})

describe('AccumulationBadge', () => {
  it('renders a dash when there is no data', () => {
    render(<AccumulationBadge data={undefined} locale="id" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows the accumulation label', () => {
    render(<AccumulationBadge data={acc()} locale="id" />)
    expect(screen.getByText('Akum')).toBeInTheDocument()
  })

  it('shows the distribution label', () => {
    render(<AccumulationBadge data={acc({ phase: 'distribution', phaseId: 'Distribusi', score: -20 })} locale="id" />)
    expect(screen.getByText('Dist')).toBeInTheDocument()
  })

  it('renders neutral as a muted dash, not a pill', () => {
    render(<AccumulationBadge data={acc({ phase: 'neutral', phaseId: 'Netral', score: 3 })} locale="id" />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Akum')).not.toBeInTheDocument()
  })

  it('exposes score and strength in the tooltip', () => {
    render(<AccumulationBadge data={acc()} locale="id" />)
    const el = screen.getByText('Akum').closest('[title]')
    expect(el?.getAttribute('title')).toMatch(/skor \+43\.7/)
    expect(el?.getAttribute('title')).toMatch(/kekuatan 44/)
  })

  it('uses English labels when locale is en', () => {
    render(<AccumulationBadge data={acc()} locale="en" />)
    expect(screen.getByText('Acc')).toBeInTheDocument()
  })
})
