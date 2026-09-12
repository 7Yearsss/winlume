import { getPlatformRepositories } from "@/lib/platform";
import { decryptSecret } from "@/lib/newapi/crypto";

/**
 * Resolve the team's hidden Studio new-api bearer token for LLM calls.
 * Looks up the user's current organization, finds the is_studio_hidden api_keys
 * row, and decrypts new_api_key_ciphertext.
 */
export async function resolveStudioToken(userId: string): Promise<string> {
  const repositories = getPlatformRepositories();
  if (!repositories) throw new Error("Platform database is not configured.");

  const user = await repositories.users.findById(userId);
  if (!user?.currentOrganizationId) {
    throw new Error(`User ${userId} has no current organization to resolve a Studio token for.`);
  }

  const keys = await repositories.apiKeys.listForOrganization(user.currentOrganizationId);
  const membership = await repositories.organizations.getMembership(user.currentOrganizationId, userId);
  if (!membership) throw new Error("你已不属于当前工作区，请切换工作区。");
  const studioKey = keys.find((key) => key.isStudioHidden && key.status === "active"
    && (!key.expiresAt || key.expiresAt.getTime() > Date.now()));
  if (!studioKey?.newApiKeyCiphertext) {
    throw new Error(`Organization ${user.currentOrganizationId} has no Studio token provisioned.`);
  }
  return decryptSecret(studioKey.newApiKeyCiphertext);
}
