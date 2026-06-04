import { Suspense } from "react";
import { ProfilePageSkeleton } from "@/components/ui/skeleton-patterns";
import { ProfileContent } from "@/app/(app)/profile/profile-content";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfilePageSkeleton />}>
      <ProfileContent />
    </Suspense>
  );
}
