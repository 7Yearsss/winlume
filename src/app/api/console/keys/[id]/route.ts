import {
  ConsoleRequestError,
  consoleError,
  consoleJson,
  ensureOrganizationKeyManager,
  mapConsoleApiKey,
  parseConsoleKeyPatchInput,
  requireConsoleContext,
  type ConsoleRequestContext,
} from "@/lib/console/server";
import { requireConsoleOrganization } from "@/lib/console/workspace";
import type { ApiKeyRecord } from "@/lib/platform/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadManagedKey(
  requestContext: ConsoleRequestContext,
  id: string,
): Promise<ApiKeyRecord> {
  const key = await requestContext.repositories.apiKeys.findById(id);
  if (!key || key.isStudioHidden) {
    throw new ConsoleRequestError("未找到该 API Key。", 404, "api_key_not_found");
  }
  if (key.organizationId) {
    const selected = await requireConsoleOrganization(requestContext, key.organizationId);
    ensureOrganizationKeyManager(selected.membership.role);
  } else if (key.userId !== requestContext.userId) {
    throw new ConsoleRequestError("未找到该 API Key。", 404, "api_key_not_found");
  }
  return key;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const requestContext = await requireConsoleContext();
    await loadManagedKey(requestContext, id);
    const body = await request.json();
    if (body?.status === "active" || body?.status === "disabled") {
      const key = await requestContext.repositories.apiKeys.setEnabled(id, body.status === "active");
      if (!key) throw new ConsoleRequestError("未找到该 API Key。", 404, "api_key_not_found");
      return consoleJson({ key: mapConsoleApiKey(key) });
    }
    const input = parseConsoleKeyPatchInput(body);
    const updated = await requestContext.repositories.apiKeys.update(id, {
      name: input.name,
      expiresAt: input.expiresAt,
      allowedModels: input.allowedModels,
      ipAllowlist: input.ipAllowlist,
    });
    if (!updated) throw new ConsoleRequestError("未找到该 API Key。", 404, "api_key_not_found");
    return consoleJson({ key: mapConsoleApiKey(updated) });
  } catch (error) {
    return consoleError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const requestContext = await requireConsoleContext();
    await loadManagedKey(requestContext, id);
    const revoked = await requestContext.repositories.apiKeys.revoke(id);
    if (!revoked) throw new ConsoleRequestError("未找到该 API Key。", 404, "api_key_not_found");
    return consoleJson({ key: mapConsoleApiKey(revoked) });
  } catch (error) {
    return consoleError(error);
  }
}
