import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/fsrs/stats";

/**
 *   GET /api/stats/dashboard
 *
 * Aggregated review stats for the current user used by the dashboard's stat
 * cards (today's reviews, current streak, retention %, due-now totals, etc.).
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const supabase = await createClient();
  const stats = await getDashboardStats(supabase, user!.id);
  return NextResponse.json(stats);
}
