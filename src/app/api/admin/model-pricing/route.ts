import { NextResponse } from "next/server";
import { PlatformAdminError, requirePlatformAdmin } from "@/lib/platform/admin";
import { getPortalContent } from "@/lib/portal/content-config";
import { pricingRevision, pricingUpdate, readNewApiPricing } from "@/lib/newapi/pricing";
import { updateNewApiModelPricing } from "@/lib/newapi/admin-client";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
function failure(error: unknown) {
  if (error instanceof PlatformAdminError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  return NextResponse.json({ error: "计费服务暂不可用或没有定价管理权限，请重试。" }, { status: 502, headers });
}
export async function GET() {
  try {
    await requirePlatformAdmin();
    const [content, catalog] = await Promise.all([getPortalContent({ fresh: true }), readNewApiPricing()]);
    const names = new Set(content.modelVendors.flatMap(vendor => vendor.models.map(model => model.name)));
    return NextResponse.json({ quotaPerUnit: catalog.quotaPerUnit, groups: catalog.groups,
      models: catalog.models.filter(model => names.has(model.model_name)).map(model => ({
        name: model.model_name, mode: model.quota_type === 1 ? "fixed" : "tokens",
        input: model.model_ratio * 1_000_000 / catalog.quotaPerUnit,
        output: model.model_ratio * (model.completion_ratio ?? 1) * 1_000_000 / catalog.quotaPerUnit,
        price: model.model_price, groups: model.enable_groups ?? [], revision: pricingRevision(model),
      })),
    }, { headers });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    await requirePlatformAdmin();
    let input;
    try { input = await request.json(); } catch { return NextResponse.json({ error: "无效的定价请求。" }, { status: 400 }); }
    const content = await getPortalContent({ fresh: true });
    if (typeof input?.name !== "string" || input.name.split("/").some((part: string) => part === "." || part === "..") || !content.modelVendors.some(vendor => vendor.models.some(model => model.name === input.name))) {
      return NextResponse.json({ error: "请先在门户中保存该模型。" }, { status: 400 });
    }
    const catalog = await readNewApiPricing();
    const current = catalog.models.find(model => model.model_name === input.name);
    if (!current) return NextResponse.json({ error: "该模型尚未接入计费目录，请先在 new-api 配置模型渠道。" }, { status: 400 });
    if (input.revision !== pricingRevision(current)) return NextResponse.json({ error: "费率已变更，请关闭窗口重新读取后再保存。" }, { status: 409 });
    let update;
    try { update = pricingUpdate(input, catalog.quotaPerUnit); }
    catch(error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    await updateNewApiModelPricing(input.name, update);
    // Re-read the billing service before reporting success. No portal-only copy.
    const verified = (await readNewApiPricing()).models.find(model => model.model_name === input.name);
    if (!verified || Object.entries(update).some(([key,value]) => Math.abs(Number(verified[key as keyof typeof verified]) - value) > 1e-10 || !Number.isFinite(Number(verified[key as keyof typeof verified])))) {
      return NextResponse.json({ error: "已提交费率，但回读尚未一致，请刷新核对后再操作。" }, { status: 502 });
    }
    return NextResponse.json({ success: true }, { headers });
  } catch (error) { return failure(error); }
}
