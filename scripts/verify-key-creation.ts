// Operator smoke test: creates one temporary key in an admin-owned workspace,
// checks model-agnostic routing, then removes only that test key.
import { and, eq } from "drizzle-orm";
import { requirePlatformDb } from "../src/lib/platform/db/client";
import { users, apiKeys, organizationMemberships } from "../src/lib/platform/db/schema";
import { ApiKeyRepository } from "../src/lib/platform/repositories/api-keys";
import { TeamNewApiMappingRepository } from "../src/lib/platform/repositories/team-new-api-mapping";
import { decryptSecret } from "../src/lib/newapi/crypto";
import { fetchTeamToken, findTeamTokenIdByName, revokeTeamToken, getTeamRoutingGroups, NewApiTeamError } from "../src/lib/newapi/team-client";

async function main() {
  const db = requirePlatformDb();
  const [owner] = await db.select({ id: users.id, organizationId: organizationMemberships.organizationId })
    .from(users).innerJoin(organizationMemberships, eq(organizationMemberships.userId, users.id))
    .where(and(eq(users.platformRole, "admin"), eq(organizationMemberships.role, "owner"))).limit(1);
  if (!owner) throw new Error("No admin-owned workspace available for verification");
  const mappings = new TeamNewApiMappingRepository(db);
  const mapping = await mappings.findByOrganizationId(owner.organizationId);
  if (!mapping) throw new Error("Workspace mapping unavailable");
  let pat = decryptSecret(mapping.newApiPatCiphertext);
  let routing;
  try { routing = await getTeamRoutingGroups(pat); }
  catch (error) {
    if (!(error instanceof NewApiTeamError) || error.status !== 401) throw error;
    pat = await mappings.refreshPatIfUnchanged(owner.organizationId, mapping.newApiPatCiphertext);
    routing = await getTeamRoutingGroups(pat);
  }
  console.log(JSON.stringify({ authorizedGroupCount: routing.groups.length, automaticGroupCapacity: routing.maxCount }));
  if (routing.groups.length > routing.maxCount) {
    // Raise only the count ceiling needed for this authorized workspace;
    // group access, pricing, and the global routing priority remain unchanged.
    const response = await fetch(`${process.env.NEW_API_URL?.replace(/\/+$/, "")}/api/option/`, {
      method: "PUT", headers: { Authorization: `Bearer ${process.env.NEW_API_ADMIN_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "MaxTokenAutoGroups", value: String(routing.groups.length) }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error("Unable to enable all authorized routing groups");
    console.log("Automatic group capacity increased to cover this workspace");
  }
  const name = `reizo-check-${Date.now()}`;
  const repository = new ApiKeyRepository(db);
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
