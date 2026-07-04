import { CardListSkeleton } from "@/components/ui/skeleton-patterns";

export default function NotesLoading() {
  return (
    <div style={{ padding: "32px 40px" }}>
      <CardListSkeleton />
    </div>
  );
}
