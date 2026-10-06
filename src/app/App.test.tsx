import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('asks for a session when there is none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Not authenticated' }))
    render(
      <App />,
    )
    expect(await screen.findByRole('heading', { name: 'Masuk' })).toBeInTheDocument()
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