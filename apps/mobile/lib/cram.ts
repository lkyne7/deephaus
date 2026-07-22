import type { CramPlanStatus } from "@deephaus/api-client";
import type { BadgeTone } from "@/components/ui/badge-pill";

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

export function cramStatusTone(status: CramPlanStatus): BadgeTone {
  switch (status) {
    case "active":
      return "good";
    case "paused":
      return "orange";
    case "completed":
      return "brand";
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
