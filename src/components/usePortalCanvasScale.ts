"use client";

/**
 * Compatibility hook for portal shells.
 *
 * Public portal pages use a fixed-width canvas now. Keeping this hook as a
 * no-op lets existing shells share the same API without applying a rendered
 * 80% scale that would also shrink typography.
 */
export function usePortalCanvasScale(_frameSelector = ".portal-density-shell > .portal-frame") {
  return undefined;
}
