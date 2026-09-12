import {
  ConsoleRequestError,
  consoleError,
  consoleJson,
  ensureOrganizationKeyManager,
  requireConsoleContext,
} from "@/lib/console/server";
import { requireConsoleOrganization } from "@/lib/console/workspace";
import { decryptSecret } from "@/lib/newapi/crypto";
import { workspaceGateway } from "@/lib/gateway/workspace";
import { requirePlatformDb } from "@/lib/platform/db/client";
import { getTokenUsage } from "@/lib/newapi/team-client";
import { cachedTokenUsage, type ConsoleTokenUsageItem } from "./token-usage-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-admin observability: team quota from new-api admin API, plus per-key
 * (and Studio-hidden) usage from each token's own sk (design §7).
 */
export async function GET(request: Request) {
  try {
    const context = await requireConsoleContext();
    const url = new URL(request.url);
    let organizationId = url.searchParams.get("organizationId");

    if (!organizationId) {
      const platformUser = await context.repositories.users.findById(context.userId);
      organizationId = platformUser?.currentOrganizationId ?? null;
    }
    if (!organizationId) {
      throw new ConsoleRequestError("请选择一个工作区。", 400, "organization_id_required");
    }

    const selected = await requireConsoleOrganization(context, organizationId);
    // Team admin view (design §7).
    ensureOrganizationKeyManager(selected.membership.role);

    const mapping = await context.repositories.teamNewApiMapping.findByOrganizationId(organizationId);
    if (!mapping) {
      throw new ConsoleRequestError("工作区未关联额度账户。", 409, "team_mapping_missing");
    }

    const { quota, usedQuota } = await workspaceGateway(requirePlatformDb(), organizationId).balance();
    const keyRecords = await context.repositories.apiKeys.listForOrganization(organizationId);

    const items: ConsoleTokenUsageItem[] = await Promise.all(
      keyRecords.map(async (record) => {
        const kind: "key" | "studio" = record.isStudioHidden ? "studio" : "key";
        const base = {
          kind,
          apiKeyId: record.id,
          name: record.name,
          keyPrefix: record.keyPrefix,
          newApiTokenId: record.newApiTokenId ?? null,
        };

        if (!record.newApiKeyCiphertext || record.newApiTokenId == null) {
          return {
            ...base,
            totalGranted: 0,
            totalUsed: 0,
            totalAvailable: 0,
          };
        }

        const usage = await cachedTokenUsage(record.newApiTokenId, () =>
          getTokenUsage(decryptSecret(record.newApiKeyCiphertext!)),
        );
        return {
          ...base,
          totalGranted: usage.totalGranted,
          totalUsed: usage.totalUsed,
          totalAvailable: usage.totalAvailable,
        };
      }),
    );

    // Studio as its own line item first, then user keys by usage desc.
    items.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "studio" ? -1 : 1;
      return right.totalUsed - left.totalUsed;
    });

    return consoleJson({
      organizationId,
      quota,
      used_quota: usedQuota,
      items,
    });
  } catch (error) {
    return consoleError(error);
  }
}
