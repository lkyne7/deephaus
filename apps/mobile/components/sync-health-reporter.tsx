import { useEffect } from "react";
import { useQuery, useStatus } from "@powersync/react";
import { posthog } from "@/lib/posthog";
export function SyncHealthReporter() {
  const status = useStatus();
  const { data } = useQuery<{ count: number }>(
    "SELECT COUNT(*) count FROM ps_crud",
  );
  const pending = Number(data?.[0]?.count ?? 0);
  useEffect(() => {
    if (status.uploadError)
      posthog.capture("sync_upload_failed", { pending_count: pending });
  }, [status.uploadError, pending]);
  return null;
}
