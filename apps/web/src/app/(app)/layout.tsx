import { redirect } from "next/navigation";
import { AnimatedMain } from "@/components/motion/animated-main";
import { AppChrome, PageHeaderProvider } from "@/components/page-header-context";
import { BackgroundTasksShell } from "@/components/background-tasks-shell";
import { Sidebar, type SidebarUser } from "@/components/sidebar";
import { CardSearchProvider } from "@/lib/card-search/context";
import { getAuthUser } from "@/lib/data/server-auth";
import { deriveUserPersona } from "@/lib/user/display-name";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  const { name, initials } = deriveUserPersona(user);
  const email = user.email ?? "";

  const sidebarUser: SidebarUser = { name, email, initials };

  return (
    <PageHeaderProvider>
      <CardSearchProvider>
        <BackgroundTasksShell>
          <div style={shell.root}>
            <Sidebar user={sidebarUser} />
            <div style={shell.main}>
              <AppChrome />
              <AnimatedMain>{children}</AnimatedMain>
            </div>
          </div>
        </BackgroundTasksShell>
      </CardSearchProvider>
    </PageHeaderProvider>
  );
}

const shell: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    minHeight: "100vh",
    background: "var(--bg-canvas)",
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    zIndex: 0,
  },
};
