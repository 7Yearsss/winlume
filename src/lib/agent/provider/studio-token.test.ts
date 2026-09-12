import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  getPlatformRepositories: vi.fn(() => ({
    users: { findById: vi.fn(async () => ({ id: "user-1", currentOrganizationId: "org-1" })) },
    organizations: { getMembership: vi.fn(async () => ({ role: "owner" })) },
    apiKeys: {
      listForOrganization: vi.fn(async () => [
        { id: "key-1", isStudioHidden: false, newApiKeyCiphertext: "enc(other)" },
        { id: "key-2", status: "active", isStudioHidden: true, newApiKeyCiphertext: "enc(sk-studio-real)" },
      ]),
    },
  })),
}));
vi.mock("@/lib/newapi/crypto", () => ({
  decryptSecret: vi.fn((value: string) => value.replace(/^enc\(|\)$/g, "")),
}));

import { resolveStudioToken } from "./studio-token";

describe("resolveStudioToken", () => {
  it("returns the decrypted studio-hidden key for the user's current organization", async () => {
    await expect(resolveStudioToken("user-1")).resolves.toBe("sk-studio-real");
  });

  it("throws when the user has no current organization", async () => {
    const { getPlatformRepositories } = await import("@/lib/platform");
    vi.mocked(getPlatformRepositories).mockReturnValueOnce({
      users: { findById: vi.fn(async () => ({ id: "user-2", currentOrganizationId: null })) },
      apiKeys: { listForOrganization: vi.fn() },
    } as never);
    await expect(resolveStudioToken("user-2")).rejects.toThrow();
  });
});
