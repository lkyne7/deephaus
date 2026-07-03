/* Drives the real generation processor (occlusion-only settings) against the
 * PDF fixture, then prints the created image-occlusion cards. Cleans up after.
 * Run from apps/web:
 *   NODE_OPTIONS="--conditions=react-server" pnpm dlx tsx .imgtest/occlusion-e2e.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { extractSourceFromFile } from "../src/lib/sources/extract-source";
import { processGenerationJob } from "../src/lib/jobs/processor";

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: users } = await supabase.auth.admin.listUsers();
const userId = users!.users[0]!.id;

const { data: project } = await supabase
  .from("projects")
  .insert({
    user_id: userId,
    name: "imgtest-occl",
    deck_name: "imgtest-occl",
    settings: { cardMix: "basic", cardTypes: [], autoImageOcclusion: true, detailLevel: "medium" },
  })
  .select()
  .single();

const pdf = readFileSync(join(process.cwd(), ".imgtest", "out", "fixture.pdf"));
const extracted = await extractSourceFromFile(pdf, "fixture.pdf", "application/pdf");
const storagePath = `${userId}/${project!.id}/${Date.now()}-fixture.pdf`;
await supabase.storage.from("pdfs").upload(storagePath, pdf, { contentType: "application/pdf" });

const { data: source } = await supabase
  .from("sources")
  .insert({
    project_id: project!.id,
    type: "pdf",
    title: "fixture.pdf",
    raw_text: extracted.text,
    storage_path: storagePath,
    page_count: extracted.pageCount,
  })
  .select()
  .single();

const { data: job } = await supabase
  .from("generation_jobs")
  .insert({ source_id: source!.id, status: "pending", progress: 0 })
  .select()
  .single();

try {
  const t0 = Date.now();
  await processGenerationJob(job!.id, supabase);
  const { data: finalJob } = await supabase
    .from("generation_jobs")
    .select("status, error")
    .eq("id", job!.id)
    .single();
  console.log(`job finished in ${Date.now() - t0}ms →`, finalJob?.status, finalJob?.error ?? "");

  const { data: cards } = await supabase
    .from("cards")
    .select("type, front, tags, source_ref, source_chunk_id, occlusion_data")
    .eq("job_id", job!.id);
  console.log(`cards created: ${cards?.length ?? 0}`);
  for (const card of cards ?? []) {
    const od = card.occlusion_data as { imageUrl?: string; rects?: { label?: string }[] } | null;
    console.log(
      `  [${card.type}] ref=${card.source_ref} chunkLinked=${Boolean(card.source_chunk_id)} rects=${od?.rects?.length ?? 0}`,
    );
    for (const rect of od?.rects ?? []) console.log(`     - ${rect.label}`);
    if (od?.imageUrl) console.log(`     img: ${od.imageUrl.slice(0, 100)}`);
  }
} finally {
  const { data: cardRows } = await supabase.from("cards").select("id").eq("job_id", job!.id);
  if (cardRows?.length) await supabase.from("cards").delete().eq("job_id", job!.id);
  await supabase.from("generation_jobs").delete().eq("id", job!.id);
  await supabase.from("sources").delete().eq("id", source!.id);
  await supabase.from("projects").delete().eq("id", project!.id);
  await supabase.storage.from("pdfs").remove([storagePath]);
  const { data: media } = await supabase.storage
    .from("card-media")
    .list(`${userId}/auto-occlusion/${job!.id}`);
  if (media?.length) {
    await supabase.storage
      .from("card-media")
      .remove(media.map((m) => `${userId}/auto-occlusion/${job!.id}/${m.name}`));
  }
  console.log("cleaned up");
}
