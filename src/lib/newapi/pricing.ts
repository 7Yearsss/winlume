import type { PlazaModel } from "@/lib/catalog";
import { createHash } from "node:crypto";

export type PricingCatalog = { models: PlazaModel[]; groups: Record<string, number>; quotaPerUnit: number };

export async function readNewApiPricing(): Promise<PricingCatalog> {
  const base = process.env.NEW_API_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("未配置计费服务。");
  const responses = await Promise.all(["pricing", "status"].map(path => fetch(`${base}/api/${path}`, {
    cache: "no-store", signal: AbortSignal.timeout(12_000),
  })));
  if (responses.some(response => !response.ok)) throw new Error("读取实际费率失败，请稍后重试。");
  const [pricing, status] = await Promise.all(responses.map(response => response.json()));
  const quotaPerUnit = Number(status.data?.quota_per_unit);
  if (!pricing.success || !Array.isArray(pricing.data) || !status.success || !Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
    throw new Error("计费服务返回的费率无效。");
  }
  return { models: pricing.data, groups: pricing.group_ratio ?? {}, quotaPerUnit };
}

export function pricingRevision(model: PlazaModel): string {
  return createHash("sha256").update(JSON.stringify([model.model_name, model.quota_type, model.model_ratio, model.completion_ratio, model.model_price])).digest("hex");
}

export function applyActualPricing(models: PlazaModel[], catalog: PricingCatalog): PlazaModel[] {
  const byName = new Map(catalog.models.map(model => [model.model_name, model]));
  return models.map(model => {
    const actual = byName.get(model.model_name);
    if (!actual) return { ...model, pricing_unavailable: true };
    const groups = (actual.enable_groups ?? []).flatMap(group => group === "all" ? Object.keys(catalog.groups) : [group]);
    const rates = groups.map(group => ({ group, ratio: catalog.groups[group] })).filter(item => Number.isFinite(item.ratio) && item.ratio >= 0).sort((a,b) => a.ratio-b.ratio);
    if (!rates.length) return { ...model, pricing_unavailable: true };
    return { ...model, quota_type: actual.quota_type, model_ratio: actual.model_ratio,
      completion_ratio: actual.completion_ratio, model_price: actual.model_price,
      pricing_mode: actual.pricing_mode, quota_per_unit: catalog.quotaPerUnit,
      pricing_currency: "USD", pricing_unavailable: false,
      group_ratio: rates[0].ratio, billing_group: rates[0].group, group_ratio_is_min: rates.length > 1 };
  });
}

export function pricingUpdate(input: unknown, quotaPerUnit: number) {
  const data = input as Record<string, unknown> | null;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
  if (data?.mode === "fixed" && valid(data.price)) return { quota_type: 1, model_price: data.price };
  if (data?.mode === "tokens" && valid(data.input) && valid(data.output)) {
    if (data.input === 0 && data.output !== 0) throw new Error("输入单价为 0 时，输出单价也必须为 0。");
    const modelRatio = data.input * quotaPerUnit / 1_000_000;
    const completionRatio = data.input === 0 ? 1 : data.output / data.input;
    if (!Number.isFinite(modelRatio) || !Number.isFinite(completionRatio)) throw new Error("输入与输出价格比例超出计费服务支持范围。");
    return { quota_type: 0, model_ratio: modelRatio, completion_ratio: completionRatio };
  }
  throw new Error("请填写有效的非负单价（最高 1,000,000 美元）。");
}
