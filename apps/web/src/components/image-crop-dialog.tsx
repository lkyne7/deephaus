"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";

type CropRect = { x: number; y: number; width: number; height: number };

type Props = {
  imageUrl: string;
  onClose: () => void;
  onCrop: (file: File) => Promise<void>;
};

const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function ImageCropDialog({ imageUrl, onClose, onCrop }: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setDisplayUrl(null);
    setError(null);
    void fetch(imageUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load this image for cropping.");
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setDisplayUrl(objectUrl);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load this image.");
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl]);

  function pointFromEvent(event: React.PointerEvent): { x: number; y: number } {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / Math.max(box.width, 1)),
      y: clamp((event.clientY - box.top) / Math.max(box.height, 1)),
    };
  }

  async function saveCrop() {
    const image = imageRef.current;
    if (!image || !displayUrl || working) return;
    setWorking(true);
    setError(null);
    try {
      const sourceWidth = image.naturalWidth;
      const sourceHeight = image.naturalHeight;
      const sx = Math.round(crop.x * sourceWidth);
      const sy = Math.round(crop.y * sourceHeight);
      const sw = Math.max(1, Math.round(crop.width * sourceWidth));
      const sh = Math.max(1, Math.round(crop.height * sourceHeight));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Cropping is not supported in this browser.");
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png", 0.95),
      );
      if (!blob) throw new Error("Could not create the cropped image.");
      await onCrop(new File([blob], `cropped-${Date.now()}.png`, { type: "image/png" }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not crop this image.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AnimatedModal title="Crop image" onClose={working ? () => undefined : onClose} maxWidth={900}>
      <div style={s.root}>
        <p style={s.hint}>Drag over the image to choose the area you want to keep.</p>
        <div style={s.stage}>
          {displayUrl ? (
            <div
              style={s.imageWrap}
              onPointerDown={(event) => {
                if (working) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                const point = pointFromEvent(event);
                startRef.current = point;
                setCrop({ x: point.x, y: point.y, width: 0, height: 0 });
              }}
              onPointerMove={(event) => {
                if (!startRef.current || working) return;
                const point = pointFromEvent(event);
                const start = startRef.current;
                setCrop({
                  x: Math.min(start.x, point.x),
                  y: Math.min(start.y, point.y),
                  width: Math.abs(point.x - start.x),
                  height: Math.abs(point.y - start.y),
                });
              }}
              onPointerUp={() => {
                startRef.current = null;
                setCrop((current) =>
                  current.width < 0.02 || current.height < 0.02 ? FULL_CROP : current,
                );
              }}
              onPointerCancel={() => {
                startRef.current = null;
              }}
            >
              <img ref={imageRef} src={displayUrl} alt="" draggable={false} style={s.image} />
              <div
                style={{
                  ...s.crop,
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`,
                }}
              >
                <span style={{ ...s.handle, left: -5, top: -5 }} />
                <span style={{ ...s.handle, right: -5, top: -5 }} />
                <span style={{ ...s.handle, left: -5, bottom: -5 }} />
                <span style={{ ...s.handle, right: -5, bottom: -5 }} />
              </div>
            </div>
          ) : (
            <div style={s.loading}>
              <i className="ri-loader-4-line icon-spin" aria-hidden />
              Loading image…
            </div>
          )}
        </div>
        {error ? (
          <p role="alert" style={s.error}>
            {error}
          </p>
        ) : null}
        <div style={s.footer}>
          <button type="button" className="btn btn-ghost" disabled={working} onClick={() => setCrop(FULL_CROP)}>
            Reset
          </button>
          <div style={s.actions}>
            <button type="button" className="btn btn-ghost" disabled={working} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={working || !displayUrl}
              onClick={() => void saveCrop()}
            >
              {working ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
              Crop and save
            </button>
          </div>
        </div>
      </div>
    </AnimatedModal>
  );
}

export async function downloadImage(imageUrl: string, filename = "image"): Promise<void> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  } catch {
    const anchor = document.createElement("a");
    anchor.href = imageUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }
}

const s: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: 14 },
  hint: { margin: 0, font: "400 13px/18px var(--font-sans)", color: "var(--fg-4)" },
  stage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 320,
    maxHeight: "65vh",
    padding: 12,
    overflow: "auto",
    borderRadius: 10,
    background: "#17191c",
  },
  imageWrap: {
    position: "relative",
    display: "inline-flex",
    maxWidth: "100%",
    maxHeight: "60vh",
    cursor: "crosshair",
    touchAction: "none",
    userSelect: "none",
  },
  image: {
    display: "block",
    maxWidth: "100%",
    maxHeight: "60vh",
    width: "auto",
    height: "auto",
    pointerEvents: "none",
  },
  crop: {
    position: "absolute",
    border: "2px solid white",
    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
    boxSizing: "border-box",
    pointerEvents: "none",
  },
  handle: {
    position: "absolute",
    width: 8,
    height: 8,
    border: "1px solid #344054",
    background: "white",
  },
  loading: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "white",
    font: "500 13px/18px var(--font-sans)",
  },
  error: { margin: 0, color: "var(--grade-again)", font: "400 13px/18px var(--font-sans)" },
  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  actions: { display: "flex", alignItems: "center", gap: 8 },
};
