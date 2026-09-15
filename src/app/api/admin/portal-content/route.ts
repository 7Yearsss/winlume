import { NextRequest, NextResponse } from "next/server";
import { PlatformAdminError, requirePlatformAdmin } from "@/lib/platform/admin";
import { getPlatformRepositories } from "@/lib/platform/repositories";
import { getPortalContent, invalidatePortalContentCache, normalizePortalContent, PORTAL_CONTENT_KEY } from "@/lib/portal/content-config";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };
const editableSections = ["toolDirectory", "carousel", "notifications", "modelVendors", "applicationShowcase", "capabilityShowcase"] as const;

function errorResponse(error: unknown) {
  if (error instanceof PlatformAdminError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[admin/portal-content]", error);
  return NextResponse.json({ error: "门户内容保存失败" }, { status: 500 });
}

export async function GET() {
  try { await requirePlatformAdmin(); return NextResponse.json(await getPortalContent({ fresh: true }), { headers: noStoreHeaders }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    await requirePlatformAdmin();
    const repositories = getPlatformRepositories();
    if (!repositories) return NextResponse.json({ error: "平台数据库尚未配置。" }, { status: 503 });
    const input = await request.json().catch(() => ({}));
    let value;
    if (
      input && typeof input === "object" &&
      editableSections.includes((input as { section?: unknown }).section as typeof editableSections[number])
    ) {
      const patch = input as { section: typeof editableSections[number]; value: unknown };
      const current = await getPortalContent({ fresh: true });
      value = normalizePortalContent({ ...current, [patch.section]: patch.value });
    } else {
      // Keep accepting the original full-document shape for scripts and older
      // clients while the admin UI uses the smaller section payload above.
      value = normalizePortalContent(input);
    }
    await repositories.portalContent.set(PORTAL_CONTENT_KEY, value as unknown as Record<string, unknown>);
    invalidatePortalContentCache();
    return NextResponse.json(value, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
