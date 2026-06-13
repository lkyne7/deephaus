import { NextResponse } from "next/server";
import { setRequestUserId } from "@/lib/perf/context";
import { createClient, getRequestBearerToken } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const bearerToken = await getRequestBearerToken();
  let user = null;

  if (bearerToken) {
    const result = await supabase.auth.getUser(bearerToken);
    user = result.data.user;
  } else {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (!user) {
      const { data: sessionData } = await supabase.auth.getSession();
      user = sessionData.session?.user ?? null;
    }
  }

  if (!user) {
    return {
      user: null,
      supabase,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  setRequestUserId(user.id);
  return { user, supabase, response: null };
}
