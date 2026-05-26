import { NextResponse } from "next/server";
import { setRequestUserId } from "@/lib/perf/context";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  setRequestUserId(user.id);
  return { user, response: null };
}
