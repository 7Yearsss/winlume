import {
  filterProducts,
  getProduct,
  products,
  relatedProducts,
  type Product,
  type ProductFilter,
} from "@/data/products";

export interface CatalogService {
  list(filter?: ProductFilter): Promise<Product[]>;
  byId(id: string): Promise<Product | undefined>;
  related(product: Product, count?: number): Promise<Product[]>;
}

/** Interactive frontend features use this adapter instead of mock-data imports. */
export const catalog: CatalogService = {
  async list(filter = {}) { return filterProducts(filter); },
  async byId(id) { return getProduct(id); },
  async related(product, count) { return relatedProducts(product, count); },
};

export async function searchCatalog(query: string, limit = 8): Promise<Product[]> {
  const normalized = query.trim().toLowerCase();
  const source = normalized ? products : products.filter((product) => product.isNew);
  return source
    .filter((product) => {
      if (!normalized) return true;
      return `${product.name} ${product.brand} ${product.tagline}`.toLowerCase().includes(normalized);
    })
    .slice(0, limit);
}

/* ── 公开模型广场 ───────────────────────────────────────────── */

export interface PlazaModel {
  model_name: string;
  /** Portal-admin category override: llm / image / audio / video / embed / other. */
  portal_category?: "llm" | "image" | "audio" | "video" | "embed" | "other";
  /** Curated directory entry when the provider is not configured in the live gateway. */
  catalog_only?: boolean;
  vendor_id?: number;
  /** Stable vendor key, e.g. openai / anthropic */
  vendor_key?: string;
  vendor_name?: string;
  /** Public or CDN path to the vendor brand mark. */
  vendor_logo?: string;
  quota_type: number;
  /** Fixed USD price when quota_type === 1 / mode fixed */
  model_price: number;
  model_ratio: number;
  completion_ratio?: number;
  enable_groups?: string[];
  supported_endpoint_types?: string[];
  /** ratio | fixed | tiered_expr from pricing_model_rules */
  pricing_mode?: string;
  /**
   * Catalog quota_per_unit (new-api style: 500000 quota ≈ $1).
   * Used to turn model_ratio into a currency price.
   */
  quota_per_unit?: number;
  /**
   * Effective group_ratio for plaza list price.
   * Resolved from model_availability × pricing_group_rules (best/lowest enabled
   * group when several apply). Defaults to 1 when the model has no group map.
   */
  group_ratio?: number;
  /** Billing group that produced group_ratio (for display/debug) */
  billing_group?: string;
  /** True when multiple groups exist and we show the lowest (「起」) */
  group_ratio_is_min?: boolean;
}

export interface PlazaVendorInfo {
  id: number;
  name: string;
  key?: string;
  logo?: string;
}

export interface PlazaData {
  models: PlazaModel[];
  total: number;
  /** id → display name (kept for existing callers) */
  vendors: Record<number, string>;
  /** Full vendor metadata including logo paths */
  vendorDetails: Record<number, PlazaVendorInfo>;
}

interface PlazaResponse {
  success: boolean;
  message?: string;
  data?: PlazaModel[];
  vendors?: PlazaVendorInfo[];
}

const PLAZA_CACHE_TTL = 60_000;
let plazaCache: { data: PlazaData; expires: number } | null = null;
let plazaInFlight: Promise<PlazaData> | null = null;

/**
 * 同页多个组件需要广场数据时共享同一次请求，
 * 成功后短缓存 60s；失败不缓存，下次调用自然重试。
 */
export function fetchPlaza(options: { fresh?: boolean } = {}): Promise<PlazaData> {
  if (!options.fresh && plazaCache && plazaCache.expires > Date.now()) return Promise.resolve(plazaCache.data);
  if (plazaInFlight) return plazaInFlight;
  plazaInFlight = (async () => {
    try {
      const response = await fetch("/api/catalog/plaza", { cache: "no-store" });
      const payload = (await response.json()) as PlazaResponse;
      if (!response.ok || !payload.success) throw new Error(payload.message || "模型广场暂时不可访问。");
      const models = payload.data ?? [];
      const vendorList = payload.vendors ?? [];
      const data: PlazaData = {
        models,
        total: models.length,
        vendors: Object.fromEntries(vendorList.map((vendor) => [vendor.id, vendor.name])),
        vendorDetails: Object.fromEntries(
          vendorList.map((vendor) => [
            vendor.id,
            {
              id: vendor.id,
              name: vendor.name,
              key: vendor.key,
              logo: vendor.logo,
            },
          ]),
        ),
      };
      plazaCache = { data, expires: Date.now() + PLAZA_CACHE_TTL };
      return data;
    } finally {
      plazaInFlight = null;
    }
  })();
  return plazaInFlight;
}
