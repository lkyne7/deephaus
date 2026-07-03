import { Suspense } from "react";
import { NotesClientView } from "@/components/notes/notes-client-view";
import { CardListSkeleton } from "@/components/ui/skeleton-patterns";

export default function NotesPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "32px 40px" }}>
          <CardListSkeleton />
        </div>
      }
    >
      <NotesClientView />
    </Suspense>
  );
}
