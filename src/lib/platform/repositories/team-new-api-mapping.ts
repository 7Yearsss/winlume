import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { PlatformDatabase } from "../db/client";
import { teamNewApiMapping } from "../db/schema";
import { decryptSecret, encryptSecret } from "../../newapi/crypto";
import { loginAndMintPat } from "../../newapi/team-client";

export type TeamNewApiMappingRecord = InferSelectModel<typeof teamNewApiMapping>;

export interface CreateTeamNewApiMappingInput {
  organizationId: string;
  newApiUserId: number;
  newApiUsername: string;
  newApiPasswordCiphertext: string;
  newApiPatCiphertext: string;
}

type Transaction = Pick<PlatformDatabase, "insert">;

export class TeamNewApiMappingRepository {
  constructor(private readonly database?: PlatformDatabase) {}

  async create(tx: Transaction, input: CreateTeamNewApiMappingInput): Promise<TeamNewApiMappingRecord> {
    const [record] = await tx
      .insert(teamNewApiMapping)
      .values({
        organizationId: input.organizationId,
        newApiUserId: input.newApiUserId,
        newApiUsername: input.newApiUsername,
        newApiPasswordCiphertext: input.newApiPasswordCiphertext,
        newApiPatCiphertext: input.newApiPatCiphertext,
      })
      .returning();
    if (!record) throw new Error("Failed to create team/new-api mapping.");
    return record;
  }

  async findByOrganizationId(organizationId: string): Promise<TeamNewApiMappingRecord | null> {
    if (!this.database) throw new Error("TeamNewApiMappingRepository was constructed without a database.");
    const [record] = await this.database
      .select()
      .from(teamNewApiMapping)
      .where(eq(teamNewApiMapping.organizationId, organizationId))
      .limit(1);
    return record ?? null;
  }

  async refreshPatIfUnchanged(organizationId: string, previousCiphertext: string): Promise<string> {
    if (!this.database) throw new Error("Team mapping database is unavailable.");
    // The upstream issues one PAT per account. Lock the mapping so concurrent
    // requests cannot revoke each other's freshly issued credentials.
    return this.database.transaction(async tx => {
      const [mapping] = await tx.select().from(teamNewApiMapping)
        .where(eq(teamNewApiMapping.organizationId, organizationId)).limit(1).for("update");
      if (!mapping) throw new Error("This organization has no linked new-api team account.");
      if (mapping.newApiPatCiphertext !== previousCiphertext) return decryptSecret(mapping.newApiPatCiphertext);
      const pat = await loginAndMintPat(mapping.newApiUsername, decryptSecret(mapping.newApiPasswordCiphertext));
      await tx.update(teamNewApiMapping).set({ newApiPatCiphertext: encryptSecret(pat), updatedAt: new Date() })
        .where(eq(teamNewApiMapping.organizationId, organizationId));
      return pat;
    });
  }
}
