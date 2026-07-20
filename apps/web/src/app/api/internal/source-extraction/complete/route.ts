import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  runSourceGeneration,
  type SourceGenerationOptions,
} from "@/lib/jobs/source-with-generation";
import { createServiceClient } from "@/lib/supabase/server";

const bodySchema = z.object({ extraction_job_id: z.string().uuid() });

function authorized(request: Request): boolean {
  const configured = process.env.EXTRACTION_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sourceOwner(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const source = (value as { sources?: unknown }).sources;
  const sourceRow = Array.isArray(source) ? source[0] : source;
  if (!sourceRow || typeof sourceRow !== "object") return null;
  const project = (sourceRow as { projects?: unknown }).projects;
  const projectRow = Array.isArray(project) ? project[0] : project;
  if (!projectRow || typeof projectRow !== "object") return null;
  const userId = (projectRow as { user_id?: unknown }).user_id;
  return typeof userId === "string" ? userId : null;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const { extraction_job_id } = bodySchema.parse(await request.json());
    const supabase = createServiceClient();
    const { data: extractionJob, error } = await supabase
      .from("source_extraction_jobs")
      .select(
        "id, source_id, generation_job_id, requested_generation, sources!inner(projects!inner(user_id))",
      )
      .eq("id", extraction_job_id)
      .single();
    if (error || !extractionJob) {
      return NextResponse.json({ error: "Extraction job not found." }, { status: 404 });
    }
    if (extractionJob.generation_job_id) {
      return NextResponse.json({ generation_job_id: extractionJob.generation_job_id });
    }
    const userId = sourceOwner(extractionJob);
    if (!userId) throw new Error("Source owner could not be resolved.");
    const requested = (extractionJob.requested_generation ?? {}) as {
      settings?: SourceGenerationOptions["settings"];
      chunkIndices?: number[];
    };
    const result = await runSourceGeneration(
      supabase,
      userId,
      extractionJob.source_id,
      {
        settings: requested.settings,
        chunkIndices: requested.chunkIndices,
      },
      { allowProcessingExtraction: true },
    );
    await supabase
      .from("source_extraction_jobs")
      .update({
        generation_job_id: result.job.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", extraction_job_id);
    return NextResponse.json({ generation_job_id: result.job.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start generation." },
      { status: 500 },
    );
  }
}
