import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VolumeAccumulationPanel } from './VolumeAccumulationPanel'
import type { VolumeInfo, AccumulationInfo } from '../hooks/useTechnicals'

const volume: VolumeInfo = {
  level: 'high',
  ratio: 1.8,
  latest: 90_000_000,
  average20d: 50_000_000,
  trend: 'rising',
  spike: true,
  note: 'Volume ramai — minat pasar tinggi',
  noteEn: 'Heavy volume — strong market interest',
}

const accumulation: AccumulationInfo = {
  phase: 'accumulation',
  phaseId: 'Akumulasi',
  score: 43.7,
  strength: 44,
  obvTrend: 1.2,
  cmf: 0.08,
  mfi: 62,
  consistencyDays: 4,
  signals: ['Tekanan beli dominan — indikasi akumulasi'],
  signalsEn: ['Net buying pressure — accumulation'],
}

describe('VolumeAccumulationPanel', () => {
  it('renders nothing when both inputs are null', () => {
    const { container } = render(<VolumeAccumulationPanel volume={null} accumulation={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows volume level, ratio and spike', () => {
    render(<VolumeAccumulationPanel volume={volume} accumulation={null} locale="id" />)
    expect(screen.getByText('Ramai')).toBeInTheDocument()
    expect(screen.getByText(/1\.8×/)).toBeInTheDocument()
    expect(screen.getByText('LONJAKAN')).toBeInTheDocument()
  })

  it('shows accumulation phase, score and indicators', () => {
    render(<VolumeAccumulationPanel volume={null} accumulation={accumulation} locale="id" />)
    expect(screen.getByText('Akumulasi')).toBeInTheDocument()
    expect(screen.getByText('+43.7')).toBeInTheDocument()
    expect(screen.getByText('OBV')).toBeInTheDocument()
    expect(screen.getByText('CMF')).toBeInTheDocument()
    expect(screen.getByText('MFI')).toBeInTheDocument()
  })

  it('lists the accumulation signals', () => {
    render(<VolumeAccumulationPanel volume={null} accumulation={accumulation} locale="id" />)
    expect(screen.getByText(/Tekanan beli dominan/)).toBeInTheDocument()
  })

  it('shows the consistency-days note', () => {
    render(<VolumeAccumulationPanel volume={null} accumulation={accumulation} locale="id" />)
    expect(screen.getByText(/OBV naik 4 hari beruntun/)).toBeInTheDocument()
  })
})
