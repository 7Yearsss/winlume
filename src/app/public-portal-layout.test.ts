import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("public portal layout contract", () => {
  const globalStyles = readFileSync(join(__dirname, "globals.css"), "utf8");
  const docsStyles = readFileSync(join(__dirname, "docs", "docs.css"), "utf8");

  it("uses a fixed canvas and scrollbar overflow instead of responsive shrinking", () => {
    expect(globalStyles).toContain("--reizo-public-canvas: 1500px");
    expect(globalStyles).toContain("body {\n  overflow-x: auto;\n}");
    expect(globalStyles).toContain("width: var(--reizo-public-canvas) !important");
    expect(globalStyles).toContain("transform: none !important");
    expect(globalStyles).toContain("grid-template-columns: var(--portal-dashboard-columns) !important");
  });

  it("defines the shared public type scale for portal and docs pages", () => {
    for (const token of [
      "--reizo-font-page: 38px",
      "--reizo-font-section: 24px",
      "--reizo-font-card: 18px",
      "--reizo-font-body: 16px",
      "--reizo-font-control: 15px",
      "--reizo-font-meta: 13px",
      "--reizo-font-micro: 12px",
      "--reizo-font-metric: 28px",
    ]) {
      expect(globalStyles).toContain(token);
    }
    expect(docsStyles).toContain("var(--reizo-public-canvas)");
    expect(docsStyles).toContain("var(--reizo-font-page)");
    expect(docsStyles).toContain("var(--reizo-font-body)");
  });

  it("keeps legacy public marketing and enterprise surfaces on fixed canvases", () => {
    expect(globalStyles).toContain(".marketing-public-shell");
    expect(globalStyles).toContain(".marketing-product-detail-grid");
    expect(readFileSync(join(__dirname, "..", "components", "enterprise", "EnterprisePortal.tsx"), "utf8")).toContain("fixedCanvas");
  });
});
