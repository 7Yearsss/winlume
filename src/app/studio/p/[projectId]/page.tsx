"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  FolderKanban,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useModals } from "@/components/providers";
import LiquidGlassSurface from "@/components/studio/LiquidGlassSurface";
import { useStudioHeaderSlot } from "@/components/studio/StudioShell";
import type { Project, Session } from "@/lib/agent/types";
import {
  getProject,
  listSessions,
  StudioApiError,
} from "@/lib/studio/api";

function formatProjectDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function StudioProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const { account, openLogin } = useModals();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !account) return;
    setLoading(true);
    setError(null);
    try {
      const [nextProject, allSessions] = await Promise.all([
        getProject(projectId),
        listSessions(projectId),
      ]);
      setProject(nextProject);
      setSessions(
        allSessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    } catch (err) {
      if (err instanceof StudioApiError && err.status === 401) {
        setError("请先登录后查看项目");
        openLogin("login");
      } else if (err instanceof StudioApiError && err.status === 404) {
        setError("项目不存在或无权访问");
      } else {
        setError(err instanceof Error ? err.message : "加载项目失败");
      }
      setProject(null);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [account, openLogin, projectId]);

  useEffect(() => {
    if (!account) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const refresh = () => void load();
    window.addEventListener("reizo:sessions-changed", refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener("reizo:sessions-changed", refresh); };
  }, [account, load]);

  const headerContent = useMemo(() => project ? (
    <LiquidGlassSurface>
      <header className="studio-session-header studio-glass-soft flex shrink-0 items-center gap-3 border-b border-white/50 px-4 py-3 sm:px-6">
      <Link
        href="/studio"
        className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[#615A73] transition hover:bg-white/60 hover:text-[#241E36]"
        title="返回开始创作"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="sr-only">返回</span>
      </Link>
      <FolderKanban className="h-4 w-4 shrink-0 text-[#0F172A]" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold text-[#241E36]">{project.name}</h1>
        <p className="truncate text-[11px] text-[#8A8298]">项目工作区 · {sessions.length} 个对话</p>
      </div>
      <Link
        href={`/studio?projectId=${encodeURIComponent(project.id)}`}
        className="studio-send-btn inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-xs font-medium text-white transition"
      >
        <Plus className="h-3.5 w-3.5" />
        新对话
      </Link>
      </header>
    </LiquidGlassSurface>
  ) : null, [project, sessions.length]);

  useStudioHeaderSlot(headerContent);

  if (!account) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
        <FolderKanban className="h-7 w-7 text-[#8A8298]" strokeWidth={1.5} />
        <p className="text-sm text-[#615A73]">登录后查看项目</p>
        <button
          type="button"
          onClick={() => openLogin("login")}
          className="studio-send-btn rounded-full px-4 py-2 text-sm font-medium text-white"
        >
          登录 / 注册
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-[#8A8298]">
        <LoaderCircle className="h-4 w-4 animate-spin text-[#0F172A]" />
        正在打开项目…
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-[#615A73]">{error || "项目不存在"}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/80 bg-white/60 px-3 py-2 text-sm text-[#615A73] transition hover:bg-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
          <Link
            href="/studio"
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[rgba(15,23,42,0.08)] px-3 py-2 text-sm text-[#0F172A] transition hover:bg-[rgba(15,23,42,0.14)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="studio-home-canvas min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10 sm:py-10">
      <div className="mx-auto max-w-[920px]">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs text-[#8A8298]">
              <Link href="/studio" className="hover:text-[#241E36]">工作台</Link>
              <span aria-hidden>/</span>
              <span className="truncate text-[#615A73]">{project.name}</span>
            </div>
            <h2 className="text-[26px] font-semibold tracking-tight text-[#241E36] sm:text-[30px]">
              {project.name}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#615A73]">
              {project.description || "把这个项目的对话、上下文和作品集中在一起。"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/studio?projectId=${encodeURIComponent(project.id)}`}
              className="studio-send-btn inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              新建对话
            </Link>
            <button
              type="button"
              disabled
              title="项目设置即将上线"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/80 bg-white/55 text-[#8A8298] disabled:cursor-not-allowed"
              aria-label="项目设置即将上线"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {project.instructions ? (
          <section className="mb-8 border-y border-white/60 py-4">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-[#8A8298]">项目规则</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-[#615A73]">{project.instructions}</p>
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#241E36]">项目对话</h3>
            <span className="text-xs tabular-nums text-[#8A8298]">{sessions.length}</span>
          </div>
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center border border-dashed border-white/75 bg-white/25 px-6 py-14 text-center">
              <MessageSquareText className="mb-3 h-6 w-6 text-[#8A8298]" strokeWidth={1.5} />
              <p className="text-sm font-medium text-[#615A73]">这个项目还没有对话</p>
              <p className="mt-1 text-xs text-[#8A8298]">从项目上下文开始一段新的工作。</p>
              <Link
                href={`/studio?projectId=${encodeURIComponent(project.id)}`}
                className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] bg-[rgba(15,23,42,0.08)] px-3 py-2 text-xs font-medium text-[#0F172A] transition hover:bg-[rgba(15,23,42,0.14)]"
              >
                <Plus className="h-3.5 w-3.5" />
                开始第一段对话
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-white/60 border-y border-white/60">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/studio/c/${encodeURIComponent(session.id)}`}
                    className="group flex items-center gap-3 px-3 py-4 transition hover:bg-white/45 sm:px-4"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/65 text-[#615A73]">
                      <MessageSquareText className="h-4 w-4" strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#241E36] group-hover:text-[#0F172A]">
                        {session.title || "未命名对话"}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-[#8A8298]">
                        {session.model} · 更新于 {formatProjectDate(session.updatedAt)}
                      </span>
                    </span>
                    <span className="text-[#AAA2B2] transition group-hover:translate-x-0.5 group-hover:text-[#615A73]" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
