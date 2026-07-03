/* Seed a persistent demo project + PDF source for browser verification. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { extractSourceFromFile } from "../src/lib/sources/extract-source";

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
    name: "Image extraction demo",
    deck_name: "Image extraction demo",
    settings: { cardMix: "basic", cardTypes: ["basic"], autoImageOcclusion: true, detailLevel: "medium" },
  })
  .select()
  .single();

const pdf = readFileSync(join(process.cwd(), ".imgtest", "out", "fixture.pdf"));
const extracted = await extractSourceFromFile(pdf, "cell-biology.pdf", "application/pdf");
const storagePath = `${userId}/${project!.id}/${Date.now()}-cell-biology.pdf`;
await supabase.storage.from("pdfs").upload(storagePath, pdf, { contentType: "application/pdf" });

const { data: source } = await supabase
  .from("sources")
  .insert({
    project_id: project!.id,
    type: "pdf",
    title: "cell-biology.pdf",
    raw_text: extracted.text,
    storage_path: storagePath,
    page_count: extracted.pageCount,
  })
  .select()
  .single();

console.log("project:", project!.id);
console.log("source:", source!.id);
console.log(`open: http://localhost:3000/decks/new?deck=${project!.id}`);
