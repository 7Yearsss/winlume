"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspaceTabs } from "@/lib/studio/workspace-tabs";

/**
 * Thin route: the actual home UI is rendered by WorkspaceTabsHost (mounted
 * once per open tab in StudioShell) so switching tabs never remounts it.
 * This route's only job is to make sure a blank tab is open and active —
 * a fresh, context-bearing query string (e.g. ?skill=xxx from elsewhere in
 * the app) always opens its own new tab so it isn't silently dropped onto
 * an unrelated tab that's already open.
 */
function StudioHomeRouteInner() {
  const searchParams = useSearchParams();
  const entryQuery = searchParams.toString();
  const handledEntry = useRef<string | null>(null);
  const { ensureHomeTabActive, registerHomeTab } = useWorkspaceTabs();
  useEffect(() => {
    if (handledEntry.current === entryQuery) return;
    handledEntry.current = entryQuery;
    if (entryQuery) registerHomeTab();
    else ensureHomeTabActive();
  }, [entryQuery, registerHomeTab, ensureHomeTabActive]);
  return null;
}

export default function StudioHomeRoute() {
  return (
    <Suspense fallback={null}>
      <StudioHomeRouteInner />
    </Suspense>
  );
}
