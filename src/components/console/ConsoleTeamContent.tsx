"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Check,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/components/data-table/use-data-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  addConsoleTeamMember,
  getConsoleTeam,
  removeConsoleTeamMember,
  updateConsoleTeamMember,
} from "@/lib/console/client";
import type { ConsoleOrganizationRole, ConsoleTeam, ConsoleTeamMember } from "@/lib/console/types";
import { ConsoleEmptyState, ConsolePage } from "./ConsolePage";

const roles: Array<{ value: ConsoleOrganizationRole; label: string; description: string }> = [
  { value: "owner", label: "Owner", description: "管理工作区、成员与所有设置" },
  { value: "admin", label: "Admin", description: "管理成员与工作区共享配置" },
  { value: "member", label: "Member", description: "使用工作区项目、工具与预设" },
  { value: "viewer", label: "Viewer", description: "查看获授权的工作区资源" },
];

function canManageTarget(actorRole: ConsoleOrganizationRole, targetRole: ConsoleOrganizationRole): boolean {
  return actorRole === "owner" || (actorRole === "admin" && (targetRole === "member" || targetRole === "viewer"));
}

function assignableRoles(actorRole: ConsoleOrganizationRole): Array<{ value: ConsoleOrganizationRole; label: string }> {
  return roles
    .filter((role) => actorRole === "owner" || role.value === "member" || role.value === "viewer")
    .map((role) => ({ value: role.value, label: role.label }));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function AddMemberDialog({
  team,
  onClose,
  onAdded,
}: {
  team: ConsoleTeam;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<ConsoleOrganizationRole>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleOptions = assignableRoles(team.actorRole);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = identifier.trim();
    if (!normalized) {
      setError("请输入用户名或邮箱。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await addConsoleTeamMember({ organizationId: team.organization.id, identifier: normalized, role });
      await onAdded();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加成员失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加工作区成员</DialogTitle>
          <DialogDescription>仅可添加已经注册的 Reizo 用户。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FieldGroup>
            <Field data-invalid={Boolean(error && !identifier.trim()) || undefined}>
              <FieldLabel htmlFor="member-identifier">用户名或邮箱</FieldLabel>
              <Input
                id="member-identifier"
                autoFocus
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                maxLength={320}
                placeholder="例如：alice 或 alice@example.com"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-role">角色</FieldLabel>
              <Select value={role} onValueChange={(value) => setRole(value as ConsoleOrganizationRole)}>
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Admin 只能添加 Member 或 Viewer。</FieldDescription>
            </Field>
          </FieldGroup>
          {error ? <FieldError>{error}</FieldError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
              添加成员
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamMembersTable({
  columns,
  members,
}: {
  columns: ColumnDef<ConsoleTeamMember>[];
  members: ConsoleTeamMember[];
}) {
  const table = useDataTable({
    columns,
    data: members,
    getRowId: (member) => member.id,
  });

  return (
    <div className="flex flex-col gap-3">
      <DataTableToolbar table={table} globalSearch searchPlaceholder="搜索姓名、邮箱或用户名…">
        <DataTableFacetedFilter
          table={table}
          columnId="status"
          placeholder="全部状态"
          options={[
            { label: "正常", value: "active" },
            { label: "待激活", value: "pending" },
            { label: "已停用", value: "suspended" },
          ]}
        />
        <DataTableFacetedFilter
          table={table}
          columnId="role"
          placeholder="全部角色"
          options={[
            { label: "Owner", value: "owner" },
            { label: "Admin", value: "admin" },
            { label: "Member", value: "member" },
            { label: "Viewer", value: "viewer" },
          ]}
        />
      </DataTableToolbar>
      <DataTable table={table} columnCount={columns.length} emptyDescription="没有匹配的成员。" />
    </div>
  );
}

export default function ConsoleTeamContent() {
  const [team, setTeam] = useState<ConsoleTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async (organizationId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      setTeam(await getConsoleTeam(organizationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载工作区成员。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changeRole = useCallback(async (member: ConsoleTeamMember, role: ConsoleOrganizationRole) => {
    if (!team || role === member.role) return;
    setBusyUserId(member.userId);
    setError(null);
    try {
      await updateConsoleTeamMember(member.userId, { organizationId: team.organization.id, role });
      await load(team.organization.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新成员角色失败，请稍后重试。");
    } finally {
      setBusyUserId(null);
    }
  }, [team, load]);

  const remove = useCallback(async (member: ConsoleTeamMember) => {
    if (!team) return;
    if (!window.confirm(`确定要将 ${member.displayName} 移出工作区吗？`)) return;
    setBusyUserId(member.userId);
    setError(null);
    try {
      await removeConsoleTeamMember(member.userId, team.organization.id);
      await load(team.organization.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移除成员失败，请稍后重试。");
    } finally {
      setBusyUserId(null);
    }
  }, [team, load]);

  const ownerCount = team?.members.filter((member) => member.role === "owner").length ?? 0;
  const pendingCount = team?.members.filter((member) => member.status === "pending").length ?? 0;
  const roleCounts = useMemo(() => {
    const counts: Record<ConsoleOrganizationRole, number> = { owner: 0, admin: 0, member: 0, viewer: 0 };
    for (const member of team?.members ?? []) counts[member.role] += 1;
    return counts;
  }, [team]);

  const columns = useMemo<ColumnDef<ConsoleTeamMember>[]>(() => {
    if (!team) return [];
    return [
      {
        accessorKey: "displayName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="成员" />,
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                {member.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-ink-950">{member.displayName}</p>
                  {member.isCurrentUser ? <Badge variant="outline">你</Badge> : null}
                </div>
                <p className="truncate text-xs text-ink-500">{member.email || member.username}</p>
              </div>
            </div>
          );
        },
        meta: { label: "成员" },
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => {
          const status = row.original.status;
          if (status === "active") {
            return <Badge variant="success"><Check className="mr-1 size-3" />正常</Badge>;
          }
          if (status === "pending") return <Badge variant="outline">待激活</Badge>;
          return <Badge variant="destructive">已停用</Badge>;
        },
        meta: { label: "状态" },
      },
      {
        accessorKey: "role",
        header: ({ column }) => <DataTableColumnHeader column={column} title="角色" />,
        cell: ({ row }) => {
          const member = row.original;
          const canManage = team.canManageMembers && canManageTarget(team.actorRole, member.role);
          const protectedOwner = member.role === "owner" && ownerCount <= 1;
          const busy = busyUserId === member.userId;
          return (
            <Select
              value={member.role}
              disabled={!canManage || protectedOwner || busy}
              onValueChange={(value) => void changeRole(member, value as ConsoleOrganizationRole)}
            >
              <SelectTrigger aria-label={`${member.displayName} 的角色`} className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {roles.map((role) => (
                    <SelectItem
                      key={role.value}
                      value={role.value}
                      disabled={team.actorRole === "admin" && (role.value === "owner" || role.value === "admin")}
                    >
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          );
        },
        meta: { label: "角色" },
      },
      {
        accessorKey: "joinedAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title="加入时间" />,
        cell: ({ row }) => <span className="text-xs text-ink-500">{formatDate(row.original.joinedAt)}</span>,
        meta: { label: "加入时间" },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">操作</span>,
        cell: ({ row }) => {
          const member = row.original;
          const canManage = team.canManageMembers && canManageTarget(team.actorRole, member.role);
          const protectedOwner = member.role === "owner" && ownerCount <= 1;
          if (!canManage || protectedOwner) return null;
          const busy = busyUserId === member.userId;
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={() => void remove(member)}
              aria-label={`移除 ${member.displayName}`}
              title="移除成员"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              {busy ? <Spinner /> : <Trash2 />}
            </Button>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ];
  }, [team, busyUserId, ownerCount, changeRole, remove]);

  return (
    <ConsolePage
      title="工作区成员"
      actions={team?.canManageMembers ? (
        <Button type="button" onClick={() => setShowAdd(true)}>
          <Plus data-icon="inline-start" />
          添加成员
        </Button>
      ) : undefined}
    >
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />正在加载成员…
        </div>
      ) : null}
      {!loading && !team && !error ? (
        <ConsoleEmptyState title="工作区暂不可用" description="当前账户还没有可访问的工作区。" />
      ) : null}
      {!loading && team ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <UsersRound className="size-4 text-ink-600" />
                <div>
                  <CardTitle>{team.organization.name}</CardTitle>
                  <CardDescription>
                    {team.members.length} 位成员 · 你的角色：{roles.find((role) => role.value === team.actorRole)?.label}
                  </CardDescription>
                </div>
              </div>
              {team.organizations.length > 1 ? (
                <Select value={team.organization.id} onValueChange={(value) => void load(value)}>
                  <SelectTrigger aria-label="选择工作区" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {team.organizations.map((organization) => (
                        <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : null}
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                {roles
                  .filter((role) => roleCounts[role.value] > 0)
                  .map((role) => (
                    <Badge key={role.value} variant="outline">{role.label} {roleCounts[role.value]}</Badge>
                  ))}
                {pendingCount > 0 ? <Badge variant="outline">待激活 {pendingCount}</Badge> : null}
              </div>
              {!team.canManageMembers ? (
                <Alert className="mb-4">
                  <AlertDescription>你可以查看成员，但没有修改工作区成员的权限。</AlertDescription>
                </Alert>
              ) : null}
              <TeamMembersTable columns={columns} members={team.members} />
            </CardContent>
          </Card>
          <Card className="h-fit">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-ink-600" />
                <CardTitle>角色权限</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4">
                {roles.map((role) => (
                  <div key={role.value}>
                    <dt className="text-sm font-medium text-ink-800">{role.label}</dt>
                    <dd className="mt-1 text-xs leading-5 text-ink-500">{role.description}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {showAdd && team ? (
        <AddMemberDialog team={team} onClose={() => setShowAdd(false)} onAdded={() => load(team.organization.id)} />
      ) : null}
    </ConsolePage>
  );
}
