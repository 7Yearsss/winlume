"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useModals } from "@/components/providers";

export type WorkspaceTab =
  | { id: string; kind: "home"; title: string }
  | { id: string; kind: "session"; sessionId: string; title: string };

type StoredState = { tabs: WorkspaceTab[]; activeTabId: string | null };

const STORAGE_KEY = "reizo:studio-workspace-tabs";

function newHomeTab(): WorkspaceTab {
  return { id: crypto.randomUUID(), kind: "home", title: "新对话" };
}

function tabHref(tab: WorkspaceTab): string {
  return tab.kind === "home" ? "/studio" : `/studio/c/${tab.sessionId}`;
}

function loadStored(storageKey: string): StoredState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredState;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(storageKey: string, state: StoredState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Best-effort persistence only.
  }
}

type WorkspaceTabsContextValue = {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** Opens a brand-new blank conversation tab, activates it, and navigates to it. */
  openHomeTab: () => void;
  /**
   * Registers a new home tab as active WITHOUT navigating — for use when
   * the browser is already sitting on the right URL (e.g. the /studio route
   * arrived with a fresh, context-bearing query string) and a router.push
   * would race the new tab's own one-time read of that query string.
   */
  registerHomeTab: () => void;
  /** Activates an existing tab by id and navigates to it (no-op if it doesn't exist). */
  activateTab: (id: string) => void;
  /** Closes a tab; activates a neighbor (or opens a fresh blank tab if none remain). */
  closeTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  /** Called by the /studio route on mount: activates an existing blank home tab or registers a new one. Does not navigate. */
  ensureHomeTabActive: () => void;
  /** Called by the /studio/c/[sessionId] route on mount: activates the matching tab or registers a new one. Does not navigate. */
  ensureSessionTabActive: (sessionId: string) => void;
};

const WorkspaceTabsContext = createContext<WorkspaceTabsContextValue | null>(null);

export function WorkspaceTabsProvider({ children }: { children: ReactNode }) {
  const { account, accountLoading } = useModals();
  if (accountLoading) return null;
  const owner = account?.id ?? "guest";
  // Never restore the old, unscoped cache: its sessions may belong to another account.
  return <OwnedWorkspaceTabsProvider key={owner} storageKey={`${STORAGE_KEY}:${owner}`}>{children}</OwnedWorkspaceTabsProvider>;
}

function OwnedWorkspaceTabsProvider({ children, storageKey }: { children: ReactNode; storageKey: string }) {
  const router = useRouter();
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  // Mirrors state synchronously so callbacks can read the latest tabs
  // without touching setState updaters (which React may invoke twice under
  // StrictMode — this file intentionally keeps all navigation and other
  // side effects out of updater functions).
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
    activeTabIdRef.current = activeTabId;
  });

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = loadStored(storageKey);
    if (stored) {
      const storedActiveTabId = stored.tabs.some((tab) => tab.id === stored.activeTabId)
        ? stored.activeTabId
        : stored.tabs[0]?.id ?? null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of persisted tab state from localStorage after mount.
      setTabs(stored.tabs);
      setActiveTabId(storedActiveTabId);
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedRef.current || tabs.length === 0) return;
    persist(storageKey, { tabs, activeTabId });
  }, [tabs, activeTabId, storageKey]);

  const activateTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((item) => item.id === id);
      if (!tab) return;
      setActiveTabId(id);
      router.push(tabHref(tab));
    },
    [router],
  );

  const openHomeTab = useCallback(() => {
    const tab = newHomeTab();
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    router.push("/studio");
  }, [router]);

  const registerHomeTab = useCallback(() => {
    const tab = newHomeTab();
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const current = tabsRef.current;
      const index = current.findIndex((item) => item.id === id);
      if (index === -1) return;
      const next = current.filter((item) => item.id !== id);
      setTabs(next);
      if (activeTabIdRef.current !== id) return;
      const neighbor = next[index] ?? next[index - 1] ?? next[0];
      if (neighbor) {
        setActiveTabId(neighbor.id);
        router.push(tabHref(neighbor));
        return;
      }
      const fresh = newHomeTab();
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      router.push("/studio");
    },
    [router],
  );

  const renameTab = useCallback((id: string, title: string) => {
    setTabs((current) =>
      current.map((tab) => (tab.id === id && tab.title !== title ? { ...tab, title } : tab)),
    );
  }, []);

  /**
   * Does not navigate — callers are already sitting on the right route.
   * Always leaves a home tab active: reuses the current tab if it's already
   * blank, reuses another open blank tab if there is one, or opens a fresh
   * one — so a plain `<Link href="/studio">` (e.g. "开始创作" reached other
   * than via the tab-bar "+" button) still gets the "new blank tab" result
   * instead of silently reusing whatever session tab was active before.
   */
  const ensureHomeTabActive = useCallback(() => {
    const current = tabsRef.current;
    const active = current.find((item) => item.id === activeTabIdRef.current);
    if (active?.kind === "home") return;
    const existingHome = current.find((item) => item.kind === "home");
    if (existingHome) {
      setActiveTabId(existingHome.id);
      return;
    }
    const tab = newHomeTab();
    setTabs([...current, tab]);
    setActiveTabId(tab.id);
  }, []);

  /** Does not navigate — callers are already sitting on the right route. */
  const ensureSessionTabActive = useCallback((sessionId: string) => {
    const current = tabsRef.current;
    const existing = current.find((item) => item.kind === "session" && item.sessionId === sessionId);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab: WorkspaceTab = { id: crypto.randomUUID(), kind: "session", sessionId, title: "新对话" };
    const activeHomeIndex = current.findIndex(
      (item) => item.kind === "home" && item.id === activeTabIdRef.current,
    );
    setActiveTabId(tab.id);
    if (activeHomeIndex !== -1) {
      // Promote the blank home tab that started this conversation into the session tab in place.
      const next = [...current];
      next[activeHomeIndex] = tab;
      setTabs(next);
    } else {
      setTabs([...current, tab]);
    }
  }, []);

  const value = useMemo<WorkspaceTabsContextValue>(
    () => ({
      tabs,
      activeTabId,
      openHomeTab,
      registerHomeTab,
      activateTab,
      closeTab,
      renameTab,
      ensureHomeTabActive,
      ensureSessionTabActive,
    }),
    [
      tabs,
      activeTabId,
      openHomeTab,
      registerHomeTab,
      activateTab,
      closeTab,
      renameTab,
      ensureHomeTabActive,
      ensureSessionTabActive,
    ],
  );

  // Route effects must run after hydration, otherwise restoring tabs overwrites
  // the fresh home tab requested by a model-catalog navigation.
  return <WorkspaceTabsContext.Provider value={value}>{hydrated ? children : null}</WorkspaceTabsContext.Provider>;
}

export function useWorkspaceTabs(): WorkspaceTabsContextValue {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) throw new Error("useWorkspaceTabs must be used within WorkspaceTabsProvider");
  return ctx;
}
