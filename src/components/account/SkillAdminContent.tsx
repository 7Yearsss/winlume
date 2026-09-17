"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useModals } from "@/components/providers";
import { ConsoleEmptyState, ConsolePage } from "@/components/console/ConsolePage";
import { Button } from "@/components/ui/button";
import { DEPARTMENT_ORDER, departmentLabel } from "@/lib/agent/skills/departments";

type AdminSkill = {
  id: string;
  name: string;
  description: string;
  category: string;
  triggers?: string[];
  examplePrompt?: string;
  source: "bundled" | "imported" | "user";
  enabled: boolean;
  featured?: boolean;
  promptChars: number;
};

const SOURCE_LABEL: Record<AdminSkill["source"], string> = {
  bundled: "内置",
  imported: "导入",
  user: "自定义",
};

export default function SkillAdminContent() {
  const { account, accountLoading } = useModals();
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [source, setSource] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pageSize = 40;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    category: "general",
    triggers: "",
    examplePrompt: "",
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const loadPage = useCallback(
    async (nextOffset: number, replace: boolean) => {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(pageSize));
        params.set("offset", String(nextOffset));
        if (debouncedQ) params.set("q", debouncedQ);
        if (source !== "all") params.set("source", source);
        const response = await fetch(`/api/admin/skills?${params.toString()}`, {
          credentials: "same-origin",
        });
        const body = (await response.json()) as {
          skills?: AdminSkill[];
          total?: number;
          hasMore?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "加载失败");
        const page = body.skills ?? [];
        setSkills((current) => (replace ? page : [...current, ...page]));
        setTotal(typeof body.total === "number" ? body.total : page.length);
        setOffset(nextOffset + page.length);
        setHasMore(body.hasMore === true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
        if (replace) setSkills([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedQ, source],
  );

  useEffect(() => {
    if (account?.platform_role !== "admin") return;
    const timer = window.setTimeout(() => {
      void loadPage(0, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [account?.platform_role, loadPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadPage(offset, false);
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadPage, offset]);

  const selected = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? null,
    [selectedId, skills],
  );

  function selectSkill(skill: AdminSkill) {
    setSelectedId(skill.id);
    setDraft({
      name: skill.name,
      description: skill.description,
      category: skill.category,
      triggers: (skill.triggers ?? []).join("、"),
      examplePrompt: skill.examplePrompt ?? "",
    });
  }

  async function runAction(
    action: "sync-bundled" | "import-master" | "import-open-catalogs" | "translate-zh",
  ) {
    setBusy(action);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as {
        written?: number;
        translated?: number;
        skipped?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "操作失败");
      setNotice(
        action === "sync-bundled"
          ? `已同步 ${body.written ?? 0} 个内置 Skill`
          : action === "import-master"
            ? `已导入 ${body.written ?? 0} 个 master-skill`
            : action === "import-open-catalogs"
              ? `已导入 ${body.written ?? 0} 个开源目录 Skill`
              : `已翻译 ${body.translated ?? 0} 个名称/描述，剩余 ${body.skipped ?? 0} 个`,
      );
      await loadPage(0, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function patchSkill(id: string, payload: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/skills/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { skill?: AdminSkill; error?: string };
      if (!response.ok) throw new Error(body.error || "保存失败");
      setSkills((current) =>
        current.map((skill) => (skill.id === id && body.skill ? { ...skill, ...body.skill } : skill)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(null);
    }
  }

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
      <ConsolePage title="Skill 配置">
        <ConsoleEmptyState title="没有权限" description="当前账户不是平台 admin。" />
      </ConsolePage>
    );
  }

  return (
    <ConsolePage
      title="Skill 配置"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => void runAction("sync-bundled")}
          >
            {busy === "sync-bundled" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            同步内置 Skill
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => void runAction("import-master")}
          >
            {busy === "import-master" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            导入 master-skill
          </Button>
          <Button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void runAction("import-open-catalogs")}
          >
            {busy === "import-open-catalogs" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            导入开源目录
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => void runAction("translate-zh")}
          >
            {busy === "translate-zh" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            翻译为中文
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="搜索名称、描述、分类…"
          className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm"
        />
        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="all">全部来源</option>
          <option value="bundled">内置</option>
          <option value="imported">导入</option>
          <option value="user">自定义</option>
        </select>
        <span className="text-xs text-muted-foreground">
          已显示 {skills.length} / {total}
        </span>
      </div>

      {notice ? <p className="mb-3 text-sm text-primary-700">{notice}</p> : null}
      {error ? (
        <p className="mb-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在加载 Skill…
        </p>
      ) : skills.length === 0 ? (
        <ConsoleEmptyState
          title="还没有入库的 Skill"
          description="先点「同步内置 Skill」，再按需导入 master-skill。"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">分类</th>
                <th className="px-3 py-2 font-medium">来源</th>
                <th className="px-3 py-2 font-medium">启用</th>
                <th className="px-3 py-2 font-medium">精选</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr
                  key={skill.id}
                  className={`cursor-pointer border-t border-border ${
                    selectedId === skill.id ? "bg-primary-50/60" : "hover:bg-muted/30"
                  }`}
                  onClick={() => selectSkill(skill)}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{skill.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{skill.id}</div>
                  </td>
                  <td className="px-3 py-2">{departmentLabel(skill.category)}</td>
                  <td className="px-3 py-2">{SOURCE_LABEL[skill.source]}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      disabled={busy === skill.id}
                      onChange={(event) => {
                        event.stopPropagation();
                        void patchSkill(skill.id, { enabled: event.target.checked });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={skill.featured === true}
                      disabled={busy === skill.id}
                      onChange={(event) => {
                        event.stopPropagation();
                        void patchSkill(skill.id, { featured: event.target.checked });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={sentinelRef} className="flex h-12 items-center justify-center text-xs text-muted-foreground">
            {loadingMore ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                继续加载…
              </span>
            ) : hasMore ? (
              "下拉加载更多"
            ) : (
              "已经到底"
            )}
          </div>
        </div>
      )}

      {selected ? (
        <form
          className="mt-5 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void patchSkill(selected.id, {
              name: draft.name,
              description: draft.description,
              category: draft.category,
              triggers: draft.triggers.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
              examplePrompt: draft.examplePrompt,
            });
          }}
        >
          <h2 className="sm:col-span-2 text-sm font-semibold">编辑 {selected.name}</h2>
          <label className="grid gap-1 text-xs">
            名称
            <input
              className="h-9 rounded-md border border-border px-3 text-sm"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-xs">
            分类
            <select
              className="h-9 rounded-md border border-border px-2 text-sm"
              value={draft.category}
              onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
            >
              <option value="general">general</option>
              {DEPARTMENT_ORDER.map((id) => (
                <option key={id} value={id}>
                  {departmentLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2 grid gap-1 text-xs">
            描述
            <textarea
              className="min-h-20 rounded-md border border-border px-3 py-2 text-sm"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label className="sm:col-span-2 grid gap-1 text-xs">
            触发词
            <input
              className="h-9 rounded-md border border-border px-3 text-sm"
              value={draft.triggers}
              onChange={(event) => setDraft((current) => ({ ...current, triggers: event.target.value }))}
            />
          </label>
          <label className="sm:col-span-2 grid gap-1 text-xs">
            示例提示
            <textarea
              className="min-h-16 rounded-md border border-border px-3 py-2 text-sm"
              value={draft.examplePrompt}
              onChange={(event) => setDraft((current) => ({ ...current, examplePrompt: event.target.value }))}
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy === selected.id}>
              保存
            </Button>
          </div>
        </form>
      ) : null}
    </ConsolePage>
  );
}
