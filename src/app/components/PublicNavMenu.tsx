/**
 * The public headers' navigation, folded into a hamburger at the far right
 * of the bar (owner, 2026-10-24). The topbar's text links moved here on
 * every breakpoint; the enter gates (Masuk, Buat akun) stay visible beside
 * it, never behind it. Each screen offers only the targets it can actually
 * serve: the sheet shows Fitur and Catatan, the features screen shows
 * Harga and Catatan (a link back to the page you are on has no use).
 *
 * The popup behaves like the small menu it is: Escape closes and returns
 * focus to the button, a press outside closes it, and the links keep their
 * real hrefs so middle-click and sharing still work while clicks walk
 * through the app's handlers.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import type { Locale } from "../i18n/translations";

export interface PublicNavTarget {
  /** Real href: middle-click and sharing keep working. */
  href: string;
  label: string;
  /** Runs inside the app instead of a full page load, when there is one. */
  onNavigate?: () => void;
}

interface PublicNavMenuProps {
  locale: Locale;
  /** The navigation landmark's name, per screen, as the old nav had it. */
  ariaLabel: string;
  targets: PublicNavTarget[];
}

export function PublicNavMenu({ locale, ariaLabel, targets }: PublicNavMenuProps) {
  const isId = locale === "id";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="pub-menu" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="pub-menu-btn"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={
          open
            ? isId
              ? "Tutup menu navigasi"
              : "Close navigation menu"
            : isId
              ? "Buka menu navigasi"
              : "Open navigation menu"
        }
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={20} aria-hidden="true" strokeWidth={2.2} /> : <Menu size={20} aria-hidden="true" strokeWidth={2.2} />}
      </button>
      <nav
        id={popId}
        aria-label={ariaLabel}
        className={open ? "pub-menu-pop is-open" : "pub-menu-pop"}
      >
        {targets.map((target) => (
          <a
            key={target.href + target.label}
            href={target.href}
            onClick={(event) => {
              if (target.onNavigate) {
                event.preventDefault();
                target.onNavigate();
              }
              setOpen(false);
            }}
          >
            {target.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
