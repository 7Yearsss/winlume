/** Run only on the application host. Never prints credentials or user input. */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { requirePlatformDb } from "../src/lib/platform/db/client";
import { users, organizations, organizationMemberships, teamNewApiMapping, apiKeys } from "../src/lib/platform/db/schema";
import { decryptSecret } from "../src/lib/newapi/crypto";
import { provisionPlatformUser } from "../src/lib/platform/provision";
import { disableNewApiUser } from "../src/lib/newapi/admin-client";
import { revokeTeamToken } from "../src/lib/newapi/team-client";

async function main() {
  const db = requirePlatformDb();
  const base = process.env.NEW_API_URL!.replace(/\/+$/, "");
  async function probe(token: string, path: string) {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    return { ok: response.ok && body.success === true, status: response.status, data: body.data };
  }
  const old = await probe(process.env.NEW_API_ADMIN_TOKEN || "", "/api/user/self");
  console.log(JSON.stringify({ configuredCredentialAccepted: old.ok, status: old.status }));
  const [mapping] = await db.select({ ciphertext: teamNewApiMapping.newApiPatCiphertext, upstreamId: teamNewApiMapping.newApiUserId })
    .from(users).innerJoin(organizationMemberships, eq(users.id, organizationMemberships.userId))
    .innerJoin(teamNewApiMapping, eq(teamNewApiMapping.organizationId, organizationMemberships.organizationId))
    .where(and(eq(users.username, "admin"), eq(users.platformRole, "admin"), eq(organizationMemberships.role, "owner"), eq(organizationMemberships.organizationId, users.currentOrganizationId))).limit(1);
  if (!mapping) throw new Error("Verified admin mapping unavailable");
  const token = decryptSecret(mapping.ciphertext);
  const self = await probe(token, "/api/user/self");
  if (!self.ok || self.data?.id !== mapping.upstreamId || self.data?.role < 10) throw new Error("Mapped credential is not an upstream administrator");
  const access = await probe(token, "/api/user/search?keyword=reizo-registration-probe");
  if (!access.ok) throw new Error("Mapped administrator cannot access provisioning management");
  console.log(JSON.stringify({ mappedAdminVerified: true, adminManagementAccessible: true, credentialsDiffer: token !== process.env.NEW_API_ADMIN_TOKEN }));
  if (process.env.REPAIR_REGISTRATION !== "true") return;
  if (!/^[A-Za-z0-9._-]+$/.test(token)) throw new Error("Credential cannot be safely encoded in environment file");
  const path = "/etc/reizo/web.env";
  mkdirSync("/etc/reizo", { recursive: true, mode: 0o700 });
  let previous = "";
  try { previous = readFileSync(path, "utf8"); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  const next = previous.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?NEW_API_ADMIN_TOKEN\s*=/.test(line)).join("\n").trimEnd() + `\nNEW_API_ADMIN_TOKEN=${token}\n`;
  writeFileSync(path + ".registration-backup", previous, { mode: 0o600 });
  writeFileSync(path + ".registration-tmp", next, { mode: 0o600 });
  renameSync(path + ".registration-tmp", path);
  process.env.NEW_API_ADMIN_TOKEN = token;
  console.log("Administrator environment repaired; previous configuration retained securely on host");
  let userId: string | undefined;
  try {
    const user = await provisionPlatformUser(db, { username: `regcheck-${randomBytes(5).toString("hex")}`, displayName: "Registration check" });
    userId = user.id;
    const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.isStudioHidden, true)));
    if (!key?.newApiKeyCiphertext || !key.organizationId) throw new Error("Provisioned Studio credential missing");
    const response = await fetch(base + "/v1/models", { headers: { Authorization: `Bearer ${decryptSecret(key.newApiKeyCiphertext)}` }, signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.data)) throw new Error("New account model catalog inaccessible");
    console.log(JSON.stringify({ registrationProvisioned: true, workspaceCreated: true, studioCredentialCreated: true, modelCatalogAccessible: true, modelCount: result.data.length }));
  } finally {
    if (userId) {
      const owned = await db.select().from(organizations).where(eq(organizations.createdByUserId, userId));
      for (const org of owned) {
        const [link] = await db.select().from(teamNewApiMapping).where(eq(teamNewApiMapping.organizationId, org.id));
        if (link) {
          const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
          for (const key of keys) if (key.newApiTokenId) await revokeTeamToken(decryptSecret(link.newApiPatCiphertext), key.newApiTokenId);
          await disableNewApiUser(link.newApiUserId);
        }
      }
      await db.transaction(async tx => {
        await tx.delete(apiKeys).where(eq(apiKeys.userId, userId!));
        await tx.delete(organizations).where(eq(organizations.createdByUserId, userId!));
        await tx.delete(users).where(eq(users.id, userId!));
      });
      console.log("Temporary local account removed; upstream test account disabled and its key revoked");
    }
  }
}
main().then(() => process.exit(0)).catch(error => { console.error("Registration verification failed", { type: error?.name, status: error?.status }); process.exit(1); });
