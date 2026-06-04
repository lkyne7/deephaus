"use client";

import {
  clamp01,
  createOcclusionRectId,
  normalizeOcclusionRect,
  occlusionOrdLabel,
  occlusionRectOrd,
  type ImageOcclusionData,
  type OcclusionRect,
} from "@deephaus/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { OcclusionRegionEditInline } from "@/components/image-occlusion/occlusion-region-edit-inline";
import "./image-occlusion.css";

type Props = {
  data: ImageOcclusionData;
  onChange: (data: ImageOcclusionData) => void;
  onAutoDetect?: () => Promise<void>;
  autoDetecting?: boolean;
  disabled?: boolean;
};

type DraftRect = { x: number; y: number; width: number; height: number };

function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): DraftRect {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  const width = clamp01(Math.abs(b.x - a.x));
  const height = clamp01(Math.abs(b.y - a.y));
  return { x, y, width, height };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function normalizeRects(rects: OcclusionRect[]): OcclusionRect[] {
  return rects.map((r) => normalizeOcclusionRect({ ...r, enabled: true }));
}

export function ImageOcclusionEditor({
  data,
  onChange,
  onAutoDetect,
  autoDetecting = false,
  disabled = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const onChangeRef = useRef(onChange);
  dataRef.current = data;
  onChangeRef.current = onChange;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingRectId, setEditingRectId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<DraftRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const applyRects = useCallback((rects: OcclusionRect[]) => {
    onChangeRef.current({ ...dataRef.current, rects: normalizeRects(rects) });
  }, []);

  const patchRect = useCallback((id: string, patch: Partial<OcclusionRect>) => {
    applyRects(
      dataRef.current.rects.map((rect) =>
        rect.id === id ? { ...rect, ...patch } : rect,
      ),
    );
  }, [applyRects]);

  const removeRect = useCallback(
    (id: string) => {
      applyRects(dataRef.current.rects.filter((rect) => rect.id !== id));
      setSelectedId((current) => (current === id ? null : current));
      setEditingRectId((current) => (current === id ? null : current));
    },
    [applyRects],
  );

  useEffect(() => {
    if (!selectedId || disabled) return;
    const rectId: string = selectedId;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      removeRect(rectId);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, disabled, removeRect]);

  const pointerToNorm = useCallback((clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const box = el.getBoundingClientRect();
    return {
      x: clamp01((clientX - box.left) / box.width),
      y: clamp01((clientY - box.top) / box.height),
    };
  }, []);

  function onPointerDown(event: React.PointerEvent) {
    if (disabled) return;
    const target = event.target as HTMLElement;
    if (target.dataset.rectId) {
      const id = target.dataset.rectId;
      setSelectedId(id);
      setEditingRectId(null);
      wrapRef.current?.focus();
      return;
    }
    const point = pointerToNorm(event.clientX, event.clientY);
    startRef.current = point;
    setDrawing({ x: point.x, y: point.y, width: 0, height: 0 });
    setSelectedId(null);
    setEditingRectId(null);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!startRef.current || !drawing) return;
    const point = pointerToNorm(event.clientX, event.clientY);
    setDrawing(rectFromPoints(startRef.current, point));
  }

  function onPointerUp(event: React.PointerEvent) {
    if (!startRef.current || !drawing) return;
    const point = pointerToNorm(event.clientX, event.clientY);
    const next = rectFromPoints(startRef.current, point);
    startRef.current = null;
    setDrawing(null);
    if (next.width < 0.02 || next.height < 0.02) return;
    const selected = dataRef.current.rects.find((rect) => rect.id === selectedId);
    const rect = normalizeOcclusionRect({
      id: createOcclusionRectId(),
      ...next,
      enabled: true,
      ord: selected ? occlusionRectOrd(selected) : 1,
    });
    applyRects([...dataRef.current.rects, rect]);
    setSelectedId(rect.id);
    wrapRef.current?.focus();
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function openRegionEditor(rectId: string) {
    setSelectedId(rectId);
    setEditingRectId(rectId);
    wrapRef.current?.focus();
  }

  return (
    <div className="io-editor">
      <div className="io-toolbar">
        <span style={{ font: "400 12px/16px var(--font-sans)", color: "var(--fg-tertiary)" }}>
          Click and drag on the image to add a region
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {onAutoDetect ? (
            <span className="io-tooltip-wrap">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled || autoDetecting}
                onClick={() => void onAutoDetect()}
                aria-describedby="io-auto-occlude-tip"
              >
                <i
                  className={autoDetecting ? "ri-loader-4-line icon-spin" : "ri-sparkling-2-line"}
                />
                {autoDetecting ? "Detecting…" : "Auto-occlude"}
              </button>
              <span className="io-tooltip" role="tooltip" id="io-auto-occlude-tip">
                Works best on diagrams with printed text (e.g. anatomy figures). Draws a box
                around each word — add hints yourself to show clues over hidden regions while studying.
              </span>
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={disabled || data.rects.length === 0}
            onClick={() => {
              applyRects([]);
              setSelectedId(null);
              setEditingRectId(null);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="io-canvas-wrap"
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={data.imageUrl} alt="" draggable={false} />
        <svg className="io-svg is-drawing" viewBox="0 0 1 1" preserveAspectRatio="none">
          {data.rects.map((rect) => {
            const ord = occlusionRectOrd(rect);
            const isSelected = rect.id === selectedId;
            return (
              <rect
                key={rect.id}
                data-rect-id={rect.id}
                className={`io-rect io-rect--c${ord}${isSelected ? " is-selected" : ""}`}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={0.008}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {drawing ? (
            <rect
              className="io-rect is-selected"
              x={drawing.x}
              y={drawing.y}
              width={drawing.width}
              height={drawing.height}
              rx={0.008}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      </div>

      <div className="io-segment-box">
        <div className="io-segment-list">
          {data.rects.length === 0 ? (
            <p style={{ padding: 16, margin: 0, color: "var(--fg-tertiary)", fontSize: 13 }}>
              Drag on the image or use Auto-occlude to add regions.
            </p>
          ) : (
            data.rects.map((rect, index) => {
              const ord = occlusionRectOrd(rect);
              const hint = rect.label?.trim();
              const active = rect.id === selectedId;
              const editing = rect.id === editingRectId;
              return (
                <div
                  key={rect.id}
                  className={`io-segment-row${active ? " is-active" : ""}`}
                  onClick={() => {
                    setSelectedId(rect.id);
                    setEditingRectId(null);
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="io-segment-ref">
                      <button
                        type="button"
                        className={`io-segment-ord-btn io-segment-ord-btn--c${ord}${editing ? " is-editing" : ""}`}
                        disabled={disabled}
                        aria-expanded={editing}
                        aria-label={`Edit ${occlusionOrdLabel(ord)} region`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (editing) {
                            setEditingRectId(null);
                          } else {
                            openRegionEditor(rect.id);
                          }
                        }}
                      >
                        {occlusionOrdLabel(ord)}
                      </button>
                      Region {index + 1}
                      {hint && !editing ? (
                        <span className="io-segment-hint-tag">Hint</span>
                      ) : null}
                    </div>
                    {hint && !editing ? <div className="io-segment-preview">{hint}</div> : null}
                    {editing ? (
                      <OcclusionRegionEditInline
                        rect={rect}
                        disabled={disabled}
                        onOrdChange={(nextOrd) => patchRect(rect.id, { ord: nextOrd })}
                        onHintCommit={(label) => patchRect(rect.id, { label: label || undefined })}
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={disabled}
                    aria-label="Remove region"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRect(rect.id);
                    }}
                  >
                    <i className="ri-close-line" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
