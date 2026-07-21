"use client";

import {
  buildOcclusionCardFront,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { useEffect, useMemo, useState } from "react";
import { ImageOcclusionEditor } from "@/components/image-occlusion/image-occlusion-editor";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { apiFetch } from "@/lib/api/fetch";

export type SourceImageOcclusionTarget = {
  sourceId: string;
  imageUrl: string;
  sourceRef: string | null;
};

type Props = {
  target: SourceImageOcclusionTarget;
  disabled?: boolean;
  onClose: () => void;
  onCreate: (payload: {
    front: string;
    occlusionData: ImageOcclusionData;
    sourceId: string;
    sourceRef: string | null;
  }) => Promise<void>;
};

const pendingDetectionRequests = new Map<string, Promise<ImageOcclusionData>>();

function detectSourceImage(target: SourceImageOcclusionTarget): Promise<ImageOcclusionData> {
  const key = `${target.sourceId}\n${target.imageUrl}`;
  const existing = pendingDetectionRequests.get(key);
  if (existing) return existing;

  const request = apiFetch(
    `/api/sources/${target.sourceId}/occlusion/auto-detect`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: target.imageUrl }),
    },
  )
    .then(async (response) => {
      const body = (await response.json().catch(() => null)) as
        | { occlusion_data?: ImageOcclusionData; error?: string }
        | null;
      if (!response.ok || !body?.occlusion_data) {
        throw new Error(body?.error ?? "Could not detect image labels.");
      }
      return body.occlusion_data;
    })
    .finally(() => {
      pendingDetectionRequests.delete(key);
    });

  pendingDetectionRequests.set(key, request);
  return request;
}

export function SourceImageOcclusionDialog({
  target,
  disabled = false,
  onClose,
  onCreate,
}: Props) {
  const [data, setData] = useState<ImageOcclusionData>({
    imageUrl: target.imageUrl,
    rects: [],
  });
  const [title, setTitle] = useState(target.sourceRef ?? "");
  const [detecting, setDetecting] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData({ imageUrl: target.imageUrl, rects: [] });
    setTitle(target.sourceRef ?? "");
    setDetecting(true);
    setError(null);

    void (async () => {
      try {
        const occlusionData = await detectSourceImage(target);
        if (!cancelled) setData(occlusionData);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? `${cause.message} You can still draw regions manually.`
              : "Could not detect image labels. You can still draw regions manually.",
          );
        }
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target.imageUrl, target.sourceId, target.sourceRef]);

  const enabledRegionCount = useMemo(
    () => data.rects.filter((rect) => rect.enabled !== false).length,
    [data.rects],
  );
  const busy = disabled || detecting || creating;

  async function createCard() {
    if (busy || enabledRegionCount === 0) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate({
        front: buildOcclusionCardFront(data.imageUrl, title.trim()),
        occlusionData: data,
        sourceId: target.sourceId,
        sourceRef: target.sourceRef,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create image-occlusion card.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AnimatedModal
      title="Create image occlusion"
      onClose={busy ? () => undefined : onClose}
      maxWidth={900}
    >
      <div style={s.body}>
        <label style={s.field}>
          <span className="field-label">Card title (optional)</span>
          <input
            className="input"
            value={title}
            disabled={busy}
            placeholder="Shown above the image"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        {detecting ? (
          <div style={s.detecting} role="status">
            <i className="ri-loader-4-line icon-spin" aria-hidden />
            Detecting labels…
          </div>
        ) : null}

        <ImageOcclusionEditor
          data={data}
          disabled={disabled || creating}
          onChange={setData}
        />

        {error ? (
          <p style={s.error} role="alert">
            {error}
          </p>
        ) : null}

        <div style={s.footer}>
          <span style={s.hint}>
            {enabledRegionCount === 0
              ? "Draw at least one region to create the card."
              : `${enabledRegionCount} region${enabledRegionCount === 1 ? "" : "s"} ready`}
          </span>
          <div style={s.actions}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void createCard()}
              disabled={busy || enabledRegionCount === 0}
            >
              {creating ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
              Create card
            </button>
          </div>
        </div>
      </div>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  detecting: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  error: {
    margin: 0,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  hint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
  },
};
