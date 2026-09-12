import { beforeEach, describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => ({ listKeys: vi.fn(), revealKey: vi.fn(), updateKey: vi.fn() }));
vi.mock("../../gateway/workspace", () => ({ workspaceGateway: () => gateway }));
vi.mock("../../newapi/crypto", () => ({ encryptSecret: (s: string) => "encrypted:" + s }));
import { ApiKeyRepository } from "./api-keys";
import { hashApiKey } from "../api-keys";

describe("existing key adoption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.listKeys.mockResolvedValue([{ id: 9, name: "old", status: 2, created_time: 100,
      accessed_time: 200, expired_time: 300, model_limits_enabled: true, model_limits: "gpt",
      allow_ips: "1.2.3.4", unlimited_quota: false, remain_quota: 10, used_quota: 5 }]);
    gateway.revealKey.mockResolvedValue("sk-original");
  });
  it("preserves the credential and restrictions and imports only once", async () => {
    const rows: Record<string, unknown>[] = [];
    const tx = {
      execute: vi.fn(),
      select: () => ({ from: () => ({ where: async () => rows }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => ({ returning: async () => {
        const record = { ...value, id: "local-1" }; rows.push(record); return [record];
      } }) }),
    };
    const db = { transaction: (f: (t: typeof tx) => unknown) => f(tx) };
    const repo = new ApiKeyRepository(db as never);
    expect(await repo.importExisting("user", "org")).toBe(1);
    expect(await repo.importExisting("user", "org")).toBe(0);
    expect(gateway.revealKey).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({ keyHash: hashApiKey("sk-original"), status: "disabled",
      allowedModels: ["gpt"], ipAllowlist: ["1.2.3.4"], organizationId: "org", metadata: { imported: true },
      newApiKeyCiphertext: "encrypted:sk-original", expiresAt: new Date(300000) });
  });
  it("does not reset an imported token's routing during editing", async () => {
    const existing = { id: "key", newApiTokenId: 9, organizationId: "org", metadata: { imported: true } };
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [existing] }) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [existing] }) }) }),
    };
    await new ApiKeyRepository(db as never).update("key", { name: "renamed", expiresAt: null, allowedModels: [], ipAllowlist: [] });
    expect(gateway.updateKey).toHaveBeenCalledWith(9, expect.objectContaining({ allAvailableGroups: false }));
  });
});
