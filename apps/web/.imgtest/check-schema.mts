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

async function check(label: string, fn: () => Promise<boolean>) {
  const ok = await fn();
  console.log(`${ok ? "OK" : "MISSING"}  ${label}`);
  return ok;
}

const results = await Promise.all([
  check("REST API reachable", async () => {
    const { error } = await supabase.from("projects").select("id").limit(1);
    return !error;
  }),
  check("sources.extract_images column", async () => {
    const { error } = await supabase.from("sources").select("extract_images").limit(1);
    return !error;
  }),
  check("api_tokens table", async () => {
    const { error } = await supabase.from("api_tokens").select("id").limit(1);
    return !error;
  }),
  check("Cram Plan tables", async () => {
    const results = await Promise.all([
      supabase.from("cram_plans").select("id").limit(1),
      supabase.from("cram_plan_items").select("id").limit(1),
      supabase.from("cram_plan_deck_profiles").select("id").limit(1),
      supabase.from("cram_review_logs").select("id").limit(1),
    ]);
    return results.every(({ error }) => !error);
  }),
  check("record_cram_review RPC", async () => {
    const { error } = await supabase.rpc("record_cram_review", {
      p_plan_id: "00000000-0000-0000-0000-000000000000",
      p_item_id: "00000000-0000-0000-0000-000000000000",
      p_rating: 3,
      p_expected_version: 0,
      p_next_state: {},
      p_log: {},
      p_response_ms: 0,
    });
    return !error || error.code !== "PGRST202";
  }),
  check("browse_cards RPC", async () => {
    const { error } = await supabase.rpc("browse_cards", {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_limit: 0,
    });
    return !error;
  }),
]);
const allOk = results.every(Boolean);

console.log(
  process.env.SUPABASE_ACCESS_TOKEN
    ? "OK  Supabase CLI token (SUPABASE_ACCESS_TOKEN set)"
    : "WARN  Supabase CLI not authenticated (run: pnpm supabase:login)",
);

process.exit(allOk ? 0 : 1);
