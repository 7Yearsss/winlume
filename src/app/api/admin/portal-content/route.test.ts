import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ allowed: true, record: null as unknown }));
vi.mock("@/lib/platform/admin", () => {
  class PlatformAdminError extends Error { status = 403; }
  return { PlatformAdminError, requirePlatformAdmin: async () => { if (!state.allowed) throw new PlatformAdminError("Forbidden"); } };
});
vi.mock("@/lib/platform/repositories", () => ({ getPlatformRepositories: () => ({ portalContent: {
  get: async () => state.record,
  set: async (_key: string, value: unknown) => { state.record = value; },
} }) }));

import { PUT } from "./route";
import { getPortalContent, getPortalImage, getPublicPortalContent, invalidatePortalContentCache, normalizePortalContent } from "@/lib/portal/content-config";

beforeEach(() => {
  state.allowed = true;
  state.record = normalizePortalContent({ notifications: [{ id: "keep", title: "保留通知", body: "其他模块内容" }] });
  invalidatePortalContentCache();
});

function request(value: unknown) {
  return new NextRequest("http://localhost/api/admin/portal-content", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ section: "toolDirectory", value }),
  });
}

describe("tool directory publication", () => {
  it("saves the tool section, preserves other sections and serves the uploaded image", async () => {
    const response = await PUT(request([{ id: "copywriting", imageUrl: "data:image/png;base64,aGVsbG8=", featured: false, enabled: true }]));
    expect(response.status).toBe(200);
    const saved = await getPortalContent({ fresh: true });
    expect(saved.notifications[0].id).toBe("keep");
    expect(saved.toolDirectory[0]).toMatchObject({ id: "copywriting", featured: false });
    const published = await getPublicPortalContent();
    expect(published.toolDirectory[0].imageUrl).toContain("/api/portal/image?section=toolDirectory&id=copywriting&v=");
    const image = await getPortalImage("toolDirectory", "copywriting");
    expect(image?.mimeType).toBe("image/png");
    expect(image?.data.toString()).toBe("hello");
    expect(await getPortalImage("toolDirectory", "unknown")).toBeNull();
  });

  it("rejects non-admin publication without changing stored content", async () => {
    const original = state.record;
    state.allowed = false;
    const response = await PUT(request([{ id: "copywriting", enabled: false }]));
    expect(response.status).toBe(403);
    expect(state.record).toBe(original);
  });
});
