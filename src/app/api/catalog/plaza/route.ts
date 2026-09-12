import { NextResponse } from "next/server";
import { getGatewayBaseUrl } from "@/lib/agent/provider/gateway";
import { getCurrentUserId } from "@/lib/auth/session";
import { resolveStudioToken } from "@/lib/agent/provider/studio-token";
import { getAuthMode } from "@/lib/platform/auth";
import { inferVendorFromModel, PLAZA_VENDORS } from "@/lib/catalog/vendors";
import type { PlazaModel } from "@/lib/catalog";
import { getPublicPortalContent } from "@/lib/portal/content-config";
import { publishedCatalog } from "@/lib/portal/published-catalog";
import { PlatformAdminError, requirePlatformAdmin } from "@/lib/platform/admin";
import { applyActualPricing, readNewApiPricing } from "@/lib/newapi/pricing";

type NativeModelsPayload = {
  data?: Array<{ id?: unknown; owned_by?: unknown }>;
};

/**
 * Directory fallback used when the live gateway is temporarily unavailable.
 * It keeps the public model catalogue useful instead of rendering a blank page.
 * Live `/v1/models` data still takes priority whenever it is available.
 */
const FALLBACK_MODELS: Array<{ name: string; vendor: string; endpoint: string[]; ratio?: number; completion?: number }> = [
  { name: "gpt-5.6-sol", vendor: "openai", endpoint: ["chat", "responses", "tools"], ratio: 1.8, completion: 4 },
  { name: "gpt-4.1", vendor: "openai", endpoint: ["chat", "responses", "tools"], ratio: 0.7, completion: 2.8 },
  { name: "gpt-4o", vendor: "openai", endpoint: ["chat", "vision", "tools"], ratio: 0.5, completion: 1.8 },
  { name: "o3", vendor: "openai", endpoint: ["chat", "reasoning", "tools"], ratio: 2, completion: 8 },
  { name: "text-embedding-3-large", vendor: "openai", endpoint: ["embeddings"], ratio: 0.13 },
  { name: "dall-e-3", vendor: "openai", endpoint: ["images"], ratio: 3.5 },
  { name: "whisper-1", vendor: "openai", endpoint: ["audio"], ratio: 0.2 },
  { name: "claude-3.7-sonnet", vendor: "anthropic", endpoint: ["chat", "tools"], ratio: 1.4, completion: 4.2 },
  { name: "claude-sonnet-4", vendor: "anthropic", endpoint: ["chat", "vision", "tools"], ratio: 1.5, completion: 5 },
  { name: "claude-opus-4", vendor: "anthropic", endpoint: ["chat", "vision", "tools"], ratio: 3, completion: 12 },
  { name: "claude-haiku-3.5", vendor: "anthropic", endpoint: ["chat", "vision"], ratio: 0.25, completion: 1.25 },
  { name: "gemini-2.5-pro", vendor: "google", endpoint: ["chat", "vision", "tools"], ratio: 1.1, completion: 3.4 },
  { name: "gemini-2.5-flash", vendor: "google", endpoint: ["chat", "vision", "tools"], ratio: 0.35, completion: 1.05 },
  { name: "imagen-4", vendor: "google", endpoint: ["images"], ratio: 3.2 },
  { name: "veo-3", vendor: "google", endpoint: ["video"], ratio: 8 },
  { name: "grok-3", vendor: "xai", endpoint: ["chat", "tools"], ratio: 1.2, completion: 3.6 },
  { name: "grok-4", vendor: "xai", endpoint: ["chat", "vision", "tools"], ratio: 2.2, completion: 6.6 },
  { name: "grok-3-mini", vendor: "xai", endpoint: ["chat", "reasoning"], ratio: 0.45, completion: 1.35 },
  { name: "deepseek-v3", vendor: "deepseek", endpoint: ["chat", "reasoning"], ratio: 0.3, completion: 1.1 },
  { name: "deepseek-r1", vendor: "deepseek", endpoint: ["chat", "reasoning"], ratio: 0.6, completion: 2.2 },
  { name: "deepseek-v3.2", vendor: "deepseek", endpoint: ["chat", "tools"], ratio: 0.38, completion: 1.35 },
  { name: "qwen2.5-max", vendor: "alibaba", endpoint: ["chat", "vision", "tools"], ratio: 0.45, completion: 1.5 },
  { name: "qwen3-max", vendor: "alibaba", endpoint: ["chat", "reasoning", "tools"], ratio: 0.7, completion: 2.1 },
  { name: "qwen-vl-max", vendor: "alibaba", endpoint: ["chat", "vision"], ratio: 0.55, completion: 1.65 },
  { name: "qwen-image", vendor: "alibaba", endpoint: ["images"], ratio: 2.9 },
  { name: "glm-4-plus", vendor: "zhipu", endpoint: ["chat", "tools"], ratio: 0.4, completion: 1.2 },
  { name: "glm-4.6", vendor: "zhipu", endpoint: ["chat", "reasoning", "tools"], ratio: 0.55, completion: 1.7 },
  { name: "glm-4.5v", vendor: "zhipu", endpoint: ["chat", "vision"], ratio: 0.5, completion: 1.5 },
  { name: "cogview-4", vendor: "zhipu", endpoint: ["images"], ratio: 2.6 },
  { name: "kimi-k2", vendor: "moonshot", endpoint: ["chat", "tools"], ratio: 0.55, completion: 1.7 },
  { name: "kimi-latest", vendor: "moonshot", endpoint: ["chat", "vision", "tools"], ratio: 0.5, completion: 1.55 },
  { name: "minimax-01", vendor: "minimax", endpoint: ["chat", "vision"], ratio: 0.5, completion: 1.5 },
  { name: "minimax-m2", vendor: "minimax", endpoint: ["chat", "reasoning", "tools"], ratio: 0.58, completion: 1.75 },
  { name: "minimax-speech-02", vendor: "minimax", endpoint: ["audio"], ratio: 0.24 },
  { name: "ernie-4.5", vendor: "baidu", endpoint: ["chat", "tools"], ratio: 0.48, completion: 1.4 },
  { name: "ernie-x1", vendor: "baidu", endpoint: ["chat", "reasoning"], ratio: 0.52, completion: 1.6 },
  { name: "doubao-pro", vendor: "bytedance", endpoint: ["chat", "vision"], ratio: 0.38, completion: 1.2 },
  { name: "doubao-seed-1.6", vendor: "bytedance", endpoint: ["chat", "vision", "tools"], ratio: 0.48, completion: 1.45 },
  { name: "hunyuan-turbos", vendor: "tencent", endpoint: ["chat", "vision"], ratio: 0.4, completion: 1.2 },
  { name: "hunyuan-image-3.0", vendor: "tencent", endpoint: ["images"], ratio: 2.7 },
  { name: "hunyuan-video", vendor: "tencent", endpoint: ["video"], ratio: 6.4 },
  { name: "baichuan4-turbo", vendor: "baichuan", endpoint: ["chat"], ratio: 0.32, completion: 1 },
  { name: "step-2-mini", vendor: "stepfun", endpoint: ["chat", "vision"], ratio: 0.35, completion: 1.1 },
  { name: "command-r-plus", vendor: "cohere", endpoint: ["chat", "rag", "tools"], ratio: 0.65, completion: 2 },
  { name: "jina-embeddings-v3", vendor: "jina", endpoint: ["embeddings", "rerank"], ratio: 0.18 },
  { name: "flux-1.1-pro", vendor: "black-forest", endpoint: ["images"], ratio: 3.5 },
  { name: "stable-diffusion-3.5", vendor: "stability", endpoint: ["images"], ratio: 2.8 },
  { name: "llama-3.3-70b", vendor: "meta", endpoint: ["chat"], ratio: 0.35, completion: 1 },
  { name: "llama-4-maverick", vendor: "meta", endpoint: ["chat", "vision", "tools"], ratio: 0.5, completion: 1.5 },
  { name: "mistral-large-2", vendor: "mistral", endpoint: ["chat", "tools"], ratio: 0.62, completion: 1.8 },
  { name: "codestral", vendor: "mistral", endpoint: ["chat", "code"], ratio: 0.42, completion: 1.3 },
  { name: "copilot-vision", vendor: "microsoft", endpoint: ["chat", "vision"], ratio: 0.7, completion: 2 },
  { name: "phi-4", vendor: "microsoft", endpoint: ["chat", "reasoning"], ratio: 0.28, completion: 0.9 },
];

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function plazaResponse(
  models: PlazaModel[],
  vendors: Array<{ id: number; name: string; key?: string; logo?: string }>,
) {
  return NextResponse.json(
    { success: true, data: models, vendors },
    { headers: { "cache-control": "no-store" } },
  );
}

function curatedModels(catalogOnly = false): PlazaModel[] {
  const vendorByKey = new Map(PLAZA_VENDORS.map((vendor) => [vendor.key, vendor]));
  return FALLBACK_MODELS.flatMap((item) => {
    const vendor = vendorByKey.get(item.vendor);
    if (!vendor) return [];
    return [{
      model_name: item.name,
      catalog_only: catalogOnly,
      vendor_id: vendor.id,
      vendor_key: vendor.key,
      vendor_name: vendor.name,
      vendor_logo: vendor.logo,
      quota_type: item.endpoint.includes("images") ? 1 : 0,
      model_price: item.endpoint.includes("images") ? 0.08 : 0,
      model_ratio: item.ratio ?? 1,
      completion_ratio: item.completion ?? 1,
      supported_endpoint_types: item.endpoint,
    }];
  });
}

async function fallbackPlaza() {
  const models = await mergePortalManagedModels(curatedModels(true));
  return plazaResponse(models, PLAZA_VENDORS.map((vendor) => ({
    id: vendor.id, name: vendor.name, key: vendor.key, logo: vendor.logo,
  })));
}

function mergeLiveAndCuratedModels(liveModels: PlazaModel[]) {
  const names = new Set(liveModels.map((model) => model.model_name.trim().toLowerCase()));
  const curated = curatedModels(true).filter((model) => !names.has(model.model_name.toLowerCase()));
  return [...liveModels, ...curated];
}

async function mergePortalManagedModels(models: PlazaModel[]) {
  const content = await getPublicPortalContent();
  const known = new Set(models.map((model) => model.model_name.trim().toLowerCase()));
  const managed = content.modelVendors
    .filter((vendor) => vendor.enabled)
    .flatMap((vendor) => vendor.models.map((model) => ({
      model_name: model.name,
      portal_category: vendor.category,
      vendor_key: vendor.key,
      vendor_name: vendor.name,
      vendor_logo: vendor.logoUrl,
      quota_type: ["images", "video", "audio"].some((type) => model.endpointTypes.includes(type)) ? 1 : 0,
      model_price: 0,
      model_ratio: 1,
      completion_ratio: 1,
      supported_endpoint_types: model.endpointTypes,
    } satisfies PlazaModel)))
    .filter((model) => !known.has(model.model_name.toLowerCase()));
  return [...models, ...managed];
}

async function legacyPlaza(): Promise<Response> {
  const gatewayUrl = process.env.NEW_API_URL?.trim();
  if (!gatewayUrl) {
    return NextResponse.json({ success: false, message: "旧模型广场未配置。" }, { status: 503 });
  }
  try {
    const upstream = await fetch(`${trimUrl(gatewayUrl)}/api/pricing`, { cache: "no-store" });
    const body = await upstream.text();
    return new NextResponse(body || JSON.stringify({ success: false, message: "模型广场暂时没有返回数据。" }), {
      status: body ? upstream.status : 502,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "模型广场暂时不可访问。" }, { status: 502 });
  }
}

/**
 * List models from new-api (via getGatewayBaseUrl: REIZO_GATEWAY_URL → NEW_API_URL → localhost).
 * Pricing-catalog tables were dropped with the billing engine; prices come from new-api when available.
 */
async function modelsPlaza(): Promise<Response> {
  const gatewayUrl = getGatewayBaseUrl();
  let authToken =
    process.env.REIZO_SERVICE_KEY?.trim() ||
    process.env.REIZO_GATEWAY_TOKEN?.trim() ||
    process.env.NEW_API_ADMIN_TOKEN?.trim() ||
    "";
  const userId = await getCurrentUserId();
  if (userId) {
    try {
      authToken = await resolveStudioToken(userId);
    } catch {
      // Fall back to the server-level token for unauthenticated/public callers.
    }
  }
  const headers: Record<string, string> = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  try {
    const upstream = await fetch(`${gatewayUrl}/v1/models`, {
      headers,
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json({ success: false, message: "Reizo 模型目录暂时不可访问。" }, { status: 502 });
    }
    const payload = (await upstream.json().catch(() => null)) as NativeModelsPayload | null;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const models: PlazaModel[] = rows.flatMap((row) => {
      const modelName = typeof row.id === "string" ? row.id.trim() : "";
      if (!modelName) return [];
      const vendor = inferVendorFromModel(modelName);
      return [
        {
          model_name: modelName,
          vendor_id: vendor.id,
          vendor_key: vendor.key,
          vendor_name: vendor.name,
          vendor_logo: vendor.logo,
          quota_type: 0,
          model_price: 0,
          model_ratio: 1,
          completion_ratio: 1,
          supported_endpoint_types: ["openai"],
        },
      ];
    });
    return plazaResponse(
      await mergePortalManagedModels(mergeLiveAndCuratedModels(models)),
      PLAZA_VENDORS.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        key: vendor.key,
        logo: vendor.logo,
      })),
    );
  } catch {
    return NextResponse.json({ success: false, message: "Reizo 模型目录暂时不可访问。" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const isImport = new URL(request.url).searchParams.get("scope") === "admin-import";
  if (!isImport) {
    const [content, pricing] = await Promise.all([
      getPublicPortalContent(), readNewApiPricing().catch(() => null),
    ]);
    const models = publishedCatalog(pricing?.models ?? [], content.modelVendors);
    return plazaResponse(pricing ? applyActualPricing(models, pricing) : models.map(model => ({ ...model, pricing_unavailable: true })), []);
  }
  if (isImport) {
    try { await requirePlatformAdmin(); }
    catch (error) {
      return NextResponse.json({ success: false, message: "仅管理员可导入完整目录。" }, { status: error instanceof PlatformAdminError ? error.status : 500 });
    }
  }
  const response = await (getAuthMode() === "legacy" ? legacyPlaza() : modelsPlaza());
  // The directory is public product content. A temporarily unavailable gateway
  // must not erase its vendor and model information from the client.
  const catalog = response.ok ? response : await fallbackPlaza();
  return catalog;
}
