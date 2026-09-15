import { providerErrorMessage } from "./errors";
/**
 * Vercel AI SDK transport for the existing OpenAI-compatible gateway.
 *
 * This adapter deliberately returns the project's existing ChatChunk shape.
 * That lets the current runtime keep ownership of persistence, tool policy,
 * cancellation, and artifact events while the model transport migrates to AI SDK.
 */

import {
  jsonSchema,
  streamText,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  getChatPath,
  getGatewayBaseUrl,
  type ChatChunk,
  type GatewayChatMessage,
  type StreamGatewayChatParams,
} from "./gateway";

type OpenAiToolDefinition = {
  type?: "function";
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
};

type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function reasoningEffortFor(params: StreamGatewayChatParams): ReasoningEffort | undefined {
  const value = params.reasoningEffort ?? process.env.REIZO_REASONING_EFFORT;
  return typeof value === "string" && REASONING_EFFORTS.has(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : undefined;
}

/**
 * AI SDK's OpenAI Chat Completions adapter intentionally parses only the
 * standard OpenAI fields. Several compatible gateways emit reasoning through
 * the provider extension `reasoning_content` (or `reasoning`), so read it
 * from raw chunks enabled by `include.rawChunks`.
 */
function reasoningFromRawChunk(rawValue: unknown): string | undefined {
  if (!rawValue || typeof rawValue !== "object") return undefined;
  const choices = (rawValue as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return undefined;
  const choice = firstChoice as {
    delta?: { reasoning_content?: unknown; reasoning?: unknown };
    message?: { reasoning_content?: unknown; reasoning?: unknown };
  };
  const value =
    choice.delta?.reasoning_content ??
    choice.delta?.reasoning ??
    choice.message?.reasoning_content ??
    choice.message?.reasoning;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Convert persisted OpenAI-compatible messages to AI SDK model messages. */
export function toAiSdkMessages(messages: GatewayChatMessage[]): ModelMessage[] {
  const toolNames = new Map<string, string>();
  return messages.map((message) => {
    // AI SDK 7 requires system content in the top-level `instructions`
    // option. Keep this conversion focused on conversational messages so
    // callers cannot accidentally reintroduce system roles into `messages`.
    if (message.role === "system") {
      return null;
    }

    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        toolNames.set(call.id, call.function.name);
      }
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.tool_calls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.function.name,
            input: parseJson(call.function.arguments),
          })),
        ],
      } as ModelMessage;
    }

    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result" as const,
            toolCallId: message.tool_call_id ?? "unknown",
            toolName: toolNames.get(message.tool_call_id ?? "") ?? "unknown",
            output: { type: "text" as const, value: message.content ?? "" },
          },
        ],
      } as ModelMessage;
    }

    return { role: message.role, content: message.content ?? "" } as ModelMessage;
  }).filter((message): message is ModelMessage => message !== null);
}

/** Split the OpenAI-compatible prompt into AI SDK's instructions/messages shape. */
export function toAiSdkPrompt(messages: GatewayChatMessage[]): {
  instructions?: string;
  messages: ModelMessage[];
} {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "")
    .filter(Boolean)
    .join("\n\n");

  return {
    ...(instructions ? { instructions } : {}),
    messages: toAiSdkMessages(messages),
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function aiSdkTools(rawTools: unknown[] | undefined): ToolSet {
  const tools: Record<string, unknown> = {};
  for (const raw of rawTools ?? []) {
    const definition = raw as OpenAiToolDefinition;
    const fn = definition.function;
    const name = fn?.name?.trim();
    if (!name || !fn?.parameters || typeof fn.parameters !== "object") continue;

    // No execute function is attached here. The existing Reizo runtime owns
    // execution so it can persist tool calls and emit its established SSE events.
    tools[name] = {
      description: fn.description,
      inputSchema: jsonSchema(fn.parameters as Record<string, unknown>),
      outputSchema: jsonSchema({ type: "object" }),
    };
  }
  return tools as ToolSet;
}

function modelFor(params: StreamGatewayChatParams) {
  const chatPath = getChatPath(params.chatPath);
  const suffix = "/chat/completions";
  if (!chatPath.endsWith(suffix)) {
    throw new Error(
      `AI SDK transport requires a chat-completions path ending in ${suffix}`,
    );
  }
  const base = `${getGatewayBaseUrl(params.baseUrl)}${chatPath.slice(0, -suffix.length)}`;
  const provider = createOpenAI({
    name: "reizo-gateway",
    baseURL: base,
    // The gateway accepts a bearer token. A placeholder keeps AI SDK from
    // rejecting an intentionally unauthenticated local test gateway.
    apiKey: params.token ?? process.env.REIZO_SERVICE_KEY ?? "unused",
    fetch: params.fetchImpl,
  });
  return provider.chat(params.model);
}

/**
 * Stream one gateway call through AI SDK while preserving ChatChunk semantics.
 * Tool execution remains in `runAgentTurn`, so this function is a transport
 * replacement rather than a second tool runtime.
 */
export async function* streamAiSdkGatewayChat(
  params: StreamGatewayChatParams,
): AsyncGenerator<ChatChunk, void, undefined> {
  try {
    const calls: { id: string; name: string; arguments: string }[] = [];
    const pendingRawReasoning: string[] = [];
    const reasoning = reasoningEffortFor(params);
    const prompt = toAiSdkPrompt(params.messages);
    let failed = false;
    const result = streamText({
      model: modelFor(params),
      messages: prompt.messages,
      ...(prompt.instructions ? { instructions: prompt.instructions } : {}),
      tools: aiSdkTools(params.tools),
      ...(reasoning ? { reasoning } : {}),
      include: { rawChunks: true },
      maxRetries: 0,
      abortSignal: params.signal,
    });

    for await (const part of result.fullStream) {
      const chunk = part as Record<string, unknown>;
      if (chunk.type === "raw") {
        const reasoning = reasoningFromRawChunk(chunk.rawValue);
        if (reasoning) pendingRawReasoning.push(reasoning);
        continue;
      }

      if (chunk.type === "reasoning-delta") {
        // Prefer the SDK's normalized reasoning when a provider begins
        // supporting it natively, rather than rendering both forms.
        pendingRawReasoning.length = 0;
        if (typeof chunk.text === "string") {
          yield { kind: "thinking", text: chunk.text };
        } else if (typeof chunk.delta === "string") {
          yield { kind: "thinking", text: chunk.delta };
        }
        continue;
      }

      while (pendingRawReasoning.length > 0) {
        const reasoning = pendingRawReasoning.shift();
        if (reasoning) yield { kind: "thinking", text: reasoning };
      }

      switch (chunk.type) {
        case "text-delta":
          if (typeof chunk.text === "string") {
            yield { kind: "text", text: chunk.text };
          } else if (typeof chunk.delta === "string") {
            yield { kind: "text", text: chunk.delta };
          }
          break;
        case "tool-call":
          calls.push({
            id: String(chunk.toolCallId ?? `ai-sdk-tool-call-${calls.length}`),
            name: String(chunk.toolName ?? "unknown"),
            arguments: JSON.stringify(chunk.input ?? {}),
          });
          break;
        case "error":
        case "tool-error":
          failed = true;
          yield {
            kind: "error",
            message: providerErrorMessage(chunk.error),
          };
          break;
        default:
          // Source and finish chunks do not map to the existing Studio
          // transport contract yet.
          break;
      }
    }
    while (pendingRawReasoning.length > 0) {
      const reasoning = pendingRawReasoning.shift();
      if (reasoning) yield { kind: "thinking", text: reasoning };
    }
    if (!failed && calls.length) yield { kind: "tool_calls", calls };
  } catch (error) {
    if (params.signal?.aborted) throw error;
    yield {
      kind: "error",
      message: providerErrorMessage(error),
    };
  }
}
