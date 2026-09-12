import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNewApiUserQuota,
  createNewApiUser,
  disableNewApiUser,
  findNewApiUserIdByUsername,
  getNewApiUserQuota,
  NewApiAdminError,
  updateNewApiModelPricing,
} from "./admin-client";

const originalEnv = { ...process.env };

describe("updateNewApiModelPricing", () => {
  it("patches only the selected model through the admin API", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", mock);
    await updateNewApiModelPricing("vendor/model name", { quota_type: 1, model_price: .5 });
    expect(mock).toHaveBeenCalledWith("https://v2api.top/api/pricing/admin/models/vendor/model%20name", expect.objectContaining({
      method: "PATCH", headers: expect.objectContaining({ Authorization: "Bearer admin-pat-123" }),
      body: JSON.stringify({ quota_type: 1, model_price: .5 }),
    }));
  });
});

beforeEach(() => {
  process.env.NEW_API_URL = "https://v2api.top";
  process.env.NEW_API_ADMIN_TOKEN = "admin-pat-123";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("createNewApiUser", () => {
  it("posts to /api/user/ with the admin PAT and role=1", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: "" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createNewApiUser({ username: "team-abc", password: "s3cret!!", displayName: "Team ABC" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://v2api.top/api/user/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer admin-pat-123" }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ username: "team-abc", password: "s3cret!!", display_name: "Team ABC", role: 1 });
  });

  it("throws NewApiAdminError when new-api reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, message: "duplicate" }), { status: 200 })),
    );
    await expect(
      createNewApiUser({ username: "dupe", password: "s3cret!!", displayName: "Dupe" }),
    ).rejects.toThrow(NewApiAdminError);
  });
});

describe("findNewApiUserIdByUsername", () => {
  it("returns the matching user's id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { items: [{ id: 42, username: "team-abc" }] } }),
          { status: 200 },
        ),
      ),
    );
    await expect(findNewApiUserIdByUsername("team-abc")).resolves.toBe(42);
  });

  it("returns null when no user matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [] } }), { status: 200 })),
    );
    await expect(findNewApiUserIdByUsername("nobody")).resolves.toBeNull();
  });
});

describe("addNewApiUserQuota", () => {
  it("posts action=add_quota mode=add", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await addNewApiUserQuota(42, 500000);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ id: 42, action: "add_quota", mode: "add", value: 500000 });
  });
});

describe("disableNewApiUser", () => {
  it("posts action=disable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await disableNewApiUser(42);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ id: 42, action: "disable" });
  });
});

describe("getNewApiUserQuota", () => {
  it("maps quota/used_quota from GET /api/user/:id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { id: 42, quota: 1000, used_quota: 250 } }), { status: 200 }),
      ),
    );
    await expect(getNewApiUserQuota(42)).resolves.toEqual({ quota: 1000, usedQuota: 250 });
  });
});
