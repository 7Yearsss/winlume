import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { isImageGenerationModel } from "@/lib/studio/image-model";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { getCurrentUserId } from "@/lib/auth/session";
import type { AgentSseEvent } from "@/lib/agent/types";
import { createAgentEventTranslator } from "@/lib/agent/ui-stream";
import { isTerminalStatus, toClientEvent, uiSseFrame } from "@/lib/agent/sse-stream";
import {
  RunCoordinatorError,
  RunPolicyError,
  RunStoreError,
  getAgentRunService,
  type RunEvent,
  type RunStatus,
} from "@/lib/agent/infrastructure";
import {
  normalizeExecutionMode,
  type AgentExecutionMode,
} from "@/lib/agent/executor";
import {
  registerTurn,
  unregisterTurn,
} from "@/lib/agent/turn-registry";
import { webStore } from "@/lib/host/web/store-singleton";
import {
  normalizeComposerOptions,
  toolNamesForComposerMode,
} from "@/lib/studio/composer-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseForRunError(error: unknown): Response {
  if (error instanceof RunPolicyError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: 403 },
    );
  }
  if (error instanceof RunStoreError && error.code === "idempotency_conflict") {
    return Response.json(
      { error: "Idempotency key belongs to a different request", code: error.code },
      { status: 409 },
    );
  }
  if (error instanceof RunCoordinatorError) {
    return Response.json({ error: error.message, code: error.code }, { status: 409 });
  }
  return Response.json({ error: "Unable to start agent run" }, { status: 500 });
}

type ChatBody = {
  sessionId?: string;
  projectId?: string;
  message?: string;
  model?: string;
  capabilityPresetId?: string;
  executionMode?: AgentExecutionMode;
  skillIds?: string[];
  /** Multi @-mention image artifact ids (preferred). */
  referencedArtifactIds?: string[];
  /** @deprecated Use referencedArtifactIds */
  referencedArtifactId?: string;
  composerOptions?: unknown;
  /**
   * The client already committed to `sessionId` before the server knew
   * about it — it navigated to `/studio/c/${sessionId}` optimistically,
   * with zero network round trips first. Create the session with exactly
   * this id instead of 404ing. Without `bootstrap`, `sessionId` must already
   * exist.
   */
  bootstrap?: { title?: string };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/chat - create a durable agent run and stream its persisted events.
 * Client disconnect does not cancel the worker. POST /api/chat/stop is the
 * explicit cancellation path.
 */
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const requestedModel =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : undefined;
  const requestedProjectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : undefined;
  const requestedCapabilityPresetId =
    typeof body.capabilityPresetId === "string" && body.capabilityPresetId.trim()
      ? body.capabilityPresetId.trim()
      : undefined;
  const executionMode = normalizeExecutionMode(
    body.executionMode ?? process.env.REIZO_AGENT_EXECUTION_MODE,
  );
  const skillIds = Array.isArray(body.skillIds)
    ? body.skillIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;
  const referencedArtifactIds = [
    ...(Array.isArray(body.referencedArtifactIds)
      ? body.referencedArtifactIds
      : []),
    ...(typeof body.referencedArtifactId === "string"
      ? [body.referencedArtifactId]
      : []),
  ]
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
  const composerOptions = normalizeComposerOptions(body.composerOptions);
  if (body.composerOptions !== undefined && !composerOptions) {
    return Response.json(
      { error: "无效的 Composer 参数", code: "invalid_composer_options" },
      { status: 400 },
    );
  }
  if (composerOptions?.mode === "video") {
    return Response.json(
      { error: "视频生成服务尚未接入", code: "video_generation_unavailable" },
      { status: 400 },
    );
  }
  const allowedToolNames = composerOptions
    ? toolNamesForComposerMode(composerOptions.mode)
    : undefined;

  let sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : "";
  let projectId = requestedProjectId;
  let model = requestedModel ?? "gpt-4o-mini";

  if (!sessionId) {
    if (requestedCapabilityPresetId) {
      return Response.json(
        { error: "Capability preset requires a validated session" },
        { status: 400 },
      );
    }
    if (projectId) {
      const project = await webStore.projects.getProject(userId, projectId);
      if (!project) {
        return Response.json({ error: "Project not found" }, { status: 404 });
      }
    }
    const session = await webStore.sessions.createSession({
      id: randomUUID(),
      userId,
      title: "新对话",
      model,
      ...(projectId ? { projectId } : {}),
    });
    sessionId = session.id;
  } else if (body.bootstrap) {
    // The client minted this id itself (crypto.randomUUID()) and already
    // navigated to it. Trust it only if it's shaped like one of ours — this
    // is the one path where a client picks its own primary key.
    if (!UUID_RE.test(sessionId)) {
      return Response.json({ error: "Invalid session id" }, { status: 400 });
    }
    if (projectId) {
      const project = await webStore.projects.getProject(userId, projectId);
      if (!project) {
        return Response.json({ error: "Project not found" }, { status: 404 });
      }
    }
    const existing = await webStore.sessions.getSession(userId, sessionId);
    if (existing) {
      return Response.json({ error: "Session already exists" }, { status: 409 });
    }
    const title = body.bootstrap.title?.trim() || "新对话";
    const session = await webStore.sessions.createSession({
      id: sessionId,
      userId,
      title,
      model,
      ...(projectId ? { projectId } : {}),
      ...(requestedCapabilityPresetId
        ? { capabilityPresetId: requestedCapabilityPresetId }
        : {}),
    });
    projectId = session.projectId;
    model = session.model;
  } else {
    const existing = await webStore.sessions.getSession(userId, sessionId);
    if (!existing) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    if (
      requestedCapabilityPresetId &&
      requestedCapabilityPresetId !== existing.capabilityPresetId
    ) {
      return Response.json(
        { error: "Capability preset does not match this session" },
        { status: 400 },
      );
    }
    if (projectId && existing.projectId !== projectId) {
      return Response.json(
        { error: "Session is outside the requested project" },
        { status: 409 },
      );
    }
    projectId = existing.projectId;
    model = requestedModel ?? existing.model;
    if (projectId) {
      const project = await webStore.projects.getProject(userId, projectId);
      if (!project) {
        return Response.json({ error: "Project not found" }, { status: 404 });
      }
    }
  }

  const service = getAgentRunService();
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
  const activeRun = await service.findActiveSessionRun(userId, sessionId);
  let runId: string;
  let initialRunStatus: RunStatus;
  let turn: ReturnType<typeof registerTurn> = null;
  let ownsReservation = false;

  if (
    activeRun &&
    activeRun.idempotencyKey === idempotencyKey &&
    idempotencyKey
  ) {
    // A transport retry with the same key joins the existing durable run.
    runId = activeRun.id;
    initialRunStatus = activeRun.status;
  } else if (activeRun) {
    return Response.json(
      { error: "该会话已有进行中的回复，请稍候或先停止", runId: activeRun.id },
      { status: 409 },
    );
  } else {
    turn = registerTurn(sessionId, userId);
    if (!turn) {
      return Response.json(
        { error: "该会话已有进行中的回复，请稍候或先停止" },
        { status: 409 },
      );
    }
    const createdTurn = turn;

    try {
      const submitted = await service.coordinator.submit({
        userId,
        sessionId,
        ...(projectId ? { projectId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        input: {
          message,
          executionMode: isImageGenerationModel(model) ? "studio" : executionMode,
          model,
          ...(allowedToolNames ? { allowedToolNames: [...allowedToolNames] } : {}),
          ...(skillIds?.length ? { skillIds } : {}),
          ...(referencedArtifactIds.length ? { referencedArtifactIds } : {}),
          ...(composerOptions
            ? { metadata: { composerOptions } }
            : {}),
        },
      });
      runId = submitted.run.id;
      initialRunStatus = submitted.run.status;
      ownsReservation = submitted.created;
      if (!submitted.created) {
        unregisterTurn(sessionId, createdTurn.controller);
        turn = null;
      }
    } catch (error) {
      unregisterTurn(sessionId, createdTurn.controller);
      return responseForRunError(error);
    }
  }

  // The in-process worker is only the local adapter. The durable run/event
  // record remains the source of truth for future external workers and replay.
  service.start();

  // Keep the session reservation until the worker reaches a terminal state,
  // even when this browser closes the SSE connection.
  if (turn && ownsReservation) {
    const reservedTurn = turn;
    let releaseReservation: (() => void) | undefined;
    const releaseWhenTerminal = (event: RunEvent) => {
      if (
        event.type === "run.status_changed" &&
        isTerminalStatus(event.payload.to)
      ) {
        releaseReservation?.();
      }
    };
    const reservationUnsubscribe = service.coordinator.subscribe(
      runId,
      releaseWhenTerminal,
    );
    releaseReservation = () => {
      reservationUnsubscribe();
      unregisterTurn(sessionId, reservedTurn.controller);
      releaseReservation = undefined;
    };
    void service.coordinator
      .replay(runId)
      .then((events) => events.forEach(releaseWhenTerminal))
      .catch(() => {
        // The worker/store path handles durable failure state. Keep the local
        // reservation until it can observe that terminal event.
      });
  }

  const clientSignal = request.signal;
  const encoder = new TextEncoder();
  let detachClient: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSequence = 0;
      let flushing = false;
      let flushAgain = false;

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        clientSignal.removeEventListener("abort", onClientAbort);
        try {
          controller.close();
        } catch {
          // The reader may have already cancelled the stream.
        }
      };

      const translateEvent = createAgentEventTranslator();

      const emit = (event: AgentSseEvent, sequence?: number) => {
        if (closed) return;
        try {
          const chunks = translateEvent(event);
          const frame = uiSseFrame(
            sequence === undefined
              ? chunks
              : [
                  ...chunks,
                  {
                    type: "data-run-cursor",
                    id: "cursor",
                    data: {
                      runId,
                      sequence,
                      eventType: event.type,
                      ...(event.type === "message_start"
                        ? { messageId: event.messageId }
                        : {}),
                    },
                    transient: true,
                  },
                ],
            sequence,
          );
          if (frame) controller.enqueue(encoder.encode(frame));
        } catch {
          close();
        }
      };

      // First frame, always: the canonical session id. Usually a no-op echo
      // of what the client already sent — but when this POST bootstrapped a
      // client-minted id (see `bootstrap` above), this is the client's only
      // positive confirmation the id it already navigated to is now real.
      emit({ type: "session", sessionId });

      const flush = async () => {
        if (flushing) {
          flushAgain = true;
          return;
        }
        flushing = true;
        try {
          do {
            flushAgain = false;
            const events = await service.coordinator.replay(runId, lastSequence);
            for (const event of events) {
              lastSequence = event.sequence;
              const clientEvent = toClientEvent(runId, event);
              if (clientEvent) emit(clientEvent, event.sequence);
            }
            const current = await service.coordinator.getRun(runId);
            if (current && isTerminalStatus(current.status)) {
              close();
              return;
            }
          } while (flushAgain && !closed);
        } catch {
          emit({ type: "error", message: "Unable to read agent run events", code: "run_replay_error" });
          close();
        } finally {
          flushing = false;
        }
      };

      const onClientAbort = () => {
        // Browser disconnect is not a cancellation request. It only detaches
        // this stream; the run continues and can be replayed later.
        close();
      };

      const unsubscribe = service.coordinator.subscribe(runId, () => {
        void flush();
      });
      detachClient = close;
      clientSignal.addEventListener("abort", onClientAbort, { once: true });
      emit({ type: "run", runId, status: initialRunStatus });
      void flush();
    },
    cancel() {
      detachClient?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...UI_MESSAGE_STREAM_HEADERS,
      "X-Accel-Buffering": "no",
      "X-Run-ID": runId,
    },
  });
}
