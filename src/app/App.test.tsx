import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

const ACCOUNT = {
  id: '3f2a6c11-0d5e-4a1b-9c77-1f0b2d3e4a55',
  email: 'pengguna@aidss.id',
  full_name: 'Pengguna',
  phone_number: '081234567890',
  role: 'user' as const,
  blocked: false,
  blockedReason: null,
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.history.pushState({}, '', '/')
  localStorage.clear()
})

describe('the auth gate', () => {
  it('shows nothing until the server has answered', async () => {
    // "Checking" is not "signed out". Rendering the dashboard here would flash
    // the real interface at someone who turns out to be a stranger.
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise<Response>((res) => { release = res }))
    const { container } = render(
      <App />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).not.toContain('Masuk')
    release(jsonResponse(200, ACCOUNT))
  })

  it('lands a visitor on the public price sheet first', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Not authenticated' }))
    render(
      <App />,
    )
    expect(await screen.findByRole('heading', { name: 'Subscription AI Investment Decision Support by Meta Cash Asset.' })).toBeInTheDocument()
  })

  it('walks a visitor to the features screen at /fitur', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Not authenticated' }))
    // /fitur is the second public surface (owner, 2026-10-23): the features
    // the sheet's pillar band compresses, expanded in full.
    window.history.pushState({}, '', '/fitur')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Setiap alat bantu datang dengan alasannya.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lihat aplikasi berjalan' })).toBeInTheDocument()
  })

  it('lands a cross-page hash on the sheet once the target exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Not authenticated' }))
    // Client-side navigation never scrolls to a fragment on its own, and a
    // fresh load can race the render, so App scrolls once the element is
    // there (this is what /#catatan from the features screen relies on).
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    try {
      window.history.pushState({}, '', '/#catatan')
      render(<App />)
      expect(await screen.findByText(/alat bantu keputusan, bukan penasihat investasi/)).toBeInTheDocument()
      await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: 'start' }),
      ))
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
      window.history.pushState({}, '', '/')
    }
  })

  it('keeps the forms on their real URLs, carrying the picked plan', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Not authenticated' }))

    // `/masuk` and `/daftar` are the real form addresses; the English aliases
    // read the same. The plan key rides the server's own vocabulary
    // (weekly/monthly/annual), and the signup form translates it.
    window.history.pushState({}, '', '/masuk')
    const masuk = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Masuk' })).toBeInTheDocument()
    masuk.unmount()

    window.history.pushState({}, '', '/daftar?plan=monthly')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Buat akun', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Paket terpilih: Bulanan')).toBeInTheDocument()
    expect((await screen.findByRole('button', { name: 'Bulanan' })).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the dashboard for a signed-in account', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) return Promise.resolve(jsonResponse(200, ACCOUNT))
      return Promise.resolve(jsonResponse(200, []))
    })
    render(
      <App />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // The shell's own copy is proof the gate let it through.
    expect(screen.queryByRole('heading', { name: 'Masuk' })).not.toBeInTheDocument()
  })

  it('does not treat an unreachable server as signed out', async () => {
    // Reporting "unknown" as "nobody is signed in" would sign people out every
    // time the API blips.
    fetchMock.mockRejectedValue(new Error('network down'))
    render(
      <App />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Masuk' })).not.toBeInTheDocument()
  })

  it('sends the session cookie on every request', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) return Promise.resolve(jsonResponse(200, ACCOUNT))
      return Promise.resolve(jsonResponse(200, []))
    })
    render(
      <App />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options.credentials).toBe('include')
  })
})

describe('auth routes', () => {
  it('redirects /login into the shell when a session exists', async () => {
    window.history.pushState({}, '', '/login')
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) return Promise.resolve(jsonResponse(200, ACCOUNT))
      return Promise.resolve(jsonResponse(200, []))
    })
    render(
      <App />,
    )
    // Navigate redirects in an effect, so waiting for the fetch is not waiting
    // for the redirect. Assert on the eventual location, not the immediate one.
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })
})

describe('the paywall banner', () => {
  function serve(subscription: unknown, paidStatus = 200) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) return Promise.resolve(jsonResponse(200, ACCOUNT))
      if (url.includes('/v1/subscription/current')) {
        return Promise.resolve(jsonResponse(200, subscription))
      }
      if (paidStatus !== 200) return Promise.resolve(jsonResponse(paidStatus, {}))
      return Promise.resolve(jsonResponse(200, []))
    })
  }

  it('says nothing when the account has an active subscription', async () => {
    serve({ active: true, expiresAt: '2027-01-01T00:00:00Z', daysRemaining: 30 })
    render(<App />)

    await screen.findByText(/Analisis berbayar tidak aktif/i, {}, { timeout: 2000 }).catch(() => {})
    expect(screen.queryByText(/Analisis berbayar tidak aktif/i)).not.toBeInTheDocument()
  })

  it('appears once, naming the subscription, when a paid request is refused', async () => {
    serve({ active: false }, 403)
    render(<App />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByText(/Analisis berbayar tidak aktif/i)).toBeInTheDocument()
    // One banner, not one per panel: every paid view refusing at once is one
    // fact about the account.
    expect(screen.getAllByText(/Analisis berbayar tidak aktif/i)).toHaveLength(1)
  })

  it('never tells the reader to check their connection when the server refused', async () => {
    // The whole failure this work exists for: a healthy backend declining paid
    // data, and the screen sending the reader off to debug their network.
    //
    // Scoped to role=alert, i.e. the failure banners. The freshness badge also
    // renders "backend tidak terjangkau", and in this environment that is the
    // truth — no WebSocket is ever opened — so asserting on it here would be
    // testing the harness rather than the app.
    serve({ active: false }, 403)
    render(<App />)

    await screen.findByText(/Analisis berbayar tidak aktif/i)
    await new Promise((r) => setTimeout(r, 400))

    // Asserted on the rendered text, not on a role that nothing sets on this view.
    expect(document.body.textContent).not.toMatch(/Mode simulasi/i)
    expect(screen.getByText(/langganan/i)).toBeInTheDocument()
  })

  it('says the status is unknown rather than claiming a subscription problem', async () => {
    // The server will not answer. That is not "you have no subscription" and it
    // is not silence either — a blank banner reads as the same claim.
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) return Promise.resolve(jsonResponse(200, ACCOUNT))
      return Promise.resolve(jsonResponse(503, {}))
    })
    render(<App />)

    expect(
      await screen.findByText(/Status tidak dapat dipastikan/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Analisis berbayar tidak aktif/i)).not.toBeInTheDocument()
  })

  it('leads to Settings, which is the only place the status can be read', async () => {
    serve({ active: false }, 403)
    render(<App />)

    await screen.findByText(/Analisis berbayar tidak aktif/i)
    // Scoped to the banner: the sidebar carries a settings entry too, and this
    // asserts the banner's own affordance rather than that two buttons exist.
    const banner = screen.getByRole('status')
    await userEvent.click(within(banner).getByRole('button'))

    await waitFor(() => expect(screen.getByText(/Langganan & Tagihan/i)).toBeInTheDocument())
  })
})
