"use client";

import { Bug, Lightbulb, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useModals } from "@/components/providers";
import { ConsoleEmptyState, ConsolePage } from "@/components/console/ConsolePage";
import { Button } from "@/components/ui/button";

type FeedbackType = "bug" | "feature";
type FeedbackStatus = "open" | "resolved";

type FeedbackReport = {
  id: string;
  userId: string;
  userDisplayName: string | null;
  userEmail: string | null;
  type: FeedbackType;
  description: string;
  screenshots: string[];
  status: FeedbackStatus;
  createdAt: string;
};

export default function FeedbackAdminContent() {
  const { account, accountLoading } = useModals();
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FeedbackStatus>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/feedback", { credentials: "same-origin" });
      const body = (await response.json()) as { reports?: FeedbackReport[]; error?: string };
      if (!response.ok) throw new Error(body.error || "加载失败");
      setReports(body.reports ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account?.platform_role !== "admin") return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [account?.platform_role, load]);

  const toggleStatus = useCallback(
    async (report: FeedbackReport) => {
      const nextStatus: FeedbackStatus = report.status === "resolved" ? "open" : "resolved";
      setUpdatingId(report.id);
      try {
        const response = await fetch("/api/admin/feedback", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: report.id, status: nextStatus }),
        });
        const body = (await response.json()) as { report?: FeedbackReport; error?: string };
        if (!response.ok) throw new Error(body.error || "更新失败");
        setReports((current) =>
          current.map((item) => (item.id === report.id ? { ...item, status: nextStatus } : item)),
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "更新失败");
      } finally {
        setUpdatingId(null);
      }
    },
    [],
  );

  const filtered = useMemo(
    () => reports.filter((report) => statusFilter === "all" || report.status === statusFilter),
    [reports, statusFilter],
  );

  if (accountLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        正在确认账户…
      </div>
    );
  }
  if (account?.platform_role !== "admin") {
    return (
      <ConsolePage title="反馈列表">
        <ConsoleEmptyState title="没有权限" description="当前账户不是平台 admin。" />
      </ConsolePage>
    );
  }

  return (
    <ConsolePage
      title="反馈列表"
      actions={
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
        >
          <option value="all">全部状态</option>
          <option value="open">处理中</option>
          <option value="resolved">已处理</option>
        </select>
      }
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在加载反馈…
        </p>
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : filtered.length === 0 ? (
        <ConsoleEmptyState title="暂无反馈" description="当前没有符合条件的反馈记录。" />
      ) : (
        <div className="grid gap-3">
          {filtered.map((report) => (
            <article key={report.id} className="grid gap-2 rounded-xl border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {report.type === "bug" ? (
                    <Bug className="h-4 w-4 text-red-500" />
                  ) : (
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                  )}
                  {report.type === "bug" ? "Bug 报告" : "功能建议"}
                  <span className="text-xs font-normal text-muted-foreground">
                    {report.userDisplayName || report.userEmail || report.userId}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(report.createdAt).toLocaleString("zh-CN")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={updatingId === report.id}
                    onClick={() => void toggleStatus(report)}
                  >
                    {report.status === "resolved" ? "标记为处理中" : "标记为已处理"}
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{report.description}</p>
              {report.screenshots.length ? (
                <div className="flex flex-wrap gap-2">
                  {report.screenshots.map((shot, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={index}
                      src={shot}
                      alt=""
                      className="h-20 w-20 rounded-lg border border-border object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </ConsolePage>
  );
}
