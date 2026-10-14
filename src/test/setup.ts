import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Node 25 ships an experimental global `localStorage` that shadows jsdom's and
// lacks a working clear()/setItem() unless a backing file is configured. Install
// a clean in-memory Storage so tests get predictable behaviour regardless of the
// Node/jsdom precedence.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear() {
    this.store.clear()
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}

// jsdom has no ResizeObserver, and Recharts (the sector-exposure chart) and the
// resizable panels both construct one on mount. Without this, every test that
// renders a view containing a chart fails on a browser API rather than on
// anything about the view.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: NoopResizeObserver,
  })
}

const memoryStorage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: memoryStorage,
})

// React Testing Library does not auto-clean between tests under Vitest.
afterEach(() => {
  cleanup()
  memoryStorage.clear()
})
