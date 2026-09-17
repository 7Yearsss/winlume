"use client";

import Link from "next/link";
import { KeyRound, Mail, PieChart, ShieldCheck, UserPlus, UserRound, WalletCards, Workflow } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useModals } from "@/components/providers";
import { ConsolePage } from "@/components/console/ConsolePage";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { getConsoleOverview } from "@/lib/console/client";
import type { ConsoleOverview } from "@/lib/console/types";

const fmt = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

export default function AccountOverview() {
  const { account, openLogin, openMembership } = useModals();
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setOverview(await getConsoleOverview()); } catch (reason) { setError(reason instanceof Error ? reason.message : "账户信息暂不可用"); }
  }, []);
  useEffect(() => {
    if (!account) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [account, load]);

  if (!account) return <section className="account-personal-empty"><UserRound aria-hidden /><h1>登录后查看个人中心</h1><p>账户信息、额度、API密钥 与任务看板会汇总在这里。</p><button type="button" onClick={() => openLogin("login")}>登录 / 注册</button></section>;

  const available = overview?.wallet.availableCredits ?? 0;
  const used = overview?.wallet.usedCredits ?? 0;
  const remaining = available + used > 0 ? Math.round((available / (available + used)) * 100) : 100;
  const displayName = account.display_name || account.username;

  return (
    <ConsolePage title="个人资料">
      {error ? <p className="portal-account-notice">{error}</p> : null}
      <div className="account-personal">
      <div className="account-personal-stats">
        <article><WalletCards aria-hidden /><span>余额</span><strong>{overview?.wallet.syncStatus === "unavailable" ? "暂不可用" : <AnimatedNumber value={available} format={(n) => `¥${fmt(n)}`} />}</strong><Link href="/account/wallet">去充值</Link></article>
        <article><Workflow aria-hidden /><span>累计消费</span><strong>{overview?.wallet.syncStatus === "unavailable" ? "暂不可用" : <AnimatedNumber value={used} format={fmt} />}</strong><Link href="/account/usage">使用明细</Link></article>
        <article><PieChart aria-hidden /><span>会员剩余额度</span><strong><AnimatedNumber value={remaining} format={(n) => `${Math.round(n)}%`} /></strong><button type="button" onClick={openMembership}>额度说明</button></article>
      </div>
      <section className="account-personal-panel">
        <h2>账户信息</h2>
        <div><UserRound aria-hidden /><strong>用户名</strong><em>{displayName}</em><span>已登录</span></div>
        <div><Mail aria-hidden /><strong>绑定邮箱</strong><em>{account.email || "暂未绑定"}</em><Link href="/account/personalization">修改</Link></div>
      </section>
      <section className="account-personal-panel">
        <h2>安全与接入</h2>
        <div><ShieldCheck aria-hidden /><strong>账户安全</strong><em>定期更新登录凭据并保护账号。</em><Link href="/account/security">修改密码</Link></div>
        <div><UserPlus aria-hidden /><strong>邀请好友</strong><em>生成专属邀请链接，邀请朋友或团队成员。</em><Link href="/account/invite">去邀请</Link></div>
        <div><KeyRound aria-hidden /><strong>API密钥</strong><em>{overview ? `${overview.keys.active} 个可用密钥` : "正在读取"}</em><Link href="/account/keys">管理密钥</Link></div>
      </section>
      </div>
    </ConsolePage>
  );
}
