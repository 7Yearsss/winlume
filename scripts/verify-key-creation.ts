// Operator smoke test: creates one temporary key in an admin-owned workspace,
// checks model-agnostic routing, then removes only that test key.
import { and, eq } from "drizzle-orm";
import { requirePlatformDb } from "../src/lib/platform/db/client";
import { users, apiKeys, organizationMemberships } from "../src/lib/platform/db/schema";
import { ApiKeyRepository } from "../src/lib/platform/repositories/api-keys";
import { TeamNewApiMappingRepository } from "../src/lib/platform/repositories/team-new-api-mapping";
import { decryptSecret } from "../src/lib/newapi/crypto";
import { fetchTeamToken, findTeamTokenIdByName, revokeTeamToken } from "../src/lib/newapi/team-client";

async function main() {
  const db = requirePlatformDb();
  const [owner] = await db.select({ id: users.id, username: users.username, legacyId: users.legacyNewApiUserId, organizationId: organizationMemberships.organizationId })
    .from(users).innerJoin(organizationMemberships, eq(organizationMemberships.userId, users.id))
    .where(and(eq(users.username, "admin"), eq(organizationMemberships.organizationId, users.currentOrganizationId), eq(organizationMemberships.role, "owner"))).limit(1);
  if (!owner) throw new Error("No admin-owned workspace available for verification");
  const mappings = new TeamNewApiMappingRepository(db);
  const mapping = await mappings.findByOrganizationId(owner.organizationId);
  if (!mapping) throw new Error("Workspace mapping unavailable");
  const repository = new ApiKeyRepository(db);
  const upstream = await repository.listUpstreamForOrganization(owner.organizationId);
  const local = await repository.listForOrganization(owner.organizationId);
  const linked = new Set(local.map(key => key.newApiTokenId));
  console.log(JSON.stringify({ username: owner.username, linkedNewApiUsername: mapping.newApiUsername,
    legacyAccountMatchesWorkspace: owner.legacyId === mapping.newApiUserId,
    upstreamKeyCount: upstream.length, additionalVisibleKeys: upstream.filter(key => !linked.has(key.id)).length }));
  const name = `reizo-check-${Date.now()}`;
  let createdId: string | undefined;
  try {
    const { record } = await repository.create({ userId: owner.id, organizationId: owner.organizationId, name });
    createdId = record.id;
    const mapping = await new TeamNewApiMappingRepository(db).findByOrganizationId(owner.organizationId);
    if (!mapping || !record.newApiTokenId || !record.newApiKeyCiphertext) throw new Error("Created key mapping missing");
    const token = await fetchTeamToken(decryptSecret(mapping.newApiPatCiphertext), record.newApiTokenId);
    if (token.modelLimitsEnabled || token.group !== "auto") throw new Error("Key is not configured for unrestricted automatic routing");
    const response = await fetch(`${process.env.NEW_API_URL?.replace(/\/+$/, "")}/v1/models`, {
      headers: { Authorization: `Bearer ${decryptSecret(record.newApiKeyCiphertext)}` }, signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.data) || !result.data.length) throw new Error("Created key cannot read the model catalog");
    console.log(JSON.stringify({ created: true, unrestrictedModels: true, group: token.group, availableModelCount: result.data.length }));
  } finally {
    const mapping = await new TeamNewApiMappingRepository(db).findByOrganizationId(owner.organizationId);
    if (mapping) {
      const pat = decryptSecret(mapping.newApiPatCiphertext);
      const tokenId = await findTeamTokenIdByName(pat, name);
      if (tokenId !== null) await revokeTeamToken(pat, tokenId);
    }
    if (createdId) await db.delete(apiKeys).where(and(eq(apiKeys.id, createdId), eq(apiKeys.name, name)));
    console.log("Temporary verification key cleaned up");
  }
}
main().then(() => process.exit(0)).catch(error => {
  console.error("Key verification failed", { type: error?.name, status: error?.status });
  process.exit(1);
});
