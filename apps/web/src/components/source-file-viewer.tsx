"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceType } from "@deephaus/shared";

type FileResponse = {
  url: string;
  variant: "original" | "preview";
  filename: string;
};

type PreviewStatusResponse = {
  status: "ready" | "pending" | "processing" | "failed" | "none";
  error?: string;
};

type ViewerState =
  | { kind: "loading" }
  | { kind: "converting" }
  | { kind: "ready"; url: string; media: "pdf" | "video" }
  | { kind: "error"; message: string };

const PREVIEW_POLL_MS = 2500;
const PREVIEW_POLL_LIMIT = 120; // ~5 minutes

async function fetchJson<T>(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(input, { credentials: "include", ...init });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Inline viewer for a source's original uploaded document. PDFs (and PDF
 * previews of Office files) render in the browser's native viewer; videos use
 * a media element. Office originals are converted to PDF by the extraction
 * worker on first open.
 */
export function SourceFileViewer({
  sourceId,
  sourceType,
}: {
  sourceId: string;
  sourceType: SourceType;
}) {
  const [state, setState] = useState<ViewerState>({ kind: "loading" });
  const [downloading, setDownloading] = useState(false);
  const cancelledRef = useRef(false);

  const isOffice = sourceType === "docx" || sourceType === "pptx";
  const isVideo = sourceType === "video";

  const loadFile = useCallback(
    async (variant: "original" | "preview") => {
      const { ok, data } = await fetchJson<FileResponse & { error?: string }>(
        `/api/sources/${sourceId}/file?variant=${variant}`,
      );
      if (cancelledRef.current) return;
      if (!ok || !data?.url) {
        setState({
          kind: "error",
          message: data?.error ?? "Could not load the original document.",
        });
        return;
      }
      setState({ kind: "ready", url: data.url, media: isVideo ? "video" : "pdf" });
    },
    [sourceId, isVideo],
  );

  useEffect(() => {
    cancelledRef.current = false;
    setState({ kind: "loading" });

    void (async () => {
      if (!isOffice) {
        await loadFile("original");
        return;
      }

      // Office documents: use the worker-generated PDF preview, requesting the
      // conversion (idempotent) and polling until it's ready.
      const first = await fetchJson<PreviewStatusResponse & { error?: string }>(
        `/api/sources/${sourceId}/preview`,
        { method: "POST" },
      );
      if (cancelledRef.current) return;
      if (first.data?.status === "ready") {
        await loadFile("preview");
        return;
      }
      if (first.data?.status === "failed" || (!first.ok && first.status !== 202)) {
        setState({
          kind: "error",
          message:
            first.data?.error ??
            "The preview could not be generated. Download the original instead.",
        });
        return;
      }

      setState({ kind: "converting" });
      for (let attempt = 0; attempt < PREVIEW_POLL_LIMIT; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_MS));
        if (cancelledRef.current) return;
        const poll = await fetchJson<PreviewStatusResponse>(
          `/api/sources/${sourceId}/preview`,
        );
        if (cancelledRef.current) return;
        if (poll.data?.status === "ready") {
          await loadFile("preview");
          return;
        }
        if (poll.data?.status === "failed") {
          setState({
            kind: "error",
            message:
              poll.data.error ??
              "The preview could not be generated. Download the original instead.",
          });
          return;
        }
      }
      if (!cancelledRef.current) {
        setState({
          kind: "error",
          message: "The preview is taking too long. Download the original instead.",
        });
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [sourceId, isOffice, loadFile]);

  const downloadOriginal = useCallback(async () => {
    setDownloading(true);
    try {
      const { ok, data } = await fetchJson<FileResponse & { error?: string }>(
        `/api/sources/${sourceId}/file?variant=original&download=1`,
      );
      if (ok && data?.url) {
        const anchor = document.createElement("a");
        anchor.href = data.url;
        anchor.rel = "noreferrer";
        anchor.click();
      }
    } finally {
      setDownloading(false);
    }
  }, [sourceId]);

  const downloadButton = (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => void downloadOriginal()}
      disabled={downloading}
    >
      <i
        className={downloading ? "ri-loader-4-line icon-spin" : "ri-download-2-line"}
        aria-hidden
      />
      Download original
    </button>
  );

  if (state.kind === "loading" || state.kind === "converting") {
    return (
      <div style={s.centered}>
        <i className="ri-loader-4-line icon-spin" style={s.spinner} aria-hidden />
        <p style={s.message}>
          {state.kind === "converting"
            ? "Preparing a PDF preview of this document…"
            : "Loading the original document…"}
        </p>
        {state.kind === "converting" ? downloadButton : null}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div style={s.centered}>
        <i className="ri-file-damage-line" style={s.errorIcon} aria-hidden />
        <p style={s.message}>{state.message}</p>
        {downloadButton}
      </div>
    );
  }

  if (state.media === "video") {
    return (
      <div style={s.videoWrap}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user uploads carry no caption tracks */}
        <video src={state.url} controls style={s.video} />
      </div>
    );
  }

  return (
    <iframe
      src={state.url}
      title="Original document"
      style={s.frame}
      // Browser PDF viewers cannot initialize inside a sandboxed iframe.
      // The signed storage URL is cross-origin, so same-origin isolation still
      // prevents the document from accessing or scripting the application.
      referrerPolicy="no-referrer"
    />
  );
}

const s: Record<string, React.CSSProperties> = {
  frame: {
    flex: 1,
    width: "100%",
    height: "100%",
    minHeight: 0,
    border: 0,
    background: "var(--bg-surface-2)",
  },
  centered: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
    textAlign: "center",
  },
  spinner: {
    fontSize: 26,
    color: "var(--ink-300)",
  },
  errorIcon: {
    fontSize: 30,
    color: "var(--ink-300)",
  },
  message: {
    margin: 0,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-4)",
    maxWidth: 340,
  },
  videoWrap: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--ink-900)",
  },
  video: {
    maxWidth: "100%",
    maxHeight: "100%",
  },
};
