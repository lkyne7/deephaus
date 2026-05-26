import { redirect } from "next/navigation";
import { AnimatedMain } from "@/components/motion/animated-main";
import { Sidebar, type SidebarUser } from "@/components/sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const email = user.email ?? "";
  const localPart = email.split("@")[0] ?? "";
  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    localPart ??
    "You";
  const initials = name
    .split(/\s+|\./)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase())
    .slice(0, 2)
    .join("") || "U";

  const sidebarUser: SidebarUser = { name, email, initials };

  return (
    <div style={shell.root}>
      <Sidebar user={sidebarUser} />
      <AnimatedMain>{children}</AnimatedMain>
    </div>
  );
}

const shell: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    minHeight: "100vh",
    background: "var(--bg-canvas)",
  },
};
