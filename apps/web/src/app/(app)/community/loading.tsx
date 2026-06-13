import { CommunityGridSkeleton } from "@/components/ui/skeleton-patterns";

export default function CommunityLoading() {
  return (
    <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
      <CommunityGridSkeleton />
    </div>
  );
}
