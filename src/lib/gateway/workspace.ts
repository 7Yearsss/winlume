import type { PlatformDatabase } from "../platform/db/client";
import { TeamNewApiMappingRepository } from "../platform/repositories/team-new-api-mapping";
import { decryptSecret } from "../newapi/crypto";
import { createTeamToken, fetchTeamTokenKey, findTeamTokenIdByName, revokeTeamToken,
  updateTeamToken, listTeamTokens, getTeamBalance, setTeamTokenEnabled, NewApiTeamError,
  type TeamTokenSettings, type TeamTokenListItem } from "../newapi/team-client";

/** Application-facing port. Backend credentials stay inside the adapter. */
export interface WorkspaceGateway {
  createKey(name: string, settings: TeamTokenSettings): Promise<void>;
  findKey(name: string): Promise<number | null>;
  revealKey(id: number): Promise<string>;
  updateKey(id: number, settings: { name: string } & TeamTokenSettings): Promise<void>;
  revokeKey(id: number): Promise<void>;
  setKeyEnabled(id: number, enabled: boolean): Promise<void>;
  listKeys(): Promise<TeamTokenListItem[]>;
  balance(): Promise<{ quota: number; usedQuota: number }>;
}

/** Transitional adapter; replaces neither the production backend nor billing. */
class NewApiWorkspaceGateway implements WorkspaceGateway {
  private readonly mappings: TeamNewApiMappingRepository;
  constructor(database: PlatformDatabase, private readonly organizationId: string) {
    this.mappings = new TeamNewApiMappingRepository(database);
  }
  private async authorized<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    const mapping = await this.mappings.findByOrganizationId(this.organizationId);
    if (!mapping) throw new Error("工作区尚未连接模型网关。");
    try { return await operation(decryptSecret(mapping.newApiPatCiphertext)); }
    catch (error) {
      // Retry only an explicitly rejected operation, never an uncertain write.
      if (!(error instanceof NewApiTeamError) || error.status !== 401) throw error;
      const credential = await this.mappings.refreshPatIfUnchanged(this.organizationId, mapping.newApiPatCiphertext);
      return operation(credential);
    }
  }
  createKey(name: string, settings: TeamTokenSettings) { return this.authorized(pat => createTeamToken(pat, name, settings)); }
  findKey(name: string) { return this.authorized(pat => findTeamTokenIdByName(pat, name)); }
  revealKey(id: number) { return this.authorized(pat => fetchTeamTokenKey(pat, id)); }
  updateKey(id: number, settings: { name: string } & TeamTokenSettings) { return this.authorized(pat => updateTeamToken(pat, id, settings)); }
  revokeKey(id: number) { return this.authorized(pat => revokeTeamToken(pat, id)); }
  setKeyEnabled(id: number, enabled: boolean) { return this.authorized(pat => setTeamTokenEnabled(pat, id, enabled)); }
  listKeys() { return this.authorized(pat => listTeamTokens(pat)); }
  balance() { return this.authorized(pat => getTeamBalance(pat)); }
}

export function workspaceGateway(database: PlatformDatabase, organizationId: string): WorkspaceGateway {
  // Fail closed: codex-proxy cannot be enabled before its contract is implemented.
  const backend = process.env.REIZO_GATEWAY_BACKEND?.trim() || "new-api";
  if (backend !== "new-api") throw new Error("所选模型网关尚未完成接入。");
  return new NewApiWorkspaceGateway(database, organizationId);
}
