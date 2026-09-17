"use client";

import {
  Bot,
  Check,
  CodeXml,
  LoaderCircle,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  createConsolePreset,
  getConsolePresets,
  removeConsolePreset,
  setConsolePresetDefault,
  updateConsolePreset,
} from "@/lib/console/client";
import type {
  ConsolePersonalityPreset,
  ConsolePresetKind,
  ConsolePresets,
  ConsoleToolPreset,
} from "@/lib/console/types";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ConsoleEmptyState, ConsolePage } from "./ConsolePage";

type Scope = "personal" | "organization";
type AnyPreset = ConsolePersonalityPreset | ConsoleToolPreset;
type DialogState = { kind: ConsolePresetKind; preset: AnyPreset | null };

const precedence = [
  ["运行时", "单次运行提供的临时指令"],
  ["项目", "仅对当前项目生效"],
  ["工作区", "团队共享的默认约束"],
  ["个人", "你的跨项目偏好"],
  ["系统", "平台安全与合规规则"],
];

function isPersonality(preset: AnyPreset): preset is ConsolePersonalityPreset {
  return "instructions" in preset;
}

function date(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(parsed);
}

function configPreview(value: Record<string, unknown>): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 180 ? `${serialized.slice(0, 180)}...` : serialized;
  } catch {
    return "{}";
  }
}

function PresetDialog({
  state,
  scope,
  organizationId,
  onClose,
  onSaved,
}: {
  state: DialogState;
  scope: Scope;
  organizationId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = state.preset;
  const personality = existing && isPersonality(existing) ? existing : null;
  const tool = existing && !isPersonality(existing) ? existing : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [instructions, setInstructions] = useState(personality?.instructions ?? "");
  const [configuration, setConfiguration] = useState(() => tool ? JSON.stringify(tool.toolConfiguration, null, 2) : "{\n  \"enabledTools\": []\n}");
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = Boolean(existing);
  const title = `${isEditing ? "编辑" : "新建"}${state.kind === "personality" ? "人格预设" : "工具预设"}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("请输入预设名称。");
      return;
    }
    let toolConfiguration: Record<string, unknown> | undefined;
    if (state.kind === "tool") {
      try {
        const parsed = JSON.parse(configuration) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        toolConfiguration = parsed as Record<string, unknown>;
      } catch {
        setError("工具配置需要是有效的 JSON 对象。");
        return;
      }
    } else if (!instructions.trim()) {
      setError("请输入人格指令。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (existing) {
        await updateConsolePreset(state.kind, existing.id, {
          name: normalizedName,
          description: description.trim() || null,
          instructions: state.kind === "personality" ? instructions.trim() : undefined,
          toolConfiguration,
          isDefault,
        });
      } else {
        await createConsolePreset({
          kind: state.kind,
          scope,
          organizationId: scope === "organization" ? organizationId : null,
          name: normalizedName,
          description: description.trim() || null,
          instructions: state.kind === "personality" ? instructions.trim() : undefined,
          toolConfiguration,
          isDefault,
        });
      }
      await onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存预设失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/35 p-4" role="presentation">
      <form onSubmit={submit} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col border border-line bg-surface shadow-xl" role="dialog" aria-modal="true" aria-labelledby="preset-dialog-title">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div><h2 id="preset-dialog-title" className="text-base font-semibold text-ink-950">{title}</h2><p className="mt-1 text-xs text-ink-500">{scope === "organization" ? "保存后对当前工作区可见。" : "保存后仅归属于你的个人偏好。"}</p></div>
          <button type="button" onClick={onClose} aria-label="关闭" className="grid h-8 w-8 place-items-center text-ink-500 hover:bg-canvas hover:text-ink-950"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5">
          <label className="block text-sm font-medium text-ink-800">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-2 w-full border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-ink-500" /></label>
          <label className="block text-sm font-medium text-ink-800">描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} className="mt-2 w-full resize-y border border-line bg-canvas px-3 py-2 text-sm leading-6 outline-none focus:border-ink-500" /></label>
          {state.kind === "personality" ? <label className="block text-sm font-medium text-ink-800">人格指令<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={20_000} rows={9} placeholder="说明语气、边界与默认工作方式。" className="mt-2 w-full resize-y border border-line bg-canvas px-3 py-2 font-mono text-sm leading-6 outline-none focus:border-ink-500" /></label> : <label className="block text-sm font-medium text-ink-800">工具配置<textarea value={configuration} onChange={(event) => setConfiguration(event.target.value)} rows={10} spellCheck={false} className="mt-2 w-full resize-y border border-line bg-canvas px-3 py-2 font-mono text-sm leading-6 outline-none focus:border-ink-500" /></label>}
          <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} className="h-4 w-4 accent-primary-600" />设为此作用域的默认预设</label>
          {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><button type="button" onClick={onClose} className="border border-line px-3 py-2 text-sm text-ink-700 hover:bg-canvas">取消</button><button disabled={submitting} className="inline-flex items-center gap-2 bg-ink-950 px-3 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}保存</button></div>
      </form>
    </div>
  );
}

function PresetList({
  kind,
  presets,
  canManage,
  busy,
  onEdit,
  onSetDefault,
  onRemove,
}: {
  kind: ConsolePresetKind;
  presets: AnyPreset[];
  canManage: boolean;
  busy: string | null;
  onEdit: (preset: AnyPreset) => void;
  onSetDefault: (preset: AnyPreset) => Promise<void>;
  onRemove: (preset: AnyPreset) => Promise<void>;
}) {
  const isPersonalityList = kind === "personality";
  const noun = isPersonalityList ? "人格预设" : "工具预设";
  if (!presets.length) return <ConsoleEmptyState title={`还没有${noun}`} description={canManage ? `新建第一个${noun}，随后可设置为默认。` : "当前作用域还没有可用预设。"} />;
  return <div className="divide-y divide-line border border-line bg-surface">
    {presets.map((preset) => {
      const itemBusy = busy?.startsWith(`${kind}:${preset.id}:`) ?? false;
      const summary = isPersonality(preset) ? preset.instructions : configPreview(preset.toolConfiguration);
      return <div key={preset.id} className="flex gap-4 px-4 py-4 sm:px-5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center ${isPersonalityList ? "bg-primary-100 text-primary-700" : "bg-emerald-100 text-emerald-700"}`}>{isPersonalityList ? <Bot className="h-4 w-4" /> : <CodeXml className="h-4 w-4" />}</span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink-950">{preset.name}</h3>{preset.isDefault ? <span className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"><Star className="h-3 w-3 fill-current" />默认</span> : null}</div>{preset.description ? <p className="mt-1 text-sm text-ink-600">{preset.description}</p> : null}<p className="mt-2 line-clamp-2 whitespace-pre-wrap font-mono text-xs leading-5 text-ink-500">{summary}</p><p className="mt-2 text-[11px] text-ink-400">更新于 {date(preset.updatedAt)}</p></div>
        {canManage ? <div className="flex shrink-0 items-start gap-1">{!preset.isDefault ? <button type="button" onClick={() => void onSetDefault(preset)} disabled={itemBusy} aria-label={`将 ${preset.name} 设为默认`} title="设为默认" className="grid h-8 w-8 place-items-center text-ink-500 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50">{itemBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}</button> : null}<button type="button" onClick={() => onEdit(preset)} disabled={itemBusy} aria-label={`编辑 ${preset.name}`} title="编辑预设" className="grid h-8 w-8 place-items-center text-ink-500 hover:bg-canvas hover:text-ink-950 disabled:opacity-50"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => void onRemove(preset)} disabled={itemBusy} aria-label={`删除 ${preset.name}`} title="删除预设" className="grid h-8 w-8 place-items-center text-ink-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></div> : null}
      </div>;
    })}
  </div>;
}

export default function ConsolePersonalizationContent() {
  const [data, setData] = useState<ConsolePresets | null>(null);
  const [scope, setScope] = useState<Scope>("personal");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (organizationId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getConsolePresets(organizationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载预设。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const canManage = scope === "personal" || Boolean(data?.canManageOrganizationPresets);
  const activeOrganizationId = data?.activeOrganization?.id ?? null;
  const personalities = scope === "personal" ? data?.personalities.personal ?? [] : data?.personalities.organization ?? [];
  const tools = scope === "personal" ? data?.tools.personal ?? [] : data?.tools.organization ?? [];

  async function setDefault(kind: ConsolePresetKind, preset: AnyPreset) {
    setBusy(`${kind}:${preset.id}:default`);
    setError(null);
    try {
      await setConsolePresetDefault(kind, preset.id);
      await load(activeOrganizationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "设置默认预设失败，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: ConsolePresetKind, preset: AnyPreset) {
    if (!window.confirm(`确定要删除 “${preset.name}” 吗？`)) return;
    setBusy(`${kind}:${preset.id}:remove`);
    setError(null);
    try {
      await removeConsolePreset(kind, preset.id);
      await load(activeOrganizationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除预设失败，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  return <ConsolePage title="偏好设置" actions={canManage ? <><button type="button" onClick={() => setDialog({ kind: "personality", preset: null })} className="inline-flex items-center gap-2 border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-800 hover:bg-canvas"><Plus className="h-4 w-4" />新建人格</button><button type="button" onClick={() => setDialog({ kind: "tool", preset: null })} className="inline-flex items-center gap-2 bg-ink-950 px-3 py-2 text-sm font-medium text-white hover:bg-ink-800"><Plus className="h-4 w-4" />新建工具</button></> : undefined}>
    {error ? <p role="alert" className="mb-4 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}
    {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-ink-500"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载预设…</div> : null}
    {!loading && data ? <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-4 py-3 sm:px-5"><div className="inline-flex border border-line p-0.5"><button type="button" onClick={() => setScope("personal")} className={`px-3 py-1.5 text-sm ${scope === "personal" ? "bg-ink-950 font-medium text-white" : "text-ink-600 hover:bg-canvas"}`}>个人</button><button type="button" disabled={!data.activeOrganization} onClick={() => setScope("organization")} className={`px-3 py-1.5 text-sm ${scope === "organization" ? "bg-ink-950 font-medium text-white" : "text-ink-600 hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"}`}>工作区</button></div>{scope === "organization" && data.organizations.length > 1 ? <select aria-label="选择工作区" value={activeOrganizationId ?? ""} onChange={(event) => void load(event.target.value)} className="border border-line bg-canvas px-2 py-1.5 text-sm text-ink-700 outline-none focus:border-ink-500">{data.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select> : null}<p className="text-xs text-ink-500">{scope === "organization" ? data.activeOrganization ? `${data.activeOrganization.name} · ${data.activeOrganization.role}` : "没有可访问的工作区" : "仅你的账户可见"}</p></div>
        {scope === "organization" && !canManage ? <div className="border-x border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">你可以查看共享预设，但只有 owner 或 admin 可以修改。</div> : null}
        <div className="mt-6"><div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary-600" /><div><h2 className="text-sm font-semibold text-ink-950">人格预设</h2><p className="mt-1 text-xs text-ink-500">定义默认语气、约束和工作方式。</p></div></div><PresetList kind="personality" presets={personalities} canManage={canManage} busy={busy} onEdit={(preset) => setDialog({ kind: "personality", preset })} onSetDefault={(preset) => setDefault("personality", preset)} onRemove={(preset) => remove("personality", preset)} /></div>
        <div className="mt-7"><div className="mb-3 flex items-center gap-2"><Settings2 className="h-4 w-4 text-emerald-600" /><div><h2 className="text-sm font-semibold text-ink-950">工具预设</h2><p className="mt-1 text-xs text-ink-500">保存工具开关、允许范围和默认配置。</p></div></div><PresetList kind="tool" presets={tools} canManage={canManage} busy={busy} onEdit={(preset) => setDialog({ kind: "tool", preset })} onSetDefault={(preset) => setDefault("tool", preset)} onRemove={(preset) => remove("tool", preset)} /></div>
      </section>
      <aside className="border border-line bg-surface p-5"><h2 className="text-sm font-semibold text-ink-950">生效顺序</h2><ol className="mt-4 space-y-3">{precedence.map(([level, detail], index) => <li key={level} className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center border border-line text-[11px] font-medium text-ink-600">{index + 1}</span><span><strong className="block text-sm font-medium text-ink-800">{level}</strong><span className="text-xs leading-5 text-ink-500">{detail}</span></span></li>)}</ol></aside>
    </div> : null}
    {!loading && !data && !error ? <ConsoleEmptyState title="预设暂不可用" description="请完成账户与数据库初始化后再试。" /> : null}
    {dialog && data ? <PresetDialog state={dialog} scope={scope} organizationId={activeOrganizationId} onClose={() => setDialog(null)} onSaved={() => load(activeOrganizationId)} /> : null}
  </ConsolePage>;
}
