"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { m, useReducedMotion } from "motion/react";
import { PageHeader } from "@/components/page-header";
import { motionTransition } from "@/lib/motion";

type BackLink = { href: string; label: string };

export type PageHeaderOverride = {
  title?: string;
  back?: BackLink;
  action?: ReactNode;
};

type PageHeaderContextValue = {
  override: PageHeaderOverride | null;
  setOverride: (value: PageHeaderOverride | null) => void;
};

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

function usePageHeaderContext() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("PageHeaderProvider required");
  return ctx;
}

function CreateDeckAction() {
  return (
    <Link href="/decks/new" className="btn btn-primary">
      <i className="ri-add-line" />
      Create Deck
    </Link>
  );
}

function resolveRouteHeader(pathname: string): PageHeaderOverride | null {
  if (/^\/decks\/[^/]+\/study$/.test(pathname)) {
    return { title: "Study" };
  }

  if (pathname === "/study") {
    return { title: "Study" };
  }
  if (pathname === "/dashboard") {
    return { title: "Dashboard", action: <CreateDeckAction /> };
  }
  if (pathname === "/decks") {
    return { title: "Browse" };
  }
  if (pathname === "/decks/new") {
    return {
      title: "Create",
    };
  }
  if (pathname === "/community") {
    return { title: "Community" };
  }
  if (pathname === "/profile") {
    return { title: "Profile" };
  }
  if (/^\/decks\/[^/]+$/.test(pathname)) {
    return {
      title: "Deck",
      back: { href: "/decks", label: "Browse" },
    };
  }

  return { title: "DeepHaus" };
}

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [override, setOverrideState] = useState<PageHeaderOverride | null>(null);

  useEffect(() => {
    setOverrideState(null);
  }, [pathname]);

  const setOverride = useCallback((value: PageHeaderOverride | null) => {
    setOverrideState(value);
  }, []);

  const value = useMemo(
    () => ({ override, setOverride }),
    [override, setOverride],
  );

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

export function PageHeaderSlot({
  title,
  back,
  action,
}: PageHeaderOverride) {
  const { setOverride } = usePageHeaderContext();

  useEffect(() => {
    setOverride({ title, back, action });
    return () => setOverride(null);
  }, [title, back, action, setOverride]);

  return null;
}

export function AppChrome() {
  const pathname = usePathname();
  const { override } = usePageHeaderContext();
  const reducedMotion = useReducedMotion();
  const routeHeader = resolveRouteHeader(pathname);

  if (!routeHeader) return null;

  const title = override?.title ?? routeHeader.title ?? "DeepHaus";
  const back = override?.back ?? routeHeader.back;
  const action = override?.action ?? routeHeader.action;

  return (
    <PageHeader
      title={title}
      back={back}
      action={action}
      titleNode={
        <m.h1
          key={title}
          style={titleStyle}
          initial={{ opacity: reducedMotion ? 1 : 0.55 }}
          animate={{ opacity: 1 }}
          transition={motionTransition(0.14, undefined, reducedMotion ?? false)}
        >
          {title}
        </m.h1>
      }
    />
  );
}

const titleStyle: React.CSSProperties = {
  font: "600 20px/28px var(--font-sans)",
  color: "var(--fg-primary)",
  margin: 0,
  letterSpacing: "-0.01em",
};
