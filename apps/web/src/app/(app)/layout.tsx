import { redirect } from "next/navigation";
import { AppShellLoader } from "@/components/app-shell-loader";
import { PageHeaderProvider } from "@/components/page-header-context";
import { BackgroundTasksShell } from "@/components/background-tasks-shell";
import type { SidebarUser } from "@/components/sidebar";
import { CardSearchProvider } from "@/lib/card-search/context";
import { AppDataProvider } from "@/lib/client-cache/provider";
import { AppShellUserProvider } from "@/lib/client-cache/user-context";
import { getAuthUser } from "@/lib/data/server-auth";
import { deriveUserPersona, getDisplayNameFromUser, welcomeGreeting } from "@/lib/user/display-name";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  const { name, initials } = deriveUserPersona(user);
  const email = user.email ?? "";

  const sidebarUser: SidebarUser = { name, email, initials };
  const welcomeTitle = welcomeGreeting(getDisplayNameFromUser(user));

  return (
    <AppShellUserProvider value={{ welcomeTitle }}>
      <AppDataProvider userId={user.id}>
        <PageHeaderProvider>
          <CardSearchProvider>
            <BackgroundTasksShell>
              <AppShellLoader sidebarUser={sidebarUser}>{children}</AppShellLoader>
            </BackgroundTasksShell>
          </CardSearchProvider>
        </PageHeaderProvider>
      </AppDataProvider>
    </AppShellUserProvider>
  );
}
