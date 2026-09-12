"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TransitionEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LoaderCircle,
  PanelLeftClose,
  PanelRight,
} from "lucide-react";
import ArtifactPanel from "@/components/studio/ArtifactPanel";
import ArtifactPreview from "@/components/studio/ArtifactPreview";
import ChatThread from "@/components/studio/ChatThread";
import ChatThreadSkeleton from "@/components/studio/ChatThreadSkeleton";
import Composer from "@/components/studio/Composer";
import StudioViewTransition from "@/components/studio/StudioViewTransition";
import { useStudioHeaderSlot } from "@/components/studio/StudioShell";
import { useResizablePanel } from "@/components/studio/useResizablePanel";
import { useStudioChat } from "@/components/studio/useStudioChat";
import { useModals } from "@/components/providers";
import type { Artifact, Message, Project, Session } from "@/lib/agent/types";
import type { ArtifactEventPayload } from "@/components/studio/studio-chat-types";
import { isMentionableArtifact } from "@/lib/studio/image-mentions";
import { afterNextPaint } from "@/lib/studio/next-paint";
import { flushOpenSheetEdits } from "@/lib/studio/sheet-flush";
import {
  getArtifact,
  getProject,
  getSessionBundle,
  listArtifacts,
  patchSession,
  peekPendingFirstMessage,
  readHandoffBootstrap,
  registerPendingFirstMessageListener,
  takePendingFirstMessage,
  StudioApiError,
} from "@/lib/studio/api";
import { subscribeArtifactStream } from "@/lib/studio/artifact-stream-client";
import { hasMentionToken } from "@/lib/studio/mention-editor";
import { FALLBACK_DEFAULT_MODEL } from "@/lib/studio/prefs";

type MobileTab = "chat" | "works";

const PREVIEW_WIDTH_KEY = "reizo-artifact-preview-width";
const LIST_WIDTH_KEY = "reizo-artifact-list-width";
/** Collapsed list strip — keeps a discoverable control without stealing preview width. */
const LIST_STRIP_W = 44;

function optimisticUserMessage(
  sessionId: string,
  text: string,
): Message {
  return {
    id: `pending-user-${sessionId}`,
    sessionId,
    role: "user",
    content: text,
    createdAt: new Date().toISOString(),
  };
}


export default function StudioSessionView({
  sessionId,
  active,
  onTitleChange,
}: {
  sessionId: string;
  /** Only the active tab may publish the shared header slot or claim named ViewTransitions — kept-alive inactive tabs must stay silent to avoid clobbering the active tab's chrome. */
  active: boolean;
  onTitleChange?: (title: string) => void;
}) {
  const { openLogin, account } = useModals();

  /**
   * Handoff from /studio: sessionStorage is client-only, so bootstrap in
   * useLayoutEffect. View Transitions handle the visual continuity.
   */
  const [hasHandoff, setHasHandoff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [initialMessages, setInitialMessages] = useState<
    Message[] | undefined
  >(undefined);
  const [activeRun, setActiveRun] = useState<{
    id: string;
    status: string;
    message: string;
  } | null>(null);
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>([]);
  const pendingSentRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!sessionId) return;
    const boot = readHandoffBootstrap(sessionId);
    if (!boot) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only handoff state must be applied before paint.
    setHasHandoff(true);
    setLoading(false);
    setInitialMessages([boot.userMessage]);
    if (boot.session) setSession(boot.session);
  }, [sessionId]);

  // Artifacts
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Works rail defaults collapsed. Layout width and visual open are split so
   * close can animate transform/opacity before releasing the flex slot.
   */
  const [worksRailOpen, setWorksRailOpen] = useState(false);
  /** Discrete layout slot (px). 0 when fully closed after exit transition. */
  const [worksRailLayoutWidth, setWorksRailLayoutWidth] = useState(0);
  /**
   * True only for the brief open/close toggle window — eases the width
   * change so the panel grows/shrinks in step with its content instead of
   * snapping to size instantly. Left off during live drag-resize (which
   * updates worksRailLayoutWidth continuously) so the handle stays 1:1.
   */
  const [worksRailWidthAnimating, setWorksRailWidthAnimating] = useState(false);
  const worksRailAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Preview pane within the rail (default on when rail opens). */
  const [previewOpen, setPreviewOpen] = useState(true);
  /**
   * Session artifact list — default collapsed so preview can focus (scheme A).
   * Expand via strip / header 列表 when switching works.
   */
  const [listOpen, setListOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [flashId, setFlashId] = useState<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    null,
  );
  /** Pulse edge tab when new work arrives while rail is collapsed. */
  const [edgePulse, setEdgePulse] = useState(false);
  /**
   * User explicitly hid the rail — suppress further auto-open this visit
   * until they open it manually (header / edge tab / chat link).
   */
  const userCollapsedWorksRef = useRef(false);

  // NewMax-style resizable side panes (persisted)
  const listPane = useResizablePanel({
    storageKey: LIST_WIDTH_KEY,
    defaultWidth: 256,
    minWidth: 200,
    maxWidth: 360,
    invert: true,
  });
  const previewPane = useResizablePanel({
    storageKey: PREVIEW_WIDTH_KEY,
    defaultWidth: 384,
    minWidth: 280,
    maxWidth: 720,
    invert: true,
  });

  const onUnauthorized = useCallback(() => {
    openLogin("login");
  }, [openLogin]);

  const worksRailOpenRef = useRef(worksRailOpen);
  useEffect(() => {
    worksRailOpenRef.current = worksRailOpen;
  }, [worksRailOpen]);

  const listColWidth = listOpen ? listPane.width : LIST_STRIP_W;
  // When list is collapsed, give its space to preview so reading stays full-bleed.
  const previewColWidth = previewOpen
    ? listOpen
      ? previewPane.width
      : listPane.width + previewPane.width - LIST_STRIP_W
    : 0;
  const contentRailWidth = listColWidth + previewColWidth;

  // While open, keep layout slot in sync with resizes / list·preview toggles
  useEffect(() => {
    if (worksRailOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the persisted resize slot mirrors the open rail geometry.
      setWorksRailLayoutWidth(contentRailWidth);
    }
  }, [worksRailOpen, contentRailWidth]);

  /** Eases the panel width for one open/close cycle, then hands width sync back to the instant/1:1 drag path. */
  const pulseWorksRailWidthAnim = useCallback(() => {
    setWorksRailWidthAnimating(true);
    if (worksRailAnimTimerRef.current) clearTimeout(worksRailAnimTimerRef.current);
    worksRailAnimTimerRef.current = setTimeout(
      () => setWorksRailWidthAnimating(false),
      360,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (worksRailAnimTimerRef.current) clearTimeout(worksRailAnimTimerRef.current);
    };
  }, []);

  const openWorksRail = useCallback(
    (opts?: {
      preview?: boolean;
      /** Expand session list (default false — preview-first). */
      list?: boolean;
      animated?: boolean;
      /** true = user action (clears collapse lock); false = auto from write */
      manual?: boolean;
    }) => {
      if (opts?.manual !== false) {
        userCollapsedWorksRef.current = false;
      } else if (userCollapsedWorksRef.current) {
        return;
      }
      const showPreview = opts?.preview !== false;
      const showList = opts?.list === true;
      if (showPreview) setPreviewOpen(true);
      setListOpen(showList);
      const listW = showList ? listPane.width : LIST_STRIP_W;
      const prevW = showPreview
        ? showList
          ? previewPane.width
          : listPane.width + previewPane.width - LIST_STRIP_W
        : 0;
      // Ease the width open alongside the slot allocation, then slide/fade
      // the content in on the next frame (interruptible CSS both ways).
      pulseWorksRailWidthAnim();
      setWorksRailLayoutWidth(listW + prevW);
      setEdgePulse(false);
      requestAnimationFrame(() => {
        setWorksRailOpen(true);
      });
    },
    [listPane.width, previewPane.width, pulseWorksRailWidthAnim],
  );

  const closeWorksRail = useCallback(() => {
    userCollapsedWorksRef.current = true;
    setWorksRailOpen(false);
    setPreviewOpen(false);
    setListOpen(false);
    // worksRailLayoutWidth → 0 on transition end (see shell handler)
  }, []);

  const onWorksRailTransitionEnd = useCallback(
    (e: TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== "opacity" && e.propertyName !== "transform") {
        return;
      }
      if (!worksRailOpenRef.current) {
        // Content has already faded out — ease the now-empty slot shut too
        // instead of letting it snap to 0.
        pulseWorksRailWidthAnim();
        setWorksRailLayoutWidth(0);
      }
    },
    [pulseWorksRailWidthAnim],
  );

  const refreshArtifacts = useCallback(
    async (opts?: { preferId?: string; openPreview?: boolean }) => {
      const sid = session?.id ?? sessionId;
      if (!sid) return;
      setArtifactsLoading(true);
      setArtifactsError(null);
      try {
        const list = await listArtifacts(sid);
        setArtifacts(list);
        setSelectedId((prev) => {
          if (opts?.preferId && list.some((a) => a.id === opts.preferId)) {
            return opts.preferId;
          }
          if (prev && list.some((a) => a.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
        if (opts?.openPreview) {
          // Auto path — respects userCollapsedWorksRef inside openWorksRail
          openWorksRail({ preview: true, animated: false, manual: false });
        }
      } catch (err) {
        if (err instanceof StudioApiError && err.status === 401) {
          setArtifactsError("请先登录");
        } else {
          setArtifactsError(
            err instanceof Error ? err.message : "加载作品失败",
          );
        }
      } finally {
        setArtifactsLoading(false);
      }
    },
    [session?.id, sessionId, openWorksRail],
  );

  const flashArtifact = useCallback((id: string) => {
    setFlashId(id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashId(null), 2800);
  }, []);

  const upsertArtifact = useCallback((artifact: Artifact) => {
    setArtifacts((previous) => [
      artifact,
      ...previous.filter((item) => item.id !== artifact.id),
    ]);
  }, []);

  const openPendingVideoAnalysis = useCallback(
    (artifact: Artifact) => {
      upsertArtifact(artifact);
      setSelectedId(artifact.id);
      flashArtifact(artifact.id);
      setMobileTab("works");
      openWorksRail({ preview: true, list: false, animated: true, manual: true });
    },
    [flashArtifact, openWorksRail, upsertArtifact],
  );

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const onArtifact = useCallback(
    (event: ArtifactEventPayload) => {
      // write_artifact (or auto-persist) → refresh list; open only if user hasn't hidden
      void refreshArtifacts({ preferId: event.artifactId, openPreview: true });
      flashArtifact(event.artifactId);
      if (!userCollapsedWorksRef.current) {
        setMobileTab("works");
        openWorksRail({ preview: true, animated: true, manual: false });
      } else {
        // Collapsed: pulse edge tab so user knows something new arrived
        setEdgePulse(true);
      }
    },
    [refreshArtifacts, flashArtifact, openWorksRail],
  );

  const reloadContent = useCallback(async () => {
    if (!selectedId) return;
    setContentLoading(true);
    setContentError(null);
    try {
      const data = await getArtifact(selectedId);
      setContent(data.content ?? "");
    } catch (err) {
      setContent(null);
      setContentError(err instanceof Error ? err.message : "读取作品失败");
    } finally {
      setContentLoading(false);
    }
  }, [selectedId]);

  // Background image generation jobs push status changes here, independent
  // of any single chat turn's own SSE stream (see artifact-events.ts).
  // Subscribed once with stable deps — re-subscribing on every artifact
  // click would tear down and reopen the EventSource, and any
  // artifact_updated event published during that reconnect window would be
  // lost forever (no server-side replay). Refs let the handler always read
  // the latest selectedId / reloadContent without needing them as deps.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const reloadContentRef = useRef(reloadContent);
  useEffect(() => {
    reloadContentRef.current = reloadContent;
  }, [reloadContent]);
  useEffect(() => {
    const unsubscribe = subscribeArtifactStream((event) => {
      setArtifacts((prev) =>
        prev.map((a) =>
          a.id === event.artifactId
            ? { ...a, status: event.status, ...(event.error ? { error: event.error } : {}) }
            : a,
        ),
      );
      if (event.artifactId === selectedIdRef.current) {
        void reloadContentRef.current();
      }
    });
    return unsubscribe;
  }, []);

  const reconcileSessionBundle = useCallback(async () => {
    const sid = session?.id ?? sessionId;
    if (!sid) return;
    try {
      const bundle = await getSessionBundle(sid);
      startTransition(() => {
        setSession(bundle.session);
        setPinnedSkillIds(bundle.session.pinnedSkillIds ?? []);
        setActiveRun(bundle.activeRun);
        setInitialMessages(bundle.messages);
      });
    } catch {
      // The live stream remains the source of truth if reconciliation races
      // a session bootstrap or a transient auth/network failure.
    }
  }, [session?.id, sessionId]);

  const chat = useStudioChat({
    sessionId: session?.id ?? sessionId,
    initialMessages,
    model: session?.model ?? FALLBACK_DEFAULT_MODEL,
    onUnauthorized,
    onArtifact,
    activeRun,
    onFinish: () => {
      void reconcileSessionBundle();
      void refreshArtifacts();
    },
  });

  // Resolve the shared project context independently from the chat bundle so
  // older sessions (without projectId) continue to render unchanged.
  useEffect(() => {
    const projectId = session?.projectId;
    if (!projectId || !account) {
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
  }, [account, session?.projectId]);

  const refineImageWithAnnotation = useCallback(
    (input: {
      baseArtifactId: string;
      annotationArtifactId: string;
      message: string;
    }) =>
      chat.send(input.message, {
        referencedArtifactIds: [
          input.baseArtifactId,
          input.annotationArtifactId,
        ],
      }),
    [chat],
  );

  useEffect(() => {
    if (!sessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- invalid client route state is resolved after useParams hydrates.
      setLoadError("无效的会话");
      setLoading(false);
      return;
    }

    let cancelled = false;
    // Keep handoff UI interactive — don't flip back into a blocking load state
    const pending = peekPendingFirstMessage(sessionId);
    if (!pending) setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const bundle = await getSessionBundle(sessionId);
        if (cancelled) return;
        // Don't wipe optimistic first bubble while pending send is still queued
        const stillPending = peekPendingFirstMessage(sessionId);
        const messages =
          bundle.messages.length > 0
            ? bundle.messages
            : stillPending?.message
              ? [optimisticUserMessage(sessionId, stillPending.message)]
              : bundle.messages;
        // Reveal inside a Transition so the named ViewTransition wrappers
        // (studio-chat-thread / studio-header-slot) can crossfade the
        // skeleton → real content swap instead of popping in instantly.
        startTransition(() => {
          setSession(bundle.session);
          setPinnedSkillIds(bundle.session.pinnedSkillIds ?? []);
          setActiveRun(bundle.activeRun);
          setInitialMessages(messages);
          setLoading(false);
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof StudioApiError && err.status === 401) {
          setLoadError("请先登录后查看会话");
          openLogin("login");
        } else if (err instanceof StudioApiError && err.status === 404) {
          // A client-minted session id (see /studio's startChat) navigates
          // here before the server has ever heard of it — it only gets
          // created inside the POST /api/chat that starts the first turn.
          // A 404 here just means that POST hasn't landed yet, not that the
          // session doesn't exist; the handoff bootstrap above already
          // painted a usable local session, so there's nothing to correct.
          if (!pending) setLoadError("会话不存在或无权访问");
        } else {
          setLoadError(err instanceof Error ? err.message : "加载会话失败");
        }
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, openLogin]);

  const onPinnedSkillIdsChange = useCallback(
    async (ids: string[]) => {
      setPinnedSkillIds(ids);
      const sid = session?.id ?? sessionId;
      if (!sid) return;
      try {
        const updated = await patchSession(sid, { pinnedSkillIds: ids });
        setSession(updated);
        setPinnedSkillIds(updated.pinnedSkillIds ?? ids);
      } catch (err) {
        // Keep optimistic pins; surface auth so user can re-login
        if (err instanceof StudioApiError && err.status === 401) {
          openLogin("login");
        }
      }
    },
    [session?.id, sessionId, openLogin],
  );

  // Load artifacts when session is ready
  useEffect(() => {
    if (!session?.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session identity is the external key for the Artifact store.
    void refreshArtifacts();
  }, [session?.id, refreshArtifacts]);

  // Load selected artifact content
  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing selection must clear its asynchronously loaded preview.
      setContent(null);
      setContentError(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    void (async () => {
      try {
        const data = await getArtifact(selectedId);
        if (cancelled) return;
        setContent(data.content ?? "");
      } catch (err) {
        if (cancelled) return;
        setContent(null);
        setContentError(
          err instanceof Error ? err.message : "读取作品失败",
        );
      } finally {
        if (!cancelled) setContentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Auto-send first message handed off from /studio home. The home page
  // already started uploads/video-analysis/sheet-import and will deliver the
  // fully-resolved send params via registerPendingFirstMessageListener once
  // those finish (possibly after this effect runs — uploads take real time,
  // this mount does not) — chat.prepare() below paints the optimistic bubble
  // immediately either way, matching the home page's already-shown one.
  useEffect(() => {
    if (loading || !session || pendingSentRef.current) return;
    const pending = takePendingFirstMessage(session.id);
    if (!pending) return;
    pendingSentRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consuming the one-shot handoff transitions the persisted live store.
    setHasHandoff(false);
    if (pending.model) chat.setModel(pending.model);

    const prepared = chat.prepare(pending.message, "正在理解需求…");
    if (!prepared) return;

    return registerPendingFirstMessageListener(session.id, {
      onStatus: (label) => prepared.setStatus(label),
      onFail: (message) => prepared.fail(message),
      onResolve: (overrides) => {
        void prepared.commit(pending.message, {
          model: overrides.model ?? pending.model,
          capabilityPresetId: overrides.capabilityPresetId ?? session.capabilityPresetId,
          composerOptions: overrides.composerOptions ?? pending.composerOptions,
          skillIds: overrides.skillIds ?? pending.skillIds,
          referencedArtifactIds: overrides.referencedArtifactIds ?? pending.referencedArtifactIds,
          projectId: overrides.projectId,
          bootstrap: overrides.bootstrapTitle ? { title: overrides.bootstrapTitle } : undefined,
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once after load
  }, [loading, session]);

  // Retry load after login
  useEffect(() => {
    if (!account || !sessionId || session || !loadError) return;
    let cancelled = false;
    (async () => {
      try {
        const bundle = await getSessionBundle(sessionId);
        if (cancelled) return;
        startTransition(() => {
          setSession(bundle.session);
          setPinnedSkillIds(bundle.session.pinnedSkillIds ?? []);
          setActiveRun(bundle.activeRun);
          setInitialMessages(bundle.messages);
          setLoadError(null);
        });
      } catch {
        /* keep error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, sessionId, session, loadError]);

  const title = useMemo(
    () => session?.title || "对话",
    [session?.title],
  );

  const selected = useMemo(
    () => artifacts.find((a) => a.id === selectedId) ?? null,
    [artifacts, selectedId],
  );
  const mentionableArtifacts = useMemo(
    () => artifacts.filter(isMentionableArtifact),
    [artifacts],
  );
  const focusedSheet =
    selected?.kind === "sheet" && selected.status !== "failed" ? selected : null;

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      // Focus preview after pick — collapse list so content is front and center
      setListOpen(false);
      openWorksRail({ preview: true, list: false, manual: true });
    },
    [openWorksRail],
  );

  const artifactsByMessageId = useMemo(() => {
    const map = new Map<string, Artifact[]>();
    for (const a of artifacts) {
      if (!a.messageId) continue;
      const list = map.get(a.messageId) ?? [];
      list.push(a);
      map.set(a.messageId, list);
    }
    return map;
  }, [artifacts]);

  const openArtifactFromChat = useCallback(
    (artifactId: string) => {
      setSelectedId(artifactId);
      openWorksRail({ preview: true, animated: true, manual: true });
      setMobileTab("works");
      flashArtifact(artifactId);
    },
    [flashArtifact, openWorksRail],
  );

  const jumpToMessage = useCallback((messageId: string) => {
    setMobileTab("chat");
    setHighlightMessageId(messageId);
  }, []);

  const retryGeneration = useCallback(
    (messageId: string) => {
      const original = chat.messages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      const originalText = original?.parts
        .filter((part): part is Extract<(typeof original.parts)[number], { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (!original || !originalText || hasMentionToken(originalText)) {
        // Stored text alone cannot safely rebuild referenced artifact ids.
        jumpToMessage(messageId);
        return;
      }
      return chat.send(originalText);
    },
    [chat, jumpToMessage],
  );

  /** No handoff bootstrap and the server bundle hasn't resolved yet. */
  const showThreadSkeleton = !hasHandoff && initialMessages === undefined;

  /** Published into StudioShell's persistent header slot — never unmounts on navigation. */
  const headerContent = useMemo(() => (
      <header className="studio-session-header flex shrink-0 items-center gap-3 border-b border-white/50 px-4 py-3 sm:px-6">
      <Link
        href="/studio"
        className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[#615A73] transition hover:bg-white/60 hover:text-[#241E36]"
        title="开始创作"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="sr-only">返回</span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-sm font-semibold text-[#241E36]">{title}</h1>
          {project ? (
            <Link
              href={`/studio/p/${encodeURIComponent(project.id)}`}
              className="hidden min-w-0 max-w-[180px] shrink-0 items-center gap-1 rounded-[7px] bg-white/55 px-1.5 py-0.5 text-[10px] font-medium text-[#615A73] transition hover:bg-white hover:text-[#241E36] sm:inline-flex"
              title={`返回项目：${project.name}`}
            >
              <FolderKanban className="h-3 w-3 shrink-0 text-[#0F172A]" strokeWidth={1.8} />
              <span className="truncate">{project.name}</span>
            </Link>
          ) : null}
        </div>
        {session?.model && !loadError ? (
          <p className="truncate font-mono text-[11px] text-[#8A8298]">
            {chat.model || session?.model}
          </p>
        ) : null}
      </div>
      {/* Desktop: list toggle first, then works rail (matches left→right layout) */}
      {worksRailOpen ? (
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          className={`hidden h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-medium transition md:inline-flex ${
            listOpen
              ? "border-[rgba(15,23,42,0.25)] bg-[rgba(15,23,42,0.08)] text-[#0F172A]"
              : "border-white/70 bg-white/50 text-[#615A73] hover:bg-white"
          }`}
          title={listOpen ? "收起作品列表" : "展开作品列表"}
          aria-pressed={listOpen}
        >
          {listOpen ? (
            <ChevronLeft className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          列表
          {artifacts.length > 0 ? (
            <span className="tabular-nums opacity-80">{artifacts.length}</span>
          ) : null}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (worksRailOpen) closeWorksRail();
          else
            openWorksRail({
              preview: Boolean(selectedId) || artifacts.length > 0,
              manual: true,
            });
        }}
        className={`hidden h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-medium transition md:inline-flex ${
          worksRailOpen
            ? "border-[rgba(15, 23, 42,0.25)] bg-[rgba(15, 23, 42,0.08)] text-[#0F172A]"
            : "border-white/70 bg-white/50 text-[#615A73] hover:bg-white"
        }`}
        title={worksRailOpen ? "收起作品区" : "打开作品区"}
        aria-pressed={worksRailOpen}
      >
        {worksRailOpen ? (
          <PanelLeftClose className="h-3.5 w-3.5" />
        ) : (
          <PanelRight className="h-3.5 w-3.5" />
        )}
        作品
        {artifacts.length > 0 ? (
          <span className="tabular-nums opacity-80">{artifacts.length}</span>
        ) : null}
      </button>
      {worksRailOpen && !previewOpen ? (
        <button
          type="button"
          onClick={() => {
            userCollapsedWorksRef.current = false;
            setPreviewOpen(true);
          }}
          className="hidden h-8 items-center gap-1.5 rounded-[10px] border border-white/70 bg-white/50 px-2.5 text-xs text-[#615A73] transition hover:bg-white md:inline-flex"
          title="打开预览"
        >
          <PanelRight className="h-3.5 w-3.5" />
          预览
        </button>
      ) : null}
      <div className="flex rounded-[10px] border border-white/70 bg-white/40 p-0.5 md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("chat")}
          className={`rounded-[8px] px-2.5 py-1 text-xs font-medium transition ${
            mobileTab === "chat"
              ? "bg-gradient-to-br from-[#334155] to-[#0F172A] text-white"
              : "text-[#615A73] hover:bg-white/60"
          }`}
        >
          对话
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("works")}
          className={`rounded-[8px] px-2.5 py-1 text-xs font-medium transition ${
            mobileTab === "works"
              ? "bg-gradient-to-br from-[#334155] to-[#0F172A] text-white"
              : "text-[#615A73] hover:bg-white/60"
          }`}
        >
          作品
          {artifacts.length > 0 ? (
            <span className="ml-1 tabular-nums opacity-80">
              {artifacts.length}
            </span>
          ) : null}
        </button>
      </div>
      </header>
  ), [
    artifacts.length,
    chat.model,
    closeWorksRail,
    listOpen,
    loadError,
    mobileTab,
    openWorksRail,
    previewOpen,
    project,
    selectedId,
    session?.model,
    title,
    worksRailOpen,
  ]);

  useStudioHeaderSlot(headerContent, active);

  useEffect(() => {
    if (session?.title) onTitleChange?.(session.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onTitleChange is an unstable parent callback; only the title itself should retrigger this.
  }, [session?.title]);

  if (loadError && !session && !hasHandoff) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-[#615A73]">{loadError}</p>
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0F172A] hover:opacity-80"
        >
          <ArrowLeft className="h-4 w-4" />
          返回开始创作
        </Link>
      </div>
    );
  }

  /**
   * Mobile and desktop both mount this column (CSS toggles which is visible),
   * so a shared hardcoded ViewTransition name would mount twice at once and
   * React errors ("two <ViewTransition> with the same name"). Only the
   * desktop copy — the one this feature's morph/crossfade work targets —
   * keeps the real names; the mobile copy opts out.
   */
  const renderChatColumn = (withTransitionNames: boolean) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StudioViewTransition
        name={withTransitionNames ? "studio-chat-thread" : undefined}
      >
        <div className="studio-session-thread flex min-h-0 min-w-0 flex-1 flex-col">
          {showThreadSkeleton ? (
            <ChatThreadSkeleton />
          ) : (
            <ChatThread
              messages={chat.messages}
              streaming={
                chat.streaming ||
                (hasHandoff && loading)
              }
              emptyHint="发送一条消息，开始与 Reizo 对话。"
              highlightMessageId={highlightMessageId}
              onHighlightConsumed={() => setHighlightMessageId(null)}
              artifactsByMessageId={artifactsByMessageId}
              imageArtifacts={mentionableArtifacts}
              onOpenArtifact={openArtifactFromChat}
            />
          )}
        </div>
      </StudioViewTransition>
      {!session ? (
        <div className="studio-composer-dock">
          <div
            className="studio-liquid-glass mx-auto flex h-[58px] w-full max-w-3xl items-center gap-3 px-3 text-xs text-[#64748B]"
            data-variant="session"
            aria-busy="true"
          >
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 shrink-0 motion-safe:animate-spin"
            />
            正在加载会话
          </div>
        </div>
      ) : (
        <Composer
          onSend={(text, meta) => {
            void (async () => {
              // A current reply means this message takes the queue fallback
              // instead of an immediate prepared turn. Keep the prior
              // consistency guarantee before that queued request is created.
              try {
                await flushOpenSheetEdits();
              } catch {
                // Preserve existing queue behavior on a save conflict. The
                // active turn is still authoritative and the editor exposes
                // the save error for a deliberate retry.
              }
              const ids = [...(meta?.referencedArtifactIds ?? [])];
              if (focusedSheet && !ids.includes(focusedSheet.id)) {
                ids.push(focusedSheet.id);
              }
              await chat.send(text, {
                skillIds: meta?.skillIds,
                composerOptions: meta?.composerOptions,
                referencedArtifactIds: ids.length ? ids : undefined,
              });
            })();
          }}
          onPrepareSend={(text) => {
            const prepared = chat.prepare(text);
            if (!prepared) return null;
            return {
              setStatus: prepared.setStatus,
              fail: prepared.fail,
              commit: async (outbound, meta) => {
                const ids = [...(meta?.referencedArtifactIds ?? [])];
                if (focusedSheet && !ids.includes(focusedSheet.id)) {
                  ids.push(focusedSheet.id);
                }
                prepared.setStatus(
                  focusedSheet ? "正在同步表格…" : "正在确认上下文…",
                );
                await afterNextPaint();
                try {
                  await flushOpenSheetEdits();
                } catch (error) {
                  prepared.fail(
                    error instanceof Error ? error.message : "表格同步失败，请重试",
                  );
                  return;
                }
                prepared.setStatus("正在理解需求…");
                return prepared.commit(outbound, {
                  skillIds: meta?.skillIds,
                  composerOptions: meta?.composerOptions,
                  referencedArtifactIds: ids.length ? ids : undefined,
                });
              },
            };
          }}
          onStop={chat.stop}
          streaming={chat.streaming || (hasHandoff && loading)}
          disabled={showThreadSkeleton || (loading && hasHandoff)}
          model={chat.model}
          onModelChange={chat.setModel}
          capabilityPresetId={session?.capabilityPresetId}
          pinnedSkillIds={pinnedSkillIds}
          onPinnedSkillIdsChange={(ids) => {
            void onPinnedSkillIdsChange(ids);
          }}
          error={chat.error}
          onClearError={chat.clearError}
          onRetryError={() => void chat.retryError()}
          queue={chat.queue}
          onRemoveFromQueue={chat.removeFromQueue}
          onClearQueue={chat.clearQueue}
          draftKey={session?.id ?? sessionId}
          placeholder={
            hasHandoff && loading ? "正在连接…" : undefined
          }
          shareTransitionName={withTransitionNames ? "studio-composer" : null}
          imageArtifacts={mentionableArtifacts}
          focusedSheet={focusedSheet}
          sessionId={session?.id ?? sessionId}
          onImageUploaded={upsertArtifact}
          onVideoUploaded={upsertArtifact}
          onVideoAnalysisStarted={openPendingVideoAnalysis}
          onSheetUploaded={openPendingVideoAnalysis}
        />
      )}
    </div>
  );

  const worksColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ArtifactPanel
        artifacts={artifacts}
        selectedId={selectedId}
        onSelect={handleSelect}
        loading={artifactsLoading}
        error={artifactsError}
        onRefresh={() => void refreshArtifacts()}
        flashId={flashId}
        className="max-h-[40%] w-full shrink-0 border-l-0 border-b"
      />
      <ArtifactPreview
        artifact={selected}
        content={content}
        loading={contentLoading}
        error={contentError}
        onClose={() => setPreviewOpen(false)}
        onRefresh={() => void reloadContent()}
        onJumpToMessage={jumpToMessage}
        onRetryGeneration={retryGeneration}
        sessionId={session?.id ?? sessionId}
        locked={chat.streaming}
        onImageAnnotationRefine={refineImageWithAnnotation}
        className="min-h-0 flex-1 border-l-0"
      />
    </div>
  );

  return (
    <div
      className={`studio-session-root flex min-h-0 flex-1 flex-col ${hasHandoff ? "" : "studio-view-in"}`}
      data-handoff={hasHandoff ? "true" : "false"}
    >
      {/* Mobile: tabbed */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        {mobileTab === "chat" ? renderChatColumn(false) : worksColumn}
      </div>

      {/* Desktop: chat | works rail — shell stays mounted; layout width discrete, slide via CSS */}
      <div className="relative hidden min-h-0 flex-1 md:flex">
        {renderChatColumn(active)}

        <div
          className="studio-works-shell border-l border-white/40"
          data-open={worksRailOpen ? "true" : "false"}
          data-width-animating={worksRailWidthAnimating ? "true" : "false"}
          style={{ width: worksRailLayoutWidth }}
          aria-hidden={!worksRailOpen}
        >
          <div
            className="studio-works-shell-inner relative flex h-full min-w-0"
            style={{
              width:
                contentRailWidth ||
                LIST_STRIP_W + previewPane.width,
            }}
            onTransitionEnd={onWorksRailTransitionEnd}
          >
            {/* List column: full panel or narrow strip (scheme A) */}
            <div
              className="relative flex h-full shrink-0 overflow-hidden border-r border-white/40"
              style={{ width: listColWidth }}
              data-list-open={listOpen ? "true" : "false"}
            >
              {listOpen ? (
                <>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="调整作品列表宽度"
                    onPointerDown={listPane.onHandlePointerDown}
                    className="absolute inset-y-0 left-0 z-[2] w-1.5 cursor-col-resize hover:bg-[rgba(15,23,42,0.25)] active:bg-[rgba(15,23,42,0.4)]"
                  />
                  <ArtifactPanel
                    artifacts={artifacts}
                    selectedId={selectedId}
                    onSelect={handleSelect}
                    loading={artifactsLoading}
                    error={artifactsError}
                    onRefresh={() => void refreshArtifacts()}
                    onCollapse={() => setListOpen(false)}
                    flashId={flashId}
                    className="w-full min-w-0"
                  />
                </>
              ) : (
                <>
                  {/* List collapsed: drag works rail left edge to resize preview / total width */}
                  {previewOpen ? (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="调整作品区宽度"
                      onPointerDown={previewPane.onHandlePointerDown}
                      className="absolute inset-y-0 left-0 z-[2] w-1.5 cursor-col-resize hover:bg-[rgba(15,23,42,0.25)] active:bg-[rgba(15,23,42,0.4)]"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setListOpen(true)}
                    className="studio-works-list-strip flex h-full w-full flex-col items-center gap-2 py-3 text-[#64748b] transition hover:bg-white/50 hover:text-[#0f172a]"
                    title="展开本会话作品列表"
                    aria-label={`展开作品列表${artifacts.length ? `，共 ${artifacts.length} 个` : ""}`}
                  >
                    <ChevronRight className="h-4 w-4 shrink-0" />
                    <span className="studio-works-list-strip-label text-[11px] font-semibold tracking-wide">
                      列表
                    </span>
                    {artifacts.length > 0 ? (
                      <span className="rounded-full bg-[rgba(15,23,42,0.08)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#0f172a]">
                        {artifacts.length}
                      </span>
                    ) : null}
                  </button>
                </>
              )}
            </div>

            <div
              className="studio-works-preview-shell relative h-full min-w-0 flex-1 overflow-hidden"
              data-open={previewOpen ? "true" : "false"}
              style={{ width: previewColWidth }}
              aria-hidden={!previewOpen}
            >
              {/* List open: drag list|preview split. Collapsed: left edge of strip resizes instead. */}
              {previewOpen && listOpen ? (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整预览宽度"
                  onPointerDown={previewPane.onHandlePointerDown}
                  className="absolute inset-y-0 left-0 z-[2] w-1.5 cursor-col-resize hover:bg-[rgba(15,23,42,0.25)] active:bg-[rgba(15,23,42,0.4)]"
                />
              ) : null}
              <ArtifactPreview
                artifact={selected}
                content={content}
                loading={contentLoading}
                error={contentError}
                onClose={() => setPreviewOpen(false)}
                onRefresh={() => void reloadContent()}
                onJumpToMessage={jumpToMessage}
                onRetryGeneration={retryGeneration}
                sessionId={session?.id ?? sessionId}
                locked={chat.streaming}
                onImageAnnotationRefine={refineImageWithAnnotation}
                className="h-full w-full min-w-0"
              />
            </div>
          </div>
        </div>

        {!worksRailOpen && worksRailLayoutWidth === 0 ? (
          <button
            type="button"
            className="studio-works-edge-tab"
            data-pulse={edgePulse || flashId ? "true" : "false"}
            onClick={() => openWorksRail({ preview: true, manual: true })}
            title="打开作品区"
            aria-label={`打开作品区${artifacts.length ? `，共 ${artifacts.length} 个` : ""}`}
          >
            <PanelRight className="h-4 w-4" />
            <span className="studio-works-edge-label">作品</span>
            {artifacts.length > 0 ? (
              <span className="rounded-full bg-[rgba(15, 23, 42,0.12)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#0F172A]">
                {artifacts.length}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}
