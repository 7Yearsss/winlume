import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAuthContext: vi.fn(),
  getPlatformRepositories: vi.fn(),
  getPlatformDb: vi.fn(),
  getAuthMode: vi.fn(),
  getNewApiUserQuota: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentAuthContext: mocks.getCurrentAuthContext,
}));

vi.mock("@/lib/platform", () => ({
  getPlatformRepositories: mocks.getPlatformRepositories,
  getPlatformDb: mocks.getPlatformDb,
}));

vi.mock("@/lib/platform/auth", () => ({
  getAuthMode: mocks.getAuthMode,
  hashPassword: vi.fn(),
  passwordWouldBeTruncatedByBcrypt: vi.fn(() => false),
}));

vi.mock("@/lib/gateway/workspace", () => ({
  workspaceGateway: () => ({ balance: () => mocks.getNewApiUserQuota(42) }),
}));

import { GET } from "./route";

describe("GET /api/account/self", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthMode.mockReturnValue("reizo");
    mocks.getPlatformDb.mockReturnValue({});
    mocks.getCurrentAuthContext.mockResolvedValue({
      userId: "user-1",
      username: "team-abc",
      displayName: "Team ABC",
      email: null,
      platformRole: "user",
      authVersion: 1,
      legacyNewApiUserId: null,
    });
    mocks.getPlatformRepositories.mockReturnValue({
      users: {
        findById: vi.fn(async () => ({ id: "user-1", currentOrganizationId: "org-1" })),
      },
      teamNewApiMapping: {
        findByOrganizationId: vi.fn(async () => ({ newApiUserId: 42 })),
      },
    });
    mocks.getNewApiUserQuota.mockImplementation(async (id: number) =>
      id === 42 ? { quota: 1000, usedQuota: 250 } : null,
    );
  });

  it("returns quota/used_quota sourced from new-api", async () => {
    const request = new Request("https://reizo.example/api/account/self");
    const response = await GET(request as never, { params: Promise.resolve({ action: "self" }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.quota).toBe(1000);
    expect(body.data.used_quota).toBe(250);
    expect(body.data.id).toBe("user-1");
    expect(body.data.username).toBe("team-abc");
    expect(body.data.platform_role).toBe("user");
    expect(mocks.getNewApiUserQuota).toHaveBeenCalledWith(42);
  });

  it("returns 409 when the account has no current organization", async () => {
    mocks.getPlatformRepositories.mockReturnValue({
      users: { findById: vi.fn(async () => ({ id: "user-1", currentOrganizationId: null })) },
      teamNewApiMapping: { findByOrganizationId: vi.fn() },
    });
    const response = await GET(new Request("https://reizo.example/api/account/self") as never, {
      params: Promise.resolve({ action: "self" }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("keeps an authenticated account available when the balance service rejects its credential", async () => {
    mocks.getNewApiUserQuota.mockRejectedValue(Object.assign(new Error("Unauthorized, invalid access token"), { status: 401 }));
    const response = await GET(new Request("https://reizo.example/api/account/self") as never, {
      params: Promise.resolve({ action: "self" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("user-1");
    expect(body.data.platform_role).toBe("user");
    expect(body.data).not.toHaveProperty("quota");
    expect(body.data).not.toHaveProperty("used_quota");
  });

  it("still rejects an unauthenticated request", async () => {
    mocks.getCurrentAuthContext.mockResolvedValue(null);
    const response = await GET(new Request("https://reizo.example/api/account/self") as never, {
      params: Promise.resolve({ action: "self" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.getNewApiUserQuota).not.toHaveBeenCalled();
  });
});
