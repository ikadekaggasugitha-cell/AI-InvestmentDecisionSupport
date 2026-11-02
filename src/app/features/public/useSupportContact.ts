/**
 * The support address the public footer publishes.
 *
 * One read of one server value, in the shape the price sheet already uses for
 * its prices: the number is not the frontend's to know, so the frontend asks.
 * `docs/settings-module-spec.md` §4 put this rule in writing before any of it had
 * code — the contact row's value comes from `system_settings.contact_support`,
 * and if it is empty the row is not rendered, because a `mailto:` with nothing
 * after it is a dead control.
 *
 * So this returns `null` for every failure a visitor can distinguish from
 * another and must not: never configured, server unreachable, a refused request.
 * All of them mean "there is no address to show on this page right now", and a
 * footer that said which of the three it was would be reporting the visitor's
 * network to a person who came here to read about the product.
 */
import { useEffect, useState } from 'react'
import { apiFetch, ENDPOINTS } from '@/app/config/api'

export function useSupportContact(): string | null {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await apiFetch(ENDPOINTS.contact, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { email?: string | null }
        if (controller.signal.aborted) return
        setEmail(body.email || null)
      } catch {
        if (!controller.signal.aborted) setEmail(null)
      }
    })()
    return () => controller.abort()
  }, [])

  return email
}
