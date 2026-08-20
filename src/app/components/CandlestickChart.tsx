import { useEffect, useRef, useState } from "react";
import type { GapInfo, SRLevel } from "../hooks/useAISignals";
import type { OHLCVCandle } from "../hooks/useTechnicals";

/**
 * Lightweight Charts wrapper.
 *
 * Two things this component exists to handle:
 *
 * 1. **Lazy loading.** The library is imported dynamically so its ~45KB stays
 *    out of the initial bundle. Only an expanded AI Advisor card renders a
 *    chart, and most sessions never expand one.
 *
 * 2. **Theming.** Lightweight Charts renders to a canvas, so it cannot inherit
 *    the app's CSS custom properties the way every other component does. The
 *    palette is read out of the computed styles and re-applied whenever the
 *    theme changes — without that the chart keeps light-mode colours on a dark
 *    background, which is the usual way canvas charts break in themed apps.
 */

export interface CandlestickChartProps {
  ohlcv: readonly OHLCVCandle[];
  supportResistance?: readonly SRLevel[];
  entryPrice?: number | null;
  stopLoss?: number | null;
  gaps?: readonly GapInfo[];
  height?: number;
  locale?: "id" | "en";
}

/** Read a CSS custom property off the document root. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim() || fallback;
}

function readTheme() {
  return {
    background: cssVar("--card", "#ffffff"),
    text: cssVar("--muted-foreground", "#6b7280"),
    grid: cssVar("--border", "#e5e7eb"),
    up: cssVar("--gain", "#16a34a"),
    down: cssVar("--loss", "#dc2626"),
    support: cssVar("--gain", "#16a34a"),
    resistance: cssVar("--loss", "#dc2626"),
    warning: cssVar("--warning", "#f59e0b"),
  };
}

export function CandlestickChart({
  ohlcv,
  supportResistance = [],
  entryPrice,
  stopLoss,
  gaps = [],
  height = 280,
  locale = "id",
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped whenever the theme flips, to force a full chart rebuild.
  const [themeTick, setThemeTick] = useState(0);

  const isId = locale === "id";

  /* Watch for theme changes. next-themes toggles a class / data attribute on
     <html>, and the OS-level preference can change independently. */
  useEffect(() => {
    const bump = () => setThemeTick((t) => t + 1);

    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", bump);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || ohlcv.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      let lib: typeof import("lightweight-charts");
      try {
        lib = await import("lightweight-charts");
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) return;

      const theme = readTheme();
      const chart = lib.createChart(container, {
        height,
        layout: {
          background: { type: lib.ColorType.Solid, color: theme.background },
          textColor: theme.text,
          fontFamily: cssVar("--font-mono", "monospace"),
          fontSize: 10,
        },
        grid: {
          vertLines: { color: theme.grid },
          horzLines: { color: theme.grid },
        },
        rightPriceScale: { borderColor: theme.grid },
        timeScale: { borderColor: theme.grid, timeVisible: false },
        crosshair: { mode: lib.CrosshairMode.Normal },
        handleScale: { axisPressedMouseMove: false },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: theme.up,
        downColor: theme.down,
        borderUpColor: theme.up,
        borderDownColor: theme.down,
        wickUpColor: theme.up,
        wickDownColor: theme.down,
      });
      candleSeries.setData(
        ohlcv.map((c) => ({
          time: c.time as never,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );

      // Volume on its own scale, pinned to the lower quarter of the pane.
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });
      volumeSeries.setData(
        ohlcv.map((c) => ({
          time: c.time as never,
          value: c.volume,
          color: c.close >= c.open ? `${theme.up}55` : `${theme.down}55`,
        })),
      );

      // EMA9 × EMA21 overlay — the same cross the backend reads for trend, drawn
      // so the up/down structure is visible on the chart itself. EMA9 above EMA21
      // and both rising is the uptrend footprint; the inverse is a downtrend.
      const emaLine = (period: number, color: string, title: string) => {
        const k = 2 / (period + 1);
        const points: { time: never; value: number }[] = [];
        let prev = 0;
        ohlcv.forEach((c, i) => {
          prev = i === 0 ? c.close : c.close * k + prev * (1 - k);
          if (i >= period - 1) points.push({ time: c.time as never, value: prev });
        });
        const series = chart.addLineSeries({
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title,
        });
        series.setData(points);
      };
      emaLine(9, theme.warning, "EMA9");
      emaLine(21, theme.text, "EMA21");

      // Support / resistance as horizontal lines on the candle series.
      for (const level of supportResistance) {
        candleSeries.createPriceLine({
          price: level.price,
          color: level.type === "support" ? theme.support : theme.resistance,
          lineWidth: 1,
          lineStyle: lib.LineStyle.Dotted,
          axisLabelVisible: true,
          title: level.type === "support"
            ? (isId ? "Support" : "Support")
            : (isId ? "Resisten" : "Resistance"),
        });
      }

      if (entryPrice != null) {
        candleSeries.createPriceLine({
          price: entryPrice,
          color: theme.up,
          lineWidth: 2,
          lineStyle: lib.LineStyle.Solid,
          axisLabelVisible: true,
          title: "Entry",
        });
      }

      if (stopLoss != null) {
        candleSeries.createPriceLine({
          price: stopLoss,
          color: theme.down,
          lineWidth: 2,
          lineStyle: lib.LineStyle.Dashed,
          axisLabelVisible: true,
          title: isId ? "Stop Loss" : "Stop Loss",
        });
      }

      // Unfilled gaps: mark the zone edges. A shaded band would need a custom
      // series primitive, and two thin lines read just as clearly at this size.
      for (const gap of gaps.filter((g) => !g.isFilled)) {
        for (const price of [gap.top, gap.bottom]) {
          candleSeries.createPriceLine({
            price,
            color: theme.warning,
            lineWidth: 1,
            lineStyle: lib.LineStyle.SparseDotted,
            axisLabelVisible: false,
            title: "",
          });
        }
      }

      chart.timeScale().fitContent();

      const resize = () => chart.applyOptions({ width: container.clientWidth });
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      cleanup = () => {
        resizeObserver.disconnect();
        chart.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [ohlcv, supportResistance, entryPrice, stopLoss, gaps, height, isId, themeTick]);

  if (failed) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "var(--muted-foreground)",
          background: "var(--muted)",
          borderRadius: 4,
        }}
      >
        {isId ? "Grafik tidak dapat dimuat" : "Chart could not be loaded"}
      </div>
    );
  }

  if (ohlcv.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "var(--muted-foreground)",
          background: "var(--muted)",
          borderRadius: 4,
        }}
      >
        {isId ? "Data harga belum tersedia" : "Price data not available"}
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
