/* End-to-end seeding test against the live Supabase project: uploads the PDF
 * fixture to storage, runs buildSourceDocument (the same call the document API
 * makes), prints the resulting doc structure, then cleans everything up.
 * Run from apps/web:
 *   NODE_OPTIONS="--conditions=react-server" pnpm dlx tsx .imgtest/seed-doc.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildSourceDocument } from "../src/lib/sources/source-document";

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

// Any real user works — media paths are namespaced by user id.
const { data: users } = await supabase.auth.admin.listUsers();
const userId = users?.users?.[0]?.id;
if (!userId) throw new Error("no users");
console.log("user:", userId);

const { data: project, error: projErr } = await supabase
  .from("projects")
  .insert({ user_id: userId, name: "imgtest-tmp", deck_name: "imgtest-tmp" })
  .select()
  .single();
if (projErr) throw projErr;

const pdf = readFileSync(join(process.cwd(), ".imgtest", "out", "fixture.pdf"));
const storagePath = `${userId}/${project.id}/${Date.now()}-fixture.pdf`;
const { error: upErr } = await supabase.storage
  .from("pdfs")
  .upload(storagePath, pdf, { contentType: "application/pdf" });
if (upErr) throw upErr;

const { data: source, error: srcErr } = await supabase
  .from("sources")
  .insert({
    project_id: project.id,
    type: "pdf",
    title: "fixture.pdf",
    raw_text: "",
    storage_path: storagePath,
    page_count: 2,
  })
  .select()
  .single();
if (srcErr) throw srcErr;

try {
  console.log("\n--- buildSourceDocument (extract_images default) ---");
  const t0 = Date.now();
  const { content, rawText } = await buildSourceDocument(supabase, userId, {
    id: source.id,
    type: "pdf",
    raw_text: source.raw_text,
    storage_path: storagePath,
    extract_images: (source as { extract_images?: boolean }).extract_images ?? null,
  });
  console.log(`built in ${Date.now() - t0}ms`);
  for (const node of content.content ?? []) {
    if (node.type === "image") {
      console.log(`  [image] ${String(node.attrs?.src).slice(0, 96)}`);
    } else {
      const text = (node.content ?? [])
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      const marks = (node.content ?? [])
        .flatMap((c) => c.marks?.map((m) => m.type) ?? [])
        .filter((v, i, a) => a.indexOf(v) === i);
      console.log(
        `  ${node.type}${node.attrs?.level ? node.attrs.level : ""}: ${text.slice(0, 70)}${marks.length ? `  {${marks.join(",")}}` : ""}`,
      );
    }
  }
  console.log("rawText healed:", rawText ? `${rawText.length} chars` : "null");

  console.log("\n--- buildSourceDocument (extract_images = false) ---");
  const { content: noImg } = await buildSourceDocument(supabase, userId, {
    id: source.id,
    type: "pdf",
    raw_text: source.raw_text,
    storage_path: storagePath,
    extract_images: false,
  });
  const imgCount = (noImg.content ?? []).filter((n) => n.type === "image").length;
  console.log(`image nodes with extraction off: ${imgCount}`);
} finally {
  await supabase.from("sources").delete().eq("id", source.id);
  await supabase.from("projects").delete().eq("id", project.id);
  await supabase.storage.from("pdfs").remove([storagePath]);
  const { data: media } = await supabase.storage
    .from("card-media")
    .list(`${userId}/source-media/${source.id}`);
  if (media?.length) {
    await supabase.storage
      .from("card-media")
      .remove(media.map((m) => `${userId}/source-media/${source.id}/${m.name}`));
  }
  console.log("\ncleaned up");
}
