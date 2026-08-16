import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { X, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { IDX_STOCKS } from "../data/idxData";
import type { PortfolioHolding } from "../hooks/usePortfolio";
import { LOT_MAX, PRICE_MAX } from "../constants";

export type ModalMode = "add" | "edit" | "delete";

interface Props {
  mode:          ModalMode;
  initialData?:  PortfolioHolding;
  currentPrice?: number;
  isId:          boolean;
  onSave:        (h: PortfolioHolding) => void;
  onRemove:      (symbol: string, price: number) => void;
  onClose:       () => void;
}

const SYMBOLS = IDX_STOCKS.map((s) => s.symbol);
const META = Object.fromEntries(IDX_STOCKS.map((s) => [s.symbol, s]));

function fieldStyle(hasError: boolean): CSSProperties {
  return {
    width: "100%",
    background: "var(--muted)",
    border: `1px solid ${hasError ? "var(--loss)" : "var(--border)"}`,
    borderRadius: 6,
    padding: "9px 12px",
    fontSize: 13,
    color: "var(--foreground)",
    fontFamily: "var(--font-mono)",
    outline: "none",
    boxSizing: "border-box",
  };
}

export function PositionModal({ mode, initialData, currentPrice, isId, onSave, onRemove, onClose }: Props) {
  const [symbol,   setSymbol]   = useState(initialData?.symbol  ?? SYMBOLS[0]);
  const [lots,     setLots]     = useState(initialData?.lots?.toString()     ?? "");
  const [avgPrice, setAvgPrice] = useState(initialData?.avgPrice?.toString() ?? "");
  const [errors,   setErrors]   = useState<Record<string, string>>({});

  /* Sync symbol → default price hint when in add mode and no price is entered yet */
  useEffect(() => {
    if (mode === "add") {
      const meta = META[symbol];
      if (meta && !avgPrice) setAvgPrice(meta.basePrice.toString());
    }
  }, [symbol, mode, avgPrice]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    const l = Number(lots);
    const p = Number(avgPrice);

    if (!lots || !Number.isFinite(l) || l <= 0 || !Number.isInteger(l)) {
      e.lots = isId
        ? "Lot harus bilangan bulat positif"
        : "Lots must be a positive whole number";
    } else if (l > LOT_MAX) {
      e.lots = isId
        ? `Lot maksimum ${LOT_MAX.toLocaleString()}`
        : `Maximum ${LOT_MAX.toLocaleString()} lots`;
    }

    if (!avgPrice || !Number.isFinite(p) || p <= 0) {
      e.avgPrice = isId ? "Harga harus positif" : "Price must be positive";
    } else if (p > PRICE_MAX) {
      e.avgPrice = isId
        ? `Harga maksimum Rp ${PRICE_MAX.toLocaleString("id-ID")}`
        : `Maximum price Rp ${PRICE_MAX.toLocaleString("id-ID")}`;
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    const meta = META[symbol];
    const safeLots  = Math.min(Math.max(1, Math.floor(Number(lots))),  LOT_MAX);
    const safePrice = Math.min(Math.max(1, Number(avgPrice)), PRICE_MAX);
    onSave({
      symbol,
      lots:     safeLots,
      avgPrice: safePrice,
      sector:   meta?.sector ?? "—",
    });
    onClose();
  }

  function handleRemove() {
    const price = currentPrice ?? parseFloat(avgPrice) ?? 0;
    onRemove(symbol, price);
    onClose();
  }

  const titleMap = {
    add:    isId ? "Tambah Posisi Baru"  : "Add New Position",
    edit:   isId ? "Edit Posisi"          : "Edit Position",
    delete: isId ? "Konfirmasi Hapus"     : "Confirm Remove",
  };
  const TitleIcon = mode === "add" ? Plus : mode === "edit" ? Pencil : Trash2;
  const iconColor = mode === "delete" ? "var(--loss)" : "var(--primary)";

  return (
    /* Backdrop */
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal box */}
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-2">
            <TitleIcon size={15} style={{ color: iconColor }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
              {titleMap[mode]}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px" }}>
          {mode === "delete" ? (
            /* Delete confirmation */
            <div>
              <div
                className="flex items-start gap-3 p-4 rounded mb-5"
                style={{ background: "var(--loss-bg)", border: "1px solid color-mix(in srgb, var(--loss) 25%, transparent)" }}
              >
                <AlertTriangle size={16} style={{ color: "var(--loss)", flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--loss)", marginBottom: 4 }}>
                    {isId ? `Hapus posisi ${initialData?.symbol}?` : `Remove position ${initialData?.symbol}?`}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                    {isId
                      ? `${initialData?.lots?.toLocaleString()} lot akan dijual pada harga saat ini (Rp ${currentPrice?.toLocaleString("id-ID") ?? "—"}) dan dihapus dari portofolio.`
                      : `${initialData?.lots?.toLocaleString()} lots will be sold at current price (Rp ${currentPrice?.toLocaleString("id-ID") ?? "—"}) and removed from portfolio.`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <ModalBtn secondary onClick={onClose}>{isId ? "Batal" : "Cancel"}</ModalBtn>
                <ModalBtn danger onClick={handleRemove}>{isId ? "Ya, Hapus" : "Yes, Remove"}</ModalBtn>
              </div>
            </div>
          ) : (
            /* Add / Edit form */
            <div className="flex flex-col gap-4">
              {/* Symbol */}
              <div>
                <label style={{ fontSize: 11, color: "var(--muted-foreground)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {isId ? "Kode Saham" : "Stock Symbol"}
                </label>
                {mode === "add" ? (
                  <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    style={{ ...fieldStyle(false), cursor: "pointer" }}
                  >
                    {SYMBOLS.map((s) => (
                      <option key={s} value={s}>
                        {s} — {META[s]?.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={{ ...fieldStyle(false), color: "var(--muted-foreground)", pointerEvents: "none" }}>
                    {symbol} — {META[symbol]?.name}
                  </div>
                )}
              </div>

              {/* Lots */}
              <div>
                <label style={{ fontSize: 11, color: "var(--muted-foreground)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {isId ? "Jumlah Lot" : "Number of Lots"}
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={lots}
                  onChange={(e) => setLots(e.target.value)}
                  placeholder={isId ? "mis. 100" : "e.g. 100"}
                  style={fieldStyle(!!errors.lots)}
                />
                {errors.lots && (
                  <div style={{ fontSize: 11, color: "var(--loss)", marginTop: 4 }}>{errors.lots}</div>
                )}
                {lots && !errors.lots && Number.isFinite(Number(lots)) && (
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>
                    = {(Math.floor(Number(lots)) * 100).toLocaleString("id-ID")} {isId ? "lembar saham" : "shares"}
                  </div>
                )}
              </div>

              {/* Avg price */}
              <div>
                <label style={{ fontSize: 11, color: "var(--muted-foreground)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {isId ? "Harga Rata-rata Beli (IDR)" : "Avg Buy Price (IDR)"}
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={avgPrice}
                  onChange={(e) => setAvgPrice(e.target.value)}
                  placeholder={isId ? "mis. 9850" : "e.g. 9850"}
                  style={fieldStyle(!!errors.avgPrice)}
                />
                {errors.avgPrice && (
                  <div style={{ fontSize: 11, color: "var(--loss)", marginTop: 4 }}>{errors.avgPrice}</div>
                )}
              </div>

              {/* Cost summary */}
              {lots && avgPrice && !errors.lots && !errors.avgPrice && (() => {
                const totalCost = Math.floor(Number(lots)) * 100 * Number(avgPrice);
                if (!Number.isFinite(totalCost)) return null;
                return (
                  <div
                    style={{
                      background: "var(--muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "10px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                      {isId ? "Total Biaya" : "Total Cost"}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                      Rp {totalCost.toLocaleString("id-ID")}
                    </span>
                  </div>
                );
              })()}

              <div className="flex gap-2 justify-end mt-1">
                <ModalBtn secondary onClick={onClose}>{isId ? "Batal" : "Cancel"}</ModalBtn>
                <ModalBtn onClick={handleSave}>{isId ? "Simpan" : "Save"}</ModalBtn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Button primitives ───────────────────────────────────────────────────── */

function ModalBtn({
  children, onClick, secondary, danger,
}: {
  children: ReactNode;
  onClick: () => void;
  secondary?: boolean;
  danger?: boolean;
}) {
  const bg = danger ? "var(--loss)" : secondary ? "var(--muted)" : "var(--primary)";
  const fg = danger || !secondary ? "#fff" : "var(--foreground)";
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 18px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        background: bg,
        color: fg,
        transition: "opacity 0.1s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
    >
      {children}
    </button>
  );
}
