import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AdvisorWidget } from "./AdvisorWidget";
import { parseSegments } from "./parseSegments";

/**
 * Renders one assistant answer: Markdown prose interleaved with interactive
 * `aidss:widget` blocks (see parseSegments for the streaming-safe splitting).
 */

// react-markdown element styling — matched to the dark quant theme. Kept inline
// so the chat needs no global stylesheet.
const MD_COMPONENTS = {
  p: (p: any) => <p style={{ margin: "0 0 8px", lineHeight: 1.6 }} {...p} />,
  h1: (p: any) => <h1 style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 6px" }} {...p} />,
  h2: (p: any) => <h2 style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 6px" }} {...p} />,
  h3: (p: any) => <h3 style={{ fontSize: 12.5, fontWeight: 600, margin: "8px 0 4px", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }} {...p} />,
  ul: (p: any) => <ul style={{ margin: "0 0 8px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }} {...p} />,
  ol: (p: any) => <ol style={{ margin: "0 0 8px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }} {...p} />,
  li: (p: any) => <li style={{ lineHeight: 1.5 }} {...p} />,
  strong: (p: any) => <strong style={{ fontWeight: 700, color: "var(--foreground)" }} {...p} />,
  a: (p: any) => <a style={{ color: "var(--primary)", textDecoration: "underline" }} target="_blank" rel="noreferrer" {...p} />,
  code: (p: any) => <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, background: "var(--muted)", borderRadius: 3, padding: "1px 4px" }} {...p} />,
  blockquote: (p: any) => <blockquote style={{ borderLeft: "2px solid var(--border)", margin: "0 0 8px", padding: "2px 0 2px 10px", color: "var(--muted-foreground)" }} {...p} />,
  table: (p: any) => (
    <div style={{ overflowX: "auto", margin: "0 0 8px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }} {...p} />
    </div>
  ),
  th: (p: any) => <th style={{ border: "1px solid var(--border)", padding: "4px 8px", textAlign: "left", background: "var(--muted)", fontWeight: 600 }} {...p} />,
  td: (p: any) => <td style={{ border: "1px solid var(--border)", padding: "4px 8px", fontFamily: "var(--font-mono)" }} {...p} />,
  hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "10px 0" }} />,
};

export const AdvisorMessage = memo(function AdvisorMessage({ content }: { content: string }) {
  const segments = parseSegments(content);
  return (
    <div style={{ fontSize: 12.5, color: "var(--foreground)" }}>
      {segments.map((seg, i) =>
        seg.kind === "widget" ? (
          <AdvisorWidget key={i} data={seg.data} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {seg.text}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
});
