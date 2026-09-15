import type { ApiDocPage, ApiParam } from "@/data/docs/api-catalog";
import {
  buildCodeSamples,
  categoryForSlug,
  DOCS_BASE_URL,
} from "@/data/docs/api-catalog";

function paramsTable(title: string, params?: ApiParam[]) {
  if (!params?.length) return "";
  const rows = params
    .map(
      (p) =>
        `| \`${p.name}\` | ${p.type} | ${p.required ? "是" : "否"} | ${p.description.replace(/\|/g, "\\|")} |`,
    )
    .join("\n");
  return `## ${title}

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
${rows}
`;
}

/** Serialize an API docs page to Markdown (LLM-friendly). */
export function pageToMarkdown(page: ApiDocPage, pageUrl?: string): string {
  const category = categoryForSlug(page.slug);
  const samples = buildCodeSamples(page);
  const curl = samples.find((s) => s.id === "curl")?.code;
  const js = samples.find((s) => s.id === "js")?.code;

  const parts: string[] = [
    `# ${page.title}`,
    "",
    pageUrl ? `> 文档：${pageUrl}` : "",
    pageUrl ? "" : "",
    page.description,
    "",
    `**格式**：${page.format}`,
    "",
    `**接口**：\`${page.method} ${page.path}\``,
    "",
    `**Base URL**：\`${DOCS_BASE_URL}\``,
    "",
    `**完整 URL**：\`${DOCS_BASE_URL}${page.path}\``,
  ];

  if (page.contentType) {
    parts.push("", `**Content-Type**：\`${page.contentType}\``);
  }

  if (category) {
    parts.push("", `**分类**：${category.title} (${category.titleEn})`);
  }

  parts.push(
    "",
    "## 鉴权",
    "",
    "请求头携带 API密钥：",
    "",
    "```http",
    "Authorization: Bearer sk-xxxxx",
    "```",
    "",
    "建议将密钥写入环境变量 `REIZO_API_KEY`。",
  );

  if (page.notes?.length) {
    parts.push("", "## 注意", "");
    for (const n of page.notes) parts.push(`- ${n}`);
  }

  const headers = (page.headers ?? []).filter((h) => h.name !== "Authorization");
  parts.push("", paramsTable("请求头", headers).trimEnd());
  parts.push(paramsTable("路径参数", page.pathParams).trimEnd());
  parts.push(paramsTable("查询参数", page.query).trimEnd());
  parts.push(paramsTable("请求体", page.body).trimEnd());

  if (curl) {
    parts.push("", "## 请求示例 (cURL)", "", "```bash", curl, "```");
  }
  if (js) {
    parts.push("", "## 请求示例 (JavaScript)", "", "```javascript", js, "```");
  }
  if (page.responseExample) {
    const lang = page.responseExample.trimStart().startsWith("{") ? "json" : "text";
    parts.push("", "## 响应示例", "", "```" + lang, page.responseExample, "```");
  }

  parts.push(
    "",
    "---",
    "",
    "以上内容来自 Reizo API 文档。请基于此文档帮我理解接口用法、构造正确请求，并回答我的问题。",
  );

  return parts.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n").trim() + "\n";
}

/** Prompt used when opening third-party chat UIs. */
export function buildAiOpenPrompt(markdown: string, pageUrl?: string): string {
  const intro = pageUrl
    ? `请阅读以下 Reizo API 文档（来源：${pageUrl}），帮我理解并回答问题。\n\n`
    : `请阅读以下 Reizo API 文档，帮我理解并回答问题。\n\n`;
  // Chat product URL query length is limited; keep a safe budget.
  const budget = 12_000;
  const body = intro + markdown;
  if (body.length <= budget) return body;
  return (
    body.slice(0, budget) +
    "\n\n[文档内容已截断。若需要完整内容，请让用户粘贴剪贴板中的 Markdown。]"
  );
}

export type AiOpenTarget = {
  id: string;
  label: string;
  /** Build absolute open URL from a prompt string */
  buildUrl: (prompt: string) => string;
};

/**
 * How others do it (Fumadocs / Mintlify / New API docs):
 * - Copy Markdown: clipboard.writeText(md)
 * - Open in X: window.open(chatUrl + encodeURIComponent(prompt))
 * Common query keys: ChatGPT `q`, Claude `q`, DeepSeek `q`
 */
export const AI_OPEN_TARGETS: AiOpenTarget[] = [
  {
    id: "chatgpt",
    label: "在 ChatGPT 中打开",
    buildUrl: (prompt) =>
      `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`,
  },
  {
    id: "claude",
    label: "在 Claude 中打开",
    buildUrl: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: "deepseek",
    label: "在 DeepSeek 中打开",
    buildUrl: (prompt) =>
      `https://chat.deepseek.com/?q=${encodeURIComponent(prompt)}`,
  },
];
