"use client";

import { usePathname } from "next/navigation";
import { NewDeckMenu } from "@/components/new-deck-menu";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PageHeader, type Breadcrumb } from "@/components/page-header";

type BackLink = { href: string; label: string };

export type PageHeaderOverride = {
  title?: string;
  back?: BackLink;
  action?: ReactNode;
  breadcrumbs?: Breadcrumb[];
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

const ROOT_CRUMB: Breadcrumb = { label: "DeepHaus", href: "/dashboard" };

function resolveRouteBreadcrumbs(pathname: string): Breadcrumb[] | null {
  if (pathname === "/dashboard" || pathname === "/") {
    return [{ label: "Dashboard" }];
  }
  if (pathname === "/study") {
    return [{ label: "Decks" }];
  }
  if (pathname === "/decks") {
    return [{ label: "Browse" }];
  }
  if (pathname === "/decks/new") {
    return [{ label: "Create", href: "/decks/new" }];
  }
  if (pathname === "/decks/import") {
    return [
      { label: "Create", href: "/decks/new" },
      { label: "Import from Anki" },
    ];
  }
  if (pathname === "/community") {
    return [{ label: "Community" }];
  }
  if (pathname === "/profile") {
    return [{ label: "Profile" }];
  }
  if (/^\/decks\/[^/]+$/.test(pathname)) {
    return [
      { label: "Decks", href: "/study" },
      { label: "Deck" },
    ];
  }
  if (/^\/decks\/[^/]+\/study$/.test(pathname)) {
    return [
      { label: "Decks", href: "/study" },
      { label: "Deck" },
      { label: "Study" },
    ];
  }

  return [{ label: "DeepHaus" }];
}

function mergeBreadcrumbs(
  route: Breadcrumb[] | null,
  override: PageHeaderOverride | null,
): Breadcrumb[] | null {
  if (override?.breadcrumbs?.length) {
    return override.breadcrumbs;
  }

  if (route === null) return null;

  if (override?.back && override?.title) {
    return [
      { label: override.back.label, href: override.back.href },
      { label: override.title },
    ];
  }

  if (override?.title) {
    if (route.length === 0) return [{ label: override.title }];
    const last = route[route.length - 1];
    if (last?.label === "Deck" || last?.label === override.title) {
      return [...route.slice(0, -1), { label: override.title }];
    }
    return [...route, { label: override.title }];
  }

  return route;
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
  breadcrumbs,
}: PageHeaderOverride) {
  const { setOverride } = usePageHeaderContext();

  useEffect(() => {
    setOverride({ title, back, action, breadcrumbs });
    return () => setOverride(null);
  }, [title, back, action, breadcrumbs, setOverride]);

  return null;
}

export function AppChrome() {
  const pathname = usePathname();
  const { override } = usePageHeaderContext();
  const routeCrumbs = resolveRouteBreadcrumbs(pathname);
  const crumbs = mergeBreadcrumbs(routeCrumbs, override);

  if (!crumbs) return null;

  const defaultAction = pathname === "/dashboard" ? <NewDeckMenu /> : undefined;

  return (
    <PageHeader
      breadcrumbs={[ROOT_CRUMB, ...crumbs]}
      action={override?.action ?? defaultAction}
    />
  );
}
