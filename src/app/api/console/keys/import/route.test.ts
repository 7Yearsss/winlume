import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), organization: vi.fn(), importExisting: vi.fn() }));
vi.mock("@/lib/console/server", () => ({
  requireConsoleContext: mocks.context,
  ensureOrganizationKeyManager: (role: string) => { if (!["owner", "admin"].includes(role)) throw new Error("forbidden"); },
  consoleJson: (body: unknown) => Response.json(body),
  consoleError: () => Response.json({ error: "forbidden" }, { status: 403 }),
}));
vi.mock("@/lib/console/workspace", () => ({ requireConsoleOrganization: mocks.organization }));
import { POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ userId: "user", repositories: { apiKeys: { importExisting: mocks.importExisting } } });
  mocks.importExisting.mockResolvedValue(3);
});
it("denies imports by viewers before reading secrets or writing records", async () => {
  mocks.organization.mockResolvedValue({ membership: { role: "viewer" }, organization: { id: "org" } });
  const response = await POST(new Request("https://reizo/api/console/keys/import", { method: "POST", body: JSON.stringify({ organizationId: "org" }) }));
  expect(response.status).toBe(403); expect(mocks.importExisting).not.toHaveBeenCalled();
});
it("imports into the authorized workspace, returning only a count", async () => {
  mocks.organization.mockResolvedValue({ membership: { role: "owner" }, organization: { id: "org" } });
  const response = await POST(new Request("https://reizo/api/console/keys/import", { method: "POST", body: JSON.stringify({ organizationId: "org" }) }));
  expect(await response.json()).toEqual({ imported: 3 });
  expect(mocks.importExisting).toHaveBeenCalledWith("user", "org");
});
