"use client";

import { usePathname, useRouter } from "next/navigation";
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
import type { TopbarMenuItem } from "@/components/topbar-more-menu";
import { createClient } from "@/lib/supabase/client";

type BackLink = { href: string; label: string };

export type PageHeaderOverride = {
  title?: string;
  back?: BackLink;
  action?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  menuItems?: TopbarMenuItem[];
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
  if (pathname === "/decks") {
    return [{ label: "Decks" }];
  }
  if (pathname === "/cards") {
    return [{ label: "Cards" }];
  }
  if (pathname === "/create") {
    return [{ label: "Create", href: "/create" }];
  }
  if (pathname === "/create/import") {
    return [
      { label: "Create", href: "/create" },
      { label: "Import deck" },
    ];
  }
  if (pathname === "/cram") {
    return [{ label: "Cram Plans" }];
  }
  if (pathname === "/cram/new") {
    return [
      { label: "Cram Plans", href: "/cram" },
      { label: "New plan" },
    ];
  }
  if (/^\/cram\/[^/]+\/study$/.test(pathname)) {
    return [
      { label: "Cram Plans", href: "/cram" },
      { label: "Plan" },
      { label: "Study" },
    ];
  }
  if (/^\/cram\/[^/]+$/.test(pathname)) {
    return [
      { label: "Cram Plans", href: "/cram" },
      { label: "Plan" },
    ];
  }
  if (pathname === "/community") {
    return [{ label: "Community" }];
  }
  if (pathname === "/notes") {
    return [{ label: "Notes" }];
  }
  if (/^\/notes\/[^/]+$/.test(pathname)) {
    return [
      { label: "Notes", href: "/notes" },
      { label: "Note" },
    ];
  }
  if (pathname === "/profile") {
    return [{ label: "Profile" }];
  }
  if (/^\/decks\/[^/]+$/.test(pathname)) {
    return [
      { label: "Decks", href: "/decks" },
      { label: "Deck" },
    ];
  }
  if (/^\/decks\/[^/]+\/study$/.test(pathname)) {
    return [
      { label: "Decks", href: "/decks" },
      { label: "Deck" },
      { label: "Study" },
    ];
  }

  return [{ label: "DeepHaus" }];
}

const NEW_DECK_ITEM: TopbarMenuItem = {
  id: "new-deck",
  label: "New deck",
  icon: "ri-add-line",
  href: "/create",
};

const IMPORT_ANKI_ITEM: TopbarMenuItem = {
  id: "import-anki",
  label: "Import from Anki",
  icon: "ri-folder-download-line",
  href: "/create?import=anki",
};

const IMPORT_QUIZLET_ITEM: TopbarMenuItem = {
  id: "import-quizlet",
  label: "Import from Quizlet",
  icon: "ri-file-copy-2-line",
  href: "/create?import=quizlet",
};

function resolveRouteMenuItems(
  pathname: string,
  helpers: { signOut: () => void },
): TopbarMenuItem[] {
  if (pathname === "/dashboard" || pathname === "/") {
    return [NEW_DECK_ITEM, IMPORT_ANKI_ITEM, IMPORT_QUIZLET_ITEM];
  }
  if (pathname === "/decks" || pathname === "/cards") {
    return [NEW_DECK_ITEM, IMPORT_ANKI_ITEM, IMPORT_QUIZLET_ITEM];
  }
  if (pathname === "/cram") {
    return [
      {
        id: "new-cram-plan",
        label: "New Cram Plan",
        icon: "ri-add-line",
        href: "/cram/new",
      },
    ];
  }
  if (pathname === "/create") {
    return [
      {
        id: "import-apkg",
        label: "Import from Anki",
        icon: "ri-folder-download-line",
        href: "/create?import=anki",
      },
      {
        id: "import-quizlet",
        label: "Import from Quizlet",
        icon: "ri-file-copy-2-line",
        href: "/create?import=quizlet",
      },
    ];
  }
  if (pathname === "/create/import") {
    return [{ id: "back-to-create", label: "Back to create", icon: "ri-arrow-go-back-line", href: "/create" }];
  }
  if (pathname === "/community") {
    return [NEW_DECK_ITEM];
  }
  if (pathname === "/notes") {
    return [NEW_DECK_ITEM];
  }
  if (pathname === "/profile") {
    return [
      {
        id: "sign-out",
        label: "Sign out",
        icon: "ri-logout-box-r-line",
        onClick: helpers.signOut,
        danger: true,
      },
    ];
  }
  return [];
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
  menuItems,
}: PageHeaderOverride) {
  const { setOverride } = usePageHeaderContext();

  useEffect(() => {
    setOverride({ title, back, action, breadcrumbs, menuItems });
  }, [title, back, action, breadcrumbs, menuItems, setOverride]);

  useEffect(() => {
    return () => setOverride(null);
  }, [setOverride]);

  return null;
}

export function AppChrome() {
  const pathname = usePathname();
  const router = useRouter();
  const { override } = usePageHeaderContext();
  const routeCrumbs = resolveRouteBreadcrumbs(pathname);
  const crumbs = mergeBreadcrumbs(routeCrumbs, override);

  const signOut = useCallback(() => {
    void (async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    })();
  }, [router]);

  const menuItems = useMemo(() => {
    if (override?.menuItems?.length) return override.menuItems;
    return resolveRouteMenuItems(pathname, { signOut });
  }, [override?.menuItems, pathname, signOut]);

  if (!crumbs) return null;

  return (
    <PageHeader
      breadcrumbs={[ROOT_CRUMB, ...crumbs]}
      action={override?.action}
      menuItems={menuItems}
    />
  );
}
