import { DocumentSkeleton } from "@/components/ui/skeleton-patterns";

export default function NoteDetailLoading() {
  return (
    <div style={{ height: "100%", minHeight: 0, background: "var(--white)" }} aria-busy aria-label="Loading note">
      <DocumentSkeleton />
    </div>
  );
}
