import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { PlatformDatabase } from "../db/client";
import { apiKeys } from "../db/schema";
import { generateApiKey, hashApiKey } from "../api-keys";
import { decryptSecret, encryptSecret } from "../../newapi/crypto";
import {
  createTeamToken,
  fetchTeamTokenKey,
  findTeamTokenIdByName,
  revokeTeamToken,
  updateTeamToken,
  NewApiTeamError,
} from "../../newapi/team-client";
import { TeamNewApiMappingRepository } from "./team-new-api-mapping";
import type { ApiKeyStatus } from "../types";

export type ApiKeyRecord = InferSelectModel<typeof apiKeys>;

export interface CreateApiKeyInput {
  userId: string;
  organizationId: string;
  name: string;
  scopes?: string[];
  allowedModels?: string[];
  allowedGroups?: string[];
  ipAllowlist?: string[];
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export class ApiKeyRepository {
  private readonly teamMappings: TeamNewApiMappingRepository;

  constructor(private readonly database: PlatformDatabase) {
    // Must construct after `database` is assigned — field initializers run before
    // parameter properties, so `new TeamNewApiMappingRepository(this.database)` at
    // field-init time would pass undefined.
    this.teamMappings = new TeamNewApiMappingRepository(database);
  }

  private async withTeamPat<T>(organizationId: string, operation: (pat: string) => Promise<T>): Promise<T> {
    const mapping = await this.teamMappings.findByOrganizationId(organizationId);
    if (!mapping) throw new Error("This organization has no linked new-api team account.");
    try { return await operation(decryptSecret(mapping.newApiPatCiphertext)); }
    catch (error) {
      // An explicit 401 means this operation was rejected before execution.
      // Never replay successful creation, timeouts, or other uncertain writes.
      if (!(error instanceof NewApiTeamError) || error.status !== 401) throw error;
      const pat = await this.teamMappings.refreshPatIfUnchanged(organizationId, mapping.newApiPatCiphertext);
      return operation(pat);
    }
  }

  async create(input: CreateApiKeyInput): Promise<{ record: ApiKeyRecord; plaintext: string }> {
    const name = input.name.trim();
    if (!name) throw new Error("An API key name is required.");

    await this.withTeamPat(input.organizationId, pat => createTeamToken(pat, name, {
      allAvailableGroups: true,
      expiredTime: unixExpiry(input.expiresAt),
      modelLimits: input.allowedModels ?? [],
      allowIps: input.ipAllowlist ?? [],
    }));
    const newApiTokenId = await this.withTeamPat(input.organizationId, pat => findTeamTokenIdByName(pat, name));
    if (newApiTokenId === null) throw new Error("new-api token was created but could not be found afterward.");
    const newApiKey = await this.withTeamPat(input.organizationId, pat => fetchTeamTokenKey(pat, newApiTokenId));

    const generated = generateApiKey();
    const [record] = await this.database
      .insert(apiKeys)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        name,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        scopes: input.scopes ?? [],
        allowedModels: input.allowedModels ?? [],
        allowedGroups: input.allowedGroups ?? [],
        ipAllowlist: input.ipAllowlist ?? [],
        newApiTokenId,
        newApiKeyCiphertext: encryptSecret(newApiKey),
        expiresAt: input.expiresAt ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    if (!record) throw new Error("Failed to create API key.");
    return { record, plaintext: generated.plaintext };
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const [record] = await this.database.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    return record ?? null;
  }

  async findActiveByPlaintext(plaintext: string): Promise<ApiKeyRecord | null> {
    const keyHash = hashApiKey(plaintext);
    const [record] = await this.database
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, keyHash),
          eq(apiKeys.status, "active"),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
        ),
      )
      .limit(1);
    if (!record) return null;
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null;
    return record;
  }

  async listForUser(userId: string, organizationId?: string): Promise<ApiKeyRecord[]> {
    const conditions = [eq(apiKeys.userId, userId)];
    if (organizationId) conditions.push(eq(apiKeys.organizationId, organizationId));
    return this.database.select().from(apiKeys).where(and(...conditions));
  }

  /**
   * Returns every API key created by any member of the organization, not just
   * the caller's own keys. Use this for org-shared key visibility; `listForUser`
   * still scopes to a single user even when an organizationId is supplied.
   */
  async listForOrganization(organizationId: string): Promise<ApiKeyRecord[]> {
    return this.database.select().from(apiKeys).where(eq(apiKeys.organizationId, organizationId));
  }

  async setStatus(id: string, status: ApiKeyStatus): Promise<ApiKeyRecord | null> {
    const [record] = await this.database
      .update(apiKeys)
      .set({
        status,
        revokedAt: status === "revoked" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, id))
      .returning();
    return record ?? null;
  }

  /** Marks the key revoked locally, then best-effort revokes the new-api token behind it —
   * a revoked local key stops working at the proxy regardless of new-api-side state, so a
   * failure here is logged, not thrown (design doc §5.3). */
  async revoke(id: string): Promise<ApiKeyRecord | null> {
    const record = await this.setStatus(id, "revoked");
    if (record?.newApiTokenId && record.organizationId) {
      try {
        await this.withTeamPat(record.organizationId, pat => revokeTeamToken(pat, record.newApiTokenId!));
      } catch (error) {
        console.error("Failed to revoke underlying new-api token", { keyId: id, error });
      }
    }
    return record;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.database.update(apiKeys).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  async update(
    id: string,
    input: {
      name: string;
      expiresAt: Date | null;
      allowedModels: string[];
      ipAllowlist: string[];
    },
  ): Promise<ApiKeyRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const name = input.name.trim();
    if (!name) throw new Error("An API key name is required.");

    if (existing.newApiTokenId && existing.organizationId) {
      await this.withTeamPat(existing.organizationId, pat => updateTeamToken(pat, existing.newApiTokenId!, {
        allAvailableGroups: true,
        name,
        expiredTime: unixExpiry(input.expiresAt),
        modelLimits: input.allowedModels,
        allowIps: input.ipAllowlist,
      }));
    }

    const [record] = await this.database
      .update(apiKeys)
      .set({
        name,
        expiresAt: input.expiresAt,
        allowedModels: input.allowedModels,
        ipAllowlist: input.ipAllowlist,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, id))
      .returning();
    return record ?? null;
  }
}

function unixExpiry(value?: Date | null): number {
  if (!value) return -1;
  return Math.floor(value.getTime() / 1000);
}
