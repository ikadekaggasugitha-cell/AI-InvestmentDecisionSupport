import type { CSSProperties } from 'react'

/* Shared control styles for the Profile tab. Declared once because three
   components would otherwise each re-state the same 44px tap target and the same
   3:1 border, and one of them would eventually get it wrong. */

export const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--foreground)',
  marginBottom: 6,
}

export const fieldInput: CSSProperties = {
  width: '100%',
  minHeight: '44px',
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'var(--font-sans)',
  color: 'var(--foreground)',
  background: 'var(--input-background, #ffffff)',
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius)',
  boxSizing: 'border-box',
}

export const primaryButton: CSSProperties = {
  minHeight: '44px',
  padding: '10px 16px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  color: 'var(--primary-foreground)',
  background: 'var(--primary)',
  border: '1px solid var(--primary)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
}

export const secondaryButton: CSSProperties = {
  minHeight: '44px',
  padding: '10px 16px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  color: 'var(--foreground)',
  background: 'transparent',
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
}

export const signOutButton: CSSProperties = {
  minHeight: '44px',
  padding: '10px 16px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  color: 'var(--destructive)',
  background: 'transparent',
  border: '1px solid var(--destructive)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
}
