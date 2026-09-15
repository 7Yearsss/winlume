"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { applicationTools, defaultToolPresentation, resolveApplicationTools, representativeTools, applicationToolHref, toolCategoryDescriptions, type ApplicationTool, type ToolPresentation } from "@/lib/portal/application-tools";
import styles from "./application-directory.module.css";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, BarChart3, BriefcaseBusiness, ChevronRight, Code2, FileText, ImageIcon,
  GraduationCap, LayoutGrid, Megaphone, Presentation, Search, ShoppingCart, Sparkles, Video, X,
} from "lucide-react";
import Modal, { ModalCloseButton } from "./Modal";
import { catalogAccentStyle, skillMonogram } from "@/lib/studio/skill-mark";
import type { SkillMeta } from "@/lib/agent/types";
import {
  applicationCatalogSkillHref,
  portalCategoryFromSkill,
  portalSkillCountsFromCatalogs,
  portalSkillsHref,
  skillsForPortalCategory,
  type PortalToolCategory,
} from "@/lib/portal/application-directory-skills";
import { getStudioToolCategory, skillDepartmentToToolCategory } from "@/lib/studio/tool-categories";

type ToolCategory = PortalToolCategory;

const toolIcons: Record<string, typeof FileText> = { copywriting: FileText, seo: Search, social: Megaphone, poster: ImageIcon, "image-edit": Sparkles, "video-script": Video, "video-edit": Video, "code-review": Code2, "unit-test": Code2, "api-docs": Code2 };
const tools = applicationTools.map((tool) => ({ ...tool, icon: toolIcons[tool.id] ?? ({ "内容与营销": FileText, "视觉与媒体": ImageIcon, "电商与销售": ShoppingCart, "财务与法务": BriefcaseBusiness, "产品与研发": Sparkles, "办公与管理": Presentation, "数据与科研": BarChart3, "开发与代码": Code2 }[tool.category]), accent: "blue" }));

const categories: Array<{ name: ToolCategory; icon: typeof FileText }> = [
  { name: "内容与营销", icon: FileText },
  { name: "视觉与媒体", icon: ImageIcon },
  { name: "电商与销售", icon: ShoppingCart },
  { name: "财务与法务", icon: BriefcaseBusiness },
  { name: "产品与研发", icon: Sparkles },
  { name: "办公与管理", icon: Presentation },
  { name: "数据与科研", icon: BarChart3 },
  { name: "开发与代码", icon: Code2 },
];

export default function ApplicationDirectory({ initialQuery = "", initialCategory }: { initialQuery?: string; initialCategory?: string }) {
  const router = useRouter();
  const categoryParam = initialCategory as ToolCategory | undefined;
  const resolvedCategory = categoryParam && categories.some((category) => category.name === categoryParam) ? categoryParam : "全部应用";
  const [activeCategory, setActiveCategory] = useState<ToolCategory | "全部应用">(resolvedCategory);
  const [query, setQuery] = useState(initialQuery);
  const [recommendationOpen, setRecommendationOpen] = useState(false);
  const [recommendationCategory, setRecommendationCategory] = useState<ToolCategory | null>(null);
  const [catalogSkills, setCatalogSkills] = useState<SkillMeta[]>([]);
  const [catalogCounts, setCatalogCounts] = useState<Record<ToolCategory, number> | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [presentation, setPresentation] = useState<ToolPresentation[]>(defaultToolPresentation);
  const [moreCategory, setMoreCategory] = useState<ToolCategory | null>(null);
  const [moreQuery, setMoreQuery] = useState("");
  const enabledTools = useMemo(() => resolveApplicationTools(presentation).map((tool) => ({ ...tool, icon: tools.find((item) => item.id === tool.id)!.icon, accent: "blue" })), [presentation]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/portal/content", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((content: { toolDirectory?: ToolPresentation[] } | null) => {
        if (!controller.signal.aborted && content?.toolDirectory) setPresentation(content.toolDirectory);
      }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { skills?: SkillMeta[]; catalogs?: Array<{ id: string; count: number }> } | null) => {
        if (cancelled) return;
        setCatalogSkills(payload?.skills ?? []);
        setCatalogCounts(portalSkillCountsFromCatalogs(payload?.catalogs ?? []));
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogSkills([]);
          setCatalogCounts(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase();
    const filtered = enabledTools.filter((tool) =>
      (activeCategory === "全部应用" || tool.category === activeCategory) &&
      (!value || `${tool.name}${tool.category}${tool.description}`.toLowerCase().includes(value)),
    );
    return filtered;
  }, [activeCategory, query, enabledTools]);

  const selectCategory = (category: ToolCategory | "全部应用") => {
    setActiveCategory(category);
    setMoreCategory(null);
    const params = new URLSearchParams(window.location.search);
    params.set("cate", "app");
    if (category === "全部应用") params.delete("category");
    else params.set("category", category);
    router.replace(`/products?${params.toString()}`, { scroll: false });
  };

  const openRecommendation = () => {
    setRecommendationCategory(null);
    setRecommendationOpen(true);
  };

  const recommendationTools = recommendationCategory
    ? enabledTools.filter((tool) => tool.category === recommendationCategory)
    : [];

  return (
    <>
      <section className={`portal-directory-layout ${styles.directory}`} aria-label="应用工具目录">
      <aside className="portal-directory-side">
        <h2>工具分类</h2>
        <button
          className={`portal-directory-all${activeCategory === "全部应用" ? " is-active" : ""}`}
          type="button"
          onClick={() => selectCategory("全部应用")}
        >
          全部应用
          <ChevronRight aria-hidden />
        </button>
        {categories.map((category) => {
          const Icon = category.icon;
          const active = activeCategory === category.name;
          return (
            <button
              key={category.name}
              type="button"
              className="portal-directory-model-row"
              data-active={active || undefined}
              onClick={() => selectCategory(category.name)}
            >
              <Icon aria-hidden />
              <span>
                <strong>{category.name}</strong>
                <small>应用 {enabledTools.filter((tool) => tool.category === category.name).length} · Skills {catalogCounts?.[category.name] ?? (skillsLoading ? "…" : 0)}</small>
              </span>
              <ChevronRight aria-hidden />
            </button>
          );
        })}
        <div className="app-directory-help">
          <strong>不会选工具？</strong>
          <button type="button" onClick={openRecommendation}>智能推荐工具 <ChevronRight aria-hidden /></button>
        </div>
      </aside>

      <div className="portal-directory-main">
        <section className="portal-catalog-hero">
          <div className="portal-catalog-title-row">
            <div>
              <h1>{activeCategory === "全部应用" ? "应用工具" : activeCategory}</h1>
            </div>
            <div className="portal-catalog-hero-links">
              <Link href="/studio/skills">Skills 技能</Link>
              <Link href="/studio" target="_blank" rel="noopener noreferrer">进入Agent工作台</Link>
            </div>
          </div>
          <form className="portal-catalog-search" onSubmit={(event) => event.preventDefault()}>
            <Search aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索应用"
              placeholder="搜索工具名称、关键词或使用场景"
            />
            {query ? (
              <button type="button" className="portal-catalog-clear" onClick={() => setQuery("")} aria-label="清除搜索">
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <button type="submit">
              <Search aria-hidden />
              搜索
            </button>
          </form>
        </section>

        {categories.filter((category) => activeCategory === "全部应用" || category.name === activeCategory).map((category) => {
          const matched = visible.filter((tool) => tool.category === category.name);
          if (!matched.length) return null;
          const shown = query.trim() ? matched : representativeTools(matched);
          return (
            <section className={styles.toolsPanel} key={category.name} aria-label={`${category.name}应用工具`}>
              <div className={styles.sectionHead}>
                <div className={styles.sectionTitle}><span className={styles.sectionIcon}><LayoutGrid aria-hidden /></span><h2>{activeCategory === "全部应用" ? category.name : "应用工具"}</h2><p>{toolCategoryDescriptions[category.name]}</p></div>
                <button type="button" className={styles.moreLink} onClick={() => { setMoreCategory(category.name); setMoreQuery(""); }}>更多工具<ChevronRight aria-hidden /></button>
              </div>
              <div className={styles.toolGrid}>{shown.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
            </section>
          );
        })}
        {visible.length === 0 ? <div className="app-directory-empty">没有匹配的应用工具，试试搜索其他任务或切换分类。</div> : null}

        <SkillStrip category={activeCategory} skills={catalogSkills} loading={skillsLoading} query={query} />
      </div>
      </section>

      <Modal open={moreCategory !== null} onClose={() => setMoreCategory(null)} label={`${moreCategory ?? ""} · 全部工具`} size="onboarding">
        <div className={styles.moreDialog}>
          <header className={styles.sectionHead}><div><h2>{moreCategory} · 全部工具</h2><p>选择一个任务，进入 Agent工作台继续完成。</p></div><ModalCloseButton onClose={() => setMoreCategory(null)} /></header>
          <label className={styles.moreSearch}><Search aria-hidden /><input aria-label="搜索更多工具" placeholder="搜索工具名称或用途" value={moreQuery} onChange={(event) => setMoreQuery(event.target.value)} /></label>
          <div className={styles.toolGrid}>{enabledTools.filter((tool) => tool.category === moreCategory && `${tool.name}${tool.description}`.toLowerCase().includes(moreQuery.trim().toLowerCase())).map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
          {!enabledTools.some((tool) => tool.category === moreCategory && `${tool.name}${tool.description}`.toLowerCase().includes(moreQuery.trim().toLowerCase())) ? <p className="app-directory-empty">没有匹配的工具，试试其他关键词。</p> : null}
        </div>
      </Modal>

      <Modal
        open={recommendationOpen}
        onClose={() => setRecommendationOpen(false)}
        label="智能推荐工具"
        size="onboarding"
      >
        <div className="app-recommendation-dialog">
          <header className="app-recommendation-head">
            <div>
              <span><Sparkles aria-hidden /> 智能推荐</span>
              <h2>帮你找到合适的工具</h2>
              <p>{recommendationCategory ? "根据你的场景，为你推荐可直接使用的工具。" : "先选择你要完成的事情，我们会为你缩小选择范围。"}</p>
            </div>
            <ModalCloseButton onClose={() => setRecommendationOpen(false)} />
          </header>

          {recommendationCategory ? (
            <div className="app-recommendation-results">
              <button
                type="button"
                className="app-recommendation-back"
                onClick={() => setRecommendationCategory(null)}
              >
                <ArrowLeft aria-hidden /> 重新选择场景
              </button>
              <div className="app-recommendation-context">
                <span className="app-recommendation-context-icon"><CategoryIcon category={recommendationCategory} /></span>
                <div>
                  <strong>{recommendationCategory}</strong>
                  <small>{recommendationTools.length} 个推荐工具</small>
                </div>
              </div>
              <div className="app-recommendation-tool-grid">
                {recommendationTools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <Link
                      key={tool.name}
                      className={`app-recommendation-tool is-${tool.accent}`}
                      href={`/studio?entry=application-catalog&tool=${encodeURIComponent(tool.name)}`}
                      onClick={() => setRecommendationOpen(false)}
                    >
                      <span className="app-recommendation-tool-icon"><Icon aria-hidden /></span>
                      <div>
                        <h3>{tool.name}</h3>
                        <p>{tool.description}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="app-recommendation-categories">
              <div className="app-recommendation-category-grid">
                {categories.map((category) => {
                  const Icon = category.icon;
                  return (
                    <button
                      key={category.name}
                      type="button"
                      className="app-recommendation-category"
                      onClick={() => setRecommendationCategory(category.name)}
                    >
                      <span className="app-recommendation-category-icon"><Icon aria-hidden /></span>
                      <span className="app-recommendation-category-copy">
                        <strong>{category.name}</strong>
                        <small>{enabledTools.filter((tool) => tool.category === category.name).length} 个应用 · {catalogCounts?.[category.name] ?? (skillsLoading ? "…" : 0)} 项技能</small>
                      </span>
                      <ChevronRight aria-hidden />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function SkillMark({ name, iconUrl }: { name: string; iconUrl?: string }) {
  const [brokenUrl, setBrokenUrl] = useState<string | undefined>();
  const showImage = Boolean(iconUrl) && brokenUrl !== iconUrl;
  return (
    <span className="studio-catalog-mark" data-logo={showImage ? "true" : "false"} aria-hidden>
      {showImage ? (
        // SkillHub icons are hosted on mixed CDNs, so use a native image like the workbench.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" referrerPolicy="no-referrer" onError={() => setBrokenUrl(iconUrl)} />
      ) : skillMonogram(name)}
    </span>
  );
}

function SkillStrip({
  category,
  skills,
  loading,
  query,
}: {
  category: ToolCategory | "全部应用";
  skills: SkillMeta[];
  loading: boolean;
  query: string;
}) {
  const visible = useMemo(() => {
    const value = query.trim().toLowerCase();
    const matched = value
      ? skills.filter((skill) => `${skill.name}${skill.description}`.toLowerCase().includes(value))
      : skills;
    return skillsForPortalCategory(matched, category);
  }, [category, query, skills]);

  const compactDescription = (value: string) => {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 60 ? `${Array.from(compact).slice(0, 60).join("")}...` : compact;
  };

  return (
    <section className={`app-skill-strip ${styles.skillsPanel}`} aria-labelledby="app-skill-strip-title">
      <div className="app-skill-strip-head">
        <div className={styles.sectionTitle}><span className={styles.sectionIcon}><GraduationCap aria-hidden /></span><h2 id="app-skill-strip-title">技能</h2><p>可复用的专业能力，快速挂到工作台使用</p></div>
        <div className="app-skill-strip-actions">
          <Link href={portalSkillsHref(category)}>查看全部<ChevronRight aria-hidden /></Link>
        </div>
      </div>
      {loading && visible.length === 0 ? (
        <div className="studio-catalog-grid app-directory-skill-grid" aria-busy="true" aria-label="正在加载技能">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="studio-catalog-card studio-catalog-card-skeleton" aria-hidden>
              <div className="flex items-start gap-3">
                <span className="studio-catalog-mark" />
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <span className="block h-3.5 w-2/3 rounded-md bg-ink-300/25" />
                  <span className="block h-2.5 w-14 rounded-md bg-ink-300/20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="app-directory-empty">该分类暂无技能。</div>
      ) : (
        <div className="studio-catalog-grid app-directory-skill-grid" aria-label="Skills 技能列表">
          {visible.map((skill) => {
            const tag = getStudioToolCategory(skillDepartmentToToolCategory(skill.category));
            const description = skill.description || "面向实际工作场景的可复用技能，点击即可挂到工作台。";
            return (
              <Link
                key={skill.id}
                className="studio-catalog-card"
                style={catalogAccentStyle(tag?.accent ?? "#64748b")}
                href={applicationCatalogSkillHref(skill)}
              >
                <div className="flex items-start gap-3">
                  <SkillMark name={skill.name} iconUrl={skill.iconUrl} />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-5 tracking-tight text-ink-900">{skill.name}</h3>
                    {category === "全部应用" ? (
                      <span className="mt-1 inline-block text-[11px] leading-4 text-ink-400">
                        {portalCategoryFromSkill(skill)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-ink-500">{compactDescription(description)}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[13px] font-medium text-ink-700">
                  挂到工作台
                  <ArrowRight className="studio-catalog-card-go h-3.5 w-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ToolCard({ tool }: { tool: ApplicationTool & { icon: typeof FileText } }) {
  const Icon = tool.icon;
  const [broken, setBroken] = useState<string | null>(null);
  const fallback = applicationTools.find((item) => item.id === tool.id)?.imageUrl;
  const imageUrl = broken === tool.imageUrl ? fallback : tool.imageUrl;
  return (
    <Link className={styles.toolCard} href={applicationToolHref(tool)} target="_blank" rel="noopener noreferrer" aria-label={`立即使用${tool.name}`}>
      {imageUrl ? <Image className={styles.cover} src={imageUrl} alt="" fill sizes="(max-width: 760px) 100vw, 33vw" unoptimized onError={() => setBroken(tool.imageUrl)} /> : null}
      <span className={styles.imageVeil} aria-hidden />
      <div className={styles.toolCopy}>
        <span className={styles.toolBadge}>工具</span>
        <span className={styles.toolIcon}><Icon aria-hidden /></span>
        <h3>{tool.name}</h3>
        <p>{tool.description}</p>
        <span className={styles.toolAction}>立即使用<ArrowRight aria-hidden /></span>
      </div>
    </Link>
  );
}

function CategoryIcon({ category }: { category: ToolCategory }) {
  const Icon = categories.find((item) => item.name === category)?.icon ?? Sparkles;
  return <Icon aria-hidden />;
}
