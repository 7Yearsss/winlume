export type Role = "user" | "assistant" | "system" | "tool";

export interface Session {
  id: string;
  userId: string;
  title: string;
  model: string;
  /** Hidden from active lists until explicitly restored; history remains intact. */
  archived?: boolean;
  /** Optional project scope shared by multiple conversations. */
  projectId?: string;
  /** Skills applied to every turn unless overridden; UI may pin/unpin */
  pinnedSkillIds?: string[];
  /** Validated launch intent for a capability-specific Studio experience. */
  capabilityPresetId?: string;
  /** Codex SDK thread persisted for coding-specialist continuity. */
  codexThreadId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A durable workspace shared by a user's conversations and agent context. */
export interface Project {
  id: string;
  /** May be omitted from public API responses; ownership is server-side. */
  userId?: string;
  name: string;
  description?: string;
  instructions?: string;
  pinnedSkillIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

/**
 * AI-SDK-shaped message parts, persisted so a completed turn's reasoning/tool
 * detail survives reload without client-side reconciliation guesswork. Kept
 * as a local union (not an import of `ai`'s `UIMessagePart`) so L2/L3 stay
 * decoupled from the AI SDK dependency — the shape only needs to be
 * compatible with it, not literally sourced from it.
 */
export type UIMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: `tool-${string}`;
      toolCallId: string;
      state: "input-streaming" | "input-available" | "output-available" | "output-error";
      input?: unknown;
      output?: unknown;
      errorText?: string;
    }
  | {
      type: "data-plan";
      id: "plan";
      data: {
        todos: Array<{
          id: string;
          content: string;
          status: "pending" | "in_progress" | "completed" | "cancelled";
        }>;
      };
    }
  | {
      type: "data-artifact";
      id: string;
      data: { artifactId: string; name: string; kind: ArtifactKind };
    };

export interface Message {
  id: string;
  sessionId: string;
  role: Role;
  content: string;
  skillIds?: string[];
  toolCalls?: ToolCallRecord[];
  /** For role "tool": links to the assistant tool_call id */
  toolCallId?: string;
  attachmentIds?: string[];
  /** Reasoning/tool/plan detail, persisted so it survives reload. */
  parts?: UIMessagePart[];
  metadata?: {
    model?: string;
    thinkingDurationSec?: number;
    skillIds?: string[];
  };
  createdAt: string;
}

export type DefaultArtifactKind = "markdown" | "html" | "image-prompt" | "none";

/** Safe v2 contract metadata exposed with a Skill; prompt bodies remain separate. */
export interface SkillContractMeta {
  schemaVersion: 2;
  version: string;
  stability: "experimental" | "stable";
  requiredCapabilities: string[];
  allowedTools: string[];
  approvalPolicy: "none" | "on-blocking-review" | "required";
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  /** Upstream department folder id (marketing, design, …) */
  category: string;
  triggers?: string[];
  examplePrompt?: string;
  preview?: "markdown" | "html" | "none";
  source: "bundled" | "imported" | "user";
  enabled: boolean;
  featured?: boolean;
  defaultArtifact?: DefaultArtifactKind;
  /** Remote logo for catalog cards (SkillHub iconUrl). */
  iconUrl?: string;
  contract?: SkillContractMeta;
}

export interface Skill extends SkillMeta {
  systemPrompt: string;
}

export type ArtifactKind =
  | "markdown"
  | "html"
  | "text"
  | "json"
  | "image"
  | "video"
  | "video-analysis"
  | "binary"
  | "canvas"
  | "sheet";

export interface Artifact {
  id: string;
  userId: string;
  sessionId: string;
  /** Shared project scope; sessionId remains the producing conversation. */
  projectId?: string;
  messageId?: string;
  name: string;
  kind: ArtifactKind;
  mimeType: string;
  storageKey: string;
  createdAt: string;
  /** Present for artifacts produced asynchronously (currently `image` and `video-analysis`). Omitted → treated as ready. */
  status?: "pending" | "ready" | "failed";
  /** Set when status is "failed". */
  error?: string;
  /** Hidden artifacts remain addressable by id but are excluded from normal lists. */
  visibility?: "visible" | "hidden";
  /** Internal role for an artifact used to target an image refinement. */
  purpose?: "annotation";
}

export type AgentSseEvent =
  /** Durable execution identity and lifecycle state for reconnect/replay. */
  | {
      type: "run";
      runId: string;
      status:
        | "queued"
        | "running"
        | "waiting_approval"
        | "completed"
        | "failed"
        | "cancelled";
    }
  | { type: "session"; sessionId: string }
  /**
   * Emitted once, before any text_delta/thinking/tool_call for a given
   * assistant message, reporting the id the server has already committed to
   * persisting. Lets the client reassign its optimistic id in place instead
   * of remounting when the message is later reconciled from disk.
   */
  | { type: "message_start"; messageId: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  /**
   * Streaming progress for a tool call (Grok-style Progress items).
   * kind "draft" = write_artifact body snapshot; "text" = free-form log.
   */
  | {
      type: "tool_progress";
      id: string;
      kind: "text" | "draft";
      text?: string;
      name?: string;
    }
  /**
   * Live body of write_artifact while tool arguments are still streaming.
   * Client replaces draft each time (full snapshot so far).
   * Prefer tool_progress { kind: "draft" }; kept for compatibility.
   */
  | { type: "artifact_draft"; name?: string; text: string }
  | { type: "artifact"; artifactId: string; name: string; kind: ArtifactKind }
  /**
   * Model-maintained progress checklist (todo_write).
   * Full snapshot after each update — client replaces UI state.
   */
  | {
      type: "plan";
      todos: Array<{
        id: string;
        content: string;
        status: "pending" | "in_progress" | "completed" | "cancelled";
      }>;
      /** @deprecated prefer todos; kept for older clients */
      steps?: string[];
      summary?: string;
    }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; reason: "completed" | "cancelled" | "error" };
