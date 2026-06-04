import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Cached per-request so layout + pages share one auth round-trip. */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export type UserProjectRow = {
  id: string;
  name: string;
  deck_name: string | null;
  settings: unknown;
};

/** Cached per-request project list for the signed-in user. */
export const getUserProjects = cache(async (userId: string): Promise<UserProjectRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, deck_name, settings")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as UserProjectRow[];
});

/** Sidebar deck list only — waiting counts load client-side after paint. */
export const getSidebarDecks = cache(async (userId: string) => {
  const projects = await getUserProjects(userId);
  return projects.map((d) => ({ id: d.id, name: d.deck_name || d.name }));
});
