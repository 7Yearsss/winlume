"use client";

import AnnouncementBar from "@/components/AnnouncementBar";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import MarketingDensityShell from "@/components/MarketingDensityShell";
import PortalHeader from "@/components/PortalHeader";
import { usePortalCanvasScale } from "@/components/usePortalCanvasScale";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Marketing chrome only — Studio routes use a separate layout without header/footer. */
export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const isSupportPage = pathname.startsWith("/support");
  usePortalCanvasScale(".portal-support-density-shell > .portal-frame");

  return (
    <MarketingDensityShell disableScale={isSupportPage}>
      {isSupportPage ? (
        <div className="portal-home portal-support-density-shell">
          <div className="portal-frame">
            <PortalHeader />
            <main className="portal-support-marketing-main">{children}</main>
            <footer className="portal-bottom-footer portal-support-footer">
              <div className="portal-bottom-brand">
                <strong><Image className="portal-footer-mark" src="/brand/reizo-mark.png" alt="" width={26} height={26} />REIZO</strong>
                <p>从 AI 能力到智能体，每一步都更简单。</p>
                <small>© 2026 Reizo. All rights reserved.</small>
              </div>
              <div><h3>产品</h3><Link href="/products?cate=app">应用工具</Link><Link href="/studio">工作台</Link><Link href="/products?cate=api">模型 API</Link></div>
              <div><h3>资源</h3><Link href="/products">产品目录</Link><Link href="/docs">开发文档</Link><Link href="/business">企业方案</Link></div>
              <div><h3>账户</h3><Link href="/pricing">计费标准</Link><Link href="/account/keys">API Key</Link><Link href="/account/usage">用量明细</Link></div>
              <div><h3>支持</h3><Link href="/support/faq">常见问题</Link><Link href="/support/contact">联系支持</Link><Link href="/business">商务合作</Link></div>
            </footer>
          </div>
        </div>
      ) : (
        <div className="marketing-public-shell">
          <AnnouncementBar />
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      )}
    </MarketingDensityShell>
  );
}
