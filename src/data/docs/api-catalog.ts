/**
 * Reizo API 文档目录 — AI 模型接口
 * 结构对齐 New API 文档分类，内容与示例统一为 Reizo 品牌。
 */

export const DOCS_BASE_URL = "https://api.winlume.ai";
export const DOCS_API_KEY_ENV = "REIZO_API_KEY";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type ApiParam = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

export type ApiDocPage = {
  /** URL slug under /docs/api/ — e.g. ai-model/chat/openai/createchatcompletion */
  slug: string;
  title: string;
  /** Sidebar label (shorter) */
  navTitle: string;
  description: string;
  format: string;
  method: HttpMethod;
  path: string;
  contentType?: string;
  notes?: string[];
  headers?: ApiParam[];
  query?: ApiParam[];
  pathParams?: ApiParam[];
  body?: ApiParam[];
  requestExample?: string;
  responseExample?: string;
};

export type ApiDocCategory = {
  id: string;
  title: string;
  /** English label for sidebar, e.g. Audio */
  titleEn: string;
  description: string;
  pages: ApiDocPage[];
};

export type CodeSample = {
  id: string;
  label: string;
  language: string;
  code: string;
};

/** Build multi-language request samples for the right-hand code panel. */
export function buildCodeSamples(page: ApiDocPage): CodeSample[] {
  const url = `${DOCS_BASE_URL}${page.path}`;
  const authHeader = `Bearer $${DOCS_API_KEY_ENV}`;
  const isGet = page.method === "GET";
  const bodyHint = page.body?.length
    ? Object.fromEntries(
        page.body.slice(0, 6).map((p) => {
          if (p.type.includes("array")) return [p.name, []];
          if (p.type.includes("boolean")) return [p.name, false];
          if (p.type.includes("integer") || p.type.includes("number")) return [p.name, 0];
          if (p.type.includes("object")) return [p.name, {}];
          if (p.type.includes("file")) return [p.name, "@file"];
          return [p.name, "string"];
        }),
      )
    : undefined;

  const curl =
    page.requestExample ??
    (isGet
      ? `curl "${url}" \\\n  -H "Authorization: ${authHeader}"`
      : `curl -X ${page.method} "${url}" \\\n  -H "Authorization: ${authHeader}" \\\n  -H "Content-Type: application/json" \\\n  -d '{}'`);

  const jsBody = bodyHint ? `,\n  body: JSON.stringify(${JSON.stringify(bodyHint, null, 2).replace(/\n/g, "\n  ")})` : "";
  const js = isGet
    ? `const res = await fetch("${url}", {\n  method: "GET",\n  headers: {\n    Authorization: "Bearer " + process.env.${DOCS_API_KEY_ENV},\n  },\n});\nconst data = await res.json();\nconsole.log(data);`
    : `const res = await fetch("${url}", {\n  method: "${page.method}",\n  headers: {\n    Authorization: "Bearer " + process.env.${DOCS_API_KEY_ENV},\n    "Content-Type": "application/json",\n  }${jsBody}\n});\nconst data = await res.json();\nconsole.log(data);`;

  const pyBody = bodyHint
    ? `,\n    json=${JSON.stringify(bodyHint, null, 4).replace(/\n/g, "\n    ")}`
    : "";
  const py = `import os\nimport requests\n\nresp = requests.${page.method.toLowerCase()}(\n    "${url}",\n    headers={\n        "Authorization": f"Bearer {os.environ['${DOCS_API_KEY_ENV}']}",\n    }${isGet ? "" : ',\n    # Content-Type set by requests when using json='}${pyBody}\n)\nprint(resp.json())`;

  const goBody = !isGet
    ? `\n\tpayload := strings.NewReader(\`{}\`)\n\treq, _ := http.NewRequest("${page.method}", "${url}", payload)\n\treq.Header.Set("Content-Type", "application/json")`
    : `\n\treq, _ := http.NewRequest("${page.method}", "${url}", nil)`;
  const go = `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"${isGet ? "" : "\n\t\"strings\""}\n\t"os"\n)\n\nfunc main() {${goBody}\n\treq.Header.Set("Authorization", "Bearer "+os.Getenv("${DOCS_API_KEY_ENV}"))\n\tres, _ := http.DefaultClient.Do(req)\n\tdefer res.Body.Close()\n\tbody, _ := io.ReadAll(res.Body)\n\tfmt.Println(string(body))\n}`;

  return [
    { id: "curl", label: "cURL", language: "bash", code: curl },
    { id: "js", label: "JavaScript", language: "javascript", code: js },
    { id: "python", label: "Python", language: "python", code: py },
    { id: "go", label: "Go", language: "go", code: go },
  ];
}

const bearer: ApiParam = {
  name: "Authorization",
  type: "string",
  required: true,
  description: "Bearer Token，格式：`Bearer $REIZO_API_KEY`",
};

function curlJson(method: HttpMethod, path: string, body?: unknown) {
  if (method === "GET" && body === undefined) {
    return `curl "${DOCS_BASE_URL}${path}" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}"`;
  }
  const payload =
    body === undefined
      ? undefined
      : JSON.stringify(body, null, 2).replace(/\n/g, "\n  ");
  const lines = [
    `curl -X ${method} "${DOCS_BASE_URL}${path}" \\`,
    `  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\`,
    `  -H "Content-Type: application/json"${payload ? " \\" : ""}`,
  ];
  if (payload) lines.push(`  -d '${payload}'`);
  return lines.join("\n");
}

export const apiCategories: ApiDocCategory[] = [
  {
    id: "models",
    title: "模型列表",
    titleEn: "Models",
    description: "获取可用的模型列表。",
    pages: [
      {
        slug: "ai-model/models/list/listmodels",
        title: "列出模型（OpenAI 格式）",
        navTitle: "原生 OpenAI 格式",
        description:
          "获取当前账户可用的模型列表。默认返回 OpenAI 格式；请求头包含 `x-api-key` + `anthropic-version` 时返回 Anthropic 格式，包含 `x-goog-api-key` 或 `key` 查询参数时返回 Gemini 格式。",
        format: "原生 OpenAI 格式",
        method: "GET",
        path: "/v1/models",
        headers: [bearer],
        requestExample: curlJson("GET", "/v1/models"),
        responseExample: JSON.stringify(
          {
            object: "list",
            data: [
              {
                id: "gpt-4.1-mini",
                object: "model",
                created: 1715367049,
                owned_by: "reizo",
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/models/list/listmodelsgemini",
        title: "列出模型（Gemini 格式）",
        navTitle: "原生 Gemini 格式",
        description: "以 Gemini API 格式返回可用模型列表。",
        format: "原生 Gemini 格式",
        method: "GET",
        path: "/v1beta/models",
        headers: [
          {
            name: "x-goog-api-key",
            type: "string",
            required: true,
            description: "也可使用 Authorization: Bearer 或查询参数 key",
          },
        ],
        requestExample: `curl "${DOCS_BASE_URL}/v1beta/models" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}"`,
        responseExample: JSON.stringify(
          {
            models: [
              {
                name: "models/gemini-2.0-flash",
                version: "2.0",
                displayName: "Gemini 2.0 Flash",
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "chat",
    title: "聊天",
    titleEn: "Chat",
    description: "对话补全接口。",
    pages: [
      {
        slug: "ai-model/chat/openai/createchatcompletion",
        title: "Chat Completions",
        navTitle: "Chat Completions",
        description:
          "根据对话历史创建模型响应。支持流式与非流式。兼容 OpenAI Chat Completions API。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/chat/completions",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "模型 ID，如 gpt-4.1-mini" },
          { name: "messages", type: "array", required: true, description: "对话消息列表（role + content）" },
          { name: "stream", type: "boolean", description: "是否启用 SSE 流式输出，默认 false" },
          { name: "temperature", type: "number", description: "采样温度，0–2" },
          { name: "max_tokens", type: "integer", description: "生成的最大 token 数" },
          { name: "top_p", type: "number", description: "核采样参数" },
          { name: "tools", type: "array", description: "可选工具 / function calling 定义" },
          { name: "response_format", type: "object", description: "输出格式约束，如 json_object" },
        ],
        requestExample: curlJson("POST", "/v1/chat/completions", {
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "用一句话介绍 Reizo" },
          ],
          stream: false,
        }),
        responseExample: JSON.stringify(
          {
            id: "chatcmpl-xxx",
            object: "chat.completion",
            created: 1715367049,
            model: "gpt-4.1-mini",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Reizo 是统一接入多模型的 AI API 平台。",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 28, completion_tokens: 18, total_tokens: 46 },
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/chat/openai/createresponse",
        title: "Responses API",
        navTitle: "Responses 格式",
        description:
          "OpenAI Responses API，用于创建模型响应，支持多轮对话、工具调用与推理等能力。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/responses",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "模型 ID" },
          { name: "input", type: "string | array", required: true, description: "用户输入文本或消息列表" },
          { name: "stream", type: "boolean", description: "是否流式输出" },
          { name: "tools", type: "array", description: "可用工具列表" },
          { name: "instructions", type: "string", description: "系统级指令" },
        ],
        requestExample: curlJson("POST", "/v1/responses", {
          model: "gpt-4.1-mini",
          input: "总结 Reizo 的核心价值",
        }),
        responseExample: JSON.stringify(
          {
            id: "resp_xxx",
            object: "response",
            status: "completed",
            model: "gpt-4.1-mini",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "统一账户、统一计费、多模型路由。" }],
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/chat/createmessage",
        title: "Claude Messages",
        navTitle: "原生 Claude 格式",
        description:
          "Anthropic Claude Messages API 格式。请求头需包含 `anthropic-version`。",
        format: "原生 Claude 格式",
        method: "POST",
        path: "/v1/messages",
        contentType: "application/json",
        headers: [
          bearer,
          {
            name: "anthropic-version",
            type: "string",
            required: true,
            description: "例如 2023-06-01",
          },
        ],
        body: [
          { name: "model", type: "string", required: true, description: "Claude 模型 ID" },
          { name: "messages", type: "array", required: true, description: "消息列表" },
          { name: "max_tokens", type: "integer", required: true, description: "最大生成 token" },
          { name: "system", type: "string", description: "系统提示" },
          { name: "stream", type: "boolean", description: "是否流式" },
          { name: "temperature", type: "number", description: "采样温度" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1/messages" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "claude-sonnet-4-20250514",\n    "max_tokens": 1024,\n    "messages": [{"role": "user", "content": "Hello"}]\n  }'`,
        responseExample: JSON.stringify(
          {
            id: "msg_xxx",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello! How can I help you today?" }],
            model: "claude-sonnet-4-20250514",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 12 },
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/chat/gemini/geminirelayv1beta",
        title: "Gemini 文本聊天",
        navTitle: "Gemini 文本聊天",
        description:
          "代理 Gemini API 请求。路径格式：`/v1beta/models/{model}:{action}`，常见 action 为 `generateContent` / `streamGenerateContent`。",
        format: "原生 Gemini 格式",
        method: "POST",
        path: "/v1beta/models/{model}:generateContent",
        contentType: "application/json",
        headers: [bearer],
        pathParams: [
          { name: "model", type: "string", required: true, description: "如 gemini-2.0-flash" },
        ],
        body: [
          {
            name: "contents",
            type: "array",
            required: true,
            description: "对话内容，含 role 与 parts",
          },
          { name: "generationConfig", type: "object", description: "温度、maxOutputTokens 等" },
          { name: "systemInstruction", type: "object", description: "系统指令" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1beta/models/gemini-2.0-flash:generateContent" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "contents": [{\n      "role": "user",\n      "parts": [{"text": "介绍一下 Reizo"}]\n    }]\n  }'`,
        responseExample: JSON.stringify(
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Reizo 是 AI 模型与应用聚合平台。" }],
                },
                finishReason: "STOP",
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/chat/gemini/geminirelayv1beta-391536411",
        title: "Gemini 媒体识别",
        navTitle: "Gemini 媒体识别",
        description:
          "Gemini 图像 / PDF / 音频 / 视频识别。仅支持通过 `inlineData` 以 base64 上传，不支持 `fileData.fileUri` 或 File API。",
        format: "原生 Gemini 格式",
        method: "POST",
        path: "/v1beta/models/{model}:generateContent",
        contentType: "application/json",
        headers: [bearer],
        pathParams: [
          { name: "model", type: "string", required: true, description: "支持多模态的 Gemini 模型" },
        ],
        body: [
          {
            name: "contents",
            type: "array",
            required: true,
            description: "parts 中可包含 text 与 inlineData（mimeType + data）",
          },
        ],
        notes: [
          "图片请使用 image/png、image/jpeg 等 MIME 类型。",
          "大文件建议压缩后再 base64，注意请求体大小限制。",
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1beta/models/gemini-2.0-flash:generateContent" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "contents": [{\n      "role": "user",\n      "parts": [\n        {"text": "描述这张图片"},\n        {"inlineData": {"mimeType": "image/jpeg", "data": "<base64>"}}\n      ]\n    }]\n  }'`,
        responseExample: JSON.stringify(
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "图中是一只坐在窗边的猫。" }],
                },
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "completions",
    title: "补全",
    titleEn: "Completions",
    description: "传统文本补全接口。",
    pages: [
      {
        slug: "ai-model/completions/createcompletion",
        title: "文本补全",
        navTitle: "原生 OpenAI 格式",
        description: "基于给定提示创建文本补全（Legacy Completions API）。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/completions",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "模型 ID" },
          { name: "prompt", type: "string | array", required: true, description: "提示文本" },
          { name: "max_tokens", type: "integer", description: "最大生成长度" },
          { name: "temperature", type: "number", description: "采样温度" },
          { name: "stream", type: "boolean", description: "是否流式" },
        ],
        requestExample: curlJson("POST", "/v1/completions", {
          model: "gpt-3.5-turbo-instruct",
          prompt: "Reizo is",
          max_tokens: 32,
        }),
        responseExample: JSON.stringify(
          {
            id: "cmpl-xxx",
            object: "text_completion",
            choices: [{ text: " an AI API gateway.", index: 0, finish_reason: "stop" }],
            usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "embeddings",
    title: "嵌入",
    titleEn: "Embeddings",
    description: "文本嵌入向量生成接口。",
    pages: [
      {
        slug: "ai-model/embeddings/createembedding",
        title: "创建嵌入",
        navTitle: "原生 OpenAI 格式",
        description: "将文本转换为向量嵌入，适用于检索、聚类与相似度计算。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/embeddings",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "嵌入模型 ID" },
          { name: "input", type: "string | array", required: true, description: "待嵌入文本或文本数组" },
          { name: "encoding_format", type: "string", description: "float 或 base64" },
          { name: "dimensions", type: "integer", description: "部分模型支持降维输出" },
        ],
        requestExample: curlJson("POST", "/v1/embeddings", {
          model: "text-embedding-3-small",
          input: "Reizo API 文档",
        }),
        responseExample: JSON.stringify(
          {
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: [0.012, -0.034, 0.056] }],
            model: "text-embedding-3-small",
            usage: { prompt_tokens: 6, total_tokens: 6 },
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/embeddings/createengineembedding",
        title: "引擎嵌入（Gemini 路径）",
        navTitle: "原生 Gemini 格式",
        description: "使用指定引擎 / 模型创建嵌入。",
        format: "原生 Gemini 格式",
        method: "POST",
        path: "/v1/engines/{model}/embeddings",
        contentType: "application/json",
        headers: [bearer],
        pathParams: [{ name: "model", type: "string", required: true, description: "嵌入模型名" }],
        body: [
          { name: "input", type: "string | array", required: true, description: "待嵌入文本" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1/engines/text-embedding-004/embeddings" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"input":"hello world"}'`,
        responseExample: JSON.stringify(
          {
            object: "list",
            data: [{ object: "embedding", embedding: [0.1, 0.2, 0.3] }],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "rerank",
    title: "重排序",
    titleEn: "Rerank",
    description: "文档重排序接口。",
    pages: [
      {
        slug: "ai-model/rerank/creatererank",
        title: "文档重排序",
        navTitle: "文档重排序",
        description: "根据查询对文档列表进行相关性重排序。",
        format: "Rerank",
        method: "POST",
        path: "/v1/rerank",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "重排模型 ID" },
          { name: "query", type: "string", required: true, description: "查询文本" },
          { name: "documents", type: "array", required: true, description: "候选文档字符串列表" },
          { name: "top_n", type: "integer", description: "返回前 N 条" },
          { name: "return_documents", type: "boolean", description: "是否在结果中返回原文" },
        ],
        requestExample: curlJson("POST", "/v1/rerank", {
          model: "rerank-multilingual-v3.0",
          query: "什么是 Reizo？",
          documents: ["Reizo 是 AI API 平台", "今天天气不错", "统一计费与模型路由"],
          top_n: 2,
        }),
        responseExample: JSON.stringify(
          {
            results: [
              { index: 0, relevance_score: 0.92 },
              { index: 2, relevance_score: 0.81 },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "moderations",
    title: "审查",
    titleEn: "Moderations",
    description: "内容安全审核接口。",
    pages: [
      {
        slug: "ai-model/moderations/createmoderation",
        title: "内容审核",
        navTitle: "原生 OpenAI 格式",
        description:
          "检查文本内容是否违反使用政策。审核接口是合规工具之一，不替代部署方自身安全治理义务。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/moderations",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", description: "审核模型，可选" },
          { name: "input", type: "string | array", required: true, description: "待审核文本" },
        ],
        requestExample: curlJson("POST", "/v1/moderations", {
          model: "omni-moderation-latest",
          input: "示例文本",
        }),
        responseExample: JSON.stringify(
          {
            id: "modr-xxx",
            model: "omni-moderation-latest",
            results: [
              {
                flagged: false,
                categories: { hate: false, violence: false },
                category_scores: { hate: 0.001, violence: 0.002 },
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "audio",
    title: "音频",
    titleEn: "Audio",
    description: "语音识别和语音合成接口。",
    pages: [
      {
        slug: "ai-model/audio/openai/createspeech",
        title: "文本转语音",
        navTitle: "文本转语音",
        description: "将文本转换为音频（TTS）。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/audio/speech",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "如 tts-1、tts-1-hd" },
          { name: "input", type: "string", required: true, description: "要合成的文本" },
          { name: "voice", type: "string", required: true, description: "音色，如 alloy、nova" },
          { name: "response_format", type: "string", description: "mp3 / opus / aac / flac 等" },
          { name: "speed", type: "number", description: "语速 0.25–4.0" },
        ],
        requestExample: curlJson("POST", "/v1/audio/speech", {
          model: "tts-1",
          input: "欢迎使用 Reizo",
          voice: "alloy",
        }),
        responseExample: "（二进制音频流，Content-Type: audio/mpeg）",
        notes: ["成功时直接返回音频文件字节流，而非 JSON。"],
      },
      {
        slug: "ai-model/audio/openai/createtranscription",
        title: "音频转录",
        navTitle: "音频转录",
        description: "将音频转换为文本（Speech to Text）。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/audio/transcriptions",
        contentType: "multipart/form-data",
        headers: [bearer],
        body: [
          { name: "file", type: "file", required: true, description: "音频文件" },
          { name: "model", type: "string", required: true, description: "如 whisper-1" },
          { name: "language", type: "string", description: "ISO-639-1 语言代码" },
          { name: "prompt", type: "string", description: "可选提示，提高准确率" },
          { name: "response_format", type: "string", description: "json / text / srt / vtt" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1/audio/transcriptions" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -F file="@speech.mp3" \\\n  -F model="whisper-1"`,
        responseExample: JSON.stringify({ text: "欢迎使用 Reizo。" }, null, 2),
      },
      {
        slug: "ai-model/audio/openai/createtranslation",
        title: "音频翻译",
        navTitle: "音频翻译",
        description: "将音频翻译为英文文本。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/audio/translations",
        contentType: "multipart/form-data",
        headers: [bearer],
        body: [
          { name: "file", type: "file", required: true, description: "音频文件" },
          { name: "model", type: "string", required: true, description: "如 whisper-1" },
          { name: "prompt", type: "string", description: "可选提示" },
          { name: "response_format", type: "string", description: "json / text / srt / vtt" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1/audio/translations" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -F file="@speech.mp3" \\\n  -F model="whisper-1"`,
        responseExample: JSON.stringify({ text: "Welcome to Reizo." }, null, 2),
      },
      {
        slug: "ai-model/audio/geminirelayv1beta-383836364",
        title: "Gemini 音频生成",
        navTitle: "原生 Gemini 格式",
        description:
          "Gemini 音频生成接口，可使用如 gemini-2.5-flash-preview-tts 等模型。",
        format: "原生 Gemini 格式",
        method: "POST",
        path: "/v1beta/models/{model}:generateContent",
        contentType: "application/json",
        headers: [bearer],
        pathParams: [
          { name: "model", type: "string", required: true, description: "支持 TTS 的 Gemini 模型" },
        ],
        body: [
          { name: "contents", type: "array", required: true, description: "含待合成文本的 contents" },
          {
            name: "generationConfig",
            type: "object",
            description: "可配置 responseModalities 等音频输出选项",
          },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1beta/models/gemini-2.5-flash-preview-tts:generateContent" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "contents": [{"role":"user","parts":[{"text":"你好，欢迎使用 Reizo"}]}],\n    "generationConfig": {"responseModalities": ["AUDIO"]}\n  }'`,
        responseExample: JSON.stringify(
          {
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: "audio/wav", data: "<base64>" } }],
                },
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "realtime",
    title: "实时语音",
    titleEn: "Realtime",
    description: "实时音频流接口。",
    pages: [
      {
        slug: "ai-model/realtime/createrealtimesession",
        title: "Realtime WebSocket",
        navTitle: "原生 OpenAI 格式",
        description:
          "建立 WebSocket 连接用于实时对话。这是 WebSocket 端点，需使用 WSS 协议。",
        format: "原生 OpenAI 格式",
        method: "GET",
        path: "/v1/realtime",
        headers: [
          bearer,
          {
            name: "OpenAI-Beta",
            type: "string",
            description: "部分客户端需要 realtime=v1",
          },
        ],
        query: [
          {
            name: "model",
            type: "string",
            required: true,
            description: "实时模型，如 gpt-4o-realtime-preview",
          },
        ],
        notes: [
          `连接示例：wss://api.winlume.ai/v1/realtime?model=gpt-4o-realtime-preview`,
          "鉴权可通过 Authorization 头或子协议传递 API密钥（视客户端实现而定）。",
        ],
        requestExample: `wss://api.winlume.ai/v1/realtime?model=gpt-4o-realtime-preview`,
        responseExample: JSON.stringify(
          {
            type: "session.created",
            session: { id: "sess_xxx", model: "gpt-4o-realtime-preview" },
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "images",
    title: "图像",
    titleEn: "Images",
    description: "AI 图像生成接口。",
    pages: [
      {
        slug: "ai-model/images/openai/post-v1-images-generations",
        title: "生成图像",
        navTitle: "生成图像（OpenAI）",
        description: "根据文本提示创建图像。兼容 OpenAI Images API。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/images/generations",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", description: "如 dall-e-3、gpt-image-1" },
          { name: "prompt", type: "string", required: true, description: "图像描述" },
          { name: "n", type: "integer", description: "生成数量" },
          { name: "size", type: "string", description: "如 1024x1024" },
          { name: "quality", type: "string", description: "standard / hd 等" },
          { name: "response_format", type: "string", description: "url 或 b64_json" },
        ],
        requestExample: curlJson("POST", "/v1/images/generations", {
          model: "dall-e-3",
          prompt: "A minimal logo for Reizo, teal spectrum accents",
          size: "1024x1024",
        }),
        responseExample: JSON.stringify(
          {
            created: 1715367049,
            data: [{ url: "https://cdn.example.com/img.png", revised_prompt: "..." }],
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/images/openai/post-v1-images-edits",
        title: "编辑图像",
        navTitle: "编辑图像（OpenAI）",
        description: "在给定原始图像和提示的情况下创建编辑或扩展图像。",
        format: "原生 OpenAI 格式",
        method: "POST",
        path: "/v1/images/edits",
        contentType: "multipart/form-data",
        headers: [bearer],
        body: [
          { name: "image", type: "file", required: true, description: "原始图像" },
          { name: "prompt", type: "string", required: true, description: "编辑说明" },
          { name: "mask", type: "file", description: "可选遮罩" },
          { name: "model", type: "string", description: "图像编辑模型" },
          { name: "n", type: "integer", description: "生成数量" },
          { name: "size", type: "string", description: "输出尺寸" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1/images/edits" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -F image="@input.png" \\\n  -F prompt="将背景换成纯白" \\\n  -F model="dall-e-2"`,
        responseExample: JSON.stringify(
          { created: 1715367049, data: [{ url: "https://cdn.example.com/edited.png" }] },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/images/qwen/createimage",
        title: "通义千问生成图像",
        navTitle: "生成图像（通义）",
        description: "百炼 qwen-image 系列图片生成，路径兼容 OpenAI Images generations。",
        format: "通义千问 OpenAI 格式",
        method: "POST",
        path: "/v1/images/generations",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "qwen-image 系列模型" },
          { name: "prompt", type: "string", required: true, description: "图像描述" },
          { name: "size", type: "string", description: "输出尺寸" },
          { name: "n", type: "integer", description: "数量" },
        ],
        requestExample: curlJson("POST", "/v1/images/generations", {
          model: "qwen-image",
          prompt: "赛博朋克风格的城市夜景",
        }),
        responseExample: JSON.stringify(
          { created: 1715367049, data: [{ url: "https://cdn.example.com/qwen.png" }] },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/images/qwen/editimage",
        title: "通义千问编辑图像",
        navTitle: "编辑图像（通义）",
        description: "百炼 qwen-image 系列图片编辑。",
        format: "通义千问 OpenAI 格式",
        method: "POST",
        path: "/v1/images/edits",
        contentType: "multipart/form-data",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "qwen-image 编辑模型" },
          { name: "image", type: "file", required: true, description: "原始图像" },
          { name: "prompt", type: "string", required: true, description: "编辑指令" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1/images/edits" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -F model="qwen-image-edit" \\\n  -F image="@input.png" \\\n  -F prompt="去掉水印"`,
        responseExample: JSON.stringify(
          { created: 1715367049, data: [{ url: "https://cdn.example.com/qwen-edit.png" }] },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/images/gemini/geminirelayv1beta-383837589",
        title: "Gemini 原生图像生成",
        navTitle: "Gemini 原生格式",
        description: "通过 Gemini generateContent 进行图片生成。",
        format: "原生 Gemini 格式",
        method: "POST",
        path: "/v1beta/models/{model}:generateContent",
        contentType: "application/json",
        headers: [bearer],
        pathParams: [
          { name: "model", type: "string", required: true, description: "支持图像输出的 Gemini 模型" },
        ],
        body: [
          { name: "contents", type: "array", required: true, description: "提示词 contents" },
          {
            name: "generationConfig",
            type: "object",
            description: "responseModalities 可包含 IMAGE",
          },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "contents":[{"role":"user","parts":[{"text":"画一只纸飞机"}]}],\n    "generationConfig":{"responseModalities":["TEXT","IMAGE"]}\n  }'`,
        responseExample: JSON.stringify(
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: "这是生成的纸飞机。" },
                    { inlineData: { mimeType: "image/png", data: "<base64>" } },
                  ],
                },
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/images/gemini/geminirelayv1beta-389846313",
        title: "Gemini 图像（Chat Completions 格式）",
        navTitle: "OpenAI 聊天格式",
        description: "使用 OpenAI Chat Completions 路径调用 Gemini 图片生成能力。",
        format: "OpenAI 聊天格式",
        method: "POST",
        path: "/v1/chat/completions",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "Gemini 图像相关模型 ID" },
          { name: "messages", type: "array", required: true, description: "对话消息" },
          { name: "stream", type: "boolean", description: "是否流式" },
        ],
        requestExample: curlJson("POST", "/v1/chat/completions", {
          model: "gemini-2.0-flash-preview-image-generation",
          messages: [{ role: "user", content: "生成一张极简科技感海报" }],
          stream: false,
        }),
        responseExample: JSON.stringify(
          {
            id: "chatcmpl-xxx",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "已生成图像",
                },
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "videos",
    title: "视频",
    titleEn: "Videos",
    description: "AI 视频生成接口。",
    pages: [
      {
        slug: "ai-model/videos/sora/createvideo",
        title: "创建视频（Sora / OpenAI）",
        navTitle: "创建视频",
        description: "OpenAI 兼容的视频生成接口。提交后返回任务信息，可轮询状态并下载内容。",
        format: "Sora / OpenAI 格式",
        method: "POST",
        path: "/v1/videos",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "视频模型 ID" },
          { name: "prompt", type: "string", required: true, description: "视频描述" },
          { name: "size", type: "string", description: "分辨率，如 1280x720" },
          { name: "seconds", type: "string | integer", description: "时长" },
        ],
        requestExample: curlJson("POST", "/v1/videos", {
          model: "sora-2",
          prompt: "Slow aerial shot over a neon city at dusk",
          seconds: 8,
        }),
        responseExample: JSON.stringify(
          {
            id: "video_xxx",
            object: "video",
            status: "queued",
            model: "sora-2",
            created_at: 1715367049,
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/sora/getvideo",
        title: "获取视频任务状态",
        navTitle: "获取任务状态",
        description: "查询视频任务详细状态。",
        format: "Sora / OpenAI 格式",
        method: "GET",
        path: "/v1/videos/{task_id}",
        headers: [bearer],
        pathParams: [
          { name: "task_id", type: "string", required: true, description: "创建接口返回的任务 ID" },
        ],
        requestExample: `curl "${DOCS_BASE_URL}/v1/videos/video_xxx" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}"`,
        responseExample: JSON.stringify(
          {
            id: "video_xxx",
            status: "completed",
            progress: 100,
            model: "sora-2",
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/sora/getvideocontent",
        title: "获取视频内容",
        navTitle: "获取视频内容",
        description: "获取已完成视频任务的文件内容，返回视频流。",
        format: "Sora / OpenAI 格式",
        method: "GET",
        path: "/v1/videos/{task_id}/content",
        headers: [bearer],
        pathParams: [
          { name: "task_id", type: "string", required: true, description: "已完成的任务 ID" },
        ],
        requestExample: `curl "${DOCS_BASE_URL}/v1/videos/video_xxx/content" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -o output.mp4`,
        responseExample: "（视频二进制流，Content-Type: video/mp4）",
      },
      {
        slug: "ai-model/videos/kling/createklingtext2video",
        title: "Kling 文生视频",
        navTitle: "Kling 文生视频",
        description: "使用 Kling 模型从文本描述生成视频。支持 kling-v1、kling-v1-5 等。",
        format: "可灵格式",
        method: "POST",
        path: "/kling/v1/videos/text2video",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model_name", type: "string", description: "模型名，如 kling-v1-5" },
          { name: "prompt", type: "string", required: true, description: "文本提示" },
          { name: "negative_prompt", type: "string", description: "负向提示" },
          { name: "cfg_scale", type: "number", description: "提示相关性" },
          { name: "mode", type: "string", description: "std / pro 等" },
          { name: "duration", type: "string", description: "时长，如 5、10" },
          { name: "aspect_ratio", type: "string", description: "如 16:9" },
        ],
        requestExample: curlJson("POST", "/kling/v1/videos/text2video", {
          model_name: "kling-v1-5",
          prompt: "一只柴犬在草地上奔跑",
          duration: "5",
          aspect_ratio: "16:9",
        }),
        responseExample: JSON.stringify(
          {
            code: 0,
            data: { task_id: "kling_task_xxx", task_status: "submitted" },
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/kling/createklingimage2video",
        title: "Kling 图生视频",
        navTitle: "Kling 图生视频",
        description: "使用 Kling 从图片生成视频。`image` 支持 URL 或 Base64。",
        format: "可灵格式",
        method: "POST",
        path: "/kling/v1/videos/image2video",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model_name", type: "string", description: "模型名" },
          { name: "image", type: "string", required: true, description: "图片 URL 或 Base64" },
          { name: "prompt", type: "string", description: "运动 / 场景描述" },
          { name: "duration", type: "string", description: "时长" },
          { name: "mode", type: "string", description: "std / pro" },
        ],
        requestExample: curlJson("POST", "/kling/v1/videos/image2video", {
          model_name: "kling-v1-5",
          image: "https://example.com/cat.jpg",
          prompt: "镜头缓慢推进",
          duration: "5",
        }),
        responseExample: JSON.stringify(
          {
            code: 0,
            data: { task_id: "kling_task_yyy", task_status: "submitted" },
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/kling/getklingtext2video",
        title: "查询 Kling 文生视频",
        navTitle: "查询文生视频任务",
        description: "查询 Kling 文生视频任务状态与结果。",
        format: "可灵格式",
        method: "GET",
        path: "/kling/v1/videos/text2video/{task_id}",
        headers: [bearer],
        pathParams: [
          { name: "task_id", type: "string", required: true, description: "任务 ID" },
        ],
        requestExample: `curl "${DOCS_BASE_URL}/kling/v1/videos/text2video/kling_task_xxx" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}"`,
        responseExample: JSON.stringify(
          {
            code: 0,
            data: {
              task_id: "kling_task_xxx",
              task_status: "succeed",
              task_result: { videos: [{ url: "https://cdn.example.com/out.mp4" }] },
            },
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/kling/getklingimage2video",
        title: "查询 Kling 图生视频",
        navTitle: "查询图生视频任务",
        description: "查询 Kling 图生视频任务状态与结果。",
        format: "可灵格式",
        method: "GET",
        path: "/kling/v1/videos/image2video/{task_id}",
        headers: [bearer],
        pathParams: [
          { name: "task_id", type: "string", required: true, description: "任务 ID" },
        ],
        requestExample: `curl "${DOCS_BASE_URL}/kling/v1/videos/image2video/kling_task_yyy" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}"`,
        responseExample: JSON.stringify(
          {
            code: 0,
            data: {
              task_id: "kling_task_yyy",
              task_status: "succeed",
              task_result: { videos: [{ url: "https://cdn.example.com/i2v.mp4" }] },
            },
          },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/jimeng/createjimengvideo",
        title: "即梦视频生成",
        navTitle: "即梦视频生成",
        description:
          "即梦官方 API 格式的视频生成接口。需在查询参数中指定 Action 与 Version。",
        format: "即梦格式",
        method: "POST",
        path: "/jimeng/",
        contentType: "application/json",
        headers: [bearer],
        query: [
          {
            name: "Action",
            type: "string",
            required: true,
            description: "如 CVSync2AsyncSubmitTask",
          },
          { name: "Version", type: "string", required: true, description: "API 版本号" },
        ],
        body: [
          { name: "req_key", type: "string", required: true, description: "能力标识" },
          { name: "prompt", type: "string", description: "文本提示" },
          { name: "binary_data_base64", type: "array", description: "可选图片输入" },
        ],
        requestExample: `curl -X POST "${DOCS_BASE_URL}/jimeng/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"req_key":"jimeng_t2v","prompt":"海边日出延时摄影"}'`,
        responseExample: JSON.stringify(
          { code: 10000, data: { task_id: "jimeng_xxx" }, message: "Success" },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/createvideogeneration",
        title: "创建视频生成任务",
        navTitle: "通用创建任务",
        description: "提交视频生成任务，支持文生视频与图生视频。返回任务 ID，可通过 GET 查询状态。",
        format: "通用视频接口",
        method: "POST",
        path: "/v1/video/generations",
        contentType: "application/json",
        headers: [bearer],
        body: [
          { name: "model", type: "string", required: true, description: "视频模型" },
          { name: "prompt", type: "string", description: "文本提示" },
          { name: "image", type: "string", description: "图生视频时的图片 URL / Base64" },
          { name: "size", type: "string", description: "分辨率" },
          { name: "seconds", type: "integer", description: "时长（秒）" },
        ],
        requestExample: curlJson("POST", "/v1/video/generations", {
          model: "video-gen-1",
          prompt: "雨夜霓虹街道，镜头横移",
          seconds: 5,
        }),
        responseExample: JSON.stringify(
          { id: "task_xxx", status: "queued", model: "video-gen-1" },
          null,
          2,
        ),
      },
      {
        slug: "ai-model/videos/getvideogeneration",
        title: "获取视频生成任务状态",
        navTitle: "通用查询任务",
        description: "查询通用视频生成任务的状态和结果。",
        format: "通用视频接口",
        method: "GET",
        path: "/v1/video/generations/{task_id}",
        headers: [bearer],
        pathParams: [
          { name: "task_id", type: "string", required: true, description: "任务 ID" },
        ],
        requestExample: `curl "${DOCS_BASE_URL}/v1/video/generations/task_xxx" \\\n  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}"`,
        responseExample: JSON.stringify(
          {
            id: "task_xxx",
            status: "succeeded",
            result: { url: "https://cdn.example.com/video.mp4" },
          },
          null,
          2,
        ),
      },
    ],
  },
];

export const allApiPages: ApiDocPage[] = apiCategories.flatMap((c) => c.pages);

export function getApiPage(slugParts: string[]): ApiDocPage | undefined {
  const slug = slugParts.join("/");
  return allApiPages.find((p) => p.slug === slug);
}

export function getAdjacentPages(slug: string): {
  prev?: ApiDocPage;
  next?: ApiDocPage;
} {
  const idx = allApiPages.findIndex((p) => p.slug === slug);
  if (idx < 0) return {};
  return {
    prev: idx > 0 ? allApiPages[idx - 1] : undefined,
    next: idx < allApiPages.length - 1 ? allApiPages[idx + 1] : undefined,
  };
}

export function categoryForSlug(slug: string): ApiDocCategory | undefined {
  return apiCategories.find((c) => c.pages.some((p) => p.slug === slug));
}
