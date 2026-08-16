import type { CSSProperties } from "react";

/** Pulsing placeholder used while async data hooks are fetching. */
export function ViewSkeleton({ rows = 4, label }: { rows?: number; label?: string }) {
  const cols = Math.min(rows, 4);
  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
      {/* Metric strip */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            className="rounded p-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)", height: 72 }}
          >
            <Pulse width="40%" height={10} />
            <Pulse width="70%" height={18} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>

      {/* Card rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded p-5 flex flex-col gap-3"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-4">
            <Pulse width={56} height={56} style={{ borderRadius: "50%", flexShrink: 0 }} />
            <div className="flex-1 flex flex-col gap-2">
              <Pulse width="35%" height={12} />
              <Pulse width="80%" height={10} />
              <Pulse width="55%" height={10} />
            </div>
          </div>
        </div>
      ))}

      {label && (
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>
          {label}
        </div>
      )}
    </div>
  );
}

function Pulse({ width, height, style }: { width: number | string; height: number; style?: CSSProperties }) {
  return (
    <div
      className="animate-pulse"
      style={{
        width,
        height,
        borderRadius: 4,
        background: "var(--muted)",
        ...style,
      }}
    />
  );
}
