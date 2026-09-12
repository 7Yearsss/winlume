import {
  consoleError,
  consoleJson,
  ensureOrganizationKeyManager,
  listConsoleApiKeys,
  mapConsoleApiKey,
  parseConsoleKeyInput,
  requireConsoleContext,
} from "@/lib/console/server";
import { listConsoleOrganizations, requireConsoleOrganization } from "@/lib/console/workspace";
import { mergeUpstreamKeys } from "@/lib/console/key-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireConsoleContext();
    const organizations = await listConsoleOrganizations(context);
    const requested = new URL(request.url).searchParams.get("organizationId") || null;
    const platformUser = requested ? null : await context.repositories.users.findById(context.userId);
    const currentOrganizationId = platformUser?.currentOrganizationId ?? null;
    const organizationId = requested
      ?? (currentOrganizationId && organizations.some((organization) => organization.id === currentOrganizationId)
        ? currentOrganizationId
        : organizations[0]?.id ?? null);
    if (organizationId) {
      await requireConsoleOrganization(context, organizationId);
    }
    let keys = organizationId ? await listConsoleApiKeys(context, organizationId) : [];
    let syncWarning: string | undefined;
    if (organizationId) {
      try {
        const [upstream, records] = await Promise.all([
          context.repositories.apiKeys.listUpstreamForOrganization(organizationId),
          context.repositories.apiKeys.listForOrganization(organizationId),
        ]);
        // Include hidden Studio keys in deduplication so they stay hidden.
        const linkedIds = new Set(records.flatMap(record => record.newApiTokenId == null ? [] : [record.newApiTokenId]));
        keys = mergeUpstreamKeys(keys, upstream, linkedIds, organizationId);
      } catch {
        syncWarning = "new-api Key 同步暂时失败，当前仅显示本站记录，请刷新重试。";
      }
    }
    return consoleJson({ keys, organizations, organizationId, syncWarning });
  } catch (error) {
    return consoleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireConsoleContext();
    // organizationId is required (design §5.3/§5.4): only org-scoped virtual keys exist.
    const input = parseConsoleKeyInput(await request.json());
    const selected = await requireConsoleOrganization(context, input.organizationId);
    ensureOrganizationKeyManager(selected.membership.role);
    const { record, plaintext } = await context.repositories.apiKeys.create({
      userId: context.userId,
      organizationId: input.organizationId,
      name: input.name,
      expiresAt: input.expiresAt,
      allowedModels: input.allowedModels,
      ipAllowlist: input.ipAllowlist,
    });
    return consoleJson({ key: mapConsoleApiKey(record), secret: plaintext }, { status: 201 });
  } catch (error) {
    return consoleError(error);
  }
}
