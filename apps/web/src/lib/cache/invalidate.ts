import "server-only";

import { revalidateTag } from "next/cache";
import { dashboardStatsTag, studyDecksTag } from "@/lib/cache/tags";

/** Drop server-side stats caches after a study action mutates queues or logs. */
export function invalidateUserStudyCaches(userId: string): void {
  revalidateTag(dashboardStatsTag(userId));
  revalidateTag(studyDecksTag(userId));
}
