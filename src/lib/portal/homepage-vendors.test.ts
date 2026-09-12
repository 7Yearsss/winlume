import { describe, expect, it } from "vitest";
import { normalizePortalContent, toPublicPortalContent } from "./content-config";
import { homepageApiCategories } from "./homepage-vendors";

describe("published homepage providers", () => {
  it("does not restore hardcoded suppliers when no providers are published", () => {
    expect(homepageApiCategories([]).flatMap((row) => row.brands)).toEqual([]);
  });

  it("publishes enabled providers in their configured categories and hides disabled ones", () => {
    const vendor = { id: "demo", key: "demo", name: "自定义厂商", category: "image", logoUrl: "data:image/png;base64,aGVsbG8=", models: [{ name: "demo-image", endpointTypes: ["images"] }] };
    const content = toPublicPortalContent(normalizePortalContent({ modelVendors: [
      vendor, { ...vendor, id: "hidden", name: "未接入", enabled: false },
      { ...vendor, id: "video", category: "video" },
    ] }));
    const rows = homepageApiCategories(content.modelVendors);
    expect(rows.find((row) => row.id === "image")?.brands).toEqual([
      expect.objectContaining({ label: "自定义厂商", href: "/products?cate=api&brand=demo", description: "demo-image", icon: expect.stringContaining("/api/portal/image?") }),
    ]);
    expect(rows.find((row) => row.id === "video")?.brands).toHaveLength(1);
    expect(rows.flatMap((row) => row.brands).some((brand) => brand.label === "未接入")).toBe(false);
    expect(rows.find((row) => row.id === "llm")?.brands).toEqual([]);
  });
});
