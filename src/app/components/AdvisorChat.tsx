import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Square, RotateCcw, AlertTriangle } from "lucide-react";
import { useAdvisorChat } from "../hooks/useAdvisorChat";

/**
 * Q&A panel over the portfolio.
 *
 * The backend has streamed Claude responses since Phase 7; nothing on screen
 * ever called it. This is that surface.
 *
 * Answers stream token by token, so the panel scrolls itself and the send
 * control becomes a stop control while a reply is in flight — a long answer
 * should be interruptible rather than something to sit through.
 */

export interface AdvisorChatProps {
  locale?: "id" | "en";
}

const SUGGESTIONS = {
  id: [
    "Bagaimana profil risiko portofolio saya?",
    "Sektor mana yang paling overweight?",
    "Apa arti VaR 95% untuk posisi saya?",
  ],
  en: [
    "What is my portfolio's risk profile?",
    "Which sector am I most overweight in?",
    "What does 95% VaR mean for my positions?",
  ],
};

export function AdvisorChat({ locale = "id" }: AdvisorChatProps) {
  const isId = locale === "id";
  const { messages, streaming, isStreaming, error, send, reset, stop } =
    useAdvisorChat(locale);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Follow the stream as tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const submit = (text: string) => {
    if (!text.trim() || isStreaming) return;
    setDraft("");
    void send(text);
  };

  const hasConversation = messages.length > 0 || isStreaming;

  return (
    <div
      className="rounded flex flex-col"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <MessageSquare size={14} style={{ color: "var(--primary)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
          {isId ? "Tanya AI Advisor" : "Ask the AI Advisor"}
        </span>
        <span style={{ fontSize: 10, color: "var(--muted-foreground)", marginLeft: "auto" }}>
          {isId ? "Jawaban bersifat probabilistik" : "Answers are probabilistic"}
        </span>
        {hasConversation && (
          <button
            onClick={reset}
            title={isId ? "Mulai ulang" : "Reset"}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--muted-foreground)", padding: 2, display: "flex",
            }}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex flex-col gap-3 px-5 py-4"
        style={{ maxHeight: 300, overflowY: "auto", minHeight: 120 }}
      >
        {!hasConversation && !error && (
          <div className="flex flex-col gap-2">
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              {isId ? "Coba tanyakan:" : "Try asking:"}
            </div>
            {SUGGESTIONS[isId ? "id" : "en"].map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="rounded px-3 py-2"
                style={{
                  background: "var(--muted)",
                  border: "1px solid var(--border)",
                  color: "var(--foreground)",
                  fontSize: 12,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className="rounded px-3 py-2"
            style={{
              background: m.role === "user" ? "var(--muted)" : "transparent",
              border: m.role === "user" ? "1px solid var(--border)" : "none",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "88%",
            }}
          >
            <div
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--muted-foreground)",
                marginBottom: 3,
                fontFamily: "var(--font-mono)",
              }}
            >
              {m.role === "user" ? (isId ? "Anda" : "You") : "AIDSS"}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--foreground)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div style={{ maxWidth: "88%" }}>
            <div
              style={{
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em",
                color: "var(--muted-foreground)", marginBottom: 3,
                fontFamily: "var(--font-mono)",
              }}
            >
              AIDSS
            </div>
            <div style={{ fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {streaming || (isId ? "Menyusun jawaban…" : "Thinking…")}
            </div>
          </div>
        )}

        {error && (
          <div
            className="flex items-start gap-2 rounded px-3 py-2"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <AlertTriangle size={12} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: "var(--foreground)", lineHeight: 1.5 }}>
              {error}
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
          placeholder={isId ? "Tanya tentang portofolio Anda…" : "Ask about your portfolio…"}
          disabled={isStreaming}
          style={{
            flex: 1,
            background: "var(--input-background, var(--muted))",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "7px 10px",
            fontSize: 12.5,
            color: "var(--foreground)",
            fontFamily: "var(--font-sans)",
            outline: "none",
          }}
        />
        <button
          onClick={() => (isStreaming ? stop() : submit(draft))}
          disabled={!isStreaming && !draft.trim()}
          title={isStreaming ? (isId ? "Hentikan" : "Stop") : (isId ? "Kirim" : "Send")}
          style={{
            background: isStreaming ? "var(--loss)" : "var(--primary)",
            color: isStreaming ? "#fff" : "var(--primary-foreground)",
            border: "none",
            borderRadius: 4,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: !isStreaming && !draft.trim() ? "not-allowed" : "pointer",
            opacity: !isStreaming && !draft.trim() ? 0.45 : 1,
          }}
        >
          {isStreaming ? <Square size={12} /> : <Send size={13} />}
        </button>
      </div>
    </div>
  );
}
