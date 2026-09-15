import type { PortalToolCategory } from "./application-directory-skills";
import { PORTAL_IMAGE_MAX_DATA_URL_LENGTH } from "./content-limits";

export type ApplicationTool = {
  id: string;
  name: string;
  category: PortalToolCategory;
  description: string;
  imageUrl: string;
};
export type ToolPresentation = { id: string; imageUrl: string; featured: boolean; enabled: boolean };
export const toolCategoryDescriptions: Record<PortalToolCategory, string> = {
  "内容与营销": "用 AI 提升内容创作与营销效率",
  "视觉与媒体": "从视觉创意到图像与视频表达",
  "电商与销售": "让商品表达更清晰，让客户沟通更高效",
  "财务与法务": "梳理财务信息，辅助合同与条款审阅",
  "产品与研发": "将产品想法整理成可执行的研发任务",
  "办公与管理": "高效整理文档、会议与团队工作",
  "数据与科研": "整理数据与资料，发现值得深入的线索",
  "开发与代码": "辅助代码审阅、测试与技术文档编写",
};

const rows: Array<[string, string, PortalToolCategory, string]> = [
  ["copywriting", "文案助手", "内容与营销", "生成营销文案、产品介绍、邮件与社媒内容"],
  ["seo", "SEO 内容生成", "内容与营销", "基于关键词生成 SEO 友好的文章、图文和标题"],
  ["social", "社媒文案生成", "内容与营销", "为小红书、微博、公众号等创作社媒文案"],
  ["poster", "宣传海报设计", "视觉与媒体", "生成宣传海报、活动视觉与设计方案"],
  ["image-edit", "图片编辑", "视觉与媒体", "图片抠图、消除、换色、合成与风格转换"],
  ["video-script", "短视频脚本生成", "视觉与媒体", "生成短视频脚本、分镜头与拍摄建议"],
  ["video-edit", "视频剪辑助手", "视觉与媒体", "整理剪辑方案、字幕与镜头节奏建议"],
  ["product-title", "商品标题优化", "电商与销售", "输出商品标题、核心卖点与详情页结构"],
  ["audience", "用户画像生成", "电商与销售", "根据提供的数据整理用户画像与行动建议"],
  ["sales-reply", "销售话术助手", "电商与销售", "围绕客户需求生成沟通话术与跟进邮件"],
  ["contract", "合同风险识别", "财务与法务", "辅助识别合同条款风险并生成审阅建议"],
  ["finance", "财务报表分析", "财务与法务", "整理财务指标、报表变化与待核实事项"],
  ["expense", "费用归类助手", "财务与法务", "归类费用明细，整理报销与核对清单"],
  ["prd", "PRD 生成", "产品与研发", "从需求描述生成结构化产品需求文档"],
  ["user-story", "用户故事拆解", "产品与研发", "拆解用户需求，整理验收标准与任务清单"],
  ["test-plan", "测试方案生成", "产品与研发", "根据需求编写测试场景、步骤与预期结果"],
  ["presentation", "PPT 排版优化", "办公与管理", "整理演示大纲、页面结构与排版建议"],
  ["meeting", "会议纪要整理", "办公与管理", "从会议记录提炼结论、待办与负责人"],
  ["weekly-report", "工作周报生成", "办公与管理", "将工作记录整理为进展、问题与下周计划"],
  ["data-clean", "数据清洗", "数据与科研", "处理表格、字段与异常数据，输出分析建议"],
  ["research", "竞品分析", "数据与科研", "整理竞品信息、功能差异与市场报告"],
  ["literature", "文献要点提炼", "数据与科研", "从提供的文献提取研究问题、方法与结论"],
  ["code-review", "代码审阅", "开发与代码", "发现潜在问题并给出可执行的修复建议"],
  ["unit-test", "单元测试生成", "开发与代码", "根据代码生成测试用例与边界场景"],
  ["api-docs", "API 文档生成", "开发与代码", "整理接口参数、响应示例与调用说明"],
];
export const applicationTools: ApplicationTool[] = rows.map(([id, name, category, description]) => ({
  id, name, category, description, imageUrl: `/tool-covers/${id}.webp`,
}));
export const defaultToolPresentation: ToolPresentation[] = applicationTools.map((tool) => ({
  id: tool.id, imageUrl: tool.imageUrl, featured: tool.id !== "video-edit", enabled: true,
}));

function validImage(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const url = value.trim();
  if (url.length > PORTAL_IMAGE_MAX_DATA_URL_LENGTH) return fallback;
  return /^(?:\/(?!\/)|https?:\/\/|data:image\/(?:png|jpeg|jpg|webp|gif);base64,)/i.test(url) ? url : fallback;
}

/** Known tools retain their identity; old records automatically receive new defaults. */
export function normalizeToolPresentation(input: unknown): ToolPresentation[] {
  const defaults = new Map(defaultToolPresentation.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const result: ToolPresentation[] = [];
  for (const value of Array.isArray(input) ? input.slice(0, 100) : []) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const base = typeof row.id === "string" ? defaults.get(row.id) : undefined;
    if (!base || seen.has(base.id)) continue;
    seen.add(base.id);
    result.push({ ...base, imageUrl: validImage(row.imageUrl, base.imageUrl), featured: typeof row.featured === "boolean" ? row.featured : base.featured, enabled: row.enabled !== false });
  }
  return [...result, ...defaultToolPresentation.filter((item) => !seen.has(item.id))];
}

export function resolveApplicationTools(presentation: ToolPresentation[] = defaultToolPresentation) {
  const catalog = new Map(applicationTools.map((tool) => [tool.id, tool]));
  return presentation.flatMap((item) => {
    const tool = catalog.get(item.id);
    return tool && item.enabled ? [{ ...tool, ...item }] : [];
  });
}

export function representativeTools<T extends { featured: boolean }>(tools: T[]): T[] {
  return [...tools.filter((tool) => tool.featured), ...tools.filter((tool) => !tool.featured)].slice(0, 3);
}

export function applicationToolHref(tool: Pick<ApplicationTool, "name">) {
  return `/studio?${new URLSearchParams({ entry: "application-catalog", tool: tool.name })}`;
}
