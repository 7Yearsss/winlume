import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), content: vi.fn() }));
vi.mock("@/lib/platform/admin", () => ({
  requirePlatformAdmin: mocks.admin,
  PlatformAdminError: class extends Error { constructor(message: string, public status: number) { super(message); } },
}));
vi.mock("@/lib/portal/content-config", () => ({ getPublicPortalContent: mocks.content }));
vi.mock("@/lib/platform/auth", () => ({ getAuthMode: () => "legacy" }));
vi.mock("@/lib/agent/provider/gateway", () => ({ getGatewayBaseUrl: () => "https://gateway.test" }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUserId: async () => null }));
vi.mock("@/lib/agent/provider/studio-token", () => ({ resolveStudioToken: vi.fn() }));
import { GET } from "./route";
import { PlatformAdminError } from "@/lib/platform/admin";

describe("public catalog publication boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NEW_API_URL", "https://gateway.test");
    mocks.content.mockResolvedValue({ modelVendors: [] });
    mocks.admin.mockResolvedValue({ platformRole: "admin" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [{ model_name: "hidden", quota_type: 0, model_price: 0, model_ratio: 1 }] }))));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("does not publish the upstream catalog when no providers are enabled", async () => {
    const body = await (await GET(new Request("https://app.test/api/catalog/plaza"))).json();
    expect(body.data).toEqual([]);
  });
  it("does not restore sample rows when the gateway fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const body = await (await GET(new Request("https://app.test/api/catalog/plaza"))).json();
    expect(body.data).toEqual([]);
  });
  it("keeps full import data available only to admins", async () => {
    const request = new Request("https://app.test/api/catalog/plaza?scope=admin-import");
    mocks.admin.mockRejectedValueOnce(new PlatformAdminError("Denied", 401));
    expect((await GET(request)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect((await (await GET(request)).json()).data).toHaveLength(1);
  });
});
