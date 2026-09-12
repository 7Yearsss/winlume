import type { PlazaModel } from "@/lib/catalog";
import { resolvePlazaVendor } from "./plaza-display";

/** Capability facets for the live pricing catalog (not the old static product brands). */
export type PlazaCapabilityFilter =
  | "all"
  | "llm"
  | "image"
  | "video"
  | "audio"
  | "embed"
  | "other";

export const PLAZA_CAPABILITY_FILTERS: Array<{ id: PlazaCapabilityFilter; label: string }> = [
  { id: "all", label: "全部能力" },
  { id: "llm", label: "语言大模型" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "语音" },
  { id: "embed", label: "Embedding" },
  { id: "other", label: "其他" },
];

export function modelCapability(model: PlazaModel): PlazaCapabilityFilter {
  if (model.portal_category) return model.portal_category;
  const name = model.model_name.toLowerCase();
  if (
    name.includes("image") ||
    name.includes("dall") ||
    name.includes("flux") ||
    name.includes("imagen") ||
    name.includes("banana") ||
    name.includes("midjourney") ||
    name.includes("sdxl")
  ) {
    return "image";
  }
  if (name.includes("video") || name.includes("kling") || name.includes("runway") || name.includes("sora")) {
    return "video";
  }
  if (
    name.includes("tts") ||
    name.includes("speech") ||
    name.includes("whisper") ||
    name.includes("audio") ||
    name.includes("voice")
  ) {
    return "audio";
  }
  if (name.includes("embed")) {
    return "embed";
  }
  if (
    name.includes("gpt") ||
    name.includes("claude") ||
    name.includes("gemini") ||
    name.includes("grok") ||
    name.includes("qwen") ||
    name.includes("deepseek") ||
    name.includes("llama") ||
    name.includes("mistral") ||
    name.includes("kimi") ||
    name.includes("moonshot") ||
    name.includes("glm") ||
    name.includes("chat") ||
    name.includes("o1") ||
    name.includes("o3") ||
    name.includes("o4")
  ) {
    return "llm";
  }
  return "other";
}

export function filterPlazaModels(
  models: PlazaModel[],
  options: {
    query?: string;
    vendorKey?: string;
    capability?: PlazaCapabilityFilter;
  },
): PlazaModel[] {
  const q = options.query?.trim().toLowerCase() ?? "";
  const vendorKey = options.vendorKey?.trim() || undefined;
  const capability = options.capability ?? "all";

  return models.filter((model) => {
    if (vendorKey && (model.vendor_key ?? "other") !== vendorKey) return false;
    if (capability !== "all" && modelCapability(model) !== capability) return false;
    if (!q) return true;
    const hay = `${model.model_name} ${model.vendor_name ?? ""} ${model.vendor_key ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
}

/** Vendors that actually appear in a model list (for filter chips). */
export function vendorsPresentIn(models: PlazaModel[]) {
  const vendors = new Map<string, ReturnType<typeof resolvePlazaVendor> & { count: number }>();
  for (const model of models) {
    const vendor = resolvePlazaVendor(model);
    const current = vendors.get(vendor.key);
    vendors.set(vendor.key, { ...vendor, count: (current?.count ?? 0) + 1 });
  }
  return [...vendors.values()];
}
