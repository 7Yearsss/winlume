import { consoleError, consoleJson, ensureOrganizationKeyManager, requireConsoleContext } from "@/lib/console/server";
import { requireConsoleOrganization } from "@/lib/console/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireConsoleContext();
    const body = await request.json();
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    const selected = await requireConsoleOrganization(context, organizationId);
    ensureOrganizationKeyManager(selected.membership.role);
    const imported = await context.repositories.apiKeys.importExisting(context.userId, selected.organization.id);
    return consoleJson({ imported });
  } catch (error) { return consoleError(error); }
}
