"use client";

import Link from "next/link";
import { Activity, CheckCircle2, ChevronDown, FileCog, MoreVertical, RefreshCw, Search, TimerReset, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsolePage } from "@/components/console/ConsolePage";
import { StatefulButton } from "@/components/motion/button/stateful";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import type { Session } from "@/lib/agent/types";

type TaskFilter = "all" | "running" | "queued" | "completed";
type TaskStatus = Exclude<TaskFilter, "all">;

type TaskItem = { session: Session; status: TaskStatus; progress: number; remaining: string; workspace: string };

const statusCopy: Record<TaskStatus, { label: string; tone: string }> = {
  running: { label: "进行中", tone: "is-running" },
  queued: { label: "排队中", tone: "is-queued" },
  completed: { label: "已完成", tone: "is-completed" },
};

function toTaskItem(session: Session, index: number): TaskItem {
  const presets: Array<Omit<TaskItem, "session">> = [
    { status: "running", progress: 68, remaining: "预计剩余：2 分钟", workspace: "内容营销工作台" },
    { status: "running", progress: 41, remaining: "预计剩余：6 分钟", workspace: "数据分析工作台" },
    { status: "running", progress: 75, remaining: "预计剩余：1 分钟", workspace: "视觉与创意工作台" },
    { status: "queued", progress: 0, remaining: "预计开始：1 分钟后", workspace: "开发与代码工作台" },
    { status: "completed", progress: 100, remaining: "任务已完成", workspace: "财务与报表工作台" },
    { status: "completed", progress: 100, remaining: "任务已完成", workspace: "财务与法务工作台" },
  ];
  return { session, ...presets[index % presets.length] };
}

const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AccountTasksContent() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "请先登录后查看任务" : "任务列表暂时不可用");
      const payload = await response.json() as { sessions?: Session[] };
      setSessions(payload.sessions ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "任务列表暂时不可用"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const tasks = useMemo(() => sessions.map(toTaskItem), [sessions]);
  const counts = useMemo(() => ({
    all: tasks.length,
    running: tasks.filter((task) => task.status === "running").length,
    queued: tasks.filter((task) => task.status === "queued").length,
    completed: tasks.filter((task) => task.status === "completed").length,
  }), [tasks]);
  const visible = useMemo(() => tasks.filter((task) => {
    const matchesFilter = filter === "all" || task.status === filter;
    const haystack = `${task.session.title} ${task.session.model} ${task.workspace}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  }), [filter, query, tasks]);
  const recentDone = tasks.filter((task) => task.status === "completed").slice(0, 3);
  const filters: Array<{ id: TaskFilter; label: string }> = [
    { id: "all", label: `全部 ${counts.all}` },
    { id: "running", label: `进行中 ${counts.running}` },
    { id: "queued", label: `排队中 ${counts.queued}` },
    { id: "completed", label: `已完成 ${counts.completed}` },
  ];

  return (
    <ConsolePage
      title="任务看板"
      actions={
        <StatefulButton
          state={loading ? "loading" : "idle"}
          loadingText="刷新中"
          icon={<RefreshCw className="h-4 w-4" aria-hidden />}
          variant="secondary"
          size="sm"
          onClick={() => void load()}
        >
          刷新
        </StatefulButton>
      }
    >
      <div className="account-task-board">

      <section className="account-task-summary" aria-label="任务概览">
        <article><span className="account-task-summary-icon"><FileCog aria-hidden /></span><div><small>全部任务</small><strong>{counts.all}</strong><p>进行中 {counts.running} · 排队中 {counts.queued} · 已完成 {counts.completed}</p></div></article>
        <article><span className="account-task-summary-icon"><TimerReset aria-hidden /></span><div><small>进行中任务</small><strong>{counts.running}</strong><p>占全部 {counts.all ? Math.round((counts.running / counts.all) * 100) : 0}%</p></div></article>
        <article><span className="account-task-summary-icon is-green"><CheckCircle2 aria-hidden /></span><div><small>已完成任务</small><strong>{counts.completed}</strong><p>占全部 {counts.all ? Math.round((counts.completed / counts.all) * 100) : 0}%</p></div></article>
        <article className="account-task-quota"><span className="account-task-summary-icon is-quota"><Activity aria-hidden /></span><div><small>会员剩余额度</small><strong>80%</strong><p>本月可用</p></div></article>
      </section>

      <div className="account-task-board-layout">
        <main>
          <div className="account-task-board-filters">
            <Tabs value={filter} onValueChange={(value) => setFilter(value as TaskFilter)} variant="pill">
              <TabsList aria-label="任务状态筛选" className="border border-border">
                {filters.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <div className="account-task-filter-tools"><label><Search aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务名称或关键词" /></label><button type="button" className="account-task-workspace-filter">全部工作台<ChevronDown aria-hidden /></button></div>
          </div>

          {loading ? <p className="account-task-empty">正在同步任务…</p> : error ? <p className="account-task-empty">{error}</p> : visible.length === 0 ? <div className="account-task-empty"><Workflow aria-hidden /><strong>还没有匹配的任务</strong><span>进入智能体工作区创建第一个任务。</span><Link href="/studio">开始创作</Link></div> : (
            <div className="account-task-board-list">
              {visible.map((task) => {
                const state = statusCopy[task.status];
                return <article key={task.session.id} className={`account-task-board-item ${state.tone}`}>
                  <span className="account-task-board-item-icon"><Workflow aria-hidden /></span>
                  <div className="account-task-board-item-body"><div className="account-task-board-item-title"><strong>{task.session.title || "未命名任务"}</strong><em>{task.workspace}</em></div><p>{task.status === "completed" ? "任务已生成完成，可进入工作区查看结果" : `${task.session.model} 正在处理任务内容`}</p><div className="account-task-progress"><span><i style={{ width: `${task.progress}%` }} /></span><b>{task.progress}%</b></div><small>开始时间：{formatTime(task.session.updatedAt)} <span>{task.remaining}</span></small></div>
                  <div className="account-task-board-item-side"><em className={state.tone}>{state.label}</em><button type="button" aria-label="更多任务操作"><MoreVertical aria-hidden /></button><Link href={`/studio?session=${encodeURIComponent(task.session.id)}`}>{task.status === "completed" ? "查看结果" : task.status === "queued" ? "取消任务" : "查看详情"}<ChevronDown aria-hidden /></Link></div>
                </article>;
              })}
            </div>
          )}
        </main>

        <aside className="account-task-insights">
          <section className="account-task-token-card"><div className="account-task-insight-head"><h2>Token 消耗概览</h2><button type="button">今天<ChevronDown aria-hidden /></button></div><p>总消耗 Token</p><strong>1.24M</strong><small>≈ ¥0.25</small><div className="account-task-donut"><b>1.24M</b><span>Tokens</span></div><ul><li><i className="is-running" />进行中任务 <b>860K (69.4%)</b></li><li><i className="is-completed" />已完成任务 <b>320K (25.8%)</b></li><li><i className="is-queued" />排队中任务 <b>60K (4.8%)</b></li></ul></section>
          <section className="account-task-quota-card"><span>80%</span><div><strong>会员剩余额度</strong><p>本月可用 · 重置日期：2026-09-30</p></div></section>
          <section className="account-task-speed-card"><div className="account-task-insight-head"><h2>实时消耗速率</h2><span>（每分钟）</span></div><div className="account-task-speed-graph" aria-label="Token 消耗趋势图"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="account-task-speed-time"><span>13:00</span><span>13:15</span><span>13:30</span><span>13:45</span></div></section>
          <section className="account-task-recent"><div className="account-task-insight-head"><h2>最近完成的任务</h2><button type="button">查看全部</button></div>{recentDone.length ? recentDone.map((task) => <Link href={`/studio?session=${encodeURIComponent(task.session.id)}`} key={task.session.id}><CheckCircle2 aria-hidden />{task.session.title}<span>{formatTime(task.session.updatedAt).slice(-5)}</span></Link>) : <p>完成的任务会显示在这里。</p>}</section>
        </aside>
      </div>
      </div>
    </ConsolePage>
  );
}
