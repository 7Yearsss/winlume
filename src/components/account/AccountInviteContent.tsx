"use client";

import { Check, Copy, Gift, Mail, Share2, UserPlus } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useModals } from "@/components/providers";
import { ConsolePage } from "@/components/console/ConsolePage";

export default function AccountInviteContent() {
  const { account, openLogin } = useModals();
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = useState(false);
  const inviteCode = useMemo(() => account ? `REIZO-${account.id.replace(/-/g, "").slice(0, 8).toUpperCase()}` : "", [account]);
  const inviteUrl = origin && inviteCode ? `${origin}/?invite=${inviteCode}` : "";

  if (!account) return <section className="account-personal-empty"><UserPlus aria-hidden /><h1>登录后邀请好友</h1><p>登录后可生成专属邀请链接，分享给团队成员或朋友。</p><button type="button" onClick={() => openLogin("login")}>登录 / 注册</button></section>;

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("请复制邀请链接", inviteUrl);
    }
  }

  async function shareInvite() {
    if (navigator.share && inviteUrl) {
      try {
        await navigator.share({ title: "加入 Reizo", text: "邀请你一起体验 Reizo AI 能力。", url: inviteUrl });
        return;
      } catch {
        // 用户主动取消系统分享时，保留当前页面即可。
        return;
      }
    }
    await copyInvite();
  }

  return (
    <ConsolePage title="邀请好友">
      <div className="account-invite">
      <section className="account-invite-hero"><span><Gift aria-hidden /></span><div><p>专属邀请码</p><strong>{inviteCode}</strong><small>邀请链接可直接分享；奖励规则接入后会在此展示。</small></div></section>
      <section className="account-invite-panel">
        <h2>分享邀请链接</h2>
        <div className="account-invite-link"><input readOnly value={inviteUrl || "正在生成邀请链接…"} aria-label="邀请链接" /><button type="button" onClick={() => void copyInvite()} disabled={!inviteUrl}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "已复制" : "复制链接"}</button></div>
        <div className="account-invite-actions"><button type="button" onClick={() => void shareInvite()}><Share2 aria-hidden />立即分享</button><a href={`mailto:?subject=${encodeURIComponent("邀请你加入 Reizo")}&body=${encodeURIComponent(`邀请你体验 Reizo AI 能力：${inviteUrl}`)}`}><Mail aria-hidden />邮件邀请</a></div>
      </section>
      </div>
    </ConsolePage>
  );
}
