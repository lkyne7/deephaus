import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);

const service = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
);
const email = `pdf-occlusion-${Date.now()}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const { data: created, error: createError } = await service.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (createError || !created.user) {
  throw createError ?? new Error("Could not create the production test user");
}

const userId = created.user.id;
let projectId: string | undefined;
let sourceId: string | undefined;
let jobId: string | undefined;
let storagePath: string | undefined;

function countImageNodes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as { type?: string; content?: unknown[] };
  return (
    (record.type === "image" ? 1 : 0) +
    (record.content ?? []).reduce((count, child) => count + countImageNodes(child), 0)
  );
}

try {
  const { data: project, error: projectError } = await service
    .from("projects")
    .insert({
      user_id: userId,
      name: "Production PDF image regression",
      deck_name: "Production PDF image regression",
      settings: {
        cardMix: "basic",
        cardTypes: [],
        autoImageOcclusion: true,
        detailLevel: "medium",
      },
    })
    .select("id")
    .single();
  if (projectError || !project) throw projectError ?? new Error("Project insert failed");
  projectId = project.id;

  const pdf = readFileSync(join(process.cwd(), ".imgtest", "out", "fixture.pdf"));
  storagePath = `${userId}/${projectId}/${Date.now()}-fixture.pdf`;
  const { error: uploadError } = await service.storage
    .from("pdfs")
    .upload(storagePath, pdf, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { data: source, error: sourceError } = await service
    .from("sources")
    .insert({
      project_id: projectId,
      type: "pdf",
      title: "fixture.pdf",
      raw_text:
        "--- Page 1 ---\n\nCell biology diagram with labeled nucleus, mitochondria, ribosome, and membrane.",
      storage_path: storagePath,
      page_count: 2,
      extract_images: true,
    })
    .select("id")
    .single();
  if (sourceError || !source) throw sourceError ?? new Error("Source insert failed");
  sourceId = source.id;

  const auth = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session) {
    throw signInError ?? new Error("Production test sign-in failed");
  }
  const headers = {
    Authorization: `Bearer ${session.session.access_token}`,
    "Content-Type": "application/json",
  };

  const { data: extraction, error: extractionInsertError } = await service
    .from("source_extraction_jobs")
    .insert({
      source_id: sourceId,
      storage_path: storagePath,
      filename: "fixture.pdf",
      file_size: pdf.length,
      extract_images: true,
      requested_generation: {
        generate: true,
        settings: {
          cardMix: "basic",
          cardTypes: [],
          autoImageOcclusion: true,
          detailLevel: "medium",
        },
      },
    })
    .select("id")
    .single();
  if (extractionInsertError || !extraction) {
    throw extractionInsertError ?? new Error("Extraction job insert failed");
  }

  let extractionStatus = "";
  let extractionError: string | null = null;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const { data: current, error } = await service
      .from("source_extraction_jobs")
      .select("status, phase, progress, error, generation_job_id")
      .eq("id", extraction.id)
      .single();
    if (error) throw error;
    if (attempt === 0 || attempt % 5 === 0) {
      console.log(
        `extraction: ${current.status}/${current.phase} (${current.progress}%)`,
      );
    }
    if (current.generation_job_id) jobId = current.generation_job_id;
    if (current.status === "ready" || current.status === "failed") {
      extractionStatus = current.status;
      extractionError = current.error;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (extractionStatus !== "ready" || !jobId) {
    throw new Error(
      `Production extraction ${extractionStatus || "timed out"}: ${
        extractionError ?? "generation did not start"
      }`,
    );
  }
  console.log(`production job: ${jobId}`);

  let finalStatus = "";
  let finalError: string | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { data: job, error } = await service
      .from("generation_jobs")
      .select("status, progress, error")
      .eq("id", jobId)
      .single();
    if (error) throw error;
    if (attempt === 0 || attempt % 5 === 0) {
      console.log(`generation: ${job.status} (${job.progress}%)`);
    }
    if (job.status === "ready" || job.status === "failed") {
      finalStatus = job.status;
      finalError = job.error;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (finalStatus !== "ready") {
    throw new Error(`Production generation ${finalStatus || "timed out"}: ${finalError ?? ""}`);
  }

  const { data: cards, error: cardsError } = await service
    .from("cards")
    .select("id, type, source_ref, occlusion_data")
    .eq("job_id", jobId);
  if (cardsError) throw cardsError;
  const occlusionCards = (cards ?? []).filter((card) => card.type === "image-occlusion");
  const maskCount = occlusionCards.reduce((count, card) => {
    const data = card.occlusion_data as { rects?: unknown[] } | null;
    return count + (data?.rects?.length ?? 0);
  }, 0);
  if (!occlusionCards.length || !maskCount) {
    throw new Error("Production generation created no image-occlusion cards or masks");
  }
  console.log(
    `production deck: ${occlusionCards.length} image-occlusion card(s), ${maskCount} mask(s)`,
  );

  const documentResponse = await fetch(
    `https://www.deephaus.ai/api/sources/${sourceId}/document`,
    { headers },
  );
  const documentBody = (await documentResponse.json()) as {
    error?: string;
    content?: unknown;
  };
  if (!documentResponse.ok) {
    throw new Error(
      `Document request failed (${documentResponse.status}): ${documentBody.error ?? ""}`,
    );
  }
  const imageNodes = countImageNodes(documentBody.content);
  if (!imageNodes) {
    throw new Error("Production editable PDF document contained no image nodes");
  }
  console.log(`editable source: ${imageNodes} extracted image node(s)`);
} finally {
  if (jobId) {
    await service.from("cards").delete().eq("job_id", jobId);
    await service.from("generation_jobs").delete().eq("id", jobId);
  }
  if (sourceId) await service.from("sources").delete().eq("id", sourceId);
  if (projectId) await service.from("projects").delete().eq("id", projectId);
  if (storagePath) await service.storage.from("pdfs").remove([storagePath]);
  if (userId) await service.auth.admin.deleteUser(userId);
  console.log("production test data cleaned up");
}
