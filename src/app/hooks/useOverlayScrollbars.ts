import { useEffect } from "react";

const IDLE_MS = 1000;

/**
 * Reveal a scroll container's custom thumb while it scrolls and hide it again
 * after `IDLE_MS` of no motion. Listen on the window in the capture phase so a
 * nested scroller (view root, sidebar nav, market table, modal) toggles its
 * own `.scrolling` class without each container needing its own listener.
 */
export function useOverlayScrollbars(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onScroll = (e: Event) => {
      const target = e.target;
      const el =
        target instanceof Document
          ? document.scrollingElement
          : target instanceof Element
            ? target
            : null;
      if (el) el.classList.add("scrolling");
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        document.querySelectorAll(".scrolling").forEach((n) => n.classList.remove("scrolling"));
      }, IDLE_MS);
    };

    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}