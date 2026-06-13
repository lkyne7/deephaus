import { StudyCardSkeleton } from "@/components/ui/skeleton-patterns";

export default function DeckStudyLoading() {
  return (
    <div style={{ padding: "32px 40px" }}>
      <StudyCardSkeleton />
    </div>
  );
}
