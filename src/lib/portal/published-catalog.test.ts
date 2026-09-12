import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { publishedCatalog } from "./published-catalog";
import { normalizePortalContent } from "./content-config";
import { PLAZA_VENDORS } from "@/lib/catalog/vendors";
import { filterPlazaModels, vendorsPresentIn } from "@/lib/catalog/plaza-filters";

const models = ["image-one", "hidden-model", "sample-model"].map((model_name) => ({ model_name, vendor_key: "openai", quota_type: 0, model_price: 0, model_ratio: 2.4 }));
const config = normalizePortalContent({ modelVendors: [
  { id: "enabled", key: "custom", name: "自定义提供商", logoUrl: "/custom.svg", category: "image", models: [{ name: "image-one", endpointTypes: ["images"] }] },
  { id: "hidden", key: "openai", name: "OpenAI", enabled: false, models: [{ name: "hidden-model" }] },
] });

describe("published model directory", () => {
  it("excludes hidden and unconfigured live/sample models and preserves prices", () => {
    const result = publishedCatalog(models, config.modelVendors);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ model_name: "image-one", vendor_key: "custom", vendor_name: "自定义提供商", vendor_logo: "/custom.svg", portal_category: "image", model_ratio: 2.4 });
    expect(publishedCatalog(models, [])).toEqual([]);
    expect(publishedCatalog(models, config.modelVendors.map((v) => ({ ...v, enabled: false })))).toEqual([]);
  });
  it("keeps custom branding in recommendations and respects category filters", () => {
    const result = publishedCatalog(models, config.modelVendors);
    expect(vendorsPresentIn(filterPlazaModels(result, { capability: "image" }))).toEqual([
      expect.objectContaining({ key: "custom", brandLabel: "自定义提供商", logo: "/custom.svg", count: 1 }),
    ]);
    expect(vendorsPresentIn(filterPlazaModels(result, { capability: "llm" }))).toEqual([]);
  });
  it("retains every preset icon locally and matches missing icons when saving", () => {
    for (const vendor of PLAZA_VENDORS) {
      expect(existsSync(join(process.cwd(), "public", vendor.logo))).toBe(true);
      const content = normalizePortalContent({ modelVendors: [{ ...config.modelVendors[0], key: vendor.key, logoUrl: "" }] });
      expect(content.modelVendors[0].logoUrl).toBe(vendor.logo);
    }
  });
});
