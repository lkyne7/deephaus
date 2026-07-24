import "server-only";

import { revalidateTag } from "next/cache";
import { bumpUserStudyCacheEpoch } from "@/lib/cache/study-cache-epoch";
import { dashboardStatsTag, studyDecksTag } from "@/lib/cache/tags";

/** Drop server-side stats caches after a mutation that changes deck lists/queues. */
export function invalidateUserStudyCaches(userId: string): void {
  bumpUserStudyCacheEpoch(userId);
  revalidateTag(dashboardStatsTag(userId));
  revalidateTag(studyDecksTag(userId));
}
