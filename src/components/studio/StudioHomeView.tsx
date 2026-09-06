"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  FolderKanban,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import Composer, {
  type ComposerSendMeta,
  type ComposerCatalogContext,
} from "@/components/studio/Composer";
import { useModals } from "@/components/providers";
import type { Project, Session } from "@/lib/agent/types";
import {
  failPendingFirstMessage,
  getProject,
  notifyPendingFirstMessageStatus,
  resolvePendingFirstMessage,
  setPendingFirstMessage,
  StudioApiError,
  uploadImageArtifact,
  uploadSheetArtifact,
  uploadVideoArtifact,
  startVideoAnalysis,
} from "@/lib/studio/api";
import { clearComposerDraft } from "@/lib/studio/composer-draft";
import {
  extractAtMentionNames,
  resolveReferencedArtifactIds,
} from "@/lib/studio/image-mentions";
import type { ImageAttachment } from "@/lib/studio/composer-attachments";
import { resolveCapabilityPreset } from "@/lib/studio/capability-presets";
import type { CapabilityCatalog } from "@/lib/studio/capabilities";
import {
  FALLBACK_DEFAULT_MODEL,
  getDefaultModel,
} from "@/lib/studio/prefs";
import { usableComposerPrompt } from "@/lib/studio/skill-prompt";

const DOCK_MS = 340;
const DOCK_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const STUDIO_ENTRY_CONTEXT: Record<string, { label: string; detail: string }> = {
  "model-catalog": {
    label: "来自模型目录",
    detail: "模型已带入工作台；开始前仍可按需要确认或切换模型。",
  },
  "application-catalog": {
    label: "来自应用工具目录",
    detail: "描述你的任务即可开始，也可以在对话中随时更换模型。",
  },
  "model-catalog-empty": {
    label: "来自模型目录",
    detail: "当前没有匹配的模型；你仍可以直接描述任务并开始使用。",
  },
  "application-catalog-empty": {
    label: "来自应用工具目录",
    detail: "当前没有匹配的应用；你仍可以直接描述任务并开始使用。",
  },
};

/**
 * FLIP the home composer from hero center down to a bottom-docked slot
 * before View Transition navigation (no second DOM tree / no cover).
 */
function flipComposerToDock(
  setDocking: (v: boolean) => void,
): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setDocking(true);
    return Promise.resolve();
  }

  const form = document.querySelector<HTMLElement>(
    "#studio-home-composer .studio-liquid-glass",
  );
  if (!form) {
    setDocking(true);
    return Promise.resolve();
  }

  const first = form.getBoundingClientRect();
  setDocking(true);

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const last = form.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        const sx = last.width ? first.width / last.width : 1;
        const sy = last.height ? first.height / last.height : 1;

        form.style.transformOrigin = "top left";
        form.style.transition = "none";
        form.style.willChange = "transform";
        form.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        // force invert frame
        void form.getBoundingClientRect();

        requestAnimationFrame(() => {
          form.style.transition = `transform ${DOCK_MS}ms ${DOCK_EASE}`;
          form.style.transform = "translate(0, 0) scale(1)";

          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            form.style.transition = "";
            form.style.transform = "";
            form.style.willChange = "";
            form.style.transformOrigin = "";
            form.removeEventListener("transitionend", onEnd);
            resolve();
          };
          const onEnd = (e: TransitionEvent) => {
            if (e.target === form && e.propertyName === "transform") finish();
          };
          form.addEventListener("transitionend", onEnd);
          window.setTimeout(finish, DOCK_MS + 80);
        });
      });
    });
  });
}

function StudioHomeInner({ active, tabId }: { active: boolean; tabId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openLogin, account } = useModals();
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(FALLBACK_DEFAULT_MODEL);
  const [starting, setStarting] = useState(false);
  /** FLIP composer to bottom dock before route change (visual only). */
  const [docking, setDocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Blanket safety net: no matter which awaited step in `startChat` stalls
   * without rejecting, the composer must self-heal instead of staying
   * disabled forever with no feedback. There's no `createSession` network
   * call to hang on any more (the session is minted client-side and only
   * created server-side inside the same request that starts the turn), so
   * this now only catches the dock animation's own fallback timer path or
   * an edge case neither covers. Cleared on unmount (i.e. once navigation
   * to the session page actually happens), so it never fires against a
   * page the user has left.
   */
  useEffect(() => {
    if (!starting) return;
    const id = window.setTimeout(() => {
      setStarting(false);
      setDocking(false);
      setError((prev) => prev ?? "进入对话超时，请重试");
    }, 20_000);
    return () => window.clearTimeout(id);
  }, [starting]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [catalogContext, setCatalogContext] = useState<ComposerCatalogContext | null>(null);
  const [capabilityPresetId, setCapabilityPresetId] = useState<string | null>(null);
  /**
   * Captured once at mount (lazy initializer), not derived reactively from
   * `searchParams`. Workspace tabs keep this view mounted across unrelated
   * navigations elsewhere in the app (see WorkspaceTabsHost); reading
   * `searchParams` live would re-apply a stale/foreign query string to a
   * background tab every time the URL changes anywhere else.
   */
  const [projectId] = useState(() => searchParams.get("projectId")?.trim() || "");
  const [seedArtifactId] = useState(() => searchParams.get("artifact")?.trim() || "");
  const [entryContext] = useState(() => STUDIO_ENTRY_CONTEXT[searchParams.get("entry") ?? ""]);
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const prompt = searchParams.get("prompt");
      const skill = searchParams.get("skill");
      const skillName = searchParams.get("skillName")?.trim();
      const tool = searchParams.get("tool")?.trim();
      const modelParam = searchParams.get("model")?.trim();
      const presetParam = searchParams.get("preset");
      setCatalogContext(null);
      if (prompt) {
        const usable = usableComposerPrompt(prompt);
        if (usable) setDraft(usable);
        else setDraft("");
      } else if (tool) {
        setCatalogContext({ kind: "tool", name: tool });
        setDraft(`请使用${tool}完成这个任务`);
      } else if (skillName) {
        setCatalogContext({ kind: "skill", name: skillName });
        setDraft(`请使用${skillName}完成这个任务`);
      }
      if (skill) {
        setSelectedSkillIds([skill]);
        void fetch(`/api/skills?id=${encodeURIComponent(skill)}`, {
          credentials: "same-origin",
        })
          .then(async (response) => {
            if (!response.ok) return null;
            return response.json() as Promise<{ skill?: { id: string; name: string; iconUrl?: string } }>;
          })
          .then((result) => {
            if (cancelled || !result?.skill) return;
            setCatalogContext((current) =>
              current?.kind === "skill"
                ? { ...current, name: result.skill!.name, iconUrl: result.skill!.iconUrl }
                : current,
            );
          })
          .catch(() => undefined);
      } else if (skillName) {
        void fetch(`/api/skills?q=${encodeURIComponent(skillName)}&limit=20`, {
          credentials: "same-origin",
        })
          .then(async (response) => {
            if (!response.ok) return null;
            return response.json() as Promise<{
              skills?: Array<{ id: string; name: string; iconUrl?: string }>;
            }>;
          })
          .then((result) => {
            if (cancelled || !result?.skills?.length) return;
            const exact = result.skills.find((item) => item.name.trim() === skillName);
            if (!exact) return;
            setSelectedSkillIds([exact.id]);
            setCatalogContext({ kind: "skill", name: exact.name, iconUrl: exact.iconUrl });
          })
          .catch(() => undefined);
      }
      setModel(getDefaultModel());
      setCapabilityPresetId(null);

      if (!modelParam && !presetParam) return;
      void fetch("/api/capabilities", { credentials: "same-origin" })
        .then(async (response) => {
          if (!response.ok) throw new Error("capabilities");
          return response.json() as Promise<CapabilityCatalog>;
        })
        .then((catalog) => {
          if (cancelled) return;
          const preset = resolveCapabilityPreset(presetParam, catalog);
          const requestedModel =
            modelParam && catalog.models.includes(modelParam)
              ? modelParam
              : undefined;
          const resolvedModel = requestedModel ?? preset?.model;
          if (resolvedModel) setModel(resolvedModel);
          if (preset) {
            setCapabilityPresetId(preset.id);
            if (!skill) setSelectedSkillIds([]);
          }
        })
        .catch(() => {
          if (!cancelled) setCapabilityPresetId(null);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Mount-once: see the lazy-init comment above `projectId` — this tab's
    // entry query string should only ever be applied once, not whenever the
    // URL changes elsewhere while this tab sits in the background.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!account || !projectId) {
      const timer = window.setTimeout(() => setProject(null), 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    getProject(projectId)
      .then((nextProject) => {
        if (!cancelled) setProject(nextProject);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      });
    return () => {
      cancelled = true;
    };
  }, [account, projectId]);

  const startChat = useCallback(
    async (text: string, meta?: ComposerSendMeta) => {
      const message = text.trim();
      if (!message || starting) return;

      if (!account) {
        setError("请先登录后再开始对话");
        openLogin("login");
        return;
      }

      const skillIds =
        meta?.skillIds?.length
          ? meta.skillIds
          : selectedSkillIds.length
            ? selectedSkillIds
            : undefined;
      const selectedCapabilityPresetId =
        meta?.capabilityPresetId ?? capabilityPresetId;

      // A client-minted id, committed to immediately: no network round trip
      // stands between clicking send and the message appearing. The server
      // only learns this session exists on the `prepared.commit(...)` call
      // below (`bootstrap`), which creates it with this exact id.
      const sessionId = crypto.randomUUID();
      const title =
        message.replace(/\s+/g, " ").length > 40
          ? `${message.replace(/\s+/g, " ").slice(0, 40)}…`
          : message.replace(/\s+/g, " ");
      const requestModel = model.trim() || getDefaultModel();
      const requestProjectId = project?.id || projectId || undefined;
      const syntheticSession: Session = {
        id: sessionId,
        userId: account.id,
        title: title || "新对话",
        model: requestModel,
        ...(requestProjectId ? { projectId: requestProjectId } : {}),
        ...(selectedCapabilityPresetId
          ? { capabilityPresetId: selectedCapabilityPresetId }
          : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setStarting(true);
      setError(null);
      let handedOff = false;
      try {
        await flipComposerToDock(setDocking);
        setPendingFirstMessage({
          sessionId,
          message,
          model: requestModel,
          capabilityPresetId: selectedCapabilityPresetId ?? undefined,
          composerOptions: meta?.composerOptions,
          skillIds,
          session: syntheticSession,
        });
        setSelectedSkillIds([]);
        clearComposerDraft("home");
        // Keep draft until unmount so composer shared-element still has content.
        handedOff = true;
        router.push(`/studio/c/${sessionId}`, {
          transitionTypes: ["studio-handoff"],
        });

        // Everything below still runs after navigation (a floating async
        // function isn't tied to this component's mount) — only the final
        // resolvePendingFirstMessage needs a listener, and the session page
        // registers one immediately on mount, well before uploads finish.

        // Persist home-composer images under 图片N so @图片1 stays meaningful.
        const uploads = meta?.pendingImageUploads ?? [];
        const asAttachments: ImageAttachment[] = [];
        if (uploads.length) notifyPendingFirstMessageStatus(sessionId, "正在上传图片引用…");
        for (const item of uploads) {
          try {
            const artifact = await uploadImageArtifact({
              sessionId,
              name: item.name,
              dataUrl: item.dataUrl,
            });
            asAttachments.push({
              id: item.localId,
              name: item.name,
              mimeType: "image/png",
              size: 0,
              dataUrl: item.dataUrl,
              artifactId: artifact.id,
            });
          } catch {
            asAttachments.push({
              id: item.localId,
              name: item.name,
              mimeType: "image/png",
              size: 0,
              dataUrl: item.dataUrl,
            });
          }
        }

        // Files cannot cross the sessionStorage handoff. Persist the authorized
        // source and create its analysis job before the model receives the turn.
        if (meta?.pendingVideoUploads?.length) {
          notifyPendingFirstMessageStatus(sessionId, "正在准备视频参考…");
        }
        for (const item of meta?.pendingVideoUploads ?? []) {
          const source = await uploadVideoArtifact({
            sessionId,
            file: item.file,
            authorized: item.authorized,
          });
          await startVideoAnalysis({ sourceArtifactId: source.id, goal: "both" });
        }

        const importedSheetIds: string[] = [];
        if (meta?.pendingSheetUploads?.length) {
          notifyPendingFirstMessageStatus(sessionId, "正在导入表格附件…");
        }
        for (const item of meta?.pendingSheetUploads ?? []) {
          const artifact = await uploadSheetArtifact({
            sessionId,
            file: item.file,
          });
          importedSheetIds.push(artifact.id);
        }

        let referencedArtifactIds =
          meta?.referencedArtifactIds?.filter(Boolean) ?? [];
        if (seedArtifactId && !referencedArtifactIds.includes(seedArtifactId)) {
          referencedArtifactIds = [...referencedArtifactIds, seedArtifactId];
        }
        if (!referencedArtifactIds.length && extractAtMentionNames(message).length) {
          referencedArtifactIds = resolveReferencedArtifactIds(
            message,
            asAttachments,
            [],
          );
        } else if (asAttachments.length) {
          // Prefer ids from successful uploads when meta only had local placeholders.
          const fromUploads = resolveReferencedArtifactIds(
            message,
            asAttachments,
            [],
          );
          if (fromUploads.length) referencedArtifactIds = fromUploads;
        }
        if (importedSheetIds.length) {
          referencedArtifactIds = [
            ...referencedArtifactIds,
            ...importedSheetIds.filter((id) => !referencedArtifactIds.includes(id)),
          ];
        }

        notifyPendingFirstMessageStatus(sessionId, "正在理解需求…");
        // The session page owns the actual send from here — it's the only
        // mounted useChat instance that can call sendMessage. This also
        // implicitly creates the session server-side (bootstrap), with the
        // id already committed to and navigated to above.
        resolvePendingFirstMessage(sessionId, {
          model: requestModel,
          capabilityPresetId: selectedCapabilityPresetId ?? undefined,
          composerOptions: meta?.composerOptions,
          skillIds,
          referencedArtifactIds: referencedArtifactIds.length
            ? referencedArtifactIds
            : undefined,
          projectId: requestProjectId,
          bootstrapTitle: syntheticSession.title,
        });
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : "创建会话失败";
        if (handedOff) {
          failPendingFirstMessage(sessionId, errMessage);
          // Already navigated to the session page — it owns recovery from
          // here (the failure above already reported into it). Resetting
          // home-page state after handoff would be a no-op on an
          // unmounting component anyway.
          if (err instanceof StudioApiError && err.status === 401) {
            openLogin("login");
          }
          return;
        }
        if (err instanceof StudioApiError && err.status === 401) {
          setError("请先登录后再开始对话");
          openLogin("login");
        } else {
          setError(errMessage);
        }
        // Never lose what the user typed — Composer already cleared its
        // draft optimistically before this async work even started.
        setDraft(message);
      } finally {
        if (!handedOff) {
          setStarting(false);
          setDocking(false);
        }
      }
    },
    [
      account,
      capabilityPresetId,
      model,
      openLogin,
      project,
      projectId,
      router,
      seedArtifactId,
      selectedSkillIds,
      starting,
    ],
  );

  return (
    <div
      className="studio-home-canvas studio-view-in relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-docking={docking ? "true" : "false"}
    >
      {/* Compact utility controls keep the canvas focused on the prompt. */}
      <div
        className={`studio-home-utility-group pointer-events-none absolute right-5 top-4 z-[2] flex items-center gap-2 sm:right-8 sm:top-5 transition-opacity duration-200 ${
          docking ? "opacity-0" : "opacity-100"
        }`}
      >
        <Link
          href="/"
          title="返回首页"
          aria-label="返回首页"
          className="studio-home-utility studio-home-return pointer-events-auto inline-flex h-9 items-center justify-center gap-1.5 px-3 transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          <span className="studio-home-utility-label">返回首页</span>
        </Link>
        <span
          className="studio-home-utility pointer-events-auto flex h-9 w-9 items-center justify-center"
          title="通知（即将上线）"
        >
          <Bell className="h-4 w-4" strokeWidth={1.8} />
        </span>
      </div>

      {/*
        Continuous page (no mid-scroll cliff).
        On send: FLIP composer to bottom dock, then View Transition into session.
      */}
      <section
        // Only the foreground tab may own this id — background kept-alive
        // tabs (see WorkspaceTabsHost) must not shadow it, or
        // document.getElementById/querySelector calls above could resolve
        // to the wrong tab's composer.
        id={active ? "studio-home-composer" : undefined}
        className="studio-home-hero relative flex min-h-0 flex-1 flex-col"
      >
        <div
          className={`studio-home-hero-inner flex min-h-0 flex-1 flex-col px-5 sm:px-10 ${
            docking
              ? "items-stretch justify-end pb-2 pt-0 sm:pb-3"
              : "items-center justify-center pb-[24vh] pt-6 sm:pb-[22vh] sm:pt-8"
          }`}
        >
          <div
            className={`w-full ${
              docking ? "mx-auto max-w-3xl" : "max-w-[760px]"
            }`}
          >
            {!docking ? (
              <div className="studio-home-intro mb-8 text-center">
                <h1 className="text-[28px] font-semibold leading-tight text-[#172033]">
                  今天想完成什么？
                </h1>
              </div>
            ) : null}
            {entryContext ? (
              <div className="mb-3 flex items-start gap-2 rounded-[12px] border border-white/75 bg-white/55 px-3 py-2 text-xs text-[#615A73] shadow-sm backdrop-blur">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#245FD0]" strokeWidth={1.8} />
                <div>
                  <p className="font-medium text-[#241E36]">{entryContext.label}</p>
                  <p className="mt-0.5 text-[#8A8298]">{entryContext.detail}</p>
                </div>
              </div>
            ) : null}
            {project ? (
              <div className="mb-3 flex items-center gap-2 rounded-[12px] border border-white/75 bg-white/55 px-3 py-2 text-xs text-[#615A73] shadow-sm backdrop-blur">
                <FolderKanban className="h-3.5 w-3.5 shrink-0 text-[#0F172A]" strokeWidth={1.8} />
                <span className="shrink-0 text-[#8A8298]">当前项目</span>
                <Link
                  href={`/studio/p/${encodeURIComponent(project.id)}`}
                  className="min-w-0 truncate font-medium text-[#241E36] hover:underline"
                >
                  {project.name}
                </Link>
                {project.description ? (
                  <span className="hidden min-w-0 truncate text-[#8A8298] sm:inline">
                    · {project.description}
                  </span>
                ) : null}
              </div>
            ) : null}
            <Composer
              variant={docking ? "default" : "hero"}
              value={draft}
              onChange={setDraft}
              onSend={startChat}
              onPrepareSend={() => {
                // The home page has no session id yet, so it cannot create a
                // thread bubble until createSession resolves. It can still
                // acknowledge the click before Composer starts local work.
                if (account) setStarting(true);
                return null;
              }}
              disabled={starting}
              model={model}
              onModelChange={setModel}
              capabilityPresetId={capabilityPresetId}
              onCapabilityPresetChange={setCapabilityPresetId}
              skillIds={selectedSkillIds}
              onSkillIdsChange={setSelectedSkillIds}
              catalogContext={catalogContext}
              error={error}
              onClearError={() => setError(null)}
              draftKey={`home-${tabId}`}
              // Kept-alive home tabs can briefly overlap while React commits a
              // tab switch. Names must be unique in that window.
              shareTransitionName={active ? `studio-composer-${tabId}` : null}
              placeholder={
                starting
                ? "正在进入对话…"
                  : "输入需求，或输入 @ 引用产物、/选择技能"
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function StudioHomeFallback() {
  return (
    <div
      className="studio-home-canvas flex flex-1 flex-col items-center justify-center gap-2 px-4 text-sm text-[#8A8298]"
      role="status"
    >
      <LoaderCircle className="h-5 w-5 animate-spin text-[#0F172A]" />
      正在打开工作台…
    </div>
  );
}

/**
 * useSearchParams must sit under Suspense; otherwise Next bails the whole
 * segment to CSR and users only see the root "页面加载中" shell.
 */
export default function StudioHomeView({ active, tabId }: { active: boolean; tabId: string }) {
  return (
    <Suspense fallback={<StudioHomeFallback />}>
      <StudioHomeInner active={active} tabId={tabId} />
    </Suspense>
  );
}
