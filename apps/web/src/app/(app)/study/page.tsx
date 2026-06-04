import { Suspense } from "react";
import { StudyContent } from "@/app/(app)/study/study-content";
import { DecksSectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { getAuthUser } from "@/lib/data/server-auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function StudyPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  return (
    <div style={{ padding: "32px 40px" }}>
      <Suspense fallback={<DecksSectionSkeleton />}>
        <StudyContent userId={user.id} />
      </Suspense>
    </div>
  );
}
