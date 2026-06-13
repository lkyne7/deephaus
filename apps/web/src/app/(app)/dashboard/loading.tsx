import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

export default function DashboardLoading() {
  return (
    <div style={{ padding: "32px 40px" }}>
      <DashboardSkeleton />
    </div>
  );
}
