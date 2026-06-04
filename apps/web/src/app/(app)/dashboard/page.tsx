import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { getAuthUser } from "@/lib/data/server-auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getAuthUser();

  if (!user) {
    return <div style={{ padding: 40 }}>Please sign in.</div>;
  }

  return (
    <div style={{ padding: "32px 40px" }}>
      <DashboardContent userId={user.id} />
    </div>
  );
}
