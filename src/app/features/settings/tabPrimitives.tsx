/* Shared primitives for the settings tabs: one Panel, one row, one toggle,
   one metric — declared once so no tab invents its own 44px target or its own
   3:1 border and one of them eventually gets it wrong. */
import type { ReactNode } from 'react'

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{title}</span>
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

export function Unavailable({ id, title, body }: { id: boolean; title: string; body: string }) {
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
        {body}
      </span>
      <span
        style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}
      >
        {id
          ? 'docs/saas-subscription-platform.md, Fase 1'
          : 'docs/saas-subscription-platform.md, Phase 1'}
      </span>
    </div>
  )
}

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div
      className="setting-row"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
          {description}
        </div>
      </div>
      {children}
    </div>
  )
}

export function ChoiceGroup({
  options,
  id,
}: {
  options: { key: string; label: string; active: boolean; onClick?: () => void }[]
  id: boolean
}) {
  return (
    <div role="group" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={o.onClick}
          aria-pressed={o.active}
          disabled={!o.onClick}
          style={{
            minHeight: 32,
            padding: '6px 12px',
            borderRadius: 'var(--radius)',
            cursor: o.onClick ? 'pointer' : 'default',
            background: o.active ? 'var(--muted)' : 'transparent',
            border: 'none',
            color: o.active ? 'var(--foreground)' : 'var(--muted-foreground)',
            fontSize: 12,
            fontWeight: o.active ? 500 : 400,
          }}
        >
          {o.label}
        </button>
      ))}
      {id ? null : null}
    </div>
  )
}

export function ToggleRow({
  label,
  description,
  isOn,
  onToggle,
  saved,
  savedLabel,
  id,
}: {
  label: string
  description: string
  isOn: boolean
  onToggle: () => void
  saved: boolean
  savedLabel: string
  id: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 24,
        padding: '4px 0',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 }}>
          <label
            htmlFor={id}
            style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', cursor: 'pointer' }}
          >
            {label}
          </label>
          {saved && (
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }} role="status">
              {savedLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
          {description}
        </div>
      </div>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={isOn}
        aria-label={label}
        onClick={onToggle}
        style={{
          width: 36,
          height: 20,
          minHeight: 44,
          borderRadius: 10,
          background: isOn ? 'var(--primary)' : 'var(--switch-background)',
          position: 'relative',
          cursor: 'pointer',
          flexShrink: 0,
          marginTop: 12,
          border: 'none',
          padding: 0,
          transition: 'background 0.15s',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'var(--card)',
            position: 'absolute',
            top: 3,
            left: isOn ? 19 : 3,
            transition: 'left 0.15s',
            pointerEvents: 'none',
          }}
        />
      </button>
    </div>
  )
}

export function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'gain' | 'loss'
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          color:
            tone === 'gain' ? 'var(--gain)' : tone === 'loss' ? 'var(--loss)' : 'var(--foreground)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

export function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
}
