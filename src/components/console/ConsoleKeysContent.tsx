"use client";

import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Check, Copy, KeyRound, Pencil, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createConsoleKey, importConsoleKeys, listConsoleKeys, revokeConsoleKey, setConsoleKeyEnabled, updateConsoleKey } from "@/lib/console/client";
import type { ConsoleApiKey, ConsoleOrganization } from "@/lib/console/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatTile } from "@/components/ui/stat-tile";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { createSelectionColumn } from "@/components/data-table/selection-column";
import { useDataTable } from "@/components/data-table/use-data-table";
import { ConsoleEmptyState, ConsolePage } from "./ConsolePage";

function date(value: string | null, empty = "从未使用") {
  if (!value) return empty;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function toDatetimeLocal(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function splitList(value: string) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function KeyRestrictionBadges({ apiKey }: { apiKey: ConsoleApiKey }) {
  const hasModelScopes = apiKey.modelScopes.length > 0;
  const hasIpAllowList = apiKey.ipAllowList.length > 0;
  const hasExpiry = Boolean(apiKey.expiresAt);

  if (!hasModelScopes && !hasIpAllowList && !hasExpiry) {
    return <Badge variant="success">无限制</Badge>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {hasModelScopes ? (
        <Badge variant="outline" title={`允许的模型：${apiKey.modelScopes.join(", ")}`}>
          {apiKey.modelScopes.length} 个模型
        </Badge>
      ) : null}
      {hasIpAllowList ? (
        <Badge variant="outline" title={`IP 白名单：${apiKey.ipAllowList.join(", ")}`}>
          IP 限制
        </Badge>
      ) : null}
      {hasExpiry ? (
        <Badge variant="outline" title={`过期时间：${date(apiKey.expiresAt, "无")}`}>
          有过期
        </Badge>
      ) : null}
    </div>
  );
}

function KeyDialog({
  organizationId,
  existing,
  onClose,
  onCreated,
  onUpdated,
}: {
  organizationId: string | null;
  existing?: ConsoleApiKey | null;
  onClose: () => void;
  onCreated: (key: ConsoleApiKey, secret: string) => void;
  onUpdated: (key: ConsoleApiKey) => void;
}) {
  const editing = Boolean(existing);
  const [name, setName] = useState(existing?.name ?? "");
  const [modelScopes, setModelScopes] = useState(existing?.modelScopes.join(", ") ?? "");
  const [ipAllowList, setIpAllowList] = useState(existing?.ipAllowList.join(", ") ?? "");
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocal(existing?.expiresAt ?? null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) {
      setError("请输入密钥名称。");
      return;
    }
    if (normalized.length > 50) {
      setError("密钥名称最多 50 个字符。");
      return;
    }
    const scopes = splitList(modelScopes);
    const ips = splitList(ipAllowList);
    const expiry = expiresAt.trim() ? new Date(expiresAt).toISOString() : null;
    setSubmitting(true);
    setError(null);
    try {
      if (existing) {
        const result = await updateConsoleKey(existing.id, {
          name: normalized,
          expiresAt: expiry,
          modelScopes: scopes,
          ipAllowList: ips,
        });
        onUpdated(result.key);
      } else {
        const result = await createConsoleKey({
          name: normalized,
          organizationId,
          expiresAt: expiry,
          modelScopes: scopes,
          ipAllowList: ips,
        });
        onCreated(result.key, result.secret);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : editing ? "保存失败，请重试。" : "创建失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑 API密钥" : "新建 API密钥"}</DialogTitle>
          <DialogDescription>
            {editing ? "修改限制后立即对后续请求生效。" : "完整密钥只会显示一次，请保存到受保护的环境变量中。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FieldGroup>
            <Field data-invalid={Boolean(error && !name.trim()) || undefined}>
              <FieldLabel htmlFor="key-name">名称</FieldLabel>
              <Input id="key-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={50} placeholder="例如：生产环境" />
            </Field>
            <p className="text-sm text-muted-foreground">默认可调用账户内全部可用模型，系统自动选择路由，无需为不同模型分别创建密钥。</p>
            <details open={editing && Boolean(modelScopes || ipAllowList || expiresAt)} className="grid gap-4">
              <summary className="cursor-pointer text-sm font-medium">高级限制（可选）</summary>
              <div className="mt-4 grid gap-5">
            <Field>
              <FieldLabel htmlFor="key-models">限制可用模型（可选）</FieldLabel>
              <Input id="key-models" value={modelScopes} onChange={(event) => setModelScopes(event.target.value)} placeholder="例如：gpt-4o, claude-3-5-sonnet" />
              <FieldDescription>逗号分隔。留空表示不限制可调用的模型。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="key-ips">IP 白名单</FieldLabel>
              <Input id="key-ips" value={ipAllowList} onChange={(event) => setIpAllowList(event.target.value)} placeholder="例如：203.0.113.10, 203.0.113.0/24" />
              <FieldDescription>逗号分隔。留空表示不限制来源 IP。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="key-expires">过期时间</FieldLabel>
              <Input id="key-expires" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
              <FieldDescription>留空表示永不过期。额度在工作区账户上统一管理。</FieldDescription>
            </Field>
              </div>
            </details>
          </FieldGroup>
          {error ? <FieldError>{error}</FieldError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Spinner data-icon="inline-start" /> : editing ? <Pencil data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
              {editing ? "保存修改" : "创建密钥"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConsoleKeysTable({
  keys,
  columns,
  canManage,
  rowSelection,
  onRowSelectionChange,
  selectedActiveCount,
  batchRevoking,
  onRevokeSelected,
}: {
  keys: ConsoleApiKey[];
  columns: ColumnDef<ConsoleApiKey>[];
  canManage: boolean;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => void;
  selectedActiveCount: number;
  batchRevoking: boolean;
  onRevokeSelected: () => void;
}) {
  const table = useDataTable({
    columns,
    data: keys,
    getRowId: (key) => key.id,
    rowSelection,
    onRowSelectionChange,
  });

  return (
    <div className="flex flex-col gap-3">
      <DataTableToolbar table={table} globalSearch searchPlaceholder="搜索名称、前缀或所有者…">
        <DataTableFacetedFilter
          table={table}
          columnId="status"
          placeholder="全部状态"
          options={[
            { label: "可用", value: "active" },
            { label: "已撤销", value: "revoked" },
            { label: "已过期", value: "expired" },
          ]}
        />
        {canManage && selectedActiveCount > 0 ? (
          <Button
            variant="destructive"
            size="sm"
            className="h-8 gap-1.5"
            disabled={batchRevoking}
            onClick={onRevokeSelected}
          >
            {batchRevoking ? <Spinner /> : <Trash2 />}
            批量撤销（{selectedActiveCount}）
          </Button>
        ) : null}
      </DataTableToolbar>
      <DataTable table={table} columnCount={columns.length} emptyDescription="没有匹配的 API密钥。" />
    </div>
  );
}

export default function ConsoleKeysContent() {
  const [keys, setKeys] = useState<ConsoleApiKey[]>([]);
  const [organizations, setOrganizations] = useState<ConsoleOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<ConsoleApiKey | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [batchRevoking, setBatchRevoking] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const applyKeys = setKeys;
  const [importing, setImporting] = useState(false);
  const [studioStatus, setStudioStatus] = useState("unknown");
  const [notice, setNotice] = useState("");

  const keyStats = useMemo(() => {
    const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;
    let active = 0;
    let expiringSoon = 0;
    let revoked = 0;
    for (const key of keys) {
      if (key.status === "active") {
        active += 1;
        if (key.expiresAt && new Date(key.expiresAt).getTime() <= soon) expiringSoon += 1;
      } else if (key.status === "revoked") {
        revoked += 1;
      }
    }
    return { active, expiringSoon, revoked };
  }, [keys]);

  const load = useCallback(async (nextOrganizationId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listConsoleKeys(nextOrganizationId);
      applyKeys(result.keys);
      setError(result.syncWarning ?? null);
      setOrganizations(result.organizations);
      setStudioStatus(result.studioStatus);
      setOrganizationId(result.organizationId);
      setRowSelection({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载 API密钥。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeOrganization = organizationId ? organizations.find((org) => org.id === organizationId) ?? null : null;
  const canManage = activeOrganization?.role === "owner" || activeOrganization?.role === "admin";

  async function importKeys() {
    if (!organizationId) return;
    setImporting(true); setNotice(""); setError(null);
    try {
      const result = await importConsoleKeys(organizationId);
      await load(organizationId);
      setNotice(`已纳管 ${result.imported} 把历史密钥，可在这里编辑和撤销。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "历史密钥纳管失败。"); }
    finally { setImporting(false); }
  }

  async function revoke(key: ConsoleApiKey) {
    if (!window.confirm(`撤销 “${key.name}” 后，使用它的应用会立即失去访问权限。是否继续？`)) return;
    setRevoking(key.id);
    try {
      const result = await revokeConsoleKey(key.id);
      applyKeys(current => current.map((item) => item.id === result.key.id ? result.key : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "撤销失败，请重试。");
    } finally {
      setRevoking(null);
    }
  }

  async function toggleKey(key: ConsoleApiKey) {
    setRevoking(key.id);
    try {
      const result = await setConsoleKeyEnabled(key.id, key.status === "disabled");
      applyKeys(current => current.map(item => item.id === key.id ? result.key : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "密钥状态更新失败。"); }
    finally { setRevoking(null); }
  }

  const selectedActiveKeys = keys.filter((key) => rowSelection[key.id] && key.status === "active" && key.source !== "new-api");

  async function revokeSelected() {
    if (selectedActiveKeys.length === 0) return;
    if (!window.confirm(`批量撤销 ${selectedActiveKeys.length} 个密钥 后，使用它们的应用会立即失去访问权限。是否继续？`)) return;
    setBatchRevoking(true);
    setError(null);
    try {
      const results = await Promise.allSettled(selectedActiveKeys.map((key) => revokeConsoleKey(key.id)));
      const revoked = new Map<string, ConsoleApiKey>();
      let failures = 0;
      results.forEach((result) => {
        if (result.status === "fulfilled") revoked.set(result.value.key.id, result.value.key);
        else failures += 1;
      });
      if (revoked.size > 0) {
        applyKeys(current => current.map((item) => revoked.get(item.id) ?? item));
      }
      if (failures > 0) setError(`${failures} 个密钥 撤销失败，请重试。`);
      setRowSelection({});
    } finally {
      setBatchRevoking(false);
    }
  }

  async function copySecret() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const columns = useMemo<ColumnDef<ConsoleApiKey>[]>(() => {
    const base: ColumnDef<ConsoleApiKey>[] = canManage ? [createSelectionColumn<ConsoleApiKey>()] : [];
    base.push(
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="名称" />,
        cell: ({ row }) => <span className="font-medium text-ink-950">{row.original.name}{row.original.source === "new-api" ? <Badge variant="outline" className="ml-2">待纳管</Badge> : null}</span>,
        meta: { label: "名称" },
      },
      ...(organizationId
        ? [
            {
              id: "owner",
              header: "所有者",
              cell: ({ row }: { row: { original: ConsoleApiKey } }) => (
                <span className="text-xs text-ink-500">{row.original.ownerName ?? "--"}</span>
              ),
              enableSorting: false,
              meta: { label: "所有者" },
            } satisfies ColumnDef<ConsoleApiKey>,
          ]
        : []),
      {
        id: "prefix",
        header: "前缀",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.prefix}...</span>,
        enableSorting: false,
        meta: { label: "前缀" },
      },
      {
        id: "restrictions",
        header: "限制",
        cell: ({ row }) => <KeyRestrictionBadges apiKey={row.original} />,
        enableSorting: false,
        meta: { label: "限制" },
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => (
          <span className={row.original.status === "active" ? "text-emerald-700" : "text-ink-500"}>
            {row.original.status === "active" ? "可用" : row.original.status === "revoked" ? "已撤销" : row.original.status === "disabled" ? "已停用" : "已过期"}
          </span>
        ),
        meta: { label: "状态" },
      },
      {
        accessorKey: "lastUsedAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title="上次使用" />,
        cell: ({ row }) => <span className="text-xs text-ink-500">{date(row.original.lastUsedAt)}</span>,
        meta: { label: "上次使用" },
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => <span className="text-xs text-ink-500">{date(row.original.createdAt, "--")}</span>,
        meta: { label: "创建时间" },
      },
      {
        accessorKey: "expiresAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title="过期时间" />,
        cell: ({ row }) => <span className="text-xs text-ink-500">{date(row.original.expiresAt, "永不过期")}</span>,
        meta: { label: "过期时间" },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">操作</span>,
        cell: ({ row }) => {
          const key = row.original;
          if (key.source === "new-api") return <span className="text-xs text-muted-foreground">纳管后可编辑</span>;
          if (key.status === "revoked" || !canManage) return null;
          return (
            <div className="flex justify-end">
              {key.status === "active" || key.status === "disabled" ? <Button variant="ghost" size="sm" disabled={revoking === key.id} onClick={() => void toggleKey(key)}>{key.status === "disabled" ? "启用" : "停用"}</Button> : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => { setEditing(key); setShowDialog(true); }}
                aria-label={`编辑 ${key.name}`}
                title="编辑密钥"
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={revoking === key.id}
                onClick={() => void revoke(key)}
                aria-label={`撤销 ${key.name}`}
                title="撤销密钥"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                {revoking === key.id ? <Spinner /> : <Trash2 />}
              </Button>
            </div>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    );
    return base;
  }, [canManage, organizationId, revoking]);

  return (
    <ConsolePage
      title="API密钥"
      actions={<div className="flex gap-2">
        <Button variant="outline" disabled={loading} onClick={() => void load(organizationId)}>
          <RefreshCw data-icon="inline-start" />刷新
        </Button>
        {canManage ? (
        <Button onClick={() => { setEditing(null); setShowDialog(true); }}>
          <Plus data-icon="inline-start" />
          新建密钥
        </Button>
      ) : null}</div>}
    >
      {!loading && organizationId ? <section className="mb-4 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-4">
          <div><p className="font-medium">工作台调用</p><p className="mt-1 text-sm text-muted-foreground">系统维护专用凭证，无需手动创建密钥。</p></div>
          <Badge variant={studioStatus === "ready" ? "success" : "outline"}>{({ ready: "凭证可用", unavailable: "凭证需修复", missing: "尚未配置", unknown: "状态暂不可用" } as Record<string, string>)[studioStatus]}</Badge>
        </div>
      </section> : null}
      {canManage && keys.some(key => key.source === "new-api") ? <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border p-4">
        <p className="text-sm">发现历史密钥，纳管后可在 Reizo 统一管理，原密钥与限制保留。</p>
        <Button variant="outline" disabled={importing || loading} onClick={() => void importKeys()}>{importing ? <Spinner /> : null}纳管历史密钥</Button>
      </div> : null}
      {notice ? <p role="status" className="mb-4 text-sm text-emerald-700">{notice}</p> : null}
      {!loading && organizationId && keys.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatTile label="可用" value={keyStats.active} icon={KeyRound} tone="success" className="p-4" />
          <StatTile
            label="30 天内到期"
            value={keyStats.expiringSoon}
            hint={keyStats.expiringSoon > 0 ? "建议提前轮换" : "暂无临期密钥"}
            tone={keyStats.expiringSoon > 0 ? "warning" : "default"}
            className="p-4"
          />
          <StatTile label="已撤销" value={keyStats.revoked} tone="default" className="p-4" />
        </div>
      ) : null}
      {organizations.length > 1 && organizationId ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>工作区</span>
          <Select value={organizationId} onValueChange={(value) => void load(value)}>
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
      {!canManage ? (
        <Alert className="mb-4">
          <AlertDescription>你可以查看该工作区的 API密钥，但没有创建或撤销权限（仅 owner / admin 可管理）。</AlertDescription>
        </Alert>
      ) : null}
      {revealed ? (
        <section className="mb-6 border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-emerald-950">这是此密钥最后一次完整显示</p>
              <div className="mt-3 flex min-w-0 items-center gap-2 border border-emerald-200 bg-surface px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-sm text-ink-950">{revealed}</code>
                <button type="button" onClick={() => void copySecret()} aria-label="复制 API密钥" className="grid h-7 w-7 shrink-0 place-items-center text-ink-600 hover:bg-canvas">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在加载 API密钥…
        </div>
      ) : !organizationId ? (
        <ConsoleEmptyState title="还没有工作区" description="密钥属于工作区。被邀请加入后，会在这里管理。" />
      ) : keys.length === 0 ? (
        <ConsoleEmptyState title="还没有 API密钥" description="为服务端应用创建第一个 API密钥。密钥只会在创建后显示一次。" />
      ) : (
        <ConsoleKeysTable
          keys={keys}
          columns={columns}
          canManage={canManage}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          selectedActiveCount={selectedActiveKeys.length}
          batchRevoking={batchRevoking}
          onRevokeSelected={() => void revokeSelected()}
        />
      )}
      {showDialog ? (
        <KeyDialog
          key={editing?.id ?? "new"}
          organizationId={organizationId}
          existing={editing}
          onClose={() => { setShowDialog(false); setEditing(null); }}
          onCreated={(key, secret) => {
            applyKeys(current => [key, ...current]);
            setRevealed(secret);
            setShowDialog(false);
            setEditing(null);
          }}
          onUpdated={(key) => {
            applyKeys(current => current.map((item) => item.id === key.id ? key : item));
            setShowDialog(false);
            setEditing(null);
          }}
        />
      ) : null}
    </ConsolePage>
  );
}
