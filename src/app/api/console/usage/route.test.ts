import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  getPlatformRepositories: vi.fn(),
  getNewApiUserQuota: vi.fn(),
  getTokenUsage: vi.fn(),
  decryptSecret: vi.fn((value: string) => value.replace(/^enc\(|\)$/g, "")),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserId: mocks.getCurrentUserId,
}));

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return {
    ...actual,
    getPlatformRepositories: mocks.getPlatformRepositories,
  };
});

vi.mock("@/lib/gateway/workspace", () => ({
  workspaceGateway: () => ({ balance: () => mocks.getNewApiUserQuota(42) }),
}));
vi.mock("@/lib/platform/db/client", () => ({ requirePlatformDb: () => ({}), getPlatformDb: () => ({}) }));

vi.mock("@/lib/newapi/team-client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/newapi/team-client")>(),
  getTokenUsage: mocks.getTokenUsage,
}));

vi.mock("@/lib/newapi/crypto", () => ({
  decryptSecret: mocks.decryptSecret,
}));

import { GET } from "./route";
import { cachedTokenUsage, clearTokenUsageCache } from "./token-usage-cache";

describe("cachedTokenUsage", () => {
  beforeEach(() => {
    clearTokenUsageCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearTokenUsageCache();
  });

  it("does not re-run the fetcher within the TTL window", async () => {
    const fetcher = vi.fn(async () => ({
      totalGranted: 100,
      totalUsed: 10,
      totalAvailable: 90,
    }));

    await expect(cachedTokenUsage(7, fetcher)).resolves.toEqual({
      totalGranted: 100,
      totalUsed: 10,
      totalAvailable: 90,
    });
    await expect(cachedTokenUsage(7, fetcher)).resolves.toEqual({
      totalGranted: 100,
      totalUsed: 10,
      totalAvailable: 90,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    await cachedTokenUsage(7, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/console/usage", () => {
  const studioKey = {
    id: "key-studio",
    name: "Studio",
    keyPrefix: "wl_st",
    newApiTokenId: 1,
    newApiKeyCiphertext: "enc(sk-studio)",
    isStudioHidden: true,
    userId: "user-1",
  };
  const userKey = {
    id: "key-user",
    name: "Prod",
    keyPrefix: "wl_pr",
    newApiTokenId: 2,
    newApiKeyCiphertext: "enc(sk-user)",
    isStudioHidden: false,
    userId: "user-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenUsageCache();
    mocks.getCurrentUserId.mockResolvedValue("user-1");
    mocks.getNewApiUserQuota.mockResolvedValue({ quota: 5000, usedQuota: 1200 });
    mocks.getTokenUsage.mockImplementation(async (sk: string) => {
      if (sk === "sk-studio") return { totalGranted: 5000, totalUsed: 100, totalAvailable: 4900 };
      if (sk === "sk-user") return { totalGranted: 5000, totalUsed: 400, totalAvailable: 4600 };
      return { totalGranted: 0, totalUsed: 0, totalAvailable: 0 };
    });
    mocks.getPlatformRepositories.mockReturnValue({
      users: {
        findById: vi.fn(async () => ({
          id: "user-1",
          status: "active",
          currentOrganizationId: "org-1",
        })),
      },
      organizations: {
        listMembershipsForUser: vi.fn(async () => [
          { organizationId: "org-1", userId: "user-1", role: "owner" },
        ]),
        findById: vi.fn(async () => ({ id: "org-1", name: "Acme", slug: "acme" })),
      },
      teamNewApiMapping: {
        findByOrganizationId: vi.fn(async () => ({
          organizationId: "org-1",
          newApiUserId: 42,
        })),
      },
      apiKeys: {
        listForOrganization: vi.fn(async () => [studioKey, userKey]),
      },
    });
  });

  afterEach(() => {
    clearTokenUsageCache();
  });

  it("returns team quota and per-key usage with studio as a distinct line", async () => {
    const response = await GET(new Request("https://reizo.example/api/console/usage?organizationId=org-1"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.organizationId).toBe("org-1");
    expect(body.quota).toBe(5000);
    expect(body.used_quota).toBe(1200);
    expect(body.items).toHaveLength(2);

    const studio = body.items.find((item: { kind: string }) => item.kind === "studio");
    const key = body.items.find((item: { kind: string }) => item.kind === "key");
    expect(studio).toMatchObject({
      kind: "studio",
      apiKeyId: "key-studio",
      name: "Studio",
      totalUsed: 100,
    });
    expect(key).toMatchObject({
      kind: "key",
      apiKeyId: "key-user",
      name: "Prod",
      totalUsed: 400,
    });

    expect(mocks.getTokenUsage).toHaveBeenCalledWith("sk-studio");
    expect(mocks.getTokenUsage).toHaveBeenCalledWith("sk-user");
    expect(mocks.getNewApiUserQuota).toHaveBeenCalledWith(42);
  });

  it("uses the caller's current organization when organizationId is omitted", async () => {
    const response = await GET(new Request("https://reizo.example/api/console/usage"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.organizationId).toBe("org-1");
  });

  it("rejects non-admin members", async () => {
    mocks.getPlatformRepositories.mockReturnValue({
      users: {
        findById: vi.fn(async () => ({
          id: "user-1",
          status: "active",
          currentOrganizationId: "org-1",
        })),
      },
      organizations: {
        listMembershipsForUser: vi.fn(async () => [
          { organizationId: "org-1", userId: "user-1", role: "member" },
        ]),
        findById: vi.fn(async () => ({ id: "org-1", name: "Acme", slug: "acme" })),
      },
      teamNewApiMapping: { findByOrganizationId: vi.fn() },
      apiKeys: { listForOrganization: vi.fn() },
    });

    const response = await GET(new Request("https://reizo.example/api/console/usage?organizationId=org-1"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("organization_key_forbidden");
  });
});
