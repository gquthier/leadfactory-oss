"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Tracks client page visits by calling the activity tracking API.
 * Debounces to avoid logging the same page multiple times in quick succession.
 */
export function useTrackPageVisit() {
  const pathname = usePathname();
  const lastTracked = useRef<string>("");

  useEffect(() => {
    if (pathname === lastTracked.current) return;
    lastTracked.current = pathname;

    fetch("/api/auth/track-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "page_visit",
        targetType: "page",
        targetLabel: pathname,
        metadata: { page: pathname },
      }),
    }).catch(() => {});
  }, [pathname]);
}
