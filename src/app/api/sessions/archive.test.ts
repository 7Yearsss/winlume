import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebFileStore } from "@/lib/host/web/file-store";
const mocks = vi.hoisted(() => ({ user: vi.fn(), store: null as unknown as ReturnType<typeof createWebFileStore> }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/host/web/store-singleton", () => ({ get webStore() { return mocks.store; } }));
vi.mock("@/lib/agent/infrastructure", () => ({ getAgentRunService: () => ({ findActiveSessionRun: async () => null }) }));
vi.mock("@/lib/studio/capabilities.server", () => ({ loadCapabilityCatalog: vi.fn() }));
import { GET as list } from "./route";
import { PATCH as patch, GET as read } from "./[id]/route";
let root: string;
const context = { params: Promise.resolve({ id: "session1" }) };
const change = (body: unknown) => patch(new NextRequest("http://localhost/api/sessions/session1", { method: "PATCH", body: JSON.stringify(body) }), context);
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "reizo-archive-"));
  mocks.store = createWebFileStore(root);
  mocks.user.mockResolvedValue("u1");
  await mocks.store.sessions.createSession({ id: "session1", userId: "u1", title: "Keep me", model: "gpt-test", projectId: "project1" });
  await mocks.store.sessions.appendMessages("u1", "session1", [{ id: "m1", sessionId: "session1", role: "user", content: "original", createdAt: new Date().toISOString() }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe("session archive lifecycle", () => {
  it("archives and restores after store reload without losing messages or metadata", async () => {
    expect((await change({ archived: true })).status).toBe(200);
    mocks.store = createWebFileStore(root);
    const active = await list(new NextRequest("http://localhost/api/sessions"));
    expect((await active.json()).sessions).toHaveLength(0);
    const archived = await list(new NextRequest("http://localhost/api/sessions?archived=true&projectId=project1"));
    expect((await archived.json()).sessions[0]).toMatchObject({ archived: true, model: "gpt-test", projectId: "project1" });
    await change({ title: "Renamed" });
    expect((await mocks.store.sessions.getSession("u1", "session1"))?.archived).toBe(true);
    const bundle = await read(new NextRequest("http://localhost/api/sessions/session1"), context);
    expect((await bundle.json()).messages[0].content).toBe("original");
    expect((await change({ archived: false })).status).toBe(200);
    const restored = await list(new NextRequest("http://localhost/api/sessions"));
    expect((await restored.json()).sessions[0]).toMatchObject({ archived: false, title: "Renamed" });
  });
  it("treats legacy sessions as active and keeps project filtering", async () => {
    expect((await (await list(new NextRequest("http://localhost/api/sessions"))).json()).sessions).toHaveLength(1);
    expect((await (await list(new NextRequest("http://localhost/api/sessions?projectId=other"))).json()).sessions).toHaveLength(0);
  });
  it("rejects unauthorized and cross-user mutations", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await change({ archived: true })).status).toBe(401);
    mocks.user.mockResolvedValue("u2");
    expect((await change({ archived: true })).status).toBe(404);
    expect((await mocks.store.sessions.getSession("u1", "session1"))?.archived).toBeUndefined();
  });
  it.each([null, [], { archived: "true" }, { archived: 1 }])("rejects malformed patches: %j", async body => {
    expect((await change(body)).status).toBe(400);
  });
});
