import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminSmtpView } from '@/app/features/admin/AdminSmtpView'

/**
 * The email editor, tested against the two ways it could lie.
 *
 *  - **A password reaching the DOM.** The server only ever sends a boolean, and
 *    the field is a `type="password"` input that starts empty. If a future change
 *    prefilled it, the credential would sit in the accessibility tree, in the
 *    page source, and in whatever a browser extension reads.
 *  - **A save that changes nothing.** The form cannot prove the transport reads
 *    the row — that is the backend's test — but it can prove it re-reads the
 *    server after writing and reports what came back, rather than declaring
 *    success because a request went out.
 *
 * Also pinned: an empty password box is what an operator sees when a credential
 * exists, and the sentence beside it says keeping it empty keeps the stored one.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

const SECRET = 'kata-sandi-server-surat'

const STORED = {
  host: 'smtp.example.test',
  port: 587,
  username: 'relay-user',
  fromAddress: 'billing@example.test',
  useTls: true,
  enabled: true,
  hasPassword: true,
  stored: true,
  updatedAt: '2026-10-14T10:00:00+00:00',
}

const FROM_ENV = { ...STORED, stored: false, updatedAt: null, host: 'env.example.test' }

function respond(body: unknown, status = 200) {
  mocked.mockImplementation(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response,
  )
}

function writes() {
  return mocked.mock.calls.filter(
    (call) => (call[1] as { method?: string } | undefined)?.method === 'PUT',
  )
}

function lastBody() {
  const [, init] = writes()[writes().length - 1]
  return JSON.parse(String((init as { body: string }).body)) as Record<string, unknown>
}

beforeEach(() => {
  mocked.mockReset()
})

describe('mengisi formulir dari apa yang berlaku', () => {
  it('memakai nilai yang dikirim server, bukan kosong', async () => {
    /* An operator opening this screen on an install that sends mail from `.env`
       has to see what is in force. Blanks there read as "nothing is configured",
       and they would change something that was never broken. */
    respond(FROM_ENV)
    render(<AdminSmtpView />)

    await waitFor(() => expect(screen.getByLabelText(/^Host/i)).toHaveValue('env.example.test'))
    expect(screen.getByLabelText(/^Port/i)).toHaveValue('587')
    expect(screen.getByLabelText(/^Alamat Pengirim/i)).toHaveValue('billing@example.test')
    expect(await screen.findByText(/Belum ada yang tersimpan di aplikasi ini/i)).toBeInTheDocument()
  })

  it('menandai konfigurasi yang sudah tersimpan', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    expect(
      await screen.findByText(/Yang tersimpan sebagai pengaturan aplikasi ini/i),
    ).toBeInTheDocument()
  })
})

describe('password', () => {
  it('tidak pernah muncul di DOM, bahkan ketika yang tersimpan ada', async () => {
    respond(STORED)
    const { container } = render(<AdminSmtpView />)

    await screen.findByRole('switch', { name: /Kirim email dari aplikasi ini/i })
    expect(container.textContent).not.toContain(SECRET)
    // The value of every field on the page, scanned rather than assumed.
    for (const input of Array.from(container.querySelectorAll('input'))) {
      expect(input.value).not.toContain(SECRET)
    }
  })

  it('kotaknya kosong walau server menyimpan satu, dan bilang begitu', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    const box = await screen.findByLabelText(/^Password/i)
    expect(box).toHaveValue('')
    expect(box).toHaveAttribute('type', 'password')
    expect(box).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByText(/Kosong untuk mempertahankan yang tersimpan/i)).toBeInTheDocument()
  })

  it('mengirim string kosong bila operator tidak menyentuhnya', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    await userEvent.click(await screen.findByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(lastBody().password).toBe('')
  })

  it('mengirim password baru bila diketik, lalu mengosongkan kotak lagi', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    await userEvent.type(await screen.findByLabelText(/^Password/i), 'kunci-baru')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(lastBody().password).toBe('kunci-baru'))
    await waitFor(() => expect(screen.getByLabelText(/^Password/i)).toHaveValue(''))
  })
})

describe('menyimpan', () => {
  it('mengirim apa yang tertulis di kolom', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    const host = await screen.findByLabelText(/^Host/i)
    await userEvent.clear(host)
    await userEvent.type(host, 'smtp.baru.example')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(lastBody()).toMatchObject({
      host: 'smtp.baru.example',
      port: 587,
      fromAddress: 'billing@example.test',
      useTls: true,
      enabled: true,
    })
  })

  it('menyebut bahwa perubahan berlaku tanpa memulai ulang', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    await userEvent.click(await screen.findByRole('button', { name: 'Simpan' }))

    expect(
      await screen.findByText(/tidak ada proses yang perlu dimulai ulang/i),
    ).toBeInTheDocument()
  })

  it('berkata jujur soal password yang tersimpan plaintext', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    expect(
      await screen.findByText(/Password disimpan apa adanya di pengaturan aplikasi/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/cadangan aplikasi/i)).toBeInTheDocument()
  })

  it('menolak yang server tolak dan tidak mengaku tersimpan', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    await userEvent.click(await screen.findByLabelText(/^Host/i))
    mocked.mockImplementationOnce(
      async () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({ detail: 'host cannot contain a space' }),
        }) as unknown as Response,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/422/)
    expect(screen.queryByText(/Tersimpan/)).not.toBeInTheDocument()
  })

  it('mengembalikan kolom ke jawaban server setelah tulisan terbalik', async () => {
    /* The boxes go back to what the install holds, not to what was typed. A form
       that kept the refused text in place would be read as a saved change. */
    respond(STORED)
    render(<AdminSmtpView />)

    const host = await screen.findByLabelText(/^Host/i)
    await userEvent.clear(host)
    await userEvent.type(host, 'smtp.ditolak.example')
    mocked.mockImplementationOnce(
      async () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({ detail: 'no' }),
        }) as unknown as Response,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    // Queried again rather than reused: the box is re-filled from the server's
    // answer, and what matters is that the value standing there is the stored
    // one, not the text this test typed and the server refused.
    await waitFor(() => expect(screen.getByLabelText(/^Host/i)).toHaveValue('smtp.example.test'))
  })
})

describe('sakelar dan keadaan', () => {
  it('menukar sakelar dan mengirim nilainya', async () => {
    respond(STORED)
    render(<AdminSmtpView />)

    const send = await screen.findByRole('switch', { name: /Kirim email dari aplikasi ini/i })
    expect(send).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(send)
    expect(send).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(lastBody().enabled).toBe(false))
  })

  it('403 berkata administrator, bukan formulir kosong', async () => {
    respond({}, 403)
    render(<AdminSmtpView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Hanya administrator/)
    expect(screen.queryByLabelText(/^Host/i)).not.toBeInTheDocument()
  })

  it('yang tidak terbaca tidak menampilkan formulir', async () => {
    /* A form over an unreadable configuration is a form that could overwrite one
       it never showed. */
    respond({}, 503)
    render(<AdminSmtpView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak dapat dibaca/)
    expect(screen.queryByRole('button', { name: 'Simpan' })).not.toBeInTheDocument()
  })
})
