"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Bot, ChevronDown, ChevronRight, ClipboardList, Crown, KeyRound, LayoutDashboard, LogOut, WalletCards } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useModals } from "@/components/providers";
import { getUnreadPortalNotifications, markPortalNotificationsRead } from "@/lib/portal/notification-read";
import type { PortalNotification } from "@/lib/portal/content-config";

type NavItem = {
  href: string;
  label: string;
  active: (pathname: string, cate: string | null) => boolean;
};

const navItems: NavItem[] = [
  { href: "/", label: "首页", active: (pathname) => pathname === "/" },
  { href: "/products?cate=app", label: "应用工具", active: (pathname, cate) => pathname === "/products" && cate === "app" },
];

/** One portal header for the home, catalog, docs, pricing, and account surfaces. */
export default function PortalHeader({ productMode, notifications: initialNotifications }: { productMode?: "app" | "api"; notifications?: PortalNotification[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { account, openLogin, openMembership, signOut: signOutAccount } = useModals();
  const [apiMenuOpen, setApiMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string; href: string }>>(() =>
    (initialNotifications ?? []).filter((item) => item.enabled !== false),
  );
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const notificationOpenRef = useRef(false);
  const accountName = account ? account.display_name || account.username : "";
  const accountInitial = accountName ? accountName.slice(0, 1).toUpperCase() : "登";

  useEffect(() => {
    let cancelled = false;
    if (initialNotifications) {
      const enabledNotifications = initialNotifications.filter((item) => item.enabled !== false);
      if (notificationOpenRef.current) {
        markPortalNotificationsRead(enabledNotifications);
        setUnreadNotificationCount(0);
      } else {
        setUnreadNotificationCount(getUnreadPortalNotifications(enabledNotifications).length);
      }
      return;
    }
    fetch(`/api/portal/content`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((content: { notifications?: Array<{ id: string; title: string; body: string; href: string; enabled?: boolean }> } | null) => {
        if (cancelled) return;
        const enabledNotifications = (content?.notifications ?? []).filter((notice) => notice.enabled !== false);
        setNotifications(enabledNotifications);
        if (notificationOpenRef.current) {
          markPortalNotificationsRead(enabledNotifications);
          setUnreadNotificationCount(0);
        } else {
          setUnreadNotificationCount(getUnreadPortalNotifications(enabledNotifications).length);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [initialNotifications]);

  async function handleSignOut() {
    await signOutAccount();
    router.push("/");
    router.refresh();
  }

  function openNotifications() {
    notificationOpenRef.current = true;
    setNotificationOpen(true);
    markPortalNotificationsRead(notifications);
    setUnreadNotificationCount(0);
  }

  function closeNotifications() {
    notificationOpenRef.current = false;
    setNotificationOpen(false);
  }

  return (
    <>
      <div className="portal-nav-shell">
        <div className="portal-nav-shell-fill" aria-hidden />
        <header className="portal-nav" aria-label="主导航">
          <Link href="/" className="portal-brand" aria-label="返回首页">
            <Image className="portal-brand-mark" src="/brand/logo-day.png" alt="Reizo" width={32} height={32} priority unoptimized />
            Reizo
          </Link>
          <nav className="portal-main-links" aria-label="页面导航">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={item.active(pathname, pathname === "/products" ? productMode ?? "api" : null) ? "is-current" : undefined}
              >
                {item.label}
              </Link>
            ))}
            <div
              className="portal-main-menu"
              onMouseEnter={() => setApiMenuOpen(true)}
              onMouseLeave={() => setApiMenuOpen(false)}
              onFocus={() => setApiMenuOpen(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setApiMenuOpen(false);
              }}
            >
              <Link
                href="/products?cate=api"
                className={pathname === "/products" && productMode !== "app" ? "is-current" : undefined}
                aria-expanded={apiMenuOpen}
              >
                API模型<ChevronDown aria-hidden />
              </Link>
              <div className={`portal-main-submenu${apiMenuOpen ? " is-open" : ""}`}>
                <Link href="/products?cate=api">全部模型</Link>
                <Link href="/docs">API 调用文档</Link>
              </div>
            </div>
            <Link href="/studio" target="_blank" rel="noopener noreferrer" className={`portal-agent-entry${pathname.startsWith("/studio") ? " is-current" : ""}`}>
              <Bot aria-hidden />
              Agent工作台
            </Link>
          </nav>
          <button type="button" className="portal-membership-entry" onClick={openMembership}>
            <Crown aria-hidden />
            升级会员
          </button>
          <div className="portal-user-links">
            <div className="portal-notification-menu" onMouseEnter={openNotifications} onMouseLeave={closeNotifications} onFocus={openNotifications} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeNotifications(); }}>
              <button type="button" aria-expanded={notificationOpen} onClick={() => { if (notificationOpen) closeNotifications(); else openNotifications(); }}>
                <span className="portal-notification-icon"><Bell aria-hidden />{unreadNotificationCount ? <i>{unreadNotificationCount}</i> : null}</span>
                <span className="portal-notification-label">通知</span>
              </button>
              <div className={`portal-notification-submenu${notificationOpen ? " is-open" : ""}`}>
                <strong>通知</strong>
                {notifications.length ? notifications.map((item) => <Link href={item.href || "/"} key={item.id}><b>{item.title}</b><span>{item.body}</span></Link>) : <p>暂无新的通知</p>}
              </div>
            </div>
            {account ? (
              <div
                className="portal-account-menu"
                onMouseEnter={() => setAccountMenuOpen(true)}
                onMouseLeave={() => setAccountMenuOpen(false)}
                onFocus={() => setAccountMenuOpen(true)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAccountMenuOpen(false);
                }}
              >
                <Link href="/account" className={`portal-account${pathname.startsWith("/account") ? " is-current" : ""}`} aria-expanded={accountMenuOpen}>
                  <span>{accountInitial}</span>{accountName}<ChevronRight aria-hidden />
                </Link>
                <div className={`portal-account-submenu${accountMenuOpen ? " is-open" : ""}`}>
                  <Link href="/account"><LayoutDashboard aria-hidden />个人中心</Link>
                  <Link href="/account/tasks"><ClipboardList aria-hidden />任务看板</Link>
                  <Link href="/account/wallet"><WalletCards aria-hidden />钱包与充值</Link>
                  <Link href="/account/keys"><KeyRound aria-hidden />API密钥</Link>
                  <button type="button" onClick={() => void handleSignOut()}><LogOut aria-hidden />退出登录</button>
                </div>
              </div>
            ) : (
              <button type="button" className="portal-account" onClick={() => openLogin("login")}>
                <span>{accountInitial}</span>登录 / 注册<ChevronRight aria-hidden />
              </button>
            )}
          </div>
        </header>
      </div>
    </>
  );
}
