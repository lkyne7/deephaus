import { NoteCardGridSkeleton } from "@/components/ui/skeleton-patterns";

export default function NotesLoading() {
  return (
    <div style={{ padding: "32px 40px" }} aria-busy aria-label="Loading notes">
      <NoteCardGridSkeleton />
    </div>
  );
}
