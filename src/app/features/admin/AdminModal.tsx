import { useEffect, useRef } from 'react'
import { text } from '@/app/features/admin/consoleStyles'

/**
 * The modal shell the admin console's dialogs share.
 *
 * Hand-rolled rather than pulled from `src/app/components/ui/dialog.tsx`,
 * because nothing under `src/app/features/` uses those primitives: the app's own
 * dialogs (`PositionModal.tsx`) already do it this way, and a second idiom for
 * the same widget is how a codebase ends up with two focus behaviours to
 * maintain. The mechanics that matter are here once: focus moves in on open,
 * returns to whatever opened it on close, Escape dismisses, and clicking the
 * backdrop dismisses while clicking inside the box does not.
 */
export function AdminModal({
  labelledBy,
  onDismiss,
  children,
  width = 460,
}: {
  labelledBy: string
  onDismiss: () => void
  children: React.ReactNode
  width?: number
}) {
  const modalRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null
    modalRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreTo.current?.focus()
    }
  }, [onDismiss])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          width,
          maxWidth: '100%',
          boxShadow: '0 16px 40px rgba(9,16,26,0.28)',
          padding: 20,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** The button pair every admin dialog ends with, so the two agree on shape. */
export function AdminDialogActions({
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  disabled,
  danger = false,
}: {
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
  disabled?: boolean
  danger?: boolean
}) {
  const tone = danger ? 'var(--loss)' : 'var(--primary)'
  const off = disabled || busy
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
      <button
        type="button"
        disabled={off}
        onClick={onConfirm}
        style={{
          fontSize: text.body,
          padding: '7px 14px',
          minHeight: 32,
          fontWeight: 600,
          color: danger ? 'var(--loss)' : 'var(--primary-foreground)',
          background: danger ? 'transparent' : 'var(--primary)',
          border: `1px solid ${tone}`,
          borderRadius: 'var(--radius)',
          cursor: off ? 'default' : 'pointer',
          opacity: off ? 0.5 : 1,
        }}
      >
        {busy ? 'Menyimpan…' : confirmLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        style={{
          fontSize: text.body,
          padding: '7px 14px',
          minHeight: 32,
          color: 'var(--foreground)',
          background: 'transparent',
          // --control-border, not --border: ADR-0007 gives an interactive
          // boundary a contrast floor; a divider token is allowed to be quiet.
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius)',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        Batal
      </button>
    </div>
  )
}
