import type { PlazaModel } from "@/lib/catalog";
import { getVendorById, getVendorByKey, inferVendorFromModel, type PlazaVendor } from "@/lib/catalog/vendors";

export type PlazaTag = {
  label: string;
  tone: "violet" | "amber" | "sky" | "emerald" | "rose" | "slate";
};

export function resolvePlazaVendor(
  model: PlazaModel,
  fallback?: { name?: string; logo?: string },
): PlazaVendor {
  const vendorKey = model.vendor_key?.trim().toLowerCase();
  if (model.portal_category && vendorKey) {
    const base = getVendorByKey(vendorKey);
    return { ...base, key: vendorKey, name: model.vendor_name || base.name,
      brandLabel: model.vendor_name || base.brandLabel, logo: model.vendor_logo || base.logo };
  }
  if (vendorKey) {
    const byKey = getVendorByKey(vendorKey);
    if (byKey.key !== "other" || vendorKey === "other") return byKey;
  }

  // Older gateway responses may omit vendor_key and carry a stale vendor_logo.
  // Infer known providers before ever accepting that remote logo as a fallback.
  const inferred = inferVendorFromModel(`${model.model_name} ${model.vendor_name ?? fallback?.name ?? ""}`);
  if (inferred.key !== "other") return inferred;

  if (model.vendor_id != null) {
    return getVendorById(model.vendor_id);
  }
  if (fallback?.name) {
    // Preserve display name when only a free-form vendor string is known.
    const base = getVendorByKey("other");
    return { ...base, name: fallback.name, brandLabel: fallback.name, logo: fallback.logo ?? base.logo };
  }
  return getVendorByKey("other");
}

/** Short marketplace-style blurb; catalog has no prose field yet. */
export function modelDescription(model: PlazaModel, vendor: PlazaVendor): string {
  const name = model.model_name.toLowerCase();
  if (name.includes("image") || name.includes("dall") || name.includes("flux") || name.includes("imagen")) {
    return `${vendor.name} 图像生成模型，适合出图与视觉创作。`;
  }
  if (name.includes("video") || name.includes("kling") || name.includes("runway")) {
    return `${vendor.name} 视频生成模型，适合短片与动态内容。`;
  }
  if (name.includes("tts") || name.includes("speech") || name.includes("whisper") || name.includes("audio")) {
    return `${vendor.name} 语音相关模型，适合朗读、转写与音频场景。`;
  }
  if (name.includes("embed")) {
    return `${vendor.name} 向量嵌入模型，适合检索与语义匹配。`;
  }
  if (name.includes("thinking") || name.includes("reason") || name.includes("r1") || name.includes("o1") || name.includes("o3")) {
    return `${vendor.name} 推理增强模型，面向复杂分析与多步任务。`;
  }
  if (name.includes("mini") || name.includes("flash") || name.includes("haiku") || name.includes("lite")) {
    return `${vendor.name} 轻量高速模型，适合高并发与低延迟场景。`;
  }
  if (name.includes("max") || name.includes("opus") || name.includes("ultra") || name.includes("pro")) {
    return `${vendor.name} 旗舰级通用模型，适合高质量生成与复杂对话。`;
  }
  return `${vendor.name} 提供的 ${model.model_name}，可通过 Reizo Gateway 调用。`;
}

export function modelTags(model: PlazaModel): PlazaTag[] {
  const name = model.model_name.toLowerCase();
  const tags: PlazaTag[] = [];

  if (model.quota_type === 1 || name.includes("image") || name.includes("video") || name.includes("tts")) {
    tags.push({ label: "API", tone: "violet" });
  } else {
    tags.push({ label: "模型", tone: "violet" });
  }

  if (name.includes("image") || name.includes("dall") || name.includes("flux") || name.includes("imagen") || name.includes("banana")) {
    tags.push({ label: "图片生成", tone: "amber" });
  } else if (name.includes("video") || name.includes("kling")) {
    tags.push({ label: "视频生成", tone: "rose" });
  } else if (name.includes("tts") || name.includes("speech") || name.includes("whisper") || name.includes("audio")) {
    tags.push({ label: "语音", tone: "sky" });
  } else if (name.includes("embed")) {
    tags.push({ label: "Embedding", tone: "emerald" });
  } else {
    tags.push({ label: "语言大模型", tone: "sky" });
  }

  if (name.includes("thinking") || name.includes("reason") || name.includes("r1")) {
    tags.push({ label: "推理", tone: "emerald" });
  }

  return tags.slice(0, 4);
}

export type PlazaPriceLine =
  | { kind: "fixed"; text: string }
  | { kind: "ratio"; input: string; output: string }
  | { kind: "tiered"; text: string };

/** new-api default: 500_000 quota units = 1 display currency unit (shown as ¥) */
export const DEFAULT_QUOTA_PER_UNIT = 500_000;

/**
 * Convert a ratio-priced token charge into display currency per 1M tokens.
 *
 * new-api: quota ≈ tokens × model_ratio × completion_ratio × group_ratio
 * amount = quota / quota_per_unit  (no USD→CNY FX; unit is already ¥ for plaza)
 *
 * per 1M tokens (input uses completion_ratio=1):
 *   ¥ = 1e6 × model_ratio × group_ratio / quota_per_unit
 */
export function currencyPerMillionTokens(options: {
  modelRatio: number;
  completionRatio?: number;
  groupRatio?: number;
  quotaPerUnit?: number;
}): number {
  const modelRatio = positive(options.modelRatio, 1);
  const completionRatio = positive(options.completionRatio ?? 1, 1);
  const groupRatio = positive(options.groupRatio ?? 1, 1);
  const quotaPerUnit = positive(options.quotaPerUnit ?? DEFAULT_QUOTA_PER_UNIT, DEFAULT_QUOTA_PER_UNIT);
  return (1_000_000 * modelRatio * completionRatio * groupRatio) / quotaPerUnit;
}

/** @deprecated use currencyPerMillionTokens */
export function cnyPerMillionTokens(options: {
  modelRatio: number;
  completionRatio?: number;
  groupRatio?: number;
  quotaPerUnit?: number;
  usdCnyRate?: number;
}): number {
  return currencyPerMillionTokens(options);
}

export function modelPriceLines(model: PlazaModel): PlazaPriceLine {
  const quotaPerUnit = model.quota_per_unit ?? DEFAULT_QUOTA_PER_UNIT;
  const groupRatio = model.group_ratio ?? 1;

  if (model.pricing_mode === "tiered_expr") {
    return { kind: "tiered", text: "分层表达式计价" };
  }
  if (model.quota_type === 1 || model.pricing_mode === "fixed") {
    // fixed_price is already a currency amount in catalog (displayed as ¥)
    const price = Number.isFinite(model.model_price) ? model.model_price : 0;
    return {
      kind: "fixed",
      text: `价格：¥${formatCny(price)} /次`,
    };
  }

  const modelRatio = Number.isFinite(model.model_ratio) ? model.model_ratio : 1;
  const completionRatio = Number.isFinite(model.completion_ratio ?? 1) ? (model.completion_ratio ?? 1) : 1;
  const inputCny = currencyPerMillionTokens({
    modelRatio,
    completionRatio: 1,
    groupRatio,
    quotaPerUnit,
  });
  const outputCny = currencyPerMillionTokens({
    modelRatio,
    completionRatio,
    groupRatio,
    quotaPerUnit,
  });

  // 「起」when the model is listed under multiple billing groups and we show the lowest.
  const from = model.group_ratio_is_min ? "起" : "";
  return {
    kind: "ratio",
    input: `输入：¥${formatCny(inputCny)}${from} /1M tokens`,
    output: `输出：¥${formatCny(outputCny)}${from} /1M tokens`,
  };
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatCny(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(3);
  return value.toFixed(4);
}
