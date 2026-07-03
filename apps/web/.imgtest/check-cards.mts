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

const { data: cards } = await supabase
  .from("cards")
  .select("id, type, source_ref, occlusion_data, generation_jobs!inner(source_id, sources!inner(project_id))")
  .eq("type", "image-occlusion")
  .eq("generation_jobs.sources.project_id", "16e7c06e-973b-4c5d-9444-4e26bf05578e");

for (const card of cards ?? []) {
  const od = card.occlusion_data as { rects?: { label?: string; x: number; y: number; width: number; height: number }[] } | null;
  console.log(`card ${card.id} ref=${card.source_ref} rects=${od?.rects?.length ?? 0}`);
  for (const r of od?.rects ?? []) {
    console.log(`  "${r.label}" @ ${(r.x * 100).toFixed(0)},${(r.y * 100).toFixed(0)} ${(r.width * 100).toFixed(0)}x${(r.height * 100).toFixed(0)}`);
  }
}
