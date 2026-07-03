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

const LUKE = "93b424b3-9e91-46c3-b8b8-2c54d0cc6cad";
const PROJECT = "16e7c06e-973b-4c5d-9444-4e26bf05578e";
const SOURCE = "e41ad26b-9524-4244-b045-5a5da46ae2af";

const pdf = readFileSync(join(process.cwd(), ".imgtest", "out", "fixture.pdf"));
const newPath = `${LUKE}/${PROJECT}/${Date.now()}-cell-biology.pdf`;
const { error: upErr } = await supabase.storage
  .from("pdfs")
  .upload(newPath, pdf, { contentType: "application/pdf" });
if (upErr) throw upErr;

const { data: old } = await supabase.from("sources").select("storage_path").eq("id", SOURCE).single();
const { error } = await supabase.from("sources").update({ storage_path: newPath }).eq("id", SOURCE);
console.log("source updated:", error?.message ?? "ok");
if (old?.storage_path) await supabase.storage.from("pdfs").remove([old.storage_path]);
console.log("new path:", newPath);
