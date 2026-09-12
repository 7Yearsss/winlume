import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { PlatformDatabase } from "../db/client";
import { apiKeys } from "../db/schema";
import { generateApiKey, hashApiKey } from "../api-keys";
import { encryptSecret } from "../../newapi/crypto";
import { workspaceGateway } from "../../gateway/workspace";
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
  constructor(private readonly database: PlatformDatabase) {}

  async create(input: CreateApiKeyInput): Promise<{ record: ApiKeyRecord; plaintext: string }> {
    const name = input.name.trim();
    if (!name) throw new Error("An API key name is required.");

    await workspaceGateway(this.database, input.organizationId).createKey(name, {
      allAvailableGroups: true,
      expiredTime: unixExpiry(input.expiresAt),
      modelLimits: input.allowedModels ?? [],
      allowIps: input.ipAllowlist ?? [],
    });
    const newApiTokenId = await workspaceGateway(this.database, input.organizationId).findKey(name);
    if (newApiTokenId === null) throw new Error("new-api token was created but could not be found afterward.");
    const newApiKey = await workspaceGateway(this.database, input.organizationId).revealKey(newApiTokenId);

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

  async listUpstreamForOrganization(organizationId: string) {
    return workspaceGateway(this.database, organizationId).listKeys();
  }

  /** Explicit owner/admin action: preserve existing secrets and restrictions. */
  async importExisting(userId: string, organizationId: string): Promise<number> {
    const gateway = workspaceGateway(this.database, organizationId);
    const upstream = await gateway.listKeys();
    return this.database.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"key-import:" + organizationId}, 0))`);
      const local = await tx.select().from(apiKeys).where(eq(apiKeys.organizationId, organizationId));
      const known = new Set(local.map(key => key.newApiTokenId));
      let count = 0;
      for (const token of upstream) {
        if (known.has(token.id)) continue;
        const secret = await gateway.revealKey(token.id);
        const [record] = await tx.insert(apiKeys).values({
          userId, organizationId, name: token.name.slice(0, 120),
          keyPrefix: secret.slice(0, 9), keyHash: hashApiKey(secret),
          status: token.status === 2 || token.status === 4 ? "disabled" : "active",
          allowedModels: token.model_limits_enabled ? (token.model_limits || "").split(",").filter(Boolean) : [],
          ipAllowlist: (token.allow_ips || "").split(/[\s,]+/).filter(Boolean),
          newApiTokenId: token.id, newApiKeyCiphertext: encryptSecret(secret),
          expiresAt: token.expired_time > 0 ? new Date(token.expired_time * 1000) : null,
          lastUsedAt: token.accessed_time > 0 ? new Date(token.accessed_time * 1000) : null,
          createdAt: token.created_time > 0 ? new Date(token.created_time * 1000) : new Date(),
          metadata: { imported: true },
        }).returning();
        if (!record) throw new Error("历史密钥纳管失败。");
        known.add(token.id); count += 1;
      }
      return count;
    });
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

  async setEnabled(id: string, enabled: boolean): Promise<ApiKeyRecord | null> {
    const record = await this.findById(id);
    if (!record || record.status === "revoked") throw new Error("已撤销的密钥不能重新启用。");
    if (record.newApiTokenId && record.organizationId) {
      await workspaceGateway(this.database, record.organizationId).setKeyEnabled(record.newApiTokenId, enabled);
    }
    return this.setStatus(id, enabled ? "active" : "disabled");
  }

  /** Imported secrets can still be used upstream: require confirmed revocation. */
  async revoke(id: string): Promise<ApiKeyRecord | null> {
    const record = await this.findById(id);
    if (record?.newApiTokenId && record.organizationId) {
      await workspaceGateway(this.database, record.organizationId).revokeKey(record.newApiTokenId);
    }
    return record ? this.setStatus(id, "revoked") : null;
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
      await workspaceGateway(this.database, existing.organizationId).updateKey(existing.newApiTokenId, {
        allAvailableGroups: existing.metadata?.imported !== true,
        name,
        expiredTime: unixExpiry(input.expiresAt),
        modelLimits: input.allowedModels,
        allowIps: input.ipAllowlist,
      });
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
