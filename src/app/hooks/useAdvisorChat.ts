import { useCallback, useRef, useState } from "react";
import { USE_LIVE_API, ENDPOINTS } from "../config/api";

/**
 * Streaming Q&A against the backend advisor.
 *
 * The backend has streamed Claude responses at POST /v1/advisor/chat since
 * Phase 7 — the frontend simply never called it. This hook closes that gap.
 *
 * Server-sent events, not a plain fetch: the endpoint emits `data: {...}` lines
 * as tokens arrive, so the answer appears progressively instead of after a
 * multi-second silence.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AdvisorChatResult {
  messages: ChatMessage[];
  /** Tokens received so far for the in-flight reply. Empty when idle. */
  streaming: string;
  isStreaming: boolean;
  error: string | null;
  send: (question: string) => Promise<void>;
  reset: () => void;
  stop: () => void;
}

/** One `data:` frame from the SSE stream. */
interface StreamChunk {
  type: "delta" | "done" | "error";
  content: string;
}

const OFFLINE_NOTICE = {
  id: "AI Advisor memerlukan koneksi ke backend. Jalankan server API terlebih dahulu.",
  en: "AI Advisor requires a backend connection. Start the API server first.",
};

export function useAdvisorChat(locale: "id" | "en" = "id"): AdvisorChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setStreaming("");
    setError(null);
  }, [stop]);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isStreaming) return;

      if (!USE_LIVE_API) {
        setError(locale === "id" ? OFFLINE_NOTICE.id : OFFLINE_NOTICE.en);
        return;
      }

      // History excludes the message being sent — the backend appends it.
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setStreaming("");
      setError(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(ENDPOINTS.advisorChat, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, history, locale, uid: "default" }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assembled = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. Keep the trailing
          // fragment in the buffer — a chunk boundary can split a frame.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;

            let chunk: StreamChunk;
            try {
              chunk = JSON.parse(line.slice(5).trim());
            } catch {
              continue; // partial or malformed frame
            }

            if (chunk.type === "delta") {
              assembled += chunk.content;
              setStreaming(assembled);
            } else if (chunk.type === "error") {
              // Surfaced verbatim: the backend already explains a missing
              // ANTHROPIC_API_KEY in the user's language.
              setError(chunk.content);
            }
          }
        }

        if (assembled) {
          setMessages((prev) => [...prev, { role: "assistant", content: assembled }]);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        setStreaming("");
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming, locale],
  );

  return { messages, streaming, isStreaming, error, send, reset, stop };
}
