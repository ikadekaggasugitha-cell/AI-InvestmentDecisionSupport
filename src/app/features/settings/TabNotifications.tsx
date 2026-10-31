import { useEffect, useRef, useState } from 'react'
import { STORAGE_NOTIF, readNotifPrefs, type NotifKey } from '@/app/features/settings/constants'
import { Divider, Panel, ToggleRow } from '@/app/features/settings/tabPrimitives'

export function TabNotifications({ id }: { id: boolean }) {
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>(readNotifPrefs)
  const [saved, setSaved] = useState<NotifKey | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  function toggle(key: NotifKey) {
    setNotifs((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(STORAGE_NOTIF, JSON.stringify(next))
      } catch {
        /* preference stays in memory for this session */
      }
      return next
    })
    if (timer.current !== null) clearTimeout(timer.current)
    setSaved(key)
    timer.current = setTimeout(() => setSaved(null), 2000)
  }

  const rows: { key: NotifKey; label: string; en: string; desc: string; descEn: string }[] = [
    {
      key: 'ai_signals',
      label: 'Sinyal AI baru',
      en: 'New AI signals',
      desc: 'Saat model kuantitatif menghasilkan sinyal probabilitas baru',
      descEn: 'When the quantitative model produces a new probability signal',
    },
    {
      key: 'risk_alerts',
      label: 'Peringatan risiko',
      en: 'Risk alerts',
      desc: 'Saat eksposur risiko portofolio melewati ambang toleransi',
      descEn: 'When portfolio risk exposure crosses the tolerance threshold',
    },
    {
      key: 'corp_news',
      label: 'Berita korporasi',
      en: 'Corporate news',
      desc: 'Keterbukaan informasi emiten yang sedang dipantau',
      descEn: 'Listed-company disclosure filings for tracked holdings',
    },
  ]

  return (
    <Panel title={id ? 'Notifikasi' : 'Notifications'}>
      {rows.map((r, i) => (
        <div key={r.key}>
          {i > 0 && <Divider />}
          <ToggleRow
            label={id ? r.label : r.en}
            description={id ? r.desc : r.descEn}
            isOn={notifs[r.key]}
            saved={saved === r.key}
            savedLabel={id ? 'Tersimpan' : 'Saved'}
            onToggle={() => toggle(r.key)}
            id={`notif-${r.key}`}
          />
        </div>
      ))}
    </Panel>
  )
}
