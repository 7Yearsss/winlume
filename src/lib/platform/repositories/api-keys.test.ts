import { beforeEach, describe, expect, it, vi } from "vitest";

const { findByOrganizationId, refreshPatIfUnchanged, constructDatabases } = vi.hoisted(() => ({
  findByOrganizationId: vi.fn(),
  refreshPatIfUnchanged: vi.fn(async () => "fresh-pat"),
  constructDatabases: [] as unknown[],
}));

vi.mock("../../newapi/team-client", () => ({
  NewApiTeamError: class extends Error { constructor(message: string, public status: number) { super(message); } },
  createTeamToken: vi.fn(async () => {}),
  findTeamTokenIdByName: vi.fn(async () => 55),
  fetchTeamTokenKey: vi.fn(async () => "sk-newapi-raw"),
  revokeTeamToken: vi.fn(async () => {}),
  updateTeamToken: vi.fn(async () => {}),
}));
vi.mock("../../newapi/crypto", () => ({
  encryptSecret: vi.fn((value: string) => `enc(${value})`),
  decryptSecret: vi.fn((value: string) => value.replace(/^enc\(|\)$/g, "")),
}));
// Mock the whole mapping module so ApiKeyRepository constructs a real dependency
// instance with the database it was given (catches field-init order bugs).
vi.mock("./team-new-api-mapping", () => ({
  TeamNewApiMappingRepository: class TeamNewApiMappingRepository {
    constructor(database?: unknown) {
      constructDatabases.push(database);
    }
    findByOrganizationId = findByOrganizationId;
    refreshPatIfUnchanged = refreshPatIfUnchanged;
  },
}));

import { createTeamToken, revokeTeamToken, updateTeamToken, fetchTeamTokenKey, NewApiTeamError } from "../../newapi/team-client";
import { ApiKeyRepository } from "./api-keys";

const mappingRow = {
  organizationId: "org-1",
  newApiUserId: 42,
  newApiUsername: "reizo-team-abc",
  newApiPasswordCiphertext: "enc(pw)",
  newApiPatCiphertext: "enc(pat)",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeDatabase(insertedRow: Record<string, unknown>) {
  return {
    insert: () => ({ values: () => ({ returning: async () => [insertedRow] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [insertedRow] }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [insertedRow] }) }) }),
  } as unknown as ConstructorParameters<typeof ApiKeyRepository>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  constructDatabases.length = 0;
  findByOrganizationId.mockResolvedValue(mappingRow);
});

describe("ApiKeyRepository construction", () => {
  it("passes the database into the gateway's credential repository on use", async () => {
    const database = fakeDatabase({ id: "key-1" });
    await new ApiKeyRepository(database).create({ userId: "user-1", organizationId: "org-1", name: "test" });
    expect(constructDatabases.length).toBeGreaterThan(0);
    expect(constructDatabases.every(value => value === database)).toBe(true);
  });
});

describe("ApiKeyRepository.create (new-api backed)", () => {
  it("recovers an expired team credential and retries only the rejected operation", async () => {
    vi.mocked(createTeamToken).mockRejectedValueOnce(new NewApiTeamError("Unauthorized, invalid access token", 401));
    const repository = new ApiKeyRepository(fakeDatabase({ id: "key-1" }));
    await expect(repository.create({ userId: "user-1", organizationId: "org-1", name: "ce" })).resolves.toHaveProperty("plaintext");
    expect(refreshPatIfUnchanged).toHaveBeenCalledWith("org-1", "enc(pat)");
    expect(createTeamToken).toHaveBeenLastCalledWith("fresh-pat", "ce", expect.objectContaining({ modelLimits: [] }));
  });
  it("does not create another token when key retrieval needs refreshed credentials", async () => {
    vi.mocked(fetchTeamTokenKey).mockRejectedValueOnce(new NewApiTeamError("Unauthorized", 401));
    await new ApiKeyRepository(fakeDatabase({ id: "key-1" })).create({ userId: "user-1", organizationId: "org-1", name: "ce" });
    expect(createTeamToken).toHaveBeenCalledTimes(1);
    expect(fetchTeamTokenKey).toHaveBeenLastCalledWith("fresh-pat", 55);
  });
  it("does not retry quota, permission or network failures", async () => {
    vi.mocked(createTeamToken).mockRejectedValueOnce(new NewApiTeamError("Forbidden", 403));
    await expect(new ApiKeyRepository(fakeDatabase({})).create({ userId: "user-1", organizationId: "org-1", name: "ce" })).rejects.toThrow("Forbidden");
    expect(refreshPatIfUnchanged).not.toHaveBeenCalled();
  });
  it("creates a new-api token before storing the local key row", async () => {
    const database = fakeDatabase({
      id: "key-1",
      userId: "user-1",
      organizationId: "org-1",
      keyPrefix: "wl_abc123",
      keyHash: "hash",
      newApiTokenId: 55,
      newApiKeyCiphertext: "enc(sk-newapi-raw)",
    });
    const repository = new ApiKeyRepository(database);

    const result = await repository.create({ userId: "user-1", organizationId: "org-1", name: "CI key" });

    expect(findByOrganizationId).toHaveBeenCalledWith("org-1");
    expect(createTeamToken).toHaveBeenCalledWith("pat", "CI key", {
      allAvailableGroups: true,
      expiredTime: -1,
      modelLimits: [],
      allowIps: [],
    });
    expect(result.record.newApiTokenId).toBe(55);
    expect(result.plaintext).toMatch(/^wl_/);
  });
});

describe("ApiKeyRepository.update (new-api backed)", () => {
  it("syncs name and limits to the new-api token before writing the local row", async () => {
    const database = fakeDatabase({
      id: "key-1",
      organizationId: "org-1",
      newApiTokenId: 55,
      name: "CI key",
    });
    const repository = new ApiKeyRepository(database);
    const expiresAt = new Date("2028-01-01T00:00:00.000Z");
    await repository.update("key-1", {
      name: "CI key v2",
      expiresAt,
      allowedModels: ["gpt-4o"],
      ipAllowlist: ["203.0.113.10"],
    });
    expect(updateTeamToken).toHaveBeenCalledWith("pat", 55, {
      allAvailableGroups: true,
      name: "CI key v2",
      expiredTime: Math.floor(expiresAt.getTime() / 1000),
      modelLimits: ["gpt-4o"],
      allowIps: ["203.0.113.10"],
    });
  });
});

describe("ApiKeyRepository.revoke (new-api backed)", () => {
  it("revokes the underlying token before reporting success", async () => {
    const database = fakeDatabase({
      id: "key-1",
      status: "revoked",
      newApiTokenId: 55,
      organizationId: "org-1",
    });
    const repository = new ApiKeyRepository(database);
    await repository.revoke("key-1");
    expect(findByOrganizationId).toHaveBeenCalledWith("org-1");
    expect(revokeTeamToken).toHaveBeenCalledWith("pat", 55);
  });

  it("does not report successful revocation when gateway authorization fails", async () => {
    findByOrganizationId.mockRejectedValue(new Error("db down"));
    const database = fakeDatabase({
      id: "key-1",
      status: "revoked",
      newApiTokenId: 55,
      organizationId: "org-1",
    });
    const repository = new ApiKeyRepository(database);
    await expect(repository.revoke("key-1")).rejects.toThrow("db down");
    expect(revokeTeamToken).not.toHaveBeenCalled();
  });
});
