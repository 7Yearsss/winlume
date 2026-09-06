import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Homepage API categories are static brand rows (302-style).
 * We assert the source defines the expected category labels without exporting internals.
 */
describe("homepage API categories", () => {
  const source = readFileSync(join(__dirname, "ModelMarket.tsx"), "utf8");

  it("lists marketplace-style categories and no popular-models block", () => {
    for (const label of [
      "语言推理",
      "图像处理",
      "音频处理",
      "视频处理",
      "RAG知识库",
      "信息检索",
    ]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).not.toContain("常用模型");
    expect(source).not.toContain("popularModels");
  });

  it("renders brand chips without 通用接口 and exposes the supplier flyout", () => {
    expect(source).toContain("portal-api-brands");
    expect(source).toContain("portal-api-brand");
    expect(source).toContain('apiProvider("OpenAI"');
    expect(source).toContain('apiProvider("Anthropic"');
    expect(source).toContain('apiProvider("Jina AI"');
    expect(source).not.toMatch(/label:\s*"通用接口"/);
    expect(source).toContain("portal-api-touch-card");
  });

  it("keeps API billing and the all-models link together on the right side of the card header", () => {
    expect(source).toContain('<div className="portal-api-card-actions"><span className="portal-api-billing-badge">按量计费</span><ArrowLink href="/products?cate=api">查看全部API模型</ArrowLink></div>');
  });

  it("opens content destinations in a new tab while keeping primary navigation in place", () => {
    expect(source).toContain('target = "_blank"');
    expect(source).toContain('rel={target === "_blank" ? "noopener noreferrer" : undefined}');
    expect(source).toContain("<PortalHeader");
    expect(source).not.toContain('className="portal-nav"');
  });

  it("includes the first-visit three-step product guide", () => {
    expect(source).toContain("PORTAL_ONBOARDING_STORAGE_KEY");
    expect(source).toContain("Agent 智能工作台");
    expect(source).toContain("API 模型中心");
    expect(source).toContain("AI应用工具与Skills技能");
    expect(source).toContain("portal-onboarding-card");
    expect(source).toContain("data-onboarding-target=\"agent\"");
    expect(source).toContain("data-onboarding-target=\"api\"");
    expect(source).toContain("data-onboarding-target=\"tools\"");
  });

  it("uses a spotlight target and routed SVG connector for the guide", () => {
    expect(source).toContain('type OnboardingPlacementMode = "below" | "above" | "side" | "spotlight"');
    expect(source).toContain("portal-onboarding-highlight");
    expect(source).toContain("portal-onboarding-connector");
    expect(source).toContain('markerEnd="url(#portal-onboarding-arrow)"');
    expect(source).toContain("onboardingPlacement?.connectorPath");
  });

  it("uses result previews and workflow evidence instead of icon-only showcase covers", () => {
    expect(source).toContain("ApplicationResultPreview");
    expect(source).toContain('preview: "storyboard"');
    expect(source).toContain('preview: "extract"');
    expect(source).toContain("CapabilityEvidence");
    expect(source).toContain('evidence: "agent"');
    expect(source).toContain('evidence: "usage"');
  });

  it("elevates one featured output and presents Reizo capabilities as product surfaces", () => {
    expect(source).toContain("portal-featured-app-grid");
    expect(source).toContain("portal-featured-app-card");
    expect(source).toContain("portal-app-support-grid");
    expect(source).toContain("portal-capability-showcase");
    expect(source).toContain("portal-capability-hero");
  });

  it("keeps showcase cards image-only while preserving accessible link names", () => {
    expect(source).not.toContain('className="portal-featured-app-copy"');
    expect(source).not.toContain('className="portal-capability-copy"');
    expect(source).not.toContain("<span><strong>{app.title}</strong><small>{applicationDetail(app.title)}</small></span>");
    expect(source).toContain('aria-label={app.title}');
    expect(source).toContain('aria-label={card.title}');
  });

  it("keeps the capability cards but removes the redundant exploration and demand prompt", () => {
    expect(source).not.toContain("探索更多 REIZO 能力");
    expect(source).not.toContain("没有找到合适的应用或技能");
    expect(source).not.toContain("提交需求");
  });

  it("keeps homepage labels concise and moves platform scale into the tools header", () => {
    expect(source).not.toContain('className="portal-search-kicker"');
    expect(source).not.toContain("<p>APPLICATIONS</p>");
    expect(source).not.toContain("<p>MORE WITH REIZO</p>");
    expect(source).toContain('className="portal-tools-proof"');
  });

  it("routes support footer links to dedicated destinations", () => {
    expect(source).toContain('{ label: "常见问题", href: "/support/faq" }');
    expect(source).toContain('{ label: "联系支持", href: "/support/contact" }');
    expect(source).toContain('{ label: "商务合作", href: "/business" }');
  });

  it("routes homepage quick tools to their application categories", () => {
    expect(source).toContain('{ label: "产品图生成", icon: FileImage, category: "视觉与媒体" }');
    expect(source).toContain('{ label: "PPT 生成", icon: Presentation, category: "办公与管理" }');
    expect(source).toContain('{ label: "财务分析", icon: BarChart3, category: "财务与法务" }');
    expect(source).toContain("/products?cate=app&category=${encodeURIComponent(category)}");
  });
});

