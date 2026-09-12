/**
 * OpenAI-compatible chat completions client for the Reizo gateway.
 * Streams text (and optional tool-call deltas) via SSE. No tool execution here.
 */

export type ChatChunk =
  | { kind: "text"; text: string }
  /** Reasoning/thinking tokens, distinct from the final answer text. */
  | { kind: "thinking"; text: string }
  | { kind: "tool_call_delta"; id: string; name?: string; argumentsDelta?: string }
  | { kind: "tool_calls"; calls: { id: string; name: string; arguments: string }[] }
  | { kind: "error"; message: string };

export type GatewayChatRole = "system" | "user" | "assistant" | "tool";

export interface GatewayToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface GatewayChatMessage {
  role: GatewayChatRole;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: GatewayToolCall[];
}

export interface StreamGatewayChatParams {
  model: string;
  messages: GatewayChatMessage[];
  /** Bearer token override; defaults to REIZO_SERVICE_KEY. Used mainly by tests. */
  token?: string;
  /** @deprecated ignored — retained only for call-site compatibility, not read for auth. */
  userId?: string;
  /** @deprecated ignored — retained only for call-site compatibility, not read for auth. */
  internalToken?: string;
  tools?: unknown[];
  tool_choice?: unknown;
  signal?: AbortSignal;
  /** Override gateway origin (tests / multi-env) */
  baseUrl?: string;
  /** Override chat path (defaults REIZO_CHAT_PATH or /v1/chat/completions) */
  chatPath?: string;
  /** Inject fetch (tests) */
  fetchImpl?: typeof fetch;
  /**
   * Ask a reasoning-capable model to actually return its reasoning as
   * `reasoning_content` deltas instead of only reporting a token count in
   * `usage.completion_tokens_details.reasoning_tokens`. Not in this
   * gateway's documented parameter list, but confirmed working (undocumented
   * passthrough to the upstream provider) — probed directly against
   * v2api.top / gpt-5.5 on 2026-08-21. Omit for models that don't support
   * it; unset (default) sends nothing and preserves prior behavior.
   */
  reasoningEffort?: "low" | "medium" | "high";
}

export type GatewayChatStream = (
  params: StreamGatewayChatParams,
) => AsyncGenerator<ChatChunk, void, undefined>;

const DEFAULT_BASE = "http://127.0.0.1:4010";
const DEFAULT_CHAT_PATH = "/v1/chat/completions";

export function getGatewayBaseUrl(override?: string): string {
  const raw = override ?? process.env.REIZO_GATEWAY_URL ?? process.env.NEW_API_URL ?? DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

export function getChatPath(override?: string): string {
  const raw = override ?? process.env.REIZO_CHAT_PATH ?? DEFAULT_CHAT_PATH;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

type OpenAiDeltaToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiChunk = {
  error?: { message?: string } | string;
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string | null;
      /** DeepSeek-R1/Kimi-style reasoning-model field name. */
      reasoning_content?: string | null;
      /** Some proxies (e.g. OpenRouter) use this name instead. */
      reasoning?: string | null;
      role?: string;
      tool_calls?: OpenAiDeltaToolCall[];
    };
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: GatewayToolCall[];
    };
  }>;
};

export function errorMessageFromBody(text: string, status: number): string {
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof json.error === "string" && json.error) return json.error;
    if (json.error && typeof json.error === "object" && json.error.message) {
      return json.error.message;
    }
    if (typeof json.message === "string" && json.message) return json.message;
  } catch {
    /* not JSON */
  }
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 500);
  return `Gateway request failed (${status})`;
}

/**
 * Parse a single `data:` payload (JSON or `[DONE]`).
 * Pure — used by the stream client and unit tests.
 */
export function parseSseDataPayload(data: string): ChatChunk[] {
  const trimmed = data.trim();
  if (!trimmed || trimmed === "[DONE]") return [];

  let json: OpenAiChunk;
  try {
    json = JSON.parse(trimmed) as OpenAiChunk;
  } catch {
    return [{ kind: "error", message: `Invalid SSE JSON: ${trimmed.slice(0, 200)}` }];
  }

  if (json.error != null) {
    const msg =
      typeof json.error === "string"
        ? json.error
        : json.error.message ?? "Gateway error";
    return [{ kind: "error", message: msg }];
  }

  const choice = json.choices?.[0];
  if (!choice) return [];

  const out: ChatChunk[] = [];
  const delta = choice.delta;

  const reasoningDelta = delta?.reasoning_content ?? delta?.reasoning;
  if (reasoningDelta) {
    out.push({ kind: "thinking", text: reasoningDelta });
  }

  if (delta?.content) {
    out.push({ kind: "text", text: delta.content });
  }

  if (delta?.tool_calls?.length) {
    for (const tc of delta.tool_calls) {
      const id = tc.id ?? `index:${tc.index ?? 0}`;
      const name = tc.function?.name;
      const argumentsDelta = tc.function?.arguments;
      if (name || argumentsDelta) {
        out.push({
          kind: "tool_call_delta",
          id,
          ...(name ? { name } : {}),
          ...(argumentsDelta ? { argumentsDelta } : {}),
        });
      }
    }
  }

  // Non-stream style message on a choice (rare on stream endpoints)
  const reasoningMessage = choice.message?.reasoning_content ?? choice.message?.reasoning;
  if (reasoningMessage) {
    out.push({ kind: "thinking", text: reasoningMessage });
  }
  if (choice.message?.content) {
    out.push({ kind: "text", text: choice.message.content });
  }
  if (choice.message?.tool_calls?.length) {
    out.push({
      kind: "tool_calls",
      calls: choice.message.tool_calls.map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: c.function.arguments,
      })),
    });
  }

  return out;
}

/**
 * Incremental SSE line buffer. Feed decoded text chunks; receive ChatChunks.
 * Handles partial lines across network chunks (fixture-friendly pure API).
 */
export function createSseLineParser(): {
  push: (text: string) => ChatChunk[];
  flush: () => ChatChunk[];
} {
  let buffer = "";

  function consumeCompleteLines(raw: string): { events: ChatChunk[]; rest: string } {
    const events: ChatChunk[] = [];
    let rest = raw;
    // Normalize CRLF → LF for simpler splitting
    rest = rest.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    let nl: number;
    while ((nl = rest.indexOf("\n")) !== -1) {
      const line = rest.slice(0, nl);
      rest = rest.slice(nl + 1);

      if (line.startsWith("data:")) {
        const payload = line.slice(5).replace(/^ /, "");
        events.push(...parseSseDataPayload(payload));
      }
      // ignore event:, id:, comments, blank lines
    }
    return { events, rest };
  }

  return {
    push(text: string) {
      buffer += text;
      const { events, rest } = consumeCompleteLines(buffer);
      buffer = rest;
      return events;
    },
    flush() {
      if (!buffer.trim()) {
        buffer = "";
        return [];
      }
      // Final incomplete line may still be a full `data:` payload without trailing NL
      const leftover = buffer;
      buffer = "";
      if (leftover.startsWith("data:")) {
        const payload = leftover.slice(5).replace(/^ /, "");
        return parseSseDataPayload(payload);
      }
      return [];
    },
  };
}

/**
 * Parse an entire SSE body string into ordered ChatChunks (unit-test helper).
 */
export function parseSseBody(body: string): ChatChunk[] {
  const parser = createSseLineParser();
  return [...parser.push(body), ...parser.flush()];
}

async function* readResponseTextChunks(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream chat completions from the gateway as ChatChunk events.
 */
export async function* streamGatewayChat(
  params: StreamGatewayChatParams,
): AsyncGenerator<ChatChunk, void, undefined> {
  const baseUrl = getGatewayBaseUrl(params.baseUrl);
  const chatPath = getChatPath(params.chatPath);
  const url = `${baseUrl}${chatPath}`;
  const token = params.token ?? process.env.REIZO_SERVICE_KEY ?? "";
  const fetchImpl = params.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: true,
  };
  if (params.tools != null) body.tools = params.tools;
  if (params.tool_choice != null) body.tool_choice = params.tool_choice;
  const reasoningEffort =
    params.reasoningEffort ?? process.env.REIZO_REASONING_EFFORT;
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: params.signal,
      cache: "no-store",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Network error contacting gateway";
    yield { kind: "error", message };
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    yield { kind: "error", message: errorMessageFromBody(text, response.status) };
    return;
  }

  // Some gateways return a full JSON completion even when stream:true fails
  if (!isEventStream && contentType.includes("application/json")) {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as OpenAiChunk;
      if (json.error != null) {
        const msg =
          typeof json.error === "string"
            ? json.error
            : json.error.message ?? "Gateway error";
        yield { kind: "error", message: msg };
        return;
      }
      const choice = json.choices?.[0];
      const reasoning =
        choice?.message?.reasoning_content ??
        choice?.message?.reasoning ??
        choice?.delta?.reasoning_content ??
        choice?.delta?.reasoning;
      if (reasoning) yield { kind: "thinking", text: reasoning };
      const content = choice?.message?.content ?? choice?.delta?.content;
      if (content) yield { kind: "text", text: content };
      if (choice?.message?.tool_calls?.length) {
        yield {
          kind: "tool_calls",
          calls: choice.message.tool_calls.map((c) => ({
            id: c.id,
            name: c.function.name,
            arguments: c.function.arguments,
          })),
        };
      }
    } catch {
      yield { kind: "error", message: errorMessageFromBody(text, response.status) };
    }
    return;
  }

  // Accumulate tool call fragments if present (for a final tool_calls emission)
  const toolAcc = new Map<
    string,
    { id: string; name: string; arguments: string; index: number }
  >();
  const indexToId = new Map<number, string>();
  let sawToolDelta = false;
  let finishReason: string | null = null;

  const handlePayloadJson = (raw: string): ChatChunk[] => {
    // track finish_reason + tool accumulation without double-parsing errors
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "[DONE]") return [];
    try {
      const json = JSON.parse(trimmed) as OpenAiChunk;
      const choice = json.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const index = tc.index ?? 0;
          let id = tc.id;
          if (id) indexToId.set(index, id);
          else id = indexToId.get(index) ?? `index:${index}`;
          const prev = toolAcc.get(id) ?? {
            id,
            name: "",
            arguments: "",
            index,
          };
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.arguments += tc.function.arguments;
          toolAcc.set(id, prev);
          sawToolDelta = true;
        }
      }
    } catch {
      /* parseSseDataPayload will surface invalid JSON */
    }
    return parseSseDataPayload(raw);
  };

  let buffer = "";
  for await (const text of readResponseTextChunks(response.body)) {
    buffer += text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) {
        const payload = line.slice(5).replace(/^ /, "");
        for (const chunk of handlePayloadJson(payload)) {
          yield chunk;
        }
      }
    }
  }
  if (buffer.trim().startsWith("data:")) {
    const payload = buffer.trim().slice(5).replace(/^ /, "");
    for (const chunk of handlePayloadJson(payload)) {
      yield chunk;
    }
  }

  if (sawToolDelta && (finishReason === "tool_calls" || toolAcc.size > 0)) {
    const calls = [...toolAcc.values()]
      .sort((a, b) => a.index - b.index)
      .filter((c) => c.name)
      .map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));
    if (calls.length) {
      yield { kind: "tool_calls", calls };
    }
  }
}

export interface GenerateImageParams {
  prompt: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
  n: number;
  model?: string;
  /** Present → calls the image-edit endpoint with every image in order. */
  sourceImages?: { bytes: Buffer; mimeType: string }[];
  token?: string;
  /** @deprecated ignored — retained only for call-site compatibility, not read for auth. */
  userId?: string;
  /** @deprecated ignored — retained only for call-site compatibility, not read for auth. */
  internalToken?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

interface ImagesApiItem {
  b64_json?: string;
  url?: string;
}

interface ImagesApiResponse {
  data?: ImagesApiItem[];
  error?: { message?: string } | string;
}

async function resolveGeneratedImage(
  item: ImagesApiItem,
  fetchImpl: typeof fetch,
): Promise<GeneratedImage> {
  if (item.b64_json) {
    return { bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" };
  }
  if (item.url) {
    const res = await fetchImpl(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`Failed to download generated image (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const remoteContentType = res.headers.get("content-type") ?? "";
    // Never trust the remote host's content-type verbatim — it ends up as
    // this artifact's persisted mimeType and is later echoed as the
    // same-origin Content-Type of a top-level-navigable URL.
    const mimeType = /^image\//.test(remoteContentType) ? remoteContentType : "image/png";
    return { bytes: Buffer.from(arrayBuffer), mimeType };
  }
  throw new Error("Image API returned an item with neither b64_json nor url");
}

/**
 * Text-to-image (default) or image-edit (when `sourceImages` is set) against
 * the NewAPI gateway's OpenAI-compatible Images API.
 */
/** Default image model — the only model id verified reachable on the image gateway token as of 2026-07-29. */
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

/**
 * Image generation shares the same `REIZO_SERVICE_KEY` service-account
 * bearer token as chat completions.
 */
export async function generateImage(
  params: GenerateImageParams,
): Promise<GeneratedImage[]> {
  const baseUrl = getGatewayBaseUrl(params.baseUrl);
  const token = params.token ?? process.env.REIZO_SERVICE_KEY ?? "";
  const model = params.model ?? process.env.REIZO_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
  const fetchImpl = params.fetchImpl ?? fetch;
  const isEdit = Boolean(params.sourceImages?.length);
  const path = isEdit ? "/v1/images/edits" : "/v1/images/generations";
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit;
  if (isEdit) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", params.prompt);
    form.set("size", params.size);
    form.set("n", String(params.n));
    for (const [index, sourceImage] of params.sourceImages!.entries()) {
      form.append(
        "image[]",
        new Blob([new Uint8Array(sourceImage.bytes)], { type: sourceImage.mimeType }),
        `source-${index + 1}`,
      );
    }
    body = form;
    // Do NOT set Content-Type — fetch derives the multipart boundary from the FormData body.
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      model,
      prompt: params.prompt,
      size: params.size,
      n: params.n,
    });
  }

  const response = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(300_000) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(errorMessageFromBody(text, response.status));
  }

  let json: ImagesApiResponse;
  try {
    json = JSON.parse(text) as ImagesApiResponse;
  } catch {
    throw new Error(errorMessageFromBody(text, response.status));
  }
  if (json.error) {
    const msg = typeof json.error === "string" ? json.error : json.error.message;
    throw new Error(msg ?? "Image generation failed");
  }
  const items = json.data ?? [];
  if (!items.length) {
    throw new Error("Image API returned no results");
  }
  return Promise.all(items.map((item) => resolveGeneratedImage(item, fetchImpl)));
}
