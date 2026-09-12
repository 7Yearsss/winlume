"use client";

import Link from "next/link";
import { BorderBeam } from "border-beam";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useEffectEvent,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  FileText,
  Image as ImageIcon,
  ListOrdered,
  LoaderCircle,
  Mic,
  MicOff,
  MessageSquare,
  Paperclip,
  PenLine,
  Pin,
  Scissors,
  RotateCw,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Square,
  Sparkles,
  Table2,
  Workflow,
  Zap,
  X,
} from "lucide-react";
import type { PlazaModel } from "@/lib/catalog";
import { getVendorByKey, inferVendorFromModel } from "@/lib/catalog/vendors";
import type { Artifact, SkillMeta } from "@/lib/agent/types";
import {
  composeOutboundMessage,
  createPastedBlock,
  fileToAttachment,
  fileToImageAttachment,
  fileToVideoAttachment,
  formatFileSize,
  hasComposerPayload,
  isImageFile,
  isVideoFile,
  MAX_FILES,
  MAX_IMAGES,
  MAX_WORKBOOKS,
  MAX_PASTED_BLOCKS,
  MAX_VIDEOS,
  PASTED_COLLAPSED_PX,
  PASTED_EXPANDED_PX,
  resolveComposerPasteIntent,
  shouldCollapsePaste,
  type FileAttachment,
  type ImageAttachment,
  type PastedBlock,
  type VideoAttachment,
  type WorkbookAttachment,
} from "@/lib/studio/composer-attachments";
import {
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from "@/lib/studio/composer-draft";
import { afterNextPaint } from "@/lib/studio/next-paint";
import { studioToolHref } from "@/lib/studio/studio-mode";
import {
  startVideoAnalysis,
  uploadImageArtifact,
  uploadSheetArtifact,
  uploadVideoArtifact,
} from "@/lib/studio/api";
import { REFERENCE_VIDEO_ACCEPT } from "@/lib/studio/video-upload";
import {
  subscribeSheetSelection,
  type SheetSelectionPreview,
} from "@/lib/studio/sheet-selection";
import {
  isLegacyXlsFile,
  isSpreadsheetFile,
  MAX_SHEET_UPLOAD_BYTES,
  workbookTitleFromFileName,
} from "@/lib/agent/sheet-file";
import {
  buildMentionCandidates,
  filterMentionCandidates,
  nameLocalImageBatch,
  resolvePendingLocalMentions,
  resolveReferencedArtifactIds,
  type MentionCandidate,
} from "@/lib/studio/image-mentions";
import { splitSheetRangeToken } from "@/lib/studio/mention-editor";
import ArtifactMentionMenu, { detectAtMention } from "./ArtifactMentionMenu";
import MentionPromptEditor, {
  type MentionPromptEditorHandle,
} from "./MentionPromptEditor";
import {
  initialStudioToolParams,
  type StudioTool,
  type StudioToolParams,
  validateStudioToolParams,
} from "@/lib/studio/tool-catalog";
import {
  capabilityPresetForMode,
  IMAGE_SIZE_OPTIONS,
  modeForCapabilityPreset,
  type ComposerMode,
  type ComposerOptions,
  type ImageSize,
} from "@/lib/studio/composer-options";
import { isGenericSkillPrompt } from "@/lib/studio/skill-prompt";
import SkillChips, { SkillChipMark } from "./SkillChips";
import SkillSlashMenu, {
  activateSlashMenuItem,
  getSlashMenuItems,
  type MenuView,
  type SkillDepartment,
} from "./SkillSlashMenu";
import StudioViewTransition from "./StudioViewTransition";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MAX_MESSAGE_QUEUE_SIZE,
  type StudioQueuedMessage,
} from "./studio-chat-types";

const FALLBACK_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "claude-3-5-sonnet",
  "deepseek-chat",
] as const;

const DRAFT_DEBOUNCE_MS = 400;

type ModelVendorGroup = {
  key: string;
  name: string;
  models: string[];
};

const MONO_VENDOR_MARKS = new Set([
  "openai",
  "anthropic",
  "xai",
  "moonshot",
  "black-forest",
  "jina",
]);

function vendorMarkSrc(key: string) {
  return `/vendors/${encodeURIComponent(key)}.svg`;
}

function VendorMark({ vendorKey }: { vendorKey: string }) {
  const vendor = getVendorByKey(vendorKey);
  return (
    <span
      className="composer-vendor-mark"
      data-mono={MONO_VENDOR_MARKS.has(vendor.key) ? "" : undefined}
      aria-hidden
    >
      <img
        src={vendorMarkSrc(vendor.key)}
        alt=""
        onError={(event) => {
          const img = event.currentTarget;
          if (!img.src.endsWith("/vendors/other.svg")) img.src = "/vendors/other.svg";
        }}
      />
    </span>
  );
}

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type BrowserSpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

const COMPOSER_MODE_ITEMS: ReadonlyArray<{
  id: ComposerMode;
  label: string;
  title: string;
}> = [
  { id: "chat", label: "对话", title: "纯文字对话" },
  { id: "image", label: "图片", title: "图片创作与编辑" },
  { id: "video", label: "视频", title: "视频生成（服务尚未接入）" },
  { id: "canvas", label: "画布", title: "生成或更新可编辑画布" },
  { id: "sheet", label: "表格", title: "生成或更新可编辑表格" },
];

function ComposerModeIcon({
  mode,
  className = "h-3.5 w-3.5",
}: {
  mode: ComposerMode;
  className?: string;
}) {
  if (mode === "image") return <ImageIcon className={className} />;
  if (mode === "video") return <Clapperboard className={className} />;
  if (mode === "canvas") return <Workflow className={className} />;
  if (mode === "sheet") return <Table2 className={className} />;
  return <MessageSquare className={className} />;
}

function ImageSizeIcon({ value }: { value: ImageSize }) {
  if (value === "1536x1024") {
    return <RectangleHorizontal className="h-4 w-4 shrink-0 text-[#536DA8]" />;
  }
  if (value === "1024x1536") {
    return <RectangleVertical className="h-4 w-4 shrink-0 text-[#536DA8]" />;
  }
  return <Square className="h-4 w-4 shrink-0 text-[#536DA8]" />;
}

export type ComposerSendMeta = {
  /** Turn-scoped Composer mode and generation settings. */
  composerOptions?: ComposerOptions;
  /** Optional launch preset retained for session bootstrap compatibility. */
  capabilityPresetId?: string;
  skillIds?: string[];
  /** Server artifact ids resolved from @图片N (and other @names) in the prompt. */
  referencedArtifactIds?: string[];
  /**
   * Local images to persist after the home page creates a session
   * (pre-session composer has no sessionId yet).
   */
  pendingImageUploads?: Array<{
    localId: string;
    name: string;
    dataUrl: string;
  }>;
  /** Files must stay in memory; they are uploaded after the home page creates a session. */
  pendingVideoUploads?: Array<{
    localId: string;
    file: File;
    authorized: true;
  }>;
  pendingSheetUploads?: Array<{
    localId: string;
    name: string;
    file: File;
  }>;
};

export type ComposerCatalogContext = {
  kind: "tool" | "skill";
  name: string;
  iconUrl?: string;
};

/** A live turn already visible in the thread while the Composer prepares inputs. */
export type ComposerSendPreparation = {
  setStatus: (label: string) => void;
  fail: (message: string) => void;
  commit: (text: string, meta?: ComposerSendMeta) => void | Promise<void | string>;
};

export type ComposerProps = {
  value?: string;
  onChange?: (value: string) => void;
  onSend: (
    text: string,
    meta?: ComposerSendMeta,
  ) => void | Promise<void | string>;
  /**
   * Optionally creates an optimistic user + activity pair before local work
   * (uploads, workbook sync, or other preflight) begins.
   */
  onPrepareSend?: (text: string) => ComposerSendPreparation | null;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  model: string;
  onModelChange: (model: string) => void;
  placeholder?: string;
  allowCustomModel?: boolean;
  error?: string | null;
  onClearError?: () => void;
  onRetryError?: () => void;
  skillIds?: string[];
  onSkillIdsChange?: (ids: string[]) => void;
  /** Display-only context carried from the application directory. */
  catalogContext?: ComposerCatalogContext | null;
  pinnedSkillIds?: string[];
  onPinnedSkillIdsChange?: (ids: string[]) => void;
  queue?: StudioQueuedMessage[];
  onRemoveFromQueue?: (id: string) => void;
  onClearQueue?: () => void;
  /**
   * localStorage draft scope (e.g. session id or "home").
   * When set, text is auto-saved / restored (NewMax draft persistence).
   */
  draftKey?: string | null;
  /**
   * `hero` — floating pill for Apple-style workspace home (larger, no dock chrome).
   * `default` — sticky session composer.
   */
  variant?: "default" | "hero";
  /**
   * Name for the home→session shared-element morph. Two Composer instances
   * with the same name mounted at once (e.g. a duplicate responsive layout
   * tree) breaks View Transitions — pass `null` on any instance that isn't
   * the one participating in the morph to opt it out.
   */
  shareTransitionName?: string | null;
  /** Also carries canvas artifacts for @-mentions; prop name is retained for compatibility. */
  imageArtifacts?: Artifact[];
  /** Current session scope. Omitted by the pre-session home composer. */
  sessionId?: string;
  /** Called when an uploaded image finishes persisting as an Artifact. */
  onImageUploaded?: (artifact: Artifact) => void;
  /** Called after an authorized reference video becomes a source artifact. */
  onVideoUploaded?: (artifact: Artifact) => void;
  /** Called after a pending video-analysis artifact is created. */
  onVideoAnalysisStarted?: (artifact: Artifact) => void;
  /** Workbook currently open in the artifact panel; auto-included on send. */
  focusedSheet?: Artifact | null;
  /** Called after an uploaded .xlsx becomes a sheet artifact. */
  onSheetUploaded?: (artifact: Artifact) => void;
  /** Initial capability launch intent; mode changes remain turn-scoped. */
  capabilityPresetId?: string | null;
  onCapabilityPresetChange?: (id: string | null) => void;
};

function PastedBlockCard({
  block,
  onRemove,
  disabled,
}: {
  block: PastedBlock;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > PASTED_COLLAPSED_PX + 4);
  }, [block.full, expanded]);

  const title =
    block.name ||
    (block.source === "file"
      ? "文件"
      : `粘贴 · ${block.lineCount} 行 · ${formatFileSize(block.charCount)}`);

  return (
    <div className="group flex w-full max-w-full flex-col gap-1 rounded-[12px] border border-white/60 bg-white/40 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-sm">
      <div className="flex items-center gap-1.5 px-1 text-[11px] text-[#615A73]">
        <FileText className="h-3.5 w-3.5 shrink-0 text-[#0F172A]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[#241E36]">
          {title}
        </span>
        <button
          type="button"
          title="复制全文"
          disabled={disabled}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(block.full);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* deny */
            }
          }}
          className="rounded p-0.5 text-[#8A8298] hover:bg-white hover:text-[#241E36] disabled:opacity-40"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          title="移除"
          disabled={disabled}
          onClick={onRemove}
          className="rounded p-0.5 text-[#8A8298] hover:bg-white hover:text-[#0F172A] disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <pre
        ref={contentRef}
        className="overflow-hidden whitespace-pre-wrap break-words rounded-[8px] bg-white/70 px-2.5 py-2 font-mono text-[11px] leading-4 text-[#241E36]"
        style={{
          maxHeight: expanded ? PASTED_EXPANDED_PX : PASTED_COLLAPSED_PX,
          overflowY: expanded ? "auto" : "hidden",
        }}
      >
        {expanded ? block.full : block.preview}
      </pre>
      {overflowing || block.preview !== block.full ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-0.5 self-start px-1 text-[11px] font-medium text-[#0F172A] hover:underline"
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" />
              收起
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" />
              展开全部
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

export default function Composer({
  value: controlledValue,
  onChange,
  onSend,
  onPrepareSend,
  onStop,
  streaming = false,
  disabled = false,
  model,
  onModelChange,
  placeholder = "输入需求，或输入 @ 引用产物、/选择技能",
  allowCustomModel = true,
  error,
  onClearError,
  onRetryError,
  skillIds: skillIdsProp,
  onSkillIdsChange,
  catalogContext = null,
  pinnedSkillIds: pinnedSkillIdsProp,
  onPinnedSkillIdsChange,
  queue = [],
  onRemoveFromQueue,
  onClearQueue,
  draftKey = null,
  variant = "default",
  shareTransitionName = "studio-composer",
  imageArtifacts = [],
  sessionId,
  onImageUploaded,
  onVideoUploaded,
  onVideoAnalysisStarted,
  focusedSheet = null,
  onSheetUploaded,
  capabilityPresetId,
  onCapabilityPresetChange,
}: ComposerProps) {
  // Catalog requests can finish after the URL entry or a user action selects
  // a model. Always reconcile against the latest selection, not mount props.
  const reconcileLoadedModels = useEffectEvent((names: string[]) => {
    if (names.length) {
      if (!model || !names.includes(model)) onModelChange(names[0]);
    } else if (model) {
      onModelChange("");
    }
  });
  const isHero = variant === "hero";
  const promptId = useId();
  const modelId = useId();
  const menuId = useId();
  const fileInputId = useId();

  const [uncontrolled, setUncontrolled] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([...FALLBACK_MODELS]);
  const [modelCatalog, setModelCatalog] = useState<PlazaModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [customMode, setCustomMode] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>(() =>
    modeForCapabilityPreset(capabilityPresetId),
  );
  const [imageSize, setImageSize] = useState<ImageSize>("1024x1024");
  const [imageCount, setImageCount] = useState<1 | 2 | 3 | 4>(1);
  const [capabilityAvailability, setCapabilityAvailability] = useState<
    Partial<Record<ComposerMode, "available" | "degraded" | "needs_setup" | "unavailable">>
  >({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerVendor, setModelPickerVendor] = useState<string | null>(null);
  const [lastModelPickerVendor, setLastModelPickerVendor] = useState<string | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([]);
  const [departments, setDepartments] = useState<SkillDepartment[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [internalSkillIds, setInternalSkillIds] = useState<string[]>([]);
  const [internalPinnedIds, setInternalPinnedIds] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuView, setMenuView] = useState<MenuView>({ kind: "root" });
  const [slashRange, setSlashRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [turnTool, setTurnTool] = useState<StudioTool | null>(null);
  const [turnToolParams, setTurnToolParams] = useState<StudioToolParams>({});
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(
    null,
  );

  const [pastedBlocks, setPastedBlocks] = useState<PastedBlock[]>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [videos, setVideos] = useState<VideoAttachment[]>([]);
  const [workbooks, setWorkbooks] = useState<WorkbookAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [submittingAttachments, setSubmittingAttachments] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(!draftKey);

  const editorRef = useRef<MentionPromptEditorHandle>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const skillMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCounter = useRef(0);
  const imagesRef = useRef<ImageAttachment[]>([]);
  const workbooksRef = useRef<WorkbookAttachment[]>([]);
  const activeSessionIdRef = useRef(sessionId);
  const voiceRecognitionRef = useRef<{ stop: () => void } | null>(null);
  const [selectionPreview, setSelectionPreview] = useState<SheetSelectionPreview | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capability launch intent is an external prop.
    setComposerMode(modeForCapabilityPreset(capabilityPresetId));
  }, [capabilityPresetId]);

  const isControlled = controlledValue !== undefined;
  const draft = isControlled ? controlledValue : uncontrolled;

  const skillIdsControlled = skillIdsProp !== undefined;
  const selectedIds = skillIdsControlled ? skillIdsProp : internalSkillIds;

  const pinnedControlled = pinnedSkillIdsProp !== undefined;
  const pinnedIds = pinnedControlled ? pinnedSkillIdsProp : internalPinnedIds;

  const setDraft = useCallback(
    (next: string) => {
      if (isControlled) onChange?.(next);
      else setUncontrolled(next);
    },
    [isControlled, onChange],
  );

  useEffect(() => {
    activeSessionIdRef.current = sessionId;
  }, [sessionId]);

  const setComposerImages = useCallback(
    (
      next:
        | ImageAttachment[]
        | ((prev: ImageAttachment[]) => ImageAttachment[]),
    ) => {
      const resolved = typeof next === "function" ? next(imagesRef.current) : next;
      imagesRef.current = resolved;
      setImages(resolved);
    },
    [],
  );

  const setSelectedIds = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      const resolved = typeof next === "function" ? next(selectedIds) : next;
      if (!skillIdsControlled) setInternalSkillIds(resolved);
      onSkillIdsChange?.(resolved);
    },
    [selectedIds, skillIdsControlled, onSkillIdsChange],
  );

  const setPinnedIds = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      const resolved = typeof next === "function" ? next(pinnedIds) : next;
      if (!pinnedControlled) setInternalPinnedIds(resolved);
      onPinnedSkillIdsChange?.(resolved);
    },
    [pinnedIds, pinnedControlled, onPinnedSkillIdsChange],
  );

  // Hydrate draft from localStorage once per draftKey
  useEffect(() => {
    if (!draftKey) {
      setDraftHydrated(true);
      return;
    }
    const saved = loadComposerDraft(draftKey);
    if (saved && !isGenericSkillPrompt(saved)) {
      if (isControlled) {
        // Only fill if parent has empty draft (don't clobber intentional URL prompt)
        if (!controlledValue?.trim()) onChange?.(saved);
      } else {
        setUncontrolled(saved);
      }
    }
    setDraftHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per key
  }, [draftKey]);

  // Debounced draft save (works for controlled + uncontrolled)
  useEffect(() => {
    if (!draftKey || !draftHydrated) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveComposerDraft(draftKey, draft);
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [draft, draftKey, draftHydrated]);

  // Live-follow the cell range selected in the open sheet: shown as a small
  // "pin to reference" preview, not written into the draft until pinned.
  useEffect(() => {
    return subscribeSheetSelection((preview) => {
      if (preview && (!focusedSheet || focusedSheet.kind !== "sheet" || preview.artifactId !== focusedSheet.id)) {
        return;
      }
      setSelectionPreview(preview);
    });
  }, [focusedSheet]);

  // The open sheet changed (or closed) — any stale preview no longer applies.
  useEffect(() => {
    setSelectionPreview(null);
  }, [focusedSheet?.id]);

  const pinSelectionPreview = useCallback(() => {
    const preview = selectionPreview;
    const editor = editorRef.current;
    if (!preview || !editor) return;
    editor.insertMention(
      {
        name: preview.range,
        // The chip only ever displays the plain range, but the workbook can
        // have multiple sheets — the model needs the sheet name to know
        // which one "B3:B14" actually refers to, so it rides along in the
        // token that's actually sent, invisible in the chip itself.
        sendName: `${preview.sheetName}!${preview.range}`,
        title: preview.sheetName,
        kind: "sheet",
        artifactId: preview.artifactId,
      },
      null,
    );
    setSelectionPreview(null);
  }, [selectionPreview]);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    // The public plaza intentionally merges curated showcase models. Studio
    // must use the authenticated live catalog so a displayed model is also a
    // model the current New API account can actually route.
    fetch("/api/capabilities", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("capabilities");
        return response.json() as Promise<{ models?: unknown }>;
      })
      .then((data) => {
        if (cancelled) return;
        const names = Array.isArray(data.models)
          ? data.models.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          : [];
        const listedModels: PlazaModel[] = names
          .map((name) => {
            const vendor = inferVendorFromModel(name);
            return {
              model_name: name.trim(),
              vendor_id: vendor.id,
              vendor_key: vendor.key,
              vendor_name: vendor.name,
              vendor_logo: vendor.logo,
              quota_type: 0,
              model_price: 0,
              model_ratio: 1,
              completion_ratio: 1,
              supported_endpoint_types: ["openai"],
            } satisfies PlazaModel;
          });
        const listedNames = [
          ...new Set(
            listedModels
              .map((m) => m.model_name)
              .filter((n): n is string => Boolean(n?.trim())),
          ),
        ];
        if (listedNames.length) {
          setModelCatalog(listedModels);
          // Do not keep stale models from a previous session in the live
          // picker. Select the first routable model when the saved model has
          // disappeared from the current New API account.
          setModelOptions(listedNames);
          reconcileLoadedModels(listedNames);
          setCustomMode(false);
        } else {
          // A successful empty response means the current account has no
          // routable models. Do not silently retain stale showcase/fallback
          // entries that would fail only after the user sends a message.
          setModelCatalog([]);
          setModelOptions([]);
          reconcileLoadedModels([]);
        }
      })
      .catch(() => {
        // Keep the small local fallback only when the live catalog is down.
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per Composer mount
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSkillsLoading(true);
    fetch("/api/skills", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("skills");
        return res.json() as Promise<{
          skills: SkillMeta[];
          departments?: SkillDepartment[];
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        setAllSkills(data.skills ?? []);
        setDepartments(data.departments ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setAllSkills([]);
          setDepartments([]);
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/capabilities", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("capabilities");
        return response.json() as Promise<{
          capabilities?: Array<{ id?: string; availability?: string }>;
        }>;
      })
      .then((catalog) => {
        if (cancelled) return;
        const next: Partial<Record<ComposerMode, "available" | "degraded" | "needs_setup" | "unavailable">> = {};
        for (const capability of catalog.capabilities ?? []) {
          const mode =
            capability.id === "image.generate"
              ? "image"
              : capability.id === "video.generate"
                ? "video"
                : capability.id === "canvas.generate"
                  ? "canvas"
                  : capability.id === "sheet.generate"
                    ? "sheet"
                    : null;
          if (
            mode &&
            (capability.availability === "available" ||
              capability.availability === "degraded" ||
              capability.availability === "needs_setup" ||
              capability.availability === "unavailable")
          ) {
            next[mode] = capability.availability;
          }
        }
        setCapabilityAvailability(next);
      })
      .catch(() => {
        // Keep the controls usable when the capability probe is unavailable;
        // the server remains authoritative when the turn is submitted.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const modelVendorGroups = useMemo((): ModelVendorGroup[] => {
    const catalogByName = new Map(modelCatalog.map((item) => [item.model_name, item]));
    const groups = new Map<string, ModelVendorGroup>();
    for (const name of modelOptions) {
      const catalogModel = catalogByName.get(name);
      const inferred = inferVendorFromModel(name);
      const key = catalogModel?.vendor_key || inferred.key;
      const vendorName = catalogModel?.vendor_name?.trim() || inferred.name;
      const existing = groups.get(key);
      if (existing) {
        existing.models.push(name);
      } else {
        groups.set(key, { key, name: vendorName, models: [name] });
      }
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [modelCatalog, modelOptions]);

  const activeModelVendor = useMemo(
    () => modelVendorGroups.find((group) => group.models.includes(model))
      ?? modelVendorGroups[0]
      ?? null,
    [model, modelVendorGroups],
  );

  const browsingVendor = useMemo(
    () => modelVendorGroups.find((group) => group.key === modelPickerVendor) ?? null,
    [modelPickerVendor, modelVendorGroups],
  );

  const modelsVendor = useMemo(
    () =>
      browsingVendor
      ?? modelVendorGroups.find((group) => group.key === lastModelPickerVendor)
      ?? activeModelVendor,
    [activeModelVendor, browsingVendor, lastModelPickerVendor, modelVendorGroups],
  );

  const openModelPicker = useCallback(() => {
    setModelPickerVendor(null);
    setModelPickerOpen(true);
  }, []);

  const openModelPickerFromFooter = useCallback(() => {
    setSettingsOpen(true);
    openModelPicker();
  }, [openModelPicker]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const root = modelPickerRef.current;
    const picker = root?.querySelector<HTMLElement>(".composer-model-picker");
    const popover = root?.closest<HTMLElement>(".composer-settings-popover");
    const fitPicker = () => {
      if (!picker || !popover) return;
      const pop = popover.getBoundingClientRect();
      const pad = 12;
      const available = Math.max(160, window.innerHeight - pop.top - pad);
      picker.style.maxHeight = `${available}px`;
    };
    fitPicker();
    root
      ?.querySelector<HTMLElement>('button[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
    const onPointerDown = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) {
        setModelPickerOpen(false);
        setModelPickerVendor(null);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modelPickerVendor) {
        setModelPickerVendor(null);
        return;
      }
      setModelPickerOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", fitPicker);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", fitPicker);
    };
  }, [modelPickerOpen, modelPickerVendor]);

  const skillsById = useMemo(() => {
    const map = new Map<string, SkillMeta>();
    for (const s of allSkills) map.set(s.id, s);
    return map;
  }, [allSkills]);

  const menuItems = useMemo(
    () => getSlashMenuItems(allSkills, departments, menuQuery, menuView),
    [allSkills, departments, menuQuery, menuView],
  );

  useEffect(() => {
    setMenuIndex(0);
  }, [menuQuery, menuOpen, menuView]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, mentionOpen]);

  useEffect(() => {
    if (menuItems.length === 0) return;
    if (menuIndex >= menuItems.length) setMenuIndex(0);
  }, [menuItems.length, menuIndex]);

  useEffect(() => {
    if (menuQuery.trim() && menuView.kind !== "root") {
      setMenuView({ kind: "root" });
    }
  }, [menuQuery, menuView.kind]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (editorRef.current?.containsNode(t)) return;
      setMenuOpen(false);
      setSlashRange(null);
      setMenuView({ kind: "root" });
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!mentionOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (mentionMenuRef.current?.contains(t)) return;
      if (editorRef.current?.containsNode(t)) return;
      setMentionOpen(false);
      setMentionRange(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [mentionOpen]);

  const queueFull = queue.length >= MAX_MESSAGE_QUEUE_SIZE;
  const canSend =
    hasComposerPayload({
      draft,
      pasted: pastedBlocks,
      images,
      files,
      videos,
      workbooks,
    }) &&
    !disabled &&
    !submittingAttachments &&
    videos.every((video) => video.authorized) &&
    !(streaming && queueFull);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, []);

  const toggleSkill = useCallback(
    (id: string) => {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
      if (isGenericSkillPrompt(draft)) setDraft("");
    },
    [draft, setDraft, setSelectedIds],
  );

  const removeSkill = useCallback(
    (id: string) => {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
    },
    [setSelectedIds],
  );

  const clearTurnSkills = useCallback(() => {
    setSelectedIds([]);
  }, [setSelectedIds]);

  const togglePin = useCallback(
    (id: string) => {
      setPinnedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    },
    [setPinnedIds],
  );

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuQuery("");
    setSlashRange(null);
    setMenuView({ kind: "root" });
  }, []);

  const pickSkillFromMenu = useCallback(
    (skill: SkillMeta) => {
      setSettingsOpen(false);
      if (!slashRange) {
        toggleSkill(skill.id);
        return;
      }
      setSelectedIds((prev) =>
        prev.includes(skill.id) ? prev : [...prev, skill.id],
      );
      const editor = editorRef.current;
      if (editor) {
        const { text, cursor } = editor.replaceRange(slashRange, "");
        // Collapse accidental double spaces from removing /query
        const cleaned = text.replace(/\s{2,}/g, " ");
        const next = isGenericSkillPrompt(cleaned) ? "" : cleaned;
        setDraft(next);
        requestAnimationFrame(() => {
          editor.setCaretOffset(Math.min(cursor, next.length));
        });
      }
      closeMenu();
    },
    [closeMenu, setDraft, setSelectedIds, slashRange, toggleSkill],
  );

  const pickToolFromMenu = useCallback(
    (tool: StudioTool) => {
      setSettingsOpen(false);
      setTurnTool(tool);
      setTurnToolParams(initialStudioToolParams(tool));
      const editor = editorRef.current;
      if (slashRange && editor) {
        const { text, cursor } = editor.replaceRange(slashRange, "");
        const cleaned = text.replace(/\s{2,}/g, " ").trimStart();
        const next = cleaned || tool.composerPrompt;
        setDraft(next);
        requestAnimationFrame(() => editor.setCaretOffset(Math.min(cursor, next.length)));
      } else if (!draft.trim()) {
        setDraft(tool.composerPrompt);
      }
      closeMenu();
    },
    [closeMenu, draft, setDraft, slashRange],
  );

  const openSkillMenu = useCallback(
    (query = "", range: { start: number; end: number } | null = null) => {
      setSettingsOpen(false);
      setMenuQuery(query);
      setSlashRange(range);
      setMenuView({ kind: "root" });
      setMenuOpen(true);
    },
    [],
  );

  const detectSlash = useCallback(
    (text: string, cursor: number) => {
      const upto = text.slice(0, cursor);
      const match = upto.match(/(?:^|[\s\n])\/([^\s/]*)$/);
      if (!match) {
        setMenuOpen(false);
        setSlashRange(null);
        setMenuQuery("");
        setMenuView({ kind: "root" });
        return;
      }
      setSettingsOpen(false);
      const token = match[0];
      const slashLocal = token.lastIndexOf("/");
      const start = cursor - token.length + slashLocal;
      const query = match[1] ?? "";
      openSkillMenu(query, { start, end: cursor });
    },
    [openSkillMenu],
  );

  const detectMention = useCallback((text: string, cursor: number) => {
    setSettingsOpen(false);
    const hit = detectAtMention(text, cursor);
    if (!hit) {
      setMentionOpen(false);
      setMentionRange(null);
      setMentionQuery("");
      return;
    }
    setMentionQuery(hit.query);
    setMentionRange({ start: hit.start, end: hit.end });
    setMentionOpen(true);
  }, []);

  const mentionCandidates = useMemo(
    () => buildMentionCandidates(images, imageArtifacts),
    [images, imageArtifacts],
  );

  const resolveMentionMeta = useCallback(
    (name: string) => {
      const hit = mentionCandidates.find((c) => c.name === name);
      if (hit) {
        return {
          name: hit.name,
          thumbSrc: hit.thumbSrc,
          kind: hit.kind,
          artifactId: hit.artifactId,
          localId: hit.localId,
        };
      }
      // A pinned cell range serializes as "SheetName!A1:B2" — rebuild the
      // range-only chip pinSelectionPreview originally inserted.
      const rangeToken = splitSheetRangeToken(name);
      if (rangeToken) {
        const sheet = mentionCandidates.find(
          (c) => c.kind === "sheet" && c.name === rangeToken.sheetName,
        );
        if (sheet) {
          return {
            name: rangeToken.range,
            kind: "sheet" as const,
            artifactId: sheet.artifactId,
            title: rangeToken.sheetName,
          };
        }
      }
      return null;
    },
    [mentionCandidates],
  );

  const pickMentionCandidate = useCallback(
    (candidate: MentionCandidate) => {
      const editor = editorRef.current;
      if (editor) {
        editor.insertMention(
          {
            name: candidate.name,
            thumbSrc: candidate.thumbSrc,
            kind: candidate.kind,
            artifactId: candidate.artifactId,
            localId: candidate.localId,
          },
          mentionRange,
        );
      }
      setMentionOpen(false);
      setMentionRange(null);
      setMentionQuery("");
    },
    [mentionRange],
  );

  const onEditorCaretActivity = useCallback(
    (text: string, caret: number) => {
      detectSlash(text, caret);
      if (!menuOpen) detectMention(text, caret);
      else {
        setMentionOpen(false);
        setMentionRange(null);
      }
    },
    [detectSlash, detectMention, menuOpen],
  );

  const uploadOneImage = useCallback(
    (image: ImageAttachment) => {
      if (!sessionId) return;
      void uploadImageArtifact({ sessionId, name: image.name, dataUrl: image.dataUrl })
        .then((artifact) => {
          if (artifact.sessionId !== activeSessionIdRef.current) return;
          setComposerImages((prev) => prev.map((item) =>
            item.id === image.id ? { ...item, artifactId: artifact.id, uploadFailed: false } : item,
          ));
          onImageUploaded?.(artifact);
        })
        .catch(() => {
          if (sessionId !== activeSessionIdRef.current) return;
          setComposerImages((prev) => prev.map((item) =>
            item.id === image.id ? { ...item, uploadFailed: true } : item,
          ));
          setAttachError("图片上传失败，仍会随消息发送；发送前会再试一次以便 @ 引用");
        });
    },
    [onImageUploaded, sessionId, setComposerImages],
  );

  const uploadOneWorkbook = useCallback(
    (book: WorkbookAttachment) => {
      if (!sessionId) return;
      void uploadSheetArtifact({ sessionId, file: book.file })
        .then((artifact) => {
          if (artifact.sessionId !== activeSessionIdRef.current) return;
          setWorkbooks((prev) =>
            prev.map((item) =>
              item.id === book.id
                ? { ...item, artifactId: artifact.id, uploadFailed: false }
                : item,
            ),
          );
          onSheetUploaded?.(artifact);
        })
        .catch((error: unknown) => {
          if (sessionId !== activeSessionIdRef.current) return;
          setWorkbooks((prev) =>
            prev.map((item) =>
              item.id === book.id ? { ...item, uploadFailed: true } : item,
            ),
          );
          setAttachError(
            error instanceof Error ? error.message : "表格导入失败，发送前会再试一次",
          );
        });
    },
    [onSheetUploaded, sessionId],
  );

  const retryImageUpload = useCallback((imageId: string) => {
    const image = imagesRef.current.find((item) => item.id === imageId);
    if (!image) return;
    setComposerImages((prev) => prev.map((item) =>
      item.id === imageId ? { ...item, uploadFailed: false } : item,
    ));
    uploadOneImage(image);
  }, [setComposerImages, uploadOneImage]);

  const retryWorkbookUpload = useCallback((bookId: string) => {
    const book = workbooksRef.current.find((item) => item.id === bookId);
    if (!book) return;
    setWorkbooks((prev) =>
      prev.map((item) => (item.id === bookId ? { ...item, uploadFailed: false } : item)),
    );
    uploadOneWorkbook(book);
  }, [uploadOneWorkbook]);

  const addImages = useCallback(
    async (list: File[]) => {
      setAttachError(null);
      const candidates: ImageAttachment[] = [];
      for (const file of list) {
        try {
          candidates.push(await fileToImageAttachment(file));
        } catch (err) {
          setAttachError(err instanceof Error ? err.message : "添加图片失败");
        }
      }
      if (!candidates.length) return;

      const available = Math.max(0, MAX_IMAGES - imagesRef.current.length);
      const sliced = candidates.slice(0, available);
      if (sliced.length < candidates.length) {
        setAttachError(`最多 ${MAX_IMAGES} 张图片`);
      }
      if (!sliced.length) return;

      // Local 图片N names immediately — @ works before any session/upload.
      const accepted = nameLocalImageBatch(imagesRef.current, sliced);
      setComposerImages((prev) => [...prev, ...accepted]);

      if (!sessionId) return;

      accepted.forEach(uploadOneImage);
    },
    [sessionId, setComposerImages, uploadOneImage],
  );

  const addFiles = useCallback(async (list: File[]) => {
    setAttachError(null);
    for (const file of list) {
      try {
        if (isImageFile(file)) {
          await addImages([file]);
          continue;
        }
        if (isVideoFile(file)) {
          const video = fileToVideoAttachment(file);
          setVideos((prev) => {
            if (prev.length >= MAX_VIDEOS) {
              setAttachError(`一次最多添加 ${MAX_VIDEOS} 个参考视频`);
              return prev;
            }
            return [...prev, video];
          });
          continue;
        }
        if (isLegacyXlsFile(file)) {
          setAttachError("暂不支持旧版 .xls，请另存为 .xlsx 后再导入");
          continue;
        }
        if (isSpreadsheetFile(file)) {
          if (file.size > MAX_SHEET_UPLOAD_BYTES) {
            setAttachError(
              `表格过大（上限 ${Math.floor(MAX_SHEET_UPLOAD_BYTES / 1024 / 1024)} MB）`,
            );
            continue;
          }
          if (workbooksRef.current.length >= MAX_WORKBOOKS) {
            setAttachError(`一次最多导入 ${MAX_WORKBOOKS} 个工作簿`);
            continue;
          }
          const next: WorkbookAttachment = {
            id: crypto.randomUUID(),
            name: workbookTitleFromFileName(file.name),
            file,
            size: file.size,
          };
          workbooksRef.current = [...workbooksRef.current, next];
          setWorkbooks(workbooksRef.current);
          if (sessionId) uploadOneWorkbook(next);
          continue;
        }
        const result = await fileToAttachment(file);
        if (result.pasted) {
          setPastedBlocks((prev) => {
            if (prev.length >= MAX_PASTED_BLOCKS) {
              setAttachError(`最多 ${MAX_PASTED_BLOCKS} 个粘贴块`);
              return prev;
            }
            return [...prev, result.pasted!];
          });
        } else if (result.file) {
          setFiles((prev) => {
            if (prev.length >= MAX_FILES) {
              setAttachError(`最多 ${MAX_FILES} 个附件`);
              return prev;
            }
            return [...prev, result.file!];
          });
        }
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : "添加文件失败");
      }
    }
  }, [addImages, sessionId, uploadOneWorkbook]);

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const intent = resolveComposerPasteIntent(e.clipboardData);
      if (intent.kind === "empty" || intent.kind === "short-text") {
        // let browser handle short text
        return;
      }

      if (intent.kind === "long-text") {
        e.preventDefault();
        setPastedBlocks((prev) => {
          if (prev.length >= MAX_PASTED_BLOCKS) {
            setAttachError(`最多 ${MAX_PASTED_BLOCKS} 个粘贴块`);
            return prev;
          }
          setAttachError(null);
          return [...prev, createPastedBlock(intent.text)];
        });
        return;
      }

      if (intent.kind === "images") {
        e.preventDefault();
        void addImages(intent.files);
        return;
      }

      if (intent.kind === "files") {
        e.preventDefault();
        void addFiles(intent.files);
        return;
      }

      if (intent.kind === "mixed") {
        e.preventDefault();
        if (intent.text) {
          if (shouldCollapsePaste(intent.text)) {
            setPastedBlocks((prev) =>
              prev.length >= MAX_PASTED_BLOCKS
                ? prev
                : [...prev, createPastedBlock(intent.text!)],
            );
          } else {
            // insert short text at caret (serialized)
            const editor = editorRef.current;
            if (editor && intent.text) {
              const caret = editor.getCaretOffset();
              editor.replaceRange({ start: caret, end: caret }, intent.text);
            } else if (intent.text) {
              setDraft(draft + intent.text);
            }
          }
        }
        if (intent.images.length) void addImages(intent.images);
        if (intent.files.length) void addFiles(intent.files);
      }
    },
    [addFiles, addImages, draft, setDraft],
  );

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) setDragOver(true);
  };

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    if (disabled || submittingAttachments) return;
    const list = Array.from(e.dataTransfer?.files ?? []);
    if (list.length) void addFiles(list);
  };

  const clearAttachments = useCallback(() => {
    setPastedBlocks([]);
    setComposerImages([]);
    setFiles([]);
    setVideos([]);
    workbooksRef.current = [];
    setWorkbooks([]);
    setAttachError(null);
  }, [setComposerImages]);

  const submit = useCallback(() => {
    if (disabled || submittingAttachments) return;
    if (streaming && queueFull) return;

    // An unpinned live selection rides along automatically at send time —
    // pinning is only needed to keep a selection around past the next one.
    const effectiveDraft = selectionPreview
      ? draft
        ? `@${selectionPreview.sheetName}!${selectionPreview.range} ${draft}`
        : `@${selectionPreview.sheetName}!${selectionPreview.range}`
      : draft;

    if (
      !hasComposerPayload({
        draft: effectiveDraft,
        pasted: pastedBlocks,
        images,
        files,
        videos,
        workbooks,
      })
    ) {
      return;
    }
    if (videos.some((video) => !video.authorized)) {
      setAttachError("请先确认你拥有该参考视频的使用授权");
      return;
    }
    const validatedToolParams = turnTool
      ? validateStudioToolParams(turnTool, turnToolParams)
      : { params: undefined };
    if (turnTool && !validatedToolParams.params) {
      setAttachError(validatedToolParams.error ?? "请补充工具参数");
      return;
    }
    const toolParams = validatedToolParams.params ?? {};
    onClearError?.();

    const toolDraft = turnTool && !effectiveDraft.includes(turnTool.composerPrompt)
      ? `${turnTool.composerPrompt}\n${effectiveDraft}`.trim()
      : effectiveDraft;
    const outbound = composeOutboundMessage({
      draft:
        turnTool?.id === "watermark-subtitle-removal" &&
        validatedToolParams.params?.rightsConfirmed === true
          ? `${toolDraft}\n我确认拥有处理此图片及移除相关内容的必要权利。`
          : toolDraft,
      pasted: pastedBlocks,
      images,
      files,
      videos,
      workbooks,
    });
    if (!outbound) return;

    const preparation = onPrepareSend?.(outbound) ?? null;

    void (async () => {
      setSubmittingAttachments(true);
      try {
        // The thread must visibly acknowledge the turn before any upload or
        // workbook work monopolizes the main thread.
        await afterNextPaint();
        let workingImages = images;

        // Session page: finish any @-mentioned uploads before resolving ids.
        if (sessionId) {
          const pending = resolvePendingLocalMentions(effectiveDraft, workingImages);
          if (pending.length) {
            preparation?.setStatus("正在上传图片引用…");
            const uploaded: ImageAttachment[] = [...workingImages];
            for (const image of pending) {
              try {
                const artifact = await uploadImageArtifact({
                  sessionId,
                  name: image.name,
                  dataUrl: image.dataUrl,
                });
                const idx = uploaded.findIndex((i) => i.id === image.id);
                if (idx >= 0) {
                  uploaded[idx] = {
                    ...uploaded[idx]!,
                    artifactId: artifact.id,
                    uploadFailed: false,
                  };
                }
                onImageUploaded?.(artifact);
              } catch {
                const idx = uploaded.findIndex((i) => i.id === image.id);
                if (idx >= 0) {
                  uploaded[idx] = { ...uploaded[idx]!, uploadFailed: true };
                }
                setAttachError("部分图片上传失败，@ 引用可能不完整");
              }
            }
            workingImages = uploaded;
            setComposerImages(uploaded);
          }

          // Video work starts outside the chat process. Do this before the chat
          // turn so the Works panel has durable source + pending analysis rows.
          const pendingBooks = workbooks.filter((book) => !book.artifactId);
          if (pendingBooks.length) {
            preparation?.setStatus("正在导入表格附件…");
            const uploaded = [...workbooks];
            for (const book of pendingBooks) {
              try {
                const artifact = await uploadSheetArtifact({
                  sessionId,
                  file: book.file,
                });
                const idx = uploaded.findIndex((item) => item.id === book.id);
                if (idx >= 0) {
                  uploaded[idx] = {
                    ...uploaded[idx]!,
                    artifactId: artifact.id,
                    uploadFailed: false,
                  };
                }
                onSheetUploaded?.(artifact);
              } catch (error) {
                setAttachError(
                  error instanceof Error ? error.message : "表格导入失败",
                );
                preparation?.fail(
                  error instanceof Error ? error.message : "表格导入失败",
                );
                return;
              }
            }
            workbooksRef.current = uploaded;
            setWorkbooks(uploaded);
          }

          for (const video of videos) {
            try {
              preparation?.setStatus("正在准备视频参考…");
              const source = await uploadVideoArtifact({
                sessionId,
                file: video.file,
                authorized: video.authorized,
              });
              onVideoUploaded?.(source);
              const analysis = await startVideoAnalysis({
                sourceArtifactId: source.id,
                goal: "both",
              });
              onVideoAnalysisStarted?.(analysis.artifact);
            } catch (error) {
              setAttachError(
                error instanceof Error
                  ? error.message
                  : "参考视频上传或拆解任务创建失败",
              );
              preparation?.fail(
                error instanceof Error
                  ? error.message
                  : "参考视频上传或拆解任务创建失败",
              );
              return;
            }
          }
        }

        const readyWorkbooks = workbooksRef.current;

        const referencedArtifactIds = [
          ...resolveReferencedArtifactIds(
            effectiveDraft,
            workingImages,
            imageArtifacts,
          ),
          ...readyWorkbooks
            .map((book) => book.artifactId)
            .filter((id): id is string => Boolean(id)),
        ];

        const effectiveMode = turnTool ? "image" : composerMode;
        const meta: ComposerSendMeta | undefined =
          selectedIds.length ||
          referencedArtifactIds.length ||
          effectiveMode !== "chat" ||
          (!sessionId && (workingImages.length || videos.length || readyWorkbooks.length))
            ? {
                ...(effectiveMode !== "chat"
                  ? {
                      composerOptions: {
                        mode: effectiveMode,
                        ...(effectiveMode === "image" ? { size: imageSize, count: imageCount } : {}),
                        ...(turnTool
                          ? { toolId: turnTool.id, toolParams }
                          : {}),
                      },
                      capabilityPresetId: capabilityPresetForMode(effectiveMode) ?? undefined,
                    }
                  : {}),
                ...(selectedIds.length ? { skillIds: [...selectedIds] } : {}),
                ...(referencedArtifactIds.length
                  ? { referencedArtifactIds: [...new Set(referencedArtifactIds)] }
                  : {}),
                ...(!sessionId && workingImages.length
                  ? {
                      pendingImageUploads: workingImages.map((img) => ({
                        localId: img.id,
                        name: img.name,
                        dataUrl: img.dataUrl,
                      })),
                    }
                  : {}),
                ...(!sessionId && videos.length
                  ? {
                      pendingVideoUploads: videos.map((video) => ({
                        localId: video.id,
                        file: video.file,
                        authorized: true as const,
                      })),
                    }
                  : {}),
                ...(!sessionId && readyWorkbooks.length
                  ? {
                      pendingSheetUploads: readyWorkbooks.map((book) => ({
                        localId: book.id,
                        name: book.name,
                        file: book.file,
                      })),
                    }
                  : {}),
              }
            : undefined;

        if (preparation) {
          preparation.setStatus("正在连接 AI…");
          void preparation.commit(outbound, meta);
        } else {
          void onSend(outbound, meta);
        }
        setDraft("");
        editorRef.current?.clear();
        setSelectionPreview(null);
        setSelectedIds([]);
        setTurnTool(null);
        setTurnToolParams({});
        setComposerMode("chat");
        onCapabilityPresetChange?.(null);
        clearAttachments();
        closeMenu();
        setMentionOpen(false);
        setMentionRange(null);
        if (draftKey) clearComposerDraft(draftKey);
        focusComposer();
      } catch (error) {
        const message = error instanceof Error ? error.message : "准备消息时发生错误";
        setAttachError(message);
        preparation?.fail(message);
      } finally {
        setSubmittingAttachments(false);
      }
    })();
  }, [
    disabled,
    submittingAttachments,
    streaming,
    queueFull,
    draft,
    selectionPreview,
    pastedBlocks,
    images,
    files,
    videos,
    workbooks,
    sessionId,
    imageArtifacts,
    onImageUploaded,
    onVideoUploaded,
    onVideoAnalysisStarted,
    onSheetUploaded,
    setComposerImages,
    onClearError,
    onPrepareSend,
    selectedIds,
    composerMode,
    imageSize,
    imageCount,
    onCapabilityPresetChange,
    turnTool,
    turnToolParams,
    onSend,
    setDraft,
    setSelectedIds,
    clearAttachments,
    closeMenu,
    draftKey,
    focusComposer,
  ]);

  const runMenuActivate = useCallback(() => {
    const item = menuItems[menuIndex];
    activateSlashMenuItem(item, {
      onPickSkill: pickSkillFromMenu,
      onPickTool: pickToolFromMenu,
      onViewChange: setMenuView,
      onClearTurnSkills: clearTurnSkills,
      onHighlightIndexChange: setMenuIndex,
    });
  }, [menuItems, menuIndex, pickSkillFromMenu, pickToolFromMenu, clearTurnSkills]);

  const onPromptSubmit = useCallback(() => {
    if (menuOpen && menuItems.length) {
      runMenuActivate();
      return;
    }
    submit();
  }, [menuItems.length, menuOpen, runMenuActivate, submit]);

  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mentionOpen && !event.nativeEvent.isComposing) {
      const items = filterMentionCandidates(mentionCandidates, mentionQuery);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (items.length) setMentionIndex((i) => (i + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (items.length) setMentionIndex((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (items[mentionIndex]) pickMentionCandidate(items[mentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionOpen(false);
        setMentionRange(null);
        return;
      }
    }

    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (menuItems.length) {
          setMenuIndex((i) => (i + 1) % menuItems.length);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (menuItems.length) {
          setMenuIndex((i) => (i - 1 + menuItems.length) % menuItems.length);
        }
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (menuItems.length) runMenuActivate();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (menuView.kind === "department" && !menuQuery.trim()) {
          setMenuView({ kind: "root" });
          setMenuIndex(0);
          return;
        }
        closeMenu();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        if (menuItems.length) runMenuActivate();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const turnCount = selectedIds.length;
  const pinCount = pinnedIds.length;
  const hasAttachments =
    pastedBlocks.length > 0 ||
    images.length > 0 ||
    files.length > 0 ||
    videos.length > 0 ||
    workbooks.length > 0;

  const selectComposerMode = useCallback(
    (next: ComposerMode) => {
      if (next === "video") return;
      const availability = capabilityAvailability[next];
      if (availability === "needs_setup" || availability === "unavailable") return;
      setComposerMode(next);
      onCapabilityPresetChange?.(capabilityPresetForMode(next));
      if (next !== "image") {
        setImageSize("1024x1024");
        setImageCount(1);
      }
    },
    [capabilityAvailability, onCapabilityPresetChange],
  );

  const toggleVoice = useCallback(() => {
    setSettingsOpen(false);
    if (voiceListening) {
      voiceRecognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as BrowserSpeechRecognitionWindow;
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setAttachError("当前浏览器不支持语音输入");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setDraft(draft ? `${draft} ${transcript}` : transcript);
    };
    recognition.onerror = () => {
      setVoiceListening(false);
      setAttachError("语音输入未能识别，请重试");
    };
    recognition.onend = () => {
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
    };
    voiceRecognitionRef.current = recognition;
    setAttachError(null);
    setVoiceListening(true);
    recognition.start();
  }, [draft, setDraft, voiceListening]);

  useEffect(() => {
    return () => voiceRecognitionRef.current?.stop();
  }, []);

  return (
    <div
      className={
        isHero
          ? "relative z-[1] w-full px-0 py-0"
          : "studio-composer-dock"
      }
    >
      {error ? (
        <div
          role="alert"
          className={`mx-auto mb-3 flex items-start justify-between gap-3 rounded-[14px] border border-[rgba(239,71,112,0.25)] bg-[rgba(239,71,112,0.08)] px-3 py-2 text-sm text-[#0F172A] ${
            isHero ? "max-w-none" : "max-w-3xl"
          }`}
        >
          <p className="min-w-0 flex-1 leading-5">{error}</p>
          {onRetryError ? (
            <button
              type="button"
              onClick={onRetryError}
              className="shrink-0 text-xs font-medium text-[#0F172A] underline-offset-2 hover:underline"
            >
              重试
            </button>
          ) : null}
          {onClearError ? (
            <button
              type="button"
              onClick={onClearError}
              className="shrink-0 text-xs text-[#0F172A] underline-offset-2 hover:underline"
            >
              关闭
            </button>
          ) : null}
        </div>
      ) : null}

      {queue.length > 0 ? (
        <div
          className={`mx-auto mb-3 rounded-[16px] border border-white/70 bg-white/50 px-3 py-2 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.14),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl ${
            isHero ? "max-w-none" : "max-w-3xl"
          }`}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#0F172A]">
            <ListOrdered className="h-3.5 w-3.5" />
            排队中 {queue.length}/{MAX_MESSAGE_QUEUE_SIZE}
            {onClearQueue ? (
              <button
                type="button"
                onClick={onClearQueue}
                className="ml-auto text-[11px] font-normal text-[#8A8298] underline-offset-2 hover:text-[#0F172A] hover:underline"
              >
                清空
              </button>
            ) : null}
          </div>
          <ul className="space-y-1">
            {queue.map((item, index) => (
              <li
                key={item.id}
                className="flex items-start gap-2 rounded-[10px] bg-white/60 px-2 py-1.5 text-xs text-[#241E36]"
              >
                <span className="mt-0.5 shrink-0 tabular-nums text-[#8A8298]">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap">
                  {item.content}
                </span>
                {onRemoveFromQueue ? (
                  <button
                    type="button"
                    onClick={() => onRemoveFromQueue(item.id)}
                    className="shrink-0 rounded p-0.5 text-[#8A8298] hover:bg-white hover:text-[#0F172A]"
                    title="移出队列"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <StudioViewTransition
        name={shareTransitionName ?? undefined}
        share="studio-morph"
        default="none"
      >
        <BorderBeam
          active={!disabled}
          borderRadius={24}
          className={`composer-border-beam mx-auto w-full ${
            isHero ? "max-w-none" : "max-w-3xl"
          }`}
          colorVariant="colorful"
          size="md"
          theme="dark"
        >
          <PromptInput
            className={`studio-liquid-glass composer-reference-surface relative flex w-full flex-col gap-2 ${
              isHero ? "max-w-none p-3.5 sm:p-4" : "max-w-3xl p-2.5 sm:p-3"
            }`}
            inputGroupClassName="h-auto flex-col items-stretch !overflow-visible !border-0 !bg-transparent !shadow-none"
            manageAttachments={false}
            resetOnSubmit={false}
            data-variant={isHero ? "hero" : "session"}
            data-drag-over={dragOver ? "true" : "false"}
            onSubmit={onPromptSubmit}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <PromptInputBody>
        <input name="message" type="hidden" value={draft} readOnly />
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-[rgba(15,23,42,0.06)] text-sm font-medium text-[#0F172A] backdrop-blur-[2px]">
            松开以添加文件、图片或参考视频
          </div>
        ) : null}

        <SkillChips
          turnIds={
            catalogContext?.kind === "skill" &&
            selectedIds.length > 0 &&
            !selectedIds.some((id) => skillsById.has(id))
              ? []
              : selectedIds
          }
          pinnedIds={pinnedIds}
          skillsById={skillsById}
          onRemoveTurn={removeSkill}
          onTogglePin={togglePin}
          disabled={disabled}
        />

        {catalogContext &&
        !(
          catalogContext.kind === "skill" &&
          selectedIds.some((id) => skillsById.has(id))
        ) ? (
          <div className="studio-skill-chip-row" aria-label="已挂载目录上下文">
            <span className="studio-skill-chip" title={`来自应用工具目录：${catalogContext.name}`}>
              {catalogContext.kind === "skill" && catalogContext.iconUrl ? (
                <SkillChipMark name={catalogContext.name} iconUrl={catalogContext.iconUrl} />
              ) : (
                <span className="studio-skill-chip-mark">
                  {catalogContext.kind === "skill" ? (
                    <Sparkles className="h-3 w-3" aria-hidden />
                  ) : (
                    <Zap className="h-3 w-3" aria-hidden />
                  )}
                </span>
              )}
              <span className="studio-skill-chip-name">
                {catalogContext.kind === "skill" ? "Skill" : "工具"} · {catalogContext.name}
              </span>
            </span>
          </div>
        ) : null}

        {(images.length > 0 || videos.length > 0 || workbooks.length > 0 || files.length > 0 || focusedSheet?.kind === "sheet") ? (
          <div className="composer-context-strip flex min-w-0 items-center gap-1.5 overflow-x-auto px-2 pt-1">
            {focusedSheet?.kind === "sheet" ? (
              <span className="composer-context-tab composer-context-tab-active">
                <Table2 className="h-3.5 w-3.5 shrink-0 text-[#7CD3FC]" />
                <span className="max-w-[10rem] truncate">{focusedSheet.name}</span>
              </span>
            ) : null}
            {images.map((image) => (
              <span key={image.id} className="composer-context-tab">
                <button
                  type="button"
                  onClick={() => {
                    if (image.uploadFailed) {
                      retryImageUpload(image.id);
                      return;
                    }
                    editorRef.current?.insertMention(
                      {
                        name: image.name,
                        thumbSrc: image.dataUrl,
                        artifactId: image.artifactId,
                        localId: image.id,
                      },
                      null,
                    );
                  }}
                  className="flex min-w-0 items-center gap-2 text-left"
                  title={image.uploadFailed ? "上传失败，点击重试" : `引用 @${image.name}`}
                >
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#FBBF24]" />
                  <span className="max-w-[9rem] truncate">{image.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setComposerImages((previous) => previous.filter((item) => item.id !== image.id))}
                  className="composer-context-tab-remove"
                  title={`移除 ${image.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {workbooks.map((book) => (
              <span key={book.id} className="composer-context-tab">
                <Table2 className="h-3.5 w-3.5 shrink-0 text-[#4ADE80]" />
                <span className="max-w-[10rem] truncate">{book.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    workbooksRef.current = workbooksRef.current.filter((item) => item.id !== book.id);
                    setWorkbooks(workbooksRef.current);
                  }}
                  className="composer-context-tab-remove"
                  title={`移除 ${book.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {videos.map((video) => (
              <span key={video.id} className="composer-context-tab composer-context-tab-video">
                <Clapperboard className="h-3.5 w-3.5 shrink-0 text-[#C4B5FD]" />
                <span className="max-w-[9rem] truncate">{video.name}</span>
                <label className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[#615A73]" title="确认视频使用授权">
                  <Checkbox
                    checked={video.authorized}
                    disabled={disabled || submittingAttachments}
                    onCheckedChange={(checked) => setVideos((previous) => previous.map((item) => item.id === video.id ? { ...item, authorized: checked === true } : item))}
                    className="size-3.5 rounded-[4px] border-[rgba(36,30,54,0.18)] bg-white/70 data-[state=checked]:border-[#536DA8] data-[state=checked]:bg-[#536DA8]"
                  />
                  授权
                </label>
                <button
                  type="button"
                  onClick={() => setVideos((previous) => previous.filter((item) => item.id !== video.id))}
                  className="composer-context-tab-remove"
                  title={`移除 ${video.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {files.map((file) => (
              <span key={file.id} className="composer-context-tab">
                <FileText className="h-3.5 w-3.5 shrink-0 text-[#CBD5E1]" />
                <span className="max-w-[9rem] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((previous) => previous.filter((item) => item.id !== file.id))}
                  className="composer-context-tab-remove"
                  title={`移除 ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="hidden">
          {focusedSheet?.kind === "sheet" ? (
            <span
              className="studio-liquid-chip inline-flex max-w-[12rem] items-center gap-1 rounded-[10px] px-2 py-1 text-[11px] text-[#241E36]"
              title={`这一轮会改「${focusedSheet.name}」`}
            >
              <Table2 className="h-3 w-3 shrink-0 text-primary-600" />
              <span className="min-w-0 truncate">正在改「{focusedSheet.name}」</span>
            </span>
          ) : null}
          <div
            className="flex min-w-0 max-w-full items-center overflow-x-auto rounded-[10px] border border-white/70 bg-white/35 p-0.5"
            role="tablist"
            aria-label="Composer 模式"
          >
            {COMPOSER_MODE_ITEMS.map((item) => {
              const unavailable =
                item.id === "video" ||
                capabilityAvailability[item.id] === "needs_setup" ||
                capabilityAvailability[item.id] === "unavailable";
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={composerMode === item.id}
                  aria-label={item.title}
                  title={unavailable ? `${item.title} · 暂不可用` : item.title}
                  disabled={disabled || unavailable}
                  onClick={() => selectComposerMode(item.id)}
                  className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[11px] font-medium transition ${
                    composerMode === item.id
                      ? "bg-[rgba(15,23,42,0.10)] text-[#0F172A] shadow-sm"
                      : "text-[#615A73] hover:bg-white/60"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <ComposerModeIcon mode={item.id} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          {composerMode === "image" ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <label className="sr-only" htmlFor={`${modelId}-image-size`}>
                图片尺寸
              </label>
              <select
                id={`${modelId}-image-size`}
                value={imageSize}
                disabled={disabled}
                onChange={(event) => setImageSize(event.target.value as ImageSize)}
                className="studio-liquid-chip max-w-[10rem] appearance-none rounded-[10px] px-2 py-1 text-[11px] text-[#241E36] disabled:opacity-50"
                title="图片比例与尺寸"
              >
                {IMAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`${modelId}-image-count`}>
                图片数量
              </label>
              <select
                id={`${modelId}-image-count`}
                value={imageCount}
                disabled={disabled}
                onChange={(event) =>
                  setImageCount(Number(event.target.value) as 1 | 2 | 3 | 4)
                }
                className="studio-liquid-chip rounded-[10px] px-2 py-1 text-[11px] text-[#241E36] disabled:opacity-50"
                title="生成数量"
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count} 张
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <label htmlFor={modelId} className="sr-only">
            模型
          </label>
          {customMode && allowCustomModel ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              <input
                id={modelId}
                type="text"
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder="输入模型名称"
                disabled={disabled}
                className="studio-liquid-chip min-w-0 flex-1 rounded-[10px] px-2.5 py-1 font-mono text-xs text-[#241E36] sm:w-48"
              />
              <button
                type="button"
                onClick={() => {
                  setCustomMode(false);
                  if (!modelOptions.includes(model) && modelOptions[0]) {
                    onModelChange(modelOptions[0]);
                  }
                }}
                className="text-xs text-[#8A8298] hover:text-[#241E36]"
              >
                列表
              </button>
            </div>
          ) : (
            <div className="relative">
              <select
                id={modelId}
                value={modelOptions.includes(model) ? model : modelOptions[0] ?? model}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomMode(true);
                    return;
                  }
                  onModelChange(e.target.value);
                }}
                disabled={disabled || modelsLoading}
                className="studio-liquid-chip appearance-none rounded-[10px] py-1 pl-2.5 pr-7 font-mono text-xs text-[#241E36] disabled:opacity-60"
              >
                {modelOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {allowCustomModel ? (
                  <option value="__custom__">自定义…</option>
                ) : null}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A8298]" />
            </div>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || submittingAttachments}
            title="添加附件、图片、Excel 或参考视频"
            className="studio-liquid-chip inline-flex items-center gap-1 rounded-[10px] px-2 py-1 text-xs text-[#615A73] disabled:opacity-50"
          >
            <Paperclip className="h-3.5 w-3.5" />
            附件
          </button>
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            multiple
            className="hidden"
            accept={`image/*,${REFERENCE_VIDEO_ACCEPT},.xlsx,.xlsm,.txt,.md,.json,.csv,.log,.html,.css,.js,.ts,.tsx,.py,.yml,.yaml`}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (list.length) void addFiles(list);
            }}
          />

          <span className="text-[11px] text-[#8A8298]">
            {submittingAttachments
              ? "正在上传附件并创建拆解任务…"
              : streaming
                ? queueFull
                  ? `队列已满（${MAX_MESSAGE_QUEUE_SIZE}）· 可停止当前生成`
                  : "生成中 · Enter 加入队列 · 可粘贴/拖入附件"
                : videos.length > 0
                  ? "确认授权后发送 · 将在作品区生成可编辑拆解"
                  : images.length > 0
                    ? "输入 @ 引用图片（如 @图片1）· Enter 发送"
                    : "Enter 发送 · 粘贴长文自动折叠 · 可拖入文件"}
          </span>
        </div>

        {turnTool ? (
          <div className="flex flex-wrap items-center gap-1.5 px-2">
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[#8A8298]">
              本轮工具
            </span>
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[rgba(15, 23, 42,0.2)] bg-[rgba(15, 23, 42,0.08)] py-0.5 pl-2.5 pr-1 text-xs text-[#0F172A]">
              <Scissors className="h-3 w-3 shrink-0" />
              <span className="truncate">{turnTool.name}</span>
              <Link
                href={studioToolHref(turnTool.id)}
                className="rounded-full px-1.5 text-[10px] text-[#4F46E5] hover:bg-white/70"
              >
                表单
              </Link>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setTurnTool(null);
                  setTurnToolParams({});
                }}
                className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/70 disabled:opacity-50"
                title="取消工具"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
            {turnTool.parameters.map((field) =>
              field.type === "select" ? (
                <label key={field.id} className="inline-flex items-center gap-1.5 text-xs text-[#615A73]">
                  <span className="sr-only">{field.label}</span>
                  <select
                    value={String(turnToolParams[field.id] ?? field.defaultValue ?? "")}
                    disabled={disabled}
                    onChange={(event) => {
                      setTurnToolParams((previous) => ({
                        ...previous,
                        [field.id]: event.target.value,
                      }));
                      setAttachError(null);
                    }}
                    className="studio-liquid-chip rounded-[10px] px-2 py-1 text-[11px] text-[#241E36]"
                    title={field.description}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {field.label}: {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={field.id} className="inline-flex items-center gap-1.5 text-xs text-[#615A73]">
                  <input
                    type="checkbox"
                    checked={turnToolParams[field.id] === true}
                    disabled={disabled}
                    onChange={(event) => {
                      setTurnToolParams((previous) => ({
                        ...previous,
                        [field.id]: event.target.checked,
                      }));
                      if (event.target.checked) setAttachError(null);
                    }}
                    className="h-3.5 w-3.5 accent-[#0F172A]"
                  />
                  {field.label}
                </label>
              ),
            )}
          </div>
        ) : null}

        {/* Attachment strip: images, reference videos, and binary file chips. */}
        {(images.length > 0 || videos.length > 0 || files.length > 0 || workbooks.length > 0) && (
          <div className="hidden">
            {images.map((img) => (
              <div
                key={img.id}
                className="group relative h-16 w-16 overflow-hidden rounded-[12px] border border-white/80 bg-white/70 shadow-sm"
              >
                <button
                  type="button"
                  className="h-full w-full"
                  title={img.uploadFailed ? "上传失败，点击重试" : `点击插入 @${img.name}`}
                  disabled={disabled}
                  onClick={() => {
                    if (img.uploadFailed) {
                      retryImageUpload(img.id);
                      return;
                    }
                    // Insert at caret as a real chip (ignore any open @query range).
                    editorRef.current?.insertMention(
                      {
                        name: img.name,
                        thumbSrc: img.dataUrl,
                        artifactId: img.artifactId,
                        localId: img.id,
                      },
                      null,
                    );
                    setMentionOpen(false);
                    setMentionRange(null);
                    setMentionQuery("");
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className={`h-full w-full object-cover ${img.uploadFailed ? "opacity-50" : ""}`}
                  />
                  {img.uploadFailed ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-rose-900/30">
                      <RotateCw className="h-4 w-4 text-white" />
                    </span>
                  ) : (
                    <span className="pointer-events-none absolute right-0.5 top-0.5 rounded-full bg-black/55 p-0.5 text-white opacity-0 transition group-hover:opacity-100">
                      <AtSign className="h-3 w-3" />
                    </span>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-0.5 py-0.5 text-center text-[10px] font-medium leading-tight text-white">
                    {img.uploadFailed ? "上传失败" : img.name}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setComposerImages((prev) =>
                      prev.filter((item) => item.id !== img.id),
                    )
                  }
                  className="absolute right-0.5 top-0.5 z-[1] rounded-full bg-black/55 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                  title={`移除 ${img.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {videos.map((video) => (
              <div
                key={video.id}
                className="relative flex min-w-[15rem] max-w-full flex-col gap-1.5 rounded-[8px] border border-white/80 bg-white/65 px-2.5 py-2 text-[11px] text-[#241E36] shadow-sm"
              >
                <div className="flex min-w-0 items-center gap-1.5 pr-5">
                  <Clapperboard className="h-3.5 w-3.5 shrink-0 text-[#0F172A]" />
                  <span className="min-w-0 flex-1 truncate font-medium" title={video.name}>
                    {video.name}
                  </span>
                  <span className="shrink-0 text-[#8A8298]">
                    {formatFileSize(video.size)}
                  </span>
                </div>
                <label className="flex cursor-pointer items-start gap-1.5 leading-4 text-[#615A73]">
                  <input
                    type="checkbox"
                    checked={video.authorized}
                    disabled={disabled || submittingAttachments}
                    onChange={(event) => {
                      const authorized = event.target.checked;
                      setVideos((prev) =>
                        prev.map((item) =>
                          item.id === video.id ? { ...item, authorized } : item,
                        ),
                      );
                      if (authorized) setAttachError(null);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#0F172A]"
                  />
                  <span>我确认拥有该视频的使用授权</span>
                </label>
                <button
                  type="button"
                  disabled={disabled || submittingAttachments}
                  onClick={() =>
                    setVideos((prev) => prev.filter((item) => item.id !== video.id))
                  }
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-[#8A8298] hover:bg-white hover:text-[#0F172A] disabled:opacity-40"
                  title={`移除 ${video.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {workbooks.map((book) => {
              // Attachments picked before a session exists queue for upload at
              // send time (see the sessionId-gated call below) rather than
              // uploading immediately — don't show it as actively in-flight.
              const queued = !book.uploadFailed && !book.artifactId && !sessionId;
              const uploading = !book.uploadFailed && !book.artifactId && !queued;
              return (
                <div
                  key={book.id}
                  className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-[12px] border border-white/70 bg-white/60 px-2 py-1.5 text-[11px] text-[#241E36]"
                >
                  {uploading ? (
                    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-600" />
                  ) : (
                    <Table2 className="h-3.5 w-3.5 shrink-0 text-primary-600" />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left disabled:cursor-default"
                    disabled={disabled || !book.uploadFailed}
                    title={book.uploadFailed ? "导入失败，点击重试" : book.name}
                    onClick={() => {
                      if (book.uploadFailed) retryWorkbookUpload(book.id);
                    }}
                  >
                    {book.uploadFailed
                      ? "导入失败 · "
                      : book.artifactId
                        ? "已导入 · "
                        : queued
                          ? "待发送 · "
                          : "导入中 · "}
                    {book.name}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      workbooksRef.current = workbooksRef.current.filter((item) => item.id !== book.id);
                      setWorkbooks(workbooksRef.current);
                    }}
                    className="rounded p-0.5 text-[#8A8298] hover:text-[#0F172A]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {files.map((f) => (
              <div
                key={f.id}
                className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-[12px] border border-white/70 bg-white/60 px-2 py-1.5 text-[11px] text-[#241E36]"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-[#0F172A]" />
                <span className="min-w-0 flex-1 truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 text-[#8A8298]">
                  {formatFileSize(f.size)}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setFiles((prev) => prev.filter((x) => x.id !== f.id))
                  }
                  className="rounded p-0.5 text-[#8A8298] hover:text-[#0F172A]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pasted long-text cards */}
        {pastedBlocks.length > 0 ? (
          <div className="flex flex-col gap-2 px-1">
            {pastedBlocks.map((block) => (
              <PastedBlockCard
                key={block.id}
                block={block}
                disabled={disabled}
                onRemove={() =>
                  setPastedBlocks((prev) => prev.filter((b) => b.id !== block.id))
                }
              />
            ))}
          </div>
        ) : null}

        {attachError ? (
          <p className="px-2 text-[11px] text-[#0F172A]">{attachError}</p>
        ) : null}

        {hasAttachments ? (
          <div className="hidden">
            <span className="inline-flex items-center gap-1 text-[10px] text-[#8A8298]">
              {videos.length > 0 ? (
                <Clapperboard className="h-3 w-3" />
              ) : (
                <ImageIcon className="h-3 w-3" />
              )}
              {pastedBlocks.length > 0
                ? `${pastedBlocks.length} 粘贴块`
                : null}
              {pastedBlocks.length > 0 && images.length > 0 ? " · " : null}
              {images.length > 0 ? (
                <span className={images.length >= MAX_IMAGES ? "font-semibold text-rose-600" : images.length === MAX_IMAGES - 1 ? "font-medium text-amber-600" : undefined}>
                  {images.length}/{MAX_IMAGES} 图
                </span>
              ) : null}
              {(pastedBlocks.length > 0 || images.length > 0) && videos.length
                ? " · "
                : null}
              {videos.length > 0 ? (
                <span
                  className={
                    videos.some((video) => !video.authorized)
                      ? "font-medium text-amber-600"
                      : undefined
                  }
                >
                  {videos.length}/{MAX_VIDEOS} 视频
                </span>
              ) : null}
              {(pastedBlocks.length > 0 || images.length > 0 || videos.length > 0) &&
              files.length
                ? " · "
                : null}
              {files.length > 0 ? `${files.length} 文件` : null}
            </span>
            <button
              type="button"
              onClick={clearAttachments}
              disabled={disabled}
              className="text-[10px] text-[#8A8298] underline-offset-2 hover:text-[#0F172A] hover:underline"
            >
              清空附件
            </button>
          </div>
        ) : null}

        {selectionPreview ? (
          <div className="flex px-2">
            <span className="inline-flex max-w-[14rem] items-center gap-1 rounded-[10px] border border-primary-200 bg-primary-50 pl-2 pr-1 py-1 text-[11px] font-medium text-primary-700">
              <button
                type="button"
                onClick={pinSelectionPreview}
                disabled={disabled}
                title={`点击固定引用 · ${selectionPreview.sheetName}`}
                className="inline-flex min-w-0 items-center gap-1 hover:text-primary-900"
              >
                <Pin className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">{selectionPreview.range}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectionPreview(null)}
                disabled={disabled}
                title="忽略这个选区"
                className="shrink-0 rounded p-0.5 text-primary-400 hover:bg-primary-100 hover:text-primary-700 disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        ) : null}
        <div className="composer-editor-row">
          <label className="sr-only" htmlFor={promptId}>
            输入你的需求
          </label>
          <MentionPromptEditor
            ref={editorRef}
            id={promptId}
            value={draft}
            onChange={setDraft}
            onCaretActivity={onEditorCaretActivity}
            onPaste={handlePaste}
            onKeyDown={onEditorKeyDown}
            resolveMention={resolveMentionMeta}
            disabled={disabled}
            placeholder={
              streaming
                ? queueFull
                  ? "队列已满，请等待或停止生成…"
                  : "继续输入，将加入发送队列…"
                : videos.length > 0
                  ? "补充拆解目标，例如目标平台、时长或想保留的结构…"
                  : hasAttachments
                    ? "补充说明，或输入 @ 引用图片…"
                    : placeholder
            }
            maxHeight={isHero ? 220 : 160}
            minHeightClass={
              isHero
                ? "min-h-[4.5rem] py-3 text-[15px] leading-7"
                : "min-h-[2.75rem] py-2 text-sm leading-6"
            }
            className="disabled:opacity-60"
            aria-controls={menuOpen || mentionOpen ? menuId : undefined}
            aria-expanded={menuOpen || mentionOpen}
            aria-autocomplete="list"
          />
        </div>
        </PromptInputBody>

        <PromptInputFooter className="composer-footer relative flex w-full items-end gap-2 px-0 py-0">
          <div className="composer-footer-tools flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || submittingAttachments}
              className="composer-icon-button"
              title="添加附件、图片、Excel 或参考视频"
              aria-label="添加附件、图片、Excel 或参考视频"
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>
            <button
              ref={skillMenuAnchorRef}
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                focusComposer();
                openSkillMenu();
              }}
              disabled={disabled || skillsLoading}
              className={`composer-icon-button ${selectedIds.length ? "composer-icon-button-active" : ""}`}
              title="选择 Skill（也可以输入 /）"
              aria-label="选择 Skill"
            >
              <Zap className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="composer-footer-actions relative flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={disabled || modelsLoading}
              onClick={openModelPickerFromFooter}
              className="composer-selected-model"
              title={`当前模型：${model || "选择模型"}`}
              aria-label={`当前模型：${model || "选择模型"}`}
            >
              <span className="composer-selected-model-copy">
                {activeModelVendor ? <VendorMark vendorKey={activeModelVendor.key} /> : null}
                <span className="composer-selected-model-name">{model || "选择模型"}</span>
                {activeModelVendor ? <span className="composer-selected-model-vendor">{activeModelVendor.name}</span> : null}
              </span>
              <ChevronDown className="composer-selected-model-chevron" aria-hidden />
            </button>
            <Popover
              open={settingsOpen}
              onOpenChange={(open) => {
                setSettingsOpen(open);
                if (!open) {
                  setModelPickerOpen(false);
                  setModelPickerVendor(null);
                }
                if (open) {
                  closeMenu();
                  setMentionOpen(false);
                  setMentionRange(null);
                  setMentionQuery("");
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className={`composer-icon-button ${settingsOpen ? "composer-icon-button-active" : ""}`}
                  title="高级设置"
                  aria-label="高级设置"
                >
                  <SlidersHorizontal className="h-[18px] w-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="top"
                sideOffset={8}
                className="composer-settings-popover w-[21rem] max-w-[calc(100vw-2rem)]"
              >
                <div className="composer-settings-heading">
                  <span>高级设置</span>
                </div>
                <label className="composer-settings-field">
                  <span>模型</span>
                  {customMode && allowCustomModel ? (
                    <input
                      type="text"
                      value={model}
                      onChange={(event) => onModelChange(event.target.value)}
                      placeholder="输入模型名称"
                      disabled={disabled}
                    />
                  ) : (
                    <div ref={modelPickerRef} className="composer-model-picker-anchor">
                      <button
                        type="button"
                        disabled={disabled || modelsLoading}
                        onClick={() => {
                          if (modelPickerOpen) setModelPickerOpen(false);
                          else openModelPicker();
                        }}
                        className="composer-model-picker-trigger"
                        aria-label={`当前模型：${model || "选择模型"}`}
                        aria-haspopup="dialog"
                        aria-expanded={modelPickerOpen}
                      >
                        <span>
                          {activeModelVendor ? <VendorMark vendorKey={activeModelVendor.key} /> : null}
                          <span className="truncate">{model || "选择模型"}</span>
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${modelPickerOpen ? "rotate-180" : ""}`} />
                      </button>
                      {modelPickerOpen ? (
                        <div
                          className="composer-model-picker"
                          data-view={browsingVendor ? "models" : "vendors"}
                          role="listbox"
                          aria-label={browsingVendor ? browsingVendor.name : "选择厂商"}
                        >
                          <div className="composer-model-stack">
                            <div
                              className="composer-model-pane"
                              data-pane="vendors"
                              inert={browsingVendor ? true : undefined}
                            >
                              {modelVendorGroups.map((vendor) => (
                                <button
                                  key={vendor.key}
                                  type="button"
                                  role="option"
                                  aria-selected={vendor.key === activeModelVendor?.key}
                                  className="composer-model-vendor"
                                  onClick={() => {
                                    setLastModelPickerVendor(vendor.key);
                                    setModelPickerVendor(vendor.key);
                                  }}
                                >
                                  <VendorMark vendorKey={vendor.key} />
                                  <span className="truncate">{vendor.name}</span>
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
                                </button>
                              ))}
                              {allowCustomModel ? (
                                <button
                                  type="button"
                                  className="composer-model-custom"
                                  onClick={() => {
                                    setCustomMode(true);
                                    setModelPickerOpen(false);
                                    setModelPickerVendor(null);
                                  }}
                                >
                                  <span className="composer-vendor-mark" aria-hidden>
                                    <PenLine className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </span>
                                  <span>自定义模型</span>
                                </button>
                              ) : null}
                            </div>
                            <div
                              className="composer-model-pane"
                              data-pane="models"
                              inert={browsingVendor ? undefined : true}
                            >
                              {modelsVendor ? (
                                <>
                                  <button
                                    type="button"
                                    className="composer-model-back"
                                    onClick={() => setModelPickerVendor(null)}
                                  >
                                    <ChevronLeft className="h-4 w-4 shrink-0 opacity-60" />
                                    <VendorMark vendorKey={modelsVendor.key} />
                                    <span className="truncate">{modelsVendor.name}</span>
                                  </button>
                                  <div className="composer-model-rows">
                                    {modelsVendor.models.map((name) => (
                                      <button
                                        key={name}
                                        type="button"
                                        role="option"
                                        aria-selected={name === model}
                                        onClick={() => {
                                          onModelChange(name);
                                          setModelPickerOpen(false);
                                          setModelPickerVendor(null);
                                        }}
                                      >
                                        <span className="truncate">{name}</span>
                                        {name === model ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> : null}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </label>
                {customMode && allowCustomModel ? (
                  <button type="button" className="composer-settings-reset" onClick={() => setCustomMode(false)}>
                    使用模型列表
                  </button>
                ) : null}
                {composerMode === "image" ? (
                  <div className="composer-settings-grid">
                    <label className="composer-settings-field">
                      <span>比例与尺寸</span>
                      <Select value={imageSize} disabled={disabled} onValueChange={(value) => setImageSize(value as ImageSize)}>
                        <SelectTrigger className="!h-[2.65rem] !w-full min-w-0 rounded-[10px] border-line bg-white/70 text-[#241E36]"><SelectValue /></SelectTrigger>
                        <SelectContent position="popper" align="end" side="bottom" sideOffset={6} avoidCollisions={false} className="composer-mode-menu">
                          {IMAGE_SIZE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span className="inline-flex items-center gap-2">
                                <ImageSizeIcon value={option.value} />
                                <span>{option.label}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="composer-settings-field">
                      <span>生成数量</span>
                      <Select value={String(imageCount)} disabled={disabled} onValueChange={(value) => setImageCount(Number(value) as 1 | 2 | 3 | 4)}>
                        <SelectTrigger className="!h-[2.65rem] !w-full min-w-0 rounded-[10px] border-line bg-white/70 text-[#241E36]"><SelectValue /></SelectTrigger>
                        <SelectContent position="popper" align="end" side="bottom" sideOffset={6} avoidCollisions={false} className="composer-mode-menu">
                          {[1, 2, 3, 4].map((count) => <SelectItem key={count} value={String(count)}>{count} 张</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
            <Select
              value={composerMode}
              disabled={disabled}
              onValueChange={(value) => {
                setSettingsOpen(false);
                selectComposerMode(value as ComposerMode);
              }}
            >
              <SelectTrigger className="composer-mode-trigger">
                <SelectValue placeholder="对话" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="end"
                side="bottom"
                sideOffset={6}
                avoidCollisions={false}
                className="composer-mode-menu"
              >
                {COMPOSER_MODE_ITEMS.map((item) => {
                  const unavailable =
                    item.id === "video" ||
                    capabilityAvailability[item.id] === "needs_setup" ||
                    capabilityAvailability[item.id] === "unavailable";
                  return (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      disabled={unavailable}
                      title={unavailable ? `${item.title} · 暂不可用` : item.title}
                    >
                      <span className="inline-flex items-center gap-2.5">
                        <ComposerModeIcon mode={item.id} className="h-4 w-4" />
                        <span>{item.id === "chat" ? "对话" : item.label}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={toggleVoice}
              disabled={disabled}
              className={`composer-icon-button ${voiceListening ? "composer-icon-button-recording" : ""}`}
              title={voiceListening ? "停止语音输入" : "语音输入"}
              aria-label={voiceListening ? "停止语音输入" : "语音输入"}
            >
              {voiceListening ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
            </button>
            {streaming ? (
              <>
                <PromptInputSubmit
                  status="ready"
                  disabled={!canSend}
                  title={submittingAttachments ? "正在上传附件" : queueFull ? "队列已满" : "加入队列"}
                  className="composer-send-button composer-send-button-queue"
                >
                  {submittingAttachments ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ListOrdered className="h-4 w-4" />}
                  <span className="sr-only">加入队列</span>
                </PromptInputSubmit>
                <PromptInputSubmit status="streaming" onStop={() => onStop?.()} title="停止生成" className="composer-stop-button" />
              </>
            ) : (
              <PromptInputSubmit
                status={submittingAttachments ? "submitted" : "ready"}
                disabled={!canSend}
                title={submittingAttachments ? "正在上传附件" : "发送"}
                className="composer-send-button"
              >
                {submittingAttachments ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                <span className="sr-only">发送</span>
              </PromptInputSubmit>
            )}
          </div>

          <SkillSlashMenu
            open={menuOpen}
            query={menuQuery}
            skills={allSkills}
            departments={departments}
            selectedIds={selectedIds}
            loading={skillsLoading}
            highlightIndex={menuIndex}
            onHighlightIndexChange={setMenuIndex}
            view={menuView}
            onViewChange={setMenuView}
            onPickSkill={pickSkillFromMenu}
            onPickTool={pickToolFromMenu}
            onClearTurnSkills={clearTurnSkills}
            menuId={menuId}
            menuRef={menuRef}
            anchorRef={skillMenuAnchorRef}
          />

          <ArtifactMentionMenu
            open={mentionOpen}
            query={mentionQuery}
            candidates={mentionCandidates}
            highlightIndex={mentionIndex}
            onHighlightIndexChange={setMentionIndex}
            onPick={pickMentionCandidate}
            onRetryUpload={(candidate) => {
              if (candidate.localId) retryImageUpload(candidate.localId);
            }}
            menuRef={mentionMenuRef}
          />
            </PromptInputFooter>
          </PromptInput>
        </BorderBeam>
      </StudioViewTransition>
    </div>
  );
}
