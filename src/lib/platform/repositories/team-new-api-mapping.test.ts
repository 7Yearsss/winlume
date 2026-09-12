import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("../../newapi/crypto", () => ({ decryptSecret: (s: string) => s.replace("enc:", ""), encryptSecret: (s: string) => `enc:${s}` }));
vi.mock("../../newapi/team-client", () => ({ loginAndMintPat: vi.fn(async () => "fresh") }));
import { loginAndMintPat } from "../../newapi/team-client";
import { TeamNewApiMappingRepository } from "./team-new-api-mapping";

describe("team credential recovery", () => {
  beforeEach(() => vi.clearAllMocks());
  function setup(ciphertext = "enc:old") {
    const lock = vi.fn(async () => [{ newApiUsername: "team", newApiPasswordCiphertext: "enc:password", newApiPatCiphertext: ciphertext }]);
    const write = vi.fn(() => ({ where: async () => undefined }));
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: lock }) }) }) }), update: () => ({ set: write }) };
    const database = { transaction: async (callback: (tx: unknown) => unknown) => callback(tx) };
    return { repository: new TeamNewApiMappingRepository(database as never), lock, write };
  }
  it("locks the mapping and persists a refreshed credential encrypted", async () => {
    const { repository, lock, write } = setup();
    expect(await repository.refreshPatIfUnchanged("org", "enc:old")).toBe("fresh");
    expect(lock).toHaveBeenCalledWith("update");
    expect(loginAndMintPat).toHaveBeenCalledWith("team", "password");
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ newApiPatCiphertext: "enc:fresh" }));
  });
  it("reuses a concurrent request's credential instead of revoking it", async () => {
    const { repository, write } = setup("enc:already-refreshed");
    expect(await repository.refreshPatIfUnchanged("org", "enc:old")).toBe("already-refreshed");
    expect(loginAndMintPat).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
});

describe("TeamNewApiMappingRepository.create", () => {
  it("inserts a mapping row using the provided transaction handle", async () => {
    const inserted = {
      organizationId: "org-1",
      newApiUserId: 42,
      newApiUsername: "team-abc",
      newApiPasswordCiphertext: "enc-pw",
      newApiPatCiphertext: "enc-pat",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const values = { returning: () => Promise.resolve([inserted]) };
    const insert = () => ({ values: () => values });
    const fakeTx = { insert } as unknown as Parameters<TeamNewApiMappingRepository["create"]>[0];

    const repository = new TeamNewApiMappingRepository();
    const result = await repository.create(fakeTx, {
      organizationId: "org-1",
      newApiUserId: 42,
      newApiUsername: "team-abc",
      newApiPasswordCiphertext: "enc-pw",
      newApiPatCiphertext: "enc-pat",
    });
    expect(result).toEqual(inserted);
  });
});
