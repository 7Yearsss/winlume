import type { TeamTokenListItem } from "../newapi/team-client";
import { DEFAULT_QUOTA_PER_UNIT } from "../catalog/plaza-display";
import type { ConsoleApiKey } from "./types";

export function mergeUpstreamKeys(
  local: ConsoleApiKey[],
  upstream: TeamTokenListItem[],
  linkedIds: Set<number>,
  organizationId: string,
): ConsoleApiKey[] {
  const seen = new Set(linkedIds);
  const unixDate = (seconds: number) => seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
  const external: ConsoleApiKey[] = [];
  for (const token of upstream) {
    if (seen.has(token.id)) continue;
    seen.add(token.id);
    const expiresAt = unixDate(token.expired_time);
    external.push({
      id: `newapi:${organizationId}:${token.id}`, source: "new-api",
      name: token.name, prefix: "sk-••••",
      status: token.status === 3 || (expiresAt && Date.parse(expiresAt) <= Date.now())
        ? "expired" : token.status === 1 ? "active" : "disabled",
      createdAt: unixDate(token.created_time) ?? new Date(0).toISOString(),
      lastUsedAt: unixDate(token.accessed_time), expiresAt,
      quotaLimit: token.unlimited_quota ? null : (token.remain_quota + token.used_quota) / DEFAULT_QUOTA_PER_UNIT,
      usedQuota: token.used_quota / DEFAULT_QUOTA_PER_UNIT,
      modelScopes: token.model_limits_enabled ? (token.model_limits || "").split(",").filter(Boolean) : [],
      ipAllowList: (token.allow_ips || "").split(/[\s,]+/).filter(Boolean),
      organizationId, ownerUserId: "", ownerName: "new-api 账号",
    });
  }
  return [...local, ...external].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
