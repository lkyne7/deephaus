"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import { buildWarmupUrls, warmRoutes } from "@/lib/desktop/route-warmup";
import { useDesktopBridge } from "./use-desktop-bridge";

/** Delay before warming routes so it never competes with the first paint or initial sync. */
const WARMUP_DELAY_MS = 12_000;

let warmedThisSession = false;

/**
 * Wires the Electron shell into the signed-in app: native menu shortcuts and
 * deep links navigate client-side, the dock/taskbar badge mirrors the number
 * of cards due now, and core routes plus deck study pages are cached for a
 * cold offline launch.
 */
export function DesktopIntegration() {
  const bridge = useDesktopBridge();
  const router = useRouter();
  const { data: stats } = useDashboardStats();
  const dueNow = bridge ? stats?.due_now : undefined;
  const deckIdsKey = bridge && stats ? stats.per_deck.map((deck) => deck.deck_id).join(",") : "";
  const warmupStarted = useRef(false);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onNavigate((path) => {
      router.push(path);
    });
  }, [bridge, router]);

  useEffect(() => {
    if (!bridge || dueNow === undefined) return;
    bridge.setBadgeCount(dueNow);
  }, [bridge, dueNow]);

  useEffect(() => {
    if (!bridge || !deckIdsKey || warmedThisSession || warmupStarted.current) return;
    if (!navigator.serviceWorker?.controller) return;
    warmupStarted.current = true;
    const controller = new AbortController();
    // Decks with cards due first: they are the ones most likely opened offline.
    const deckIds = deckIdsKey.split(",");
    const timer = setTimeout(() => {
      if (!navigator.onLine) {
        warmupStarted.current = false;
        return;
      }
      warmedThisSession = true;
      void warmRoutes(buildWarmupUrls(deckIds), undefined, controller.signal);
    }, WARMUP_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (!warmedThisSession) warmupStarted.current = false;
    };
  }, [bridge, deckIdsKey]);

  return null;
}
