"use client";

import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useModals } from "@/components/providers";
import { ConsolePage } from "@/components/console/ConsolePage";
import { changePassword, logout } from "@/lib/account";

export default function AccountSecurityContent() {
  const router = useRouter();
  const { account, openLogin } = useModals();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  if (!account) return <section className="account-personal-empty"><LockKeyhole aria-hidden /><h1>登录后修改密码</h1><p>使用当前密码验证身份后，可为账户设置新的登录密码。</p><button type="button" onClick={() => openLogin("login")}>登录 / 注册</button></section>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nextPassword !== confirmPassword) {
      setNotice("两次输入的新密码不一致。");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await changePassword({ currentPassword, nextPassword });
      await logout();
      router.replace("/");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "密码修改失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConsolePage title="账户安全">
      <div className="account-security">
      <section className="account-security-panel">
        <div className="account-security-intro"><span><ShieldCheck aria-hidden /></span><div><h2>保护你的账户</h2><p>新密码须为 8 至 72 个 UTF-8 字节，建议使用未在其他网站使用过的密码。</p></div></div>
        <form onSubmit={submit}>
          <label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
          <label>新密码<input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></label>
          <label>确认新密码<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></label>
          {notice ? <p className="account-security-notice" role="alert">{notice}</p> : null}
          <button type="submit" disabled={saving}><KeyRound aria-hidden />{saving ? "正在修改…" : "确认修改密码"}</button>
        </form>
      </section>
      </div>
    </ConsolePage>
  );
}
