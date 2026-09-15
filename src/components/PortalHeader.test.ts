import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const navSource = readFileSync(join(__dirname, "PortalHeader.tsx"), "utf8");

const SHELLS = [
  "ModelMarket.tsx",
  "ProductsExplorer.tsx",
  "docs/DocsShell.tsx",
  "account/AccountShell.tsx",
  "PortalPricingShell.tsx",
] as const;

describe("portal top navigation", () => {
  it("keeps the compact primary navigation and nests API documentation", () => {
    for (const label of ["首页", "应用工具"]) {
      expect(navSource).toContain(`label: "${label}"`);
    }
    expect(navSource).toContain("portal-agent-entry");
    expect(navSource).toContain("<Bot aria-hidden");
    expect(navSource).toContain("API模型<ChevronDown");
    expect(navSource).toContain("API 调用文档");
    expect(navSource).not.toContain('label: "计费标准"');
    expect(navSource).not.toContain('label: "文档"');
    expect(navSource).toContain("升级会员");
    expect(navSource).toContain("通知");
    expect(navSource).toContain("markPortalNotificationsRead");
    expect(navSource).toContain("unreadNotificationCount");
    expect(navSource).toContain('href="/studio"');
    expect(navSource).toContain("portal-membership-entry");
    expect(navSource).toContain("portal-user-links");
    expect(navSource).toContain("portal-account-submenu");
    expect(navSource).toContain("API密钥");
    expect(navSource).toContain("钱包");
  });

  it("keeps membership as a sibling of the user-links cluster", () => {
    expect(navSource).toMatch(
      /portal-membership-entry[\s\S]*portal-user-links/,
    );
    expect(navSource).not.toMatch(
      /portal-user-links[\s\S]*portal-membership-entry/,
    );
  });

  it("is the only portal chrome used by marketing shells", () => {
    for (const file of SHELLS) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source).toContain("<PortalHeader");
      expect(source).not.toContain('className="portal-nav"');
      expect(source).not.toContain("portal-main-links");
    }
  });

  it("logs out through the modal provider so the visible account state is cleared", () => {
    expect(navSource).toContain("const { account, openLogin, openMembership, signOut: signOutAccount } = useModals();");
    expect(navSource).toContain("await signOutAccount();");
    expect(navSource).not.toContain('import { logout } from "@/lib/account";');
  });
});
