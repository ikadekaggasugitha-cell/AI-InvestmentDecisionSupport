import { describe, it, expect } from "vitest";
import { parseSegments } from "./parseSegments";

describe("parseSegments", () => {
  it("extracts an unfenced widget the model emits without backticks", () => {
    // gpt-oss frequently drops the code fence and writes the marker inline.
    const content =
      "Ringkasan risiko.\n\naidss:widget\n{\"type\":\"metric_tiles\",\"items\":[{\"label\":\"VaR\",\"value\":\"-384jt\"}]}\n\nSekian.";
    const segs = parseSegments(content);
    expect(segs.map((s) => s.kind)).toEqual(["md", "widget", "md"]);
    expect((segs[1] as any).data.type).toBe("metric_tiles");
    expect((segs[0] as any).text).toContain("Ringkasan risiko");
    expect((segs[2] as any).text).toContain("Sekian");
  });

  it("extracts a fenced ```aidss:widget block and drops the fences", () => {
    const content =
      "Teks.\n```aidss:widget\n{\"type\":\"signal_gauge\",\"symbol\":\"BBCA\",\"uprob\":82,\"tier\":\"HIGH\"}\n```\nLanjutan.";
    const segs = parseSegments(content);
    expect(segs.map((s) => s.kind)).toEqual(["md", "widget", "md"]);
    expect((segs[1] as any).data.symbol).toBe("BBCA");
    // The opening fence must not bleed into the preceding prose.
    expect((segs[0] as any).text).not.toContain("`");
  });

  it("handles multiple widgets in one answer", () => {
    const content =
      "aidss:widget\n{\"type\":\"risk_radar\",\"items\":[]}\nlalu\naidss:widget\n{\"type\":\"allocation\",\"items\":[]}";
    const segs = parseSegments(content);
    expect(segs.filter((s) => s.kind === "widget")).toHaveLength(2);
  });

  it("holds back a widget whose JSON is still streaming (no closing brace)", () => {
    const content = "Sebelum.\n\naidss:widget\n{\"type\":\"shap\",\"factors\":[{\"label\":\"Fund";
    const segs = parseSegments(content);
    // Only the prose before the incomplete block renders; nothing raw leaks.
    expect(segs.map((s) => s.kind)).toEqual(["md"]);
    expect((segs[0] as any).text).toContain("Sebelum");
    expect((segs[0] as any).text).not.toContain("aidss:widget");
  });

  it("holds back a partial marker at the end of the stream", () => {
    const content = "Jawaban sedang mengetik aidss:wid";
    const segs = parseSegments(content);
    expect(segs).toHaveLength(1);
    expect((segs[0] as any).text).not.toContain("aidss");
    expect((segs[0] as any).text.trim()).toBe("Jawaban sedang mengetik");
  });

  it("skips a completed block with malformed JSON instead of throwing", () => {
    const content = "x\naidss:widget\n{not valid json}\ny";
    const segs = parseSegments(content);
    expect(segs.some((s) => s.kind === "widget")).toBe(false);
    expect(segs.map((s) => (s as any).text ?? "").join(" ")).toContain("y");
  });

  it("ignores braces inside string values when matching the object", () => {
    const content = "aidss:widget\n{\"type\":\"metric_tiles\",\"title\":\"a{b}c\",\"items\":[]}\nend";
    const segs = parseSegments(content);
    expect((segs[0] as any).data.title).toBe("a{b}c");
    expect((segs[1] as any).text).toContain("end");
  });
});
