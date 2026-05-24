"use client";

import { NavBar } from "@/components/auth-panel";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { GenerationJob, Project } from "@sluggo/shared";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [text, setText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [cardMix, setCardMix] = useState<"basic" | "cloze" | "both">("both");
  const [density, setDensity] = useState(5);
  const [focusPrompt, setFocusPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`/api/projects/${params.id}`)
      .then((r) => r.json())
      .then(setProject)
      .catch(() => setError("Failed to load project"));
  }, [params.id]);

  useEffect(() => {
    if (!job || job.status === "ready" || job.status === "failed") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (res.ok) {
        const updated = await res.json();
        setJob(updated);
        if (updated.status === "ready") {
          router.push(`/projects/${params.id}/review/${updated.id}`);
        }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [job, params.id, router]);

  async function submitText() {
    setBusy(true);
    setError(null);
    try {
      const sourceRes = await fetch("/api/sources/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: params.id, text }),
      });
      if (!sourceRes.ok) throw new Error(await sourceRes.text());
      const source = await sourceRes.json();
      await startGeneration(source.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitPdf() {
    if (!pdfFile) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("project_id", params.id);
      form.append("file", pdfFile);
      const sourceRes = await fetch("/api/sources/pdf", { method: "POST", body: form });
      if (!sourceRes.ok) throw new Error(await sourceRes.text());
      const source = await sourceRes.json();
      await startGeneration(source.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function startGeneration(sourceId: string) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_id: sourceId,
        settings: { cardMix, density, focusPrompt: focusPrompt || undefined },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    setJob(await res.json());
  }

  return (
    <>
      <NavBar />
      <main className="container stack">
        <div className="row">
          <Link href="/projects" className="muted">
            ← Projects
          </Link>
        </div>
        <h1>{project?.name ?? "Project"}</h1>
        <p className="muted">Deck: {project?.deck_name}</p>

        <section className="card stack">
          <h2>Generation settings</h2>
          <label className="label">Card mix</label>
          <select
            className="select"
            value={cardMix}
            onChange={(e) => setCardMix(e.target.value as typeof cardMix)}
          >
            <option value="both">Basic + Cloze</option>
            <option value="basic">Basic only</option>
            <option value="cloze">Cloze only</option>
          </select>
          <label className="label">Density (cards per 1k words)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
          />
          <label className="label">Focus prompt (optional)</label>
          <input
            className="input"
            value={focusPrompt}
            onChange={(e) => setFocusPrompt(e.target.value)}
            placeholder="Exam prep, definitions only…"
          />
        </section>

        <section className="grid grid-2">
          <div className="card stack">
            <h2>Paste text</h2>
            <textarea
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your notes here…"
            />
            <button
              className="btn btn-primary"
              disabled={busy || !text.trim()}
              onClick={() => void submitText()}
            >
              Generate from text
            </button>
          </div>

          <div className="card stack">
            <h2>Upload PDF</h2>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            />
            <p className="muted">Text-based PDFs only (max 25 MB). Scanned PDFs not supported yet.</p>
            <button
              className="btn btn-primary"
              disabled={busy || !pdfFile}
              onClick={() => void submitPdf()}
            >
              Generate from PDF
            </button>
          </div>
        </section>

        {job && (
          <section className="card stack">
            <div className="row">
              <h2>Generation status</h2>
              <span className={`badge badge-${job.status === "ready" ? "ready" : job.status === "failed" ? "failed" : ""}`}>
                {job.status}
              </span>
            </div>
            <div className="progress-bar">
              <span style={{ width: `${job.progress}%` }} />
            </div>
            {job.error && <p className="muted">{job.error}</p>}
            {job.status === "ready" && (
              <Link
                className="btn btn-primary"
                href={`/projects/${params.id}/review/${job.id}`}
              >
                Review cards
              </Link>
            )}
          </section>
        )}

        {error && <p className="muted">{error}</p>}
      </main>
    </>
  );
}
