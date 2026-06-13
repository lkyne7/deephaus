import { DeckOverviewSkeleton } from "@/components/ui/skeleton-patterns";

export default function DeckLoading() {
  return (
    <div style={{ padding: "32px 40px" }}>
      <DeckOverviewSkeleton />
    </div>
  );
}
