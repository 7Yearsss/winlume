import { describe, expect, it, vi } from "vitest";
import { streamAiSdkGatewayChat, toAiSdkMessages, toAiSdkPrompt } from "./ai-sdk";
import type { ChatChunk } from "./gateway";

describe("AI SDK gateway adapter", () => {
  it("preserves tool call names across assistant and tool messages", () => {
    const messages = toAiSdkMessages([
      { role: "system", content: "system" },
      { role: "user", content: "write something" },
      {
        role: "assistant",
        content: "working",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "write_artifact",
              arguments: '{"name":"Draft"}',
            },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "saved" },
    ]);

    expect(messages[0]).toMatchObject({ role: "user", content: "write something" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "working" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "write_artifact",
          input: { name: "Draft" },
        },
      ],
    });
    expect(messages[2]).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "write_artifact",
        },
      ],
    });
  });

  it("moves every system message into instructions", () => {
    const prompt = toAiSdkPrompt([
      { role: "system", content: "base policy" },
      { role: "user", content: "hello" },
      { role: "system", content: "<system-reminder>context</system-reminder>" },
    ]);

    expect(prompt.instructions).toBe(
      "base policy\n\n<system-reminder>context</system-reminder>",
    );
    expect(prompt.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("uses an empty object for malformed historical tool JSON", () => {
    const messages = toAiSdkMessages([
      {
        role: "assistant",
        tool_calls: [
          {
            id: "bad-call",
            type: "function",
            function: { name: "read_artifact", arguments: "{" },
          },
        ],
      },
    ]);

    expect(messages[0]).toMatchObject({
      content: [{ type: "tool-call", input: {} }],
    });
  });
});

describe("streamAiSdkGatewayChat auth", () => {
  it("accepts system messages by sending them through instructions", async () => {
    const fetchImpl = vi.fn(async () => new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const chunks: ChatChunk[] = [];

    for await (const chunk of streamAiSdkGatewayChat({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "base policy" },
        { role: "user", content: "hello" },
      ],
      baseUrl: "https://gateway.test",
      chatPath: "/v1/chat/completions",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })) {
      chunks.push(chunk);
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chunks).not.toContainEqual(expect.objectContaining({ kind: "error" }));
  });

  it("ignores userId/internalToken and legacy env vars, sending only the Authorization bearer token", async () => {
    vi.stubEnv("REIZO_AUTH_MODE", "reizo");
    vi.stubEnv("NEW_API_URL", "https://retired-new-api.example");
    vi.stubEnv("REIZO_GATEWAY_TOKEN", "retired-token");
    vi.stubEnv("REIZO_GATEWAY_INTERNAL_TOKEN", "retired-internal-token");
    vi.stubEnv("REIZO_SERVICE_KEY", "wl_service_native");
    const fetchImpl = vi.fn(async () => new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));

    const chunks: ChatChunk[] = [];
    for await (const chunk of streamAiSdkGatewayChat({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "x" }],
      userId: "user-1",
      internalToken: "studio-secret",
      baseUrl: "https://gateway.test",
      chatPath: "/v1/chat/completions",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })) {
      chunks.push(chunk);
    }
    void chunks;

    expect(fetchImpl).toHaveBeenCalled();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer wl_service_native");
    expect(headers.get("New-Api-User")).toBeNull();
    expect(headers.get("x-reizo-internal-token")).toBeNull();
    expect(headers.get("x-reizo-internal-user-id")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("forwards reasoning effort and maps gateway reasoning_content to thinking", async () => {
    const response = [
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"reasoning_content":"先分析约束","content":"这是最终答案"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const fetchImpl = vi.fn(async () => new Response(response, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const chunks: ChatChunk[] = [];

    for await (const chunk of streamAiSdkGatewayChat({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "x" }],
      reasoningEffort: "medium",
      baseUrl: "https://gateway.test",
      chatPath: "/v1/chat/completions",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { kind: "thinking", text: "先分析约束" },
      { kind: "text", text: "这是最终答案" },
    ]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      reasoning_effort: "medium",
    });
  });
});


describe("AI SDK streaming errors", () => {
  it.each([
    [{ message: "Upstream rate limit exceeded, please retry later", code: "rate_limit_exceeded" }, "模型服务当前请求过多，请稍后重试或切换模型。"],
    [{ message: "status_code=524, bad response status code 524", type: "upstream_error" }, "模型服务响应超时，请稍后重试或切换模型。"],
    [{ message: "Requested model is unavailable", code: "model_not_found" }, "当前模型暂不可用，请切换模型后重试。"],
  ])("preserves a readable error after the stream has started: %j", async (error, message) => {
    const response = [
      `data: ${JSON.stringify({ id: "chatcmpl-test", choices: [{ index: 0, delta: { content: "\n" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ error })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const chunks: ChatChunk[] = [];
    for await (const chunk of streamAiSdkGatewayChat({
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "hello" }],
      baseUrl: "https://gateway.test",
      fetchImpl: async () => new Response(response, { headers: { "content-type": "text/event-stream" } }),
    })) chunks.push(chunk);
    expect(chunks).toContainEqual({ kind: "error", message });
    expect(chunks.some(chunk => chunk.kind === "error" && chunk.message === "[object Object]")).toBe(false);
    expect(chunks.some(chunk => chunk.kind === "tool_calls")).toBe(false);
  });
});
