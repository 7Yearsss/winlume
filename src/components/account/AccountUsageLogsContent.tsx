"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleUsageLogs } from "@/components/account/ConsoleUsageLogs";
import { ConsolePage } from "@/components/console/ConsolePage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getConsoleOrganizations } from "@/lib/console/client";
import type { ConsoleOrganization } from "@/lib/console/types";

export default function AccountUsageLogsContent() {
  const [organizations, setOrganizations] = useState<ConsoleOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await getConsoleOrganizations();
      setOrganizations(result.organizations);
      setOrganizationId((current) => current ?? result.organizationId ?? result.organizations[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载工作区。");
    } finally {
      setResolving(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <ConsolePage title="请求日志">
      {organizations.length > 1 && organizationId ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>工作区</span>
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger aria-label="选择工作区" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ConsoleUsageLogs organizationId={organizationId} resolving={resolving} />
    </ConsolePage>
  );
}
