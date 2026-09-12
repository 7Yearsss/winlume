import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTeamToken,
  fetchTeamTokenKey,
  findTeamTokenIdByName,
  getTokenUsage,
  getUserLogs,
  getUserQuotaDates,
  loginAndMintPat,
  redeemTeamCode,
  NewApiTeamError,
  revokeTeamToken,
  updateTeamToken,
} from "./team-client";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NEW_API_URL = "https://v2api.top";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("loginAndMintPat", () => {
  it("logs in, carries the JWT access_token into the PAT-mint call at /api/user/token, and returns the PAT", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/user/login")) {
        return new Response(JSON.stringify({ success: true, data: { access_token: "jwt-abc123" } }), { status: 200 });
      }
      if (url.endsWith("/api/user/token")) {
        return new Response(JSON.stringify({ success: true, data: "pat-xyz" }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loginAndMintPat("team-abc", "s3cret!!")).resolves.toBe("pat-xyz");

    const [patCallUrl, patCallInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patCallUrl).toBe("https://v2api.top/api/user/token");
    expect((patCallInit.headers as Record<string, string>).Authorization).toBe("Bearer jwt-abc123");
  });

  it("throws NewApiTeamError on login failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, message: "bad password" }), { status: 200 })),
    );
    await expect(loginAndMintPat("team-abc", "wrong")).rejects.toThrow(NewApiTeamError);
  });

  it("throws NewApiTeamError if the login response has no access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })),
    );
    await expect(loginAndMintPat("team-abc", "s3cret!!")).rejects.toThrow(NewApiTeamError);
  });
});

describe("createTeamToken / findTeamTokenIdByName / fetchTeamTokenKey", () => {
  it("routes an unrestricted workspace key across all authorized groups", async () => {
    const mock = vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data:
      url.endsWith("/self/groups") ? { auto: {}, gpt: { ratio: .2 }, images: { ratio: .4 }, domestic: { ratio: .3 } } :
      url.endsWith("/auto-groups") ? { groups: ["gpt"], max_count: 5 } : undefined,
    })));
    vi.stubGlobal("fetch", mock);
    await createTeamToken("pat", "all models", { allAvailableGroups: true });
    expect(mock).toHaveBeenLastCalledWith("https://v2api.top/api/token/", expect.objectContaining({
      body: expect.stringContaining('"auto_groups":["gpt","domestic","images"]'),
    }));
    const body = JSON.parse((mock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string);
    expect(body.model_limits_enabled).toBe(false); expect(body.group).toBe("auto");
  });
  it("does not silently truncate routing groups to an insufficient limit", async () => {
    const mock = vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data:
      url.endsWith("/self/groups") ? { gpt: {}, domestic: {} } : { groups: ["gpt"], max_count: 1 },
    })));
    vi.stubGlobal("fetch", mock);
    await expect(createTeamToken("pat", "all", { allAvailableGroups: true })).rejects.toThrow("上限不足");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("creates a token with the default auto group and unlimited quota", async () => {
    delete process.env.NEW_API_TOKEN_GROUP;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createTeamToken("pat-xyz", "studio");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v2api.top/api/token/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pat-xyz");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "studio",
      group: "auto",
      remain_quota: 0,
      unlimited_quota: true,
      cross_group_retry: true,
      expired_time: -1,
      model_limits_enabled: false,
      model_limits: "",
      allow_ips: "",
    });
  });

  it("honors NEW_API_TOKEN_GROUP when set", async () => {
    process.env.NEW_API_TOKEN_GROUP = "claude-max";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createTeamToken("pat-xyz", "studio");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).group).toBe("claude-max");
    delete process.env.NEW_API_TOKEN_GROUP;
  });

  it("finds a token id by exact name match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { items: [{ id: 7, name: "studio" }] } }), { status: 200 }),
      ),
    );
    await expect(findTeamTokenIdByName("pat-xyz", "studio")).resolves.toBe(7);
  });

  it("forwards expiry and model/IP limits when creating a token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createTeamToken("pat-xyz", "prod", {
      expiredTime: 1_800_000_000,
      modelLimits: ["gpt-4o"],
      allowIps: ["203.0.113.10"],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      expired_time: 1_800_000_000,
      model_limits_enabled: true,
      model_limits: "gpt-4o",
      allow_ips: "203.0.113.10",
    });
  });

  it("fetches the raw key and prefixes sk-", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { key: "rawkey123" } }), { status: 200 })),
    );
    await expect(fetchTeamTokenKey("pat-xyz", 7)).resolves.toBe("sk-rawkey123");
  });
});

describe("updateTeamToken", () => {
  it("loads the current token then PUTs merged limits without resetting quota", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET" || url.endsWith("/api/token/9")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 9,
              name: "old",
              group: "gpt-pro",
              remain_quota: 42,
              unlimited_quota: false,
              expired_time: -1,
              model_limits_enabled: false,
              model_limits: "",
              allow_ips: "",
              cross_group_retry: false,
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await updateTeamToken("pat-xyz", 9, {
      name: "new-name",
      expiredTime: 1_800_000_000,
      modelLimits: ["gpt-4o"],
      allowIps: ["203.0.113.10"],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://v2api.top/api/token/9");
    const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toBe("https://v2api.top/api/token/");
    expect(putInit.method).toBe("PUT");
    expect(JSON.parse(putInit.body as string)).toMatchObject({
      id: 9,
      name: "new-name",
      group: "gpt-pro",
      remain_quota: 42,
      unlimited_quota: false,
      expired_time: 1_800_000_000,
      model_limits_enabled: true,
      model_limits: "gpt-4o",
      allow_ips: "203.0.113.10",
    });
  });
});

describe("revokeTeamToken", () => {
  it("sends DELETE /api/token/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await revokeTeamToken("pat-xyz", 7);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v2api.top/api/token/7");
    expect(init.method).toBe("DELETE");
  });
});

describe("getUserLogs", () => {
  it("calls the team-scoped /api/log/self endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { page: 1, page_size: 100, total: 1, items: [{ model_name: "gpt-4o" }] } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getUserLogs("pat-xyz", { pageSize: 100 })).resolves.toEqual({
      page: 1,
      pageSize: 100,
      total: 1,
      items: [{ model_name: "gpt-4o" }],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v2api.top/api/log/self?p=1&page_size=100");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pat-xyz");
  });
});

describe("getUserQuotaDates", () => {
  it("calls the team-scoped /api/data/self endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [{ model_name: "gpt-4o", created_at: 1_800_000_000, count: 2, quota: 500_000 }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getUserQuotaDates("pat-xyz", { startTimestamp: 10, endTimestamp: 20 })).resolves.toEqual([
      { model_name: "gpt-4o", created_at: 1_800_000_000, count: 2, quota: 500_000 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v2api.top/api/data/self?start_timestamp=10&end_timestamp=20");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pat-xyz");
  });
});

describe("redeemTeamCode", () => {
  it("posts the redemption key to /api/user/topup and maps a quota payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 500_000 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(redeemTeamCode("pat-xyz", "CODE-1")).resolves.toEqual({ type: "quota", quota: 500_000 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v2api.top/api/user/topup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ key: "CODE-1" });
  });
});

describe("getTokenUsage", () => {
  it("authenticates with the token's own sk- key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: true, message: "ok", data: { total_granted: 1000, total_used: 250, total_available: 750 } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getTokenUsage("sk-rawkey123")).resolves.toEqual({
      totalGranted: 1000,
      totalUsed: 250,
      totalAvailable: 750,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v2api.top/api/usage/token/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-rawkey123");
  });
});
