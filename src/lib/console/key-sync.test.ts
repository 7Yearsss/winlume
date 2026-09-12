import { describe, expect, it } from "vitest";
import { mergeUpstreamKeys } from "./key-sync";
import type { TeamTokenListItem } from "../newapi/team-client";

const token: TeamTokenListItem = { id: 1, name: "existing", status: 1, created_time: 100,
  accessed_time: 0, expired_time: -1, model_limits_enabled: false, model_limits: "",
  allow_ips: null, remain_quota: 10, used_quota: 5, unlimited_quota: true };

describe("upstream key visibility", () => {
  it("deduplicates local and hidden Studio mappings, including repeated upstream items", () => {
    const result = mergeUpstreamKeys([], [token, { ...token, id: 2 }, { ...token, id: 3 }, { ...token, id: 3 }],
      new Set([1, 2]), "org-a");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "newapi:org-a:3", source: "new-api", status: "active", organizationId: "org-a" });
  });
  it("preserves restrictions and never includes a plaintext upstream secret", () => {
    const result = mergeUpstreamKeys([], [{ ...token, key: "sensitive-secret", status: 2,
      model_limits_enabled: true, model_limits: "gpt,claude", allow_ips: "1.2.3.4\n2.3.4.5" } as TeamTokenListItem],
      new Set(), "org-a");
    expect(result[0]).toMatchObject({ status: "disabled", modelScopes: ["gpt", "claude"], ipAllowList: ["1.2.3.4", "2.3.4.5"] });
    expect(JSON.stringify(result)).not.toContain("sensitive-secret");
  });
});
