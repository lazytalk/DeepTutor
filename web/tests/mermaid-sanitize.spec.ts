import { describe, expect, it } from "vitest";
import { sanitizeMindmapLabels } from "@/lib/mermaid-sanitize";

describe("sanitizeMindmapLabels", () => {
  it("quotes bare labels containing shape characters", () => {
    const src = "mindmap\n  root((Apps))\n    Extrema\n      f'(c) equals rate\n";
    const out = sanitizeMindmapLabels(src);
    expect(out).toContain('["f\'(c) equals rate"]');
    expect(out).toContain("root((Apps))");
    expect(out).toContain("    Extrema");
  });
  it("leaves non-mindmap charts untouched", () => {
    const src = "graph TD\n  a-->b\n";
    expect(sanitizeMindmapLabels(src)).toBe(src);
  });
});
