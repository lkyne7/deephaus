import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: users } = await supabase.auth.admin.listUsers();
for (const u of users!.users) console.log(u.id, u.email);

const { data: edStudy } = await supabase
  .from("projects")
  .select("id, user_id, name")
  .eq("name", "ED Study")
  .limit(1);
console.log("ED Study owner:", edStudy?.[0]?.user_id);

const owner = edStudy?.[0]?.user_id;
if (owner) {
  const { error } = await supabase
    .from("projects")
    .update({ user_id: owner })
    .eq("id", "16e7c06e-973b-4c5d-9444-4e26bf05578e");
  console.log("demo project reassigned:", error?.message ?? "ok");
}
