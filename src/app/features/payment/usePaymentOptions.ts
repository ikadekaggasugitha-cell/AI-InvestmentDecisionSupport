import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'

/**
 * The two lists a payment screen reads: how to pay online, and where a transfer
 * goes.
 *
 * Both are public endpoints and both are read on every mount, never cached and
 * never copied into a constant. The reason is the same for each: they are the
 * operator's decisions, and an operator can change them while this page is open.
 * A cached channel list would offer a method that was just switched off, and a
 * cached destination would send someone's money to an account that was just
 * retired. Either way the payer finds out and the install does not.
 *
 * Three states per list, kept apart rather than collapsed:
 *
 *   - `loading`   — not asked yet
 *   - `error`     — could not ask, or the answer was unreadable
 *   - a real list — including the empty one, which is a fact about the install
 *
 * `restricted` on the channels is the server's way of saying nobody has chosen a
 * list on this install, so its gateway's own dashboard decides what the payment
 * page offers. That is not the same as an empty list, and rendering the two the
 * same way would tell a payer they had no options when they have whatever the
 * gateway enables.
 */

export interface PaymentChannel {
  key: string
  label: string
}

export interface BankAccount {
  bank: string
  accountNumber: string
  holderName: string
}

interface ChannelsState {
  loading: boolean
  error: boolean
  restricted: boolean
  channels: PaymentChannel[]
}

interface AccountsState {
  loading: boolean
  error: boolean
  accounts: BankAccount[]
}

export function usePaymentOptions() {
  const [channels, setChannels] = useState<ChannelsState>({
    loading: true,
    error: false,
    restricted: false,
    channels: [],
  })
  const [accounts, setAccounts] = useState<AccountsState>({
    loading: true,
    error: false,
    accounts: [],
  })
  const controllers = useRef<AbortController[]>([])

  const load = useCallback(async () => {
    controllers.current.forEach((c) => c.abort())
    controllers.current = []

    const channelCall = new AbortController()
    const accountCall = new AbortController()
    controllers.current = [channelCall, accountCall]

    setChannels((current) => ({ ...current, loading: true, error: false }))
    setAccounts((current) => ({ ...current, loading: true, error: false }))

    // Two requests, settled on their own terms. One list failing does not make
    // the other unknown, and a screen that blanks both because one endpoint had
    // a bad minute is hiding information the payer still has a right to.
    const [channelRes, accountRes] = await Promise.allSettled([
      apiFetch(ENDPOINTS.paymentChannels, { signal: channelCall.signal }),
      apiFetch(ENDPOINTS.bankAccounts, { signal: accountCall.signal }),
    ])

    if (channelCall.signal.aborted) return
    if (channelRes.status === 'fulfilled' && channelRes.value.ok) {
      try {
        const body = (await channelRes.value.json()) as {
          restricted?: boolean
          channels?: PaymentChannel[]
        }
        setChannels({
          loading: false,
          error: false,
          restricted: body.restricted === true,
          channels: Array.isArray(body.channels) ? body.channels : [],
        })
      } catch {
        setChannels({ loading: false, error: true, restricted: false, channels: [] })
      }
    } else {
      setChannels({ loading: false, error: true, restricted: false, channels: [] })
    }

    if (accountCall.signal.aborted) return
    if (accountRes.status === 'fulfilled' && accountRes.value.ok) {
      try {
        const body = (await accountRes.value.json()) as { accounts?: BankAccount[] }
        setAccounts({
          loading: false,
          error: false,
          accounts: Array.isArray(body.accounts) ? body.accounts : [],
        })
      } catch {
        setAccounts({ loading: false, error: true, accounts: [] })
      }
    } else {
      setAccounts({ loading: false, error: true, accounts: [] })
    }
  }, [])

  useEffect(() => {
    void load()
    return () => controllers.current.forEach((c) => c.abort())
  }, [load])

  return { channels, accounts, reload: load }
}
