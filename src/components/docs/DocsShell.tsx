"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ChevronRight,
  Code2,
  KeyRound,
  Menu,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import PortalHeader from "@/components/PortalHeader";
import { apiCategories } from "@/data/docs/api-catalog";
import { usePortalCanvasScale } from "@/components/usePortalCanvasScale";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DocsShell({ children }: { children: ReactNode }) {
  usePortalCanvasScale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const cat of apiCategories) {
      init[cat.id] = cat.pages.some((p) => pathname.includes(`/docs/api/${p.slug}`));
    }
    if (!Object.values(init).some(Boolean)) init.models = true;
    return init;
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apiCategories;
    return apiCategories
      .map((cat) => ({
        ...cat,
        pages: cat.pages.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.navTitle.toLowerCase().includes(q) ||
            p.path.toLowerCase().includes(q) ||
            p.method.toLowerCase().includes(q) ||
            cat.title.includes(q) ||
            cat.titleEn.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.pages.length > 0);
  }, [query]);

  const sideNav = (
    <nav className="docs-side-nav" aria-label="文档导航">
      <div className="docs-search">
        <Search aria-hidden />
        <input
          type="search"
          placeholder="搜索接口 / 路径"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索文档"
        />
      </div>

      <div className="docs-side-group">
        <p className="docs-side-label">文档</p>
        <Link
          href="/docs"
          className={
            pathname === "/docs" || pathname === "/docs/api"
              ? "is-active docs-side-link"
              : "docs-side-link"
          }
          onClick={() => setOpen(false)}
        >
          <BookOpen aria-hidden className="docs-side-ico" />
          快速开始
        </Link>
        <Link href="/docs/api" className={pathname === "/docs/api" ? "is-active docs-side-link" : "docs-side-link"} onClick={() => setOpen(false)}><Code2 aria-hidden className="docs-side-ico" />API 参考</Link>
        <Link href="/account/keys" className="docs-side-link" onClick={() => setOpen(false)}>
          <KeyRound aria-hidden className="docs-side-ico" />
          API密钥
        </Link>
      </div>

      <div className="docs-side-group">
        <p className="docs-side-label">AI 模型接口</p>
        {(query.trim() ? filtered : apiCategories).map((cat) => {
          const isOpen = query.trim() ? true : (expanded[cat.id] ?? false);
          return (
            <div key={cat.id} className="docs-side-cat">
              <button
                type="button"
                className="docs-side-cat-toggle"
                aria-expanded={isOpen}
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))
                }
              >
                <span>
                  {cat.title}
                  <em>({cat.titleEn})</em>
                </span>
                <ChevronRight aria-hidden className={isOpen ? "is-open" : undefined} />
              </button>
              {isOpen ? (
                <div className="docs-side-pages">
                  {cat.pages.map((page) => {
                    const href = `/docs/api/${page.slug}`;
                    const active = isActive(pathname, href);
                    return (
                      <Link
                        key={page.slug}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={active ? "is-active" : undefined}
                        onClick={() => setOpen(false)}
                      >
                        <span className="docs-side-page-title">{page.navTitle}</span>
                        <span
                          className={`docs-method docs-method-${page.method.toLowerCase()}`}
                        >
                          {page.method}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="portal-home docs-root portal-density-shell">
      <div className="portal-frame docs-frame">
        <PortalHeader />

        {/* 仅移动端：打开侧栏；桌面不显示二级条，避免与主导航粘连 */}
        <div className="docs-shell-bar">
          <button
            type="button"
            className="docs-menu-btn"
            aria-label={open ? "关闭导航" : "打开目录"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
            <span>目录</span>
          </button>
          <Link href="/account/keys" className="docs-shell-bar-link">
            <KeyRound aria-hidden />
            API密钥
          </Link>
        </div>

        <div className="docs-body">
          <aside className={`docs-sidebar ${open ? "is-open" : ""}`}>{sideNav}</aside>
          {open ? (
            <button
              type="button"
              className="docs-backdrop"
              aria-label="关闭导航"
              onClick={() => setOpen(false)}
            />
          ) : null}
          <main className="docs-main">{children}</main>
        </div>
      </div>
    </div>
  );
}
