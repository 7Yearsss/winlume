"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { useWorkspaceTabs } from "@/lib/studio/workspace-tabs";

export default function WorkspaceTabBar() {
  const { tabs, activeTabId, activateTab, closeTab, openHomeTab, renameTab } = useWorkspaceTabs();
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!editingTabId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingTabId]);

  const commitRename = () => {
    if (!editingTabId) return;
    const nextTitle = editingTitle.trim();
    if (nextTitle) renameTab(editingTabId, nextTitle);
    setEditingTabId(null);
    setEditingTitle("");
  };

  if (tabs.length === 0) return null;

  return (
    <div className="studio-workspace-tabbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/50 px-2 py-1.5">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-active={isActive ? "true" : "false"}
            className={`studio-workspace-tab group flex h-8 min-w-0 max-w-[200px] shrink-0 items-center gap-1.5 rounded-[9px] pl-3 pr-1.5 text-[13px] transition ${
              isActive
                ? "bg-white/85 text-[#241E36] shadow-sm"
                : "text-[#8A8298] hover:bg-white/50 hover:text-[#615A73]"
            }`}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                tabId: tab.id,
                x: Math.min(event.clientX, window.innerWidth - 168),
                y: Math.min(event.clientY, window.innerHeight - 48),
              });
            }}
          >
            {editingTabId === tab.id ? (
              <input
                ref={editInputRef}
                value={editingTitle}
                onChange={(event) => setEditingTitle(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") {
                    setEditingTabId(null);
                    setEditingTitle("");
                  }
                }}
                maxLength={80}
                aria-label="标签名称"
                className="min-w-0 flex-1 bg-transparent text-left outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => activateTab(tab.id)}
                className="min-w-0 flex-1 truncate text-left"
                title={tab.title}
              >
                {tab.title}
              </button>
            )}
            {tabs.length > 1 ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label="关闭标签"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[#AAA2B2] opacity-0 transition hover:bg-black/5 hover:text-[#615A73] group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={openHomeTab}
        title="开始创作"
        aria-label="新建标签"
        className="studio-workspace-tab-add flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[#8A8298] transition hover:bg-white/60 hover:text-[#241E36]"
      >
        <Plus className="h-4 w-4" />
      </button>
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          role="menu"
          className="studio-tab-context-menu fixed z-[80] w-40 rounded-lg border border-[#e1e7ef] bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.14)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const tab = tabs.find((item) => item.id === contextMenu.tabId);
              if (!tab) return;
              activateTab(tab.id);
              setEditingTabId(tab.id);
              setEditingTitle(tab.title);
              setContextMenu(null);
            }}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f1f5f9]"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            重命名
          </button>
        </div>
      ) : null}
    </div>
  );
}
