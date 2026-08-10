import type { CramPlanStatus } from "@deephaus/api-client";
import type { BadgeTone } from "@/components/ui/badge-pill";

/** Matches web: Active → Draft → Paused → Completed → Archived. */
const STATUS_RANK: Record<CramPlanStatus, number> = {
  active: 0,
  draft: 1,
  paused: 2,
  completed: 3,
  archived: 4,
};

/** Default list order used on web and mobile. Status first, then soonest deadline. */
export function compareCramPlansByDefault(
  a: { status: CramPlanStatus; deadline_at?: string | null },
  b: { status: CramPlanStatus; deadline_at?: string | null },
): number {
  const byStatus = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (byStatus !== 0) return byStatus;
  const at = a.deadline_at ? new Date(a.deadline_at).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = b.deadline_at ? new Date(b.deadline_at).getTime() : Number.MAX_SAFE_INTEGER;
  return at - bt;
}

export function cramStatusLabel(status: CramPlanStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
  }
}

/** Matches web chip classes: active→chip-new, paused→chip-due, draft→chip-learning, else→chip-neutral. */
export function cramStatusTone(status: CramPlanStatus): BadgeTone {
  switch (status) {
    case "active":
      return "brand";
    case "paused":
      return "orange";
    case "draft":
      return "again";
    case "completed":
    case "archived":
    default:
      return "gray";
  }
}

export function readinessPct(readiness: number): number {
  return Math.round(Math.max(0, Math.min(1, readiness)) * 100);
}

export function deadlineCountdown(deadlineAt: string): string {
  const ms = new Date(deadlineAt).getTime() - Date.now();
  if (ms <= 0) return "Deadline passed";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days left`;
  if (days === 1) return "1 day left";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left`;
  return "Due within the hour";
}

export function formatDeadline(deadlineAt: string, timeZone?: string): string {
  try {
    return new Date(deadlineAt).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return new Date(deadlineAt).toDateString();
  }
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
