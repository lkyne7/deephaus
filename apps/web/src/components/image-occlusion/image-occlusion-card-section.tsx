"use client";

import {
  buildOcclusionCardFront,
  imageUrlFromCardFields,
  parseImageOcclusionData,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageOcclusionEditor } from "@/components/image-occlusion/image-occlusion-editor";
import { apiFetch } from "@/lib/api/fetch";
import { occlusionDataEqual } from "@/lib/occlusion/sync-occlusion-data";

type Props = {
  cardId: string;
  front: string | null;
  back: string | null;
  occlusionData: unknown;
  disabled?: boolean;
  onChange: (patch: {
    type: "image-occlusion";
    front: string;
    back: string | null;
    occlusion_data: ImageOcclusionData;
  }) => void;
};

function headerFromFront(front: string | null | undefined): string {
  return (front ?? "").replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
}

function occlusionDataFromProps(
  occlusionData: unknown,
  imageUrl: string | null,
): ImageOcclusionData | null {
  const parsed = parseImageOcclusionData(occlusionData);
  if (parsed) return parsed;
  if (imageUrl) return { imageUrl, rects: [] };
  return null;
}

export function ImageOcclusionCardSection({
  cardId,
  front,
  back,
  occlusionData,
  disabled,
  onChange,
}: Props) {
  const imageUrl = useMemo(
    () => parseImageOcclusionData(occlusionData)?.imageUrl ?? imageUrlFromCardFields(front, back),
    [occlusionData, front, back],
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [data, setData] = useState<ImageOcclusionData | null>(() =>
    occlusionDataFromProps(occlusionData, imageUrl),
  );
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [header, setHeader] = useState(() => headerFromFront(front));

  const lastEmittedRef = useRef<string | null>(null);
  const userEditRef = useRef(false);
  const cardIdRef = useRef(cardId);

  const emit = useCallback((next: ImageOcclusionData, nextHeader = header) => {
    lastEmittedRef.current = JSON.stringify(next);
    onChangeRef.current({
      type: "image-occlusion",
      front: buildOcclusionCardFront(next.imageUrl, nextHeader),
      back: back ?? null,
      occlusion_data: next,
    });
  }, [back, header]);

  useEffect(() => {
    const isNewCard = cardIdRef.current !== cardId;
    if (isNewCard) {
      cardIdRef.current = cardId;
      userEditRef.current = false;
      const nextData = occlusionDataFromProps(occlusionData, imageUrl);
      setData(nextData);
      setHeader(headerFromFront(front));
      setAutoDetectError(null);
      lastEmittedRef.current = nextData ? JSON.stringify(nextData) : null;
      return;
    }
    if (userEditRef.current) return;

    const nextData = occlusionDataFromProps(occlusionData, imageUrl);
    setData((prev) => (occlusionDataEqual(prev, nextData) ? prev : nextData));
    if (nextData) {
      lastEmittedRef.current = JSON.stringify(nextData);
    }
    const nextHeader = headerFromFront(front);
    setHeader((prev) => (prev === nextHeader ? prev : nextHeader));
  }, [cardId, occlusionData, imageUrl, front]);

  const handleEditorChange = useCallback((next: ImageOcclusionData) => {
    userEditRef.current = true;
    setData(next);
  }, []);

  useEffect(() => {
    if (!data || !userEditRef.current) return;

    const serialized = JSON.stringify(data);
    if (serialized === lastEmittedRef.current) {
      userEditRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      userEditRef.current = false;
      emit(data);
    }, 280);
    return () => clearTimeout(timer);
  }, [data, emit]);

  async function runAutoDetect() {
    setAutoDetecting(true);
    setAutoDetectError(null);
    try {
      const res = await apiFetch(`/api/cards/${cardId}/occlusion/auto-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occlusion_data: data }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          typeof body?.error === "string"
            ? body.error
            : res.status === 401
              ? "Your session expired. Refresh the page and sign in again."
              : "Auto-detect failed";
        setAutoDetectError(message);
        return;
      }
      const body = (await res.json()) as { occlusion_data: ImageOcclusionData };
      userEditRef.current = false;
      setData(body.occlusion_data);
      emit(body.occlusion_data);
    } catch {
      setAutoDetectError("Auto-detect failed. Check your connection and try again.");
    } finally {
      setAutoDetecting(false);
    }
  }

  if (!imageUrl || !data) {
    return (
      <p style={{ font: "400 13px/18px var(--font-sans)", color: "var(--fg-tertiary)" }}>
        Upload an image first, then set up occlusion regions.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="field-label">Card title (optional)</span>
        <input
          className="input"
          value={header ?? ""}
          disabled={disabled}
          placeholder="Shown above the image"
          onChange={(e) => {
            const nextHeader = e.target.value;
            setHeader(nextHeader);
            emit(data, nextHeader);
          }}
        />
      </label>
      <ImageOcclusionEditor
        data={data}
        disabled={disabled}
        autoDetecting={autoDetecting}
        onAutoDetect={runAutoDetect}
        onChange={handleEditorChange}
      />
      {autoDetectError ? (
        <p
          role="alert"
          style={{
            font: "400 13px/18px var(--font-sans)",
            color: "var(--danger, #c0392b)",
            margin: 0,
          }}
        >
          {autoDetectError}
        </p>
      ) : null}
    </div>
  );
}
