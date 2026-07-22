import { redirect } from "next/navigation";
import { AppShellLoader } from "@/components/app-shell-loader";
import { PageHeaderProvider } from "@/components/page-header-context";
import { BackgroundTasksShell } from "@/components/background-tasks-shell";
import type { SidebarUser } from "@/components/sidebar";
import { CardSearchProvider } from "@/lib/card-search/context";
import { AppDataProvider } from "@/lib/client-cache/provider";
import { AppShellUserProvider } from "@/lib/client-cache/user-context";
import { getAuthUser } from "@/lib/data/server-auth";
import { isOnboardingCompleted } from "@/lib/onboarding/metadata";
import { getDisplayNameFromUser, makeInitials, welcomeGreeting } from "@/lib/user/display-name";
import { loadUserProfile } from "@/lib/user/profile";
import { SettingsProvider } from "@/components/settings/settings-context";

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  if (!isOnboardingCompleted(user)) {
    redirect("/onboarding");
  }

  const email = user.email ?? "";
  const profile = await loadUserProfile(user.id);
  const name = profile?.full_name || getDisplayNameFromUser(user);
  const initials = makeInitials(name, email);

  const sidebarUser: SidebarUser = {
    name,
    email,
    initials,
    avatarUrl: profile?.avatar_url ?? null,
  };
  const welcomeTitle = welcomeGreeting(name);
  const settingsAccount = {
    id: user.id,
    name,
    email,
    initials,
    memberSince: formatMonthYear(user.created_at),
  };

  return (
    <AppShellUserProvider value={{ welcomeTitle }}>
      <AppDataProvider>
        <PageHeaderProvider>
          <CardSearchProvider>
            <BackgroundTasksShell>
              <SettingsProvider account={settingsAccount}>
                <AppShellLoader sidebarUser={sidebarUser}>{children}</AppShellLoader>
              </SettingsProvider>
            </BackgroundTasksShell>
          </CardSearchProvider>
        </PageHeaderProvider>
      </AppDataProvider>
    </AppShellUserProvider>
  );
}
