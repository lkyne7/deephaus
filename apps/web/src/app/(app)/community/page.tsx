import { Suspense } from "react";
import { CommunityGridSkeleton } from "@/components/ui/skeleton-patterns";
import { CommunityContent } from "@/app/(app)/community/community-content";

export const dynamic = "force-dynamic";

export default function CommunityPage() {
  return (
    <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
      <Suspense fallback={<CommunityGridSkeleton />}>
        <CommunityContent />
      </Suspense>
    </div>
  );
}
