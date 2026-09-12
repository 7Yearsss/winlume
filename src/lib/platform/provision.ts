import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { generateApiKey } from "./api-keys";
import type { PlatformDatabase } from "./db/client";
import { apiKeys, organizationMemberships, organizations, users } from "./db/schema";
import { encryptSecret } from "../newapi/crypto";
import { createNewApiUser, disableNewApiUser, findNewApiUserIdByUsername } from "../newapi/admin-client";
import { createTeamToken, fetchTeamTokenKey, findTeamTokenIdByName, loginAndMintPat } from "../newapi/team-client";
import { normalizeEmail, normalizeUsername, type PlatformUserRecord } from "./repositories/users";
import type { PlatformRole, UserStatus } from "./types";

export interface ProvisionPlatformUserInput {
  username: string;
  displayName?: string;
  email?: string | null;
  passwordHash?: string | null;
  image?: string | null;
  emailVerifiedAt?: Date | null;
  platformRole?: PlatformRole;
  status?: UserStatus;
  legacyNewApiUserId?: number | null;
}

const STUDIO_TOKEN_NAME = "studio";
const NEW_API_DISPLAY_NAME_MAX_LENGTH = 20;

// new-api's model.User enforces `validate:"max=20"` on Username and
// `validate:"min=8,max=20"` on Password (E:\CodeCode\new-api\model\user.go) —
// these must fit within that limit regardless of the Reizo username's own
// (much longer) length, so they're generated independently of it rather than
// derived from user input.
function generateNewApiUsername(): string {
  return `reizo-${randomBytes(6).toString("hex")}`; // "reizo-" (6) + 12 hex chars = 18
}

function generateNewApiPassword(): string {
  return randomBytes(9).toString("hex"); // 18 hex chars, within min=8/max=20
}

function truncateDisplayName(value: string, maxLength: number): string {
  // Array.from counts Unicode code points, avoiding a split surrogate pair.
  return Array.from(value).slice(0, maxLength).join("");
}

/**
 * Create a platform user with a default owner workspace backed by a dedicated new-api
 * account. New-api is provisioned first; the local transaction only runs once it
 * succeeds, and a local failure triggers a best-effort new-api compensation call
 * (design doc §5.1 — an orphaned new-api account on double failure is an accepted,
 * rare outcome, not something this function retries indefinitely).
 */
export async function provisionPlatformUser(
  database: PlatformDatabase,
  input: ProvisionPlatformUserInput,
): Promise<PlatformUserRecord> {
  const username = normalizeUsername(input.username);
  if (!username) throw new Error("A username is required.");
  const displayName = input.displayName?.trim() || username;
  const newApiDisplayName = truncateDisplayName(displayName, NEW_API_DISPLAY_NAME_MAX_LENGTH);

  const newApiUsername = generateNewApiUsername();
  const newApiPassword = generateNewApiPassword();

  await createNewApiUser({ username: newApiUsername, password: newApiPassword, displayName: newApiDisplayName });
  const newApiUserId = await findNewApiUserIdByUsername(newApiUsername);
  if (newApiUserId === null) {
    throw new Error("new-api user was created but could not be found afterward.");
  }

  try {
    const pat = await loginAndMintPat(newApiUsername, newApiPassword);
    await createTeamToken(pat, STUDIO_TOKEN_NAME, { allAvailableGroups: true });
    const studioTokenId = await findTeamTokenIdByName(pat, STUDIO_TOKEN_NAME);
    if (studioTokenId === null) {
      throw new Error("Studio token was created but could not be found afterward.");
    }
    const studioTokenKey = await fetchTeamTokenKey(pat, studioTokenId);

    return await database.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          username,
          displayName,
          email: normalizeEmail(input.email),
          passwordHash: input.passwordHash ?? null,
          image: input.image ?? null,
          emailVerifiedAt: input.emailVerifiedAt ?? null,
          platformRole: input.platformRole ?? "user",
          status: input.status ?? "active",
          legacyNewApiUserId: input.legacyNewApiUserId ?? null,
        })
        .returning();
      if (!createdUser) throw new Error("账户创建未返回记录。");

      const [organization] = await tx
        .insert(organizations)
        .values({
          name: `${createdUser.displayName} 的工作区`,
          slug: `${username}-${createdUser.id.slice(0, 8)}`,
          createdByUserId: createdUser.id,
        })
        .returning();
      if (!organization) throw new Error("工作区创建未返回记录。");

      await tx.insert(organizationMemberships).values({
        organizationId: organization.id,
        userId: createdUser.id,
        role: "owner",
      });

      const { TeamNewApiMappingRepository } = await import("./repositories/team-new-api-mapping");
      await new TeamNewApiMappingRepository().create(tx, {
        organizationId: organization.id,
        newApiUserId,
        newApiUsername,
        newApiPasswordCiphertext: encryptSecret(newApiPassword),
        newApiPatCiphertext: encryptSecret(pat),
      });

      const studioKey = generateApiKey();
      await tx.insert(apiKeys).values({
        userId: createdUser.id,
        organizationId: organization.id,
        name: "Studio",
        keyPrefix: studioKey.prefix,
        keyHash: studioKey.hash,
        newApiTokenId: studioTokenId,
        newApiKeyCiphertext: encryptSecret(studioTokenKey),
        isStudioHidden: true,
      });

      await tx
        .update(users)
        .set({ currentOrganizationId: organization.id })
        .where(eq(users.id, createdUser.id));

      return createdUser;
    });
  } catch (error) {
    try {
      await disableNewApiUser(newApiUserId);
    } catch (compensationError) {
      console.error(
        "Failed to compensate for orphaned new-api user after local registration failure",
        { newApiUserId, newApiUsername, compensationError },
      );
    }
    throw error;
  }
}
