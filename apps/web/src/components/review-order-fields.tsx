"use client";

import { useEffect, useState } from "react";
import {
  MAX_REVIEWS_PER_DAY_LIMIT,
  NEW_CARD_POSITIONS,
  NEW_CARD_POSITION_LABELS,
  REVIEW_SORT_ORDERS,
  REVIEW_SORT_ORDER_LABELS,
  type NewCardPosition,
  type ReviewOrderSettings,
  type ReviewSortOrder,
} from "@deephaus/shared";

type Props = {
  value: ReviewOrderSettings;
  onChange: (next: ReviewOrderSettings) => void;
  disabled?: boolean;
  idPrefix: string;
  /** "settings" for the Study settings page rows, "panel" for a deck's settings panel. */
  variant: "settings" | "panel";
};

const HELP = {
  siblings:
    "After you study one gap of a cloze or image card, its other gaps wait until tomorrow, so one can't give away another.",
  position: "Cards you're still learning always come first.",
  order: "Most likely forgotten first helps most after a break, when there's a backlog.",
  cap: "Cards you're learning don't count. Reviews over the limit wait for another day. Leave empty for no limit.",
};

/** Anki-style review order and limits, shared by Study settings and each deck's panel. */
export function ReviewOrderFields({ value, onChange, disabled = false, idPrefix, variant }: Props) {
  const [capInput, setCapInput] = useState(value.maxReviewsPerDay == null ? "" : String(value.maxReviewsPerDay));
  useEffect(() => {
    setCapInput(value.maxReviewsPerDay == null ? "" : String(value.maxReviewsPerDay));
  }, [value.maxReviewsPerDay]);

  const set = (patch: Partial<ReviewOrderSettings>) => onChange({ ...value, ...patch });
  const commitCap = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") return set({ maxReviewsPerDay: null });
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return;
    set({ maxReviewsPerDay: Math.max(0, Math.min(MAX_REVIEWS_PER_DAY_LIMIT, parsed)) });
  };

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={value.spaceOutSiblings}
      aria-label="Space out sibling cards"
      className="dh-toggle"
      disabled={disabled}
      onClick={() => set({ spaceOutSiblings: !value.spaceOutSiblings })}
    />
  );
  const positionSelect = (
    <select
      id={`${idPrefix}-new-position`}
      className={variant === "settings" ? "input dhs-select dhs-select--order" : "input"}
      value={value.newCardPosition}
      disabled={disabled}
      onChange={(e) => set({ newCardPosition: e.target.value as NewCardPosition })}
    >
      {NEW_CARD_POSITIONS.map((position) => (
        <option key={position} value={position}>
          {NEW_CARD_POSITION_LABELS[position]}
        </option>
      ))}
    </select>
  );
  const orderSelect = (
    <select
      id={`${idPrefix}-review-order`}
      className={variant === "settings" ? "input dhs-select dhs-select--order" : "input"}
      value={value.reviewSortOrder}
      disabled={disabled}
      onChange={(e) => set({ reviewSortOrder: e.target.value as ReviewSortOrder })}
    >
      {REVIEW_SORT_ORDERS.map((order) => (
        <option key={order} value={order}>
          {REVIEW_SORT_ORDER_LABELS[order]}
        </option>
      ))}
    </select>
  );
  const capField = (
    <input
      id={`${idPrefix}-review-cap`}
      className={variant === "settings" ? "input dhs-select" : "input"}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      placeholder="No limit"
      aria-label="Maximum reviews per day"
      disabled={disabled}
      value={capInput}
      onChange={(e) => {
        const next = e.target.value;
        if (next !== "" && !/^\d{1,4}$/.test(next)) return;
        setCapInput(next);
        commitCap(next);
      }}
      onBlur={() => commitCap(capInput)}
    />
  );

  if (variant === "panel") {
    return (
      <>
        <div className="dhd-panel-row">
          <div style={{ flex: 1 }}>
            <div className="dhd-strong">Space out sibling cards</div>
            <div className="dhd-help">{HELP.siblings}</div>
          </div>
          {toggle}
        </div>
        <label className="dhd-field" htmlFor={`${idPrefix}-new-position`}>
          <span className="dhd-field__label">New cards</span>
          {positionSelect}
          <span className="dhd-help">{HELP.position}</span>
        </label>
        <label className="dhd-field" htmlFor={`${idPrefix}-review-order`}>
          <span className="dhd-field__label">Review order</span>
          {orderSelect}
        </label>
        <label className="dhd-field" htmlFor={`${idPrefix}-review-cap`}>
          <span className="dhd-field__label">Maximum reviews per day</span>
          {capField}
          <span className="dhd-help">{HELP.cap}</span>
        </label>
      </>
    );
  }

  return (
    <>
      <div className="dhs-row">
        <div className="dhs-row__main">
          <div className="dhs-row__title">Space out sibling cards</div>
          <p className="dhs-muted">{HELP.siblings}</p>
        </div>
        {toggle}
      </div>
      <div className="dhs-row">
        <div className="dhs-row__main">
          <label className="dhs-row__title" htmlFor={`${idPrefix}-new-position`}>
            New cards
          </label>
          <p className="dhs-muted">{HELP.position}</p>
        </div>
        {positionSelect}
      </div>
      <div className="dhs-row">
        <div className="dhs-row__main">
          <label className="dhs-row__title" htmlFor={`${idPrefix}-review-order`}>
            Review order
          </label>
          <p className="dhs-muted">{HELP.order}</p>
        </div>
        {orderSelect}
      </div>
      <div className="dhs-row dhs-row--flush">
        <div className="dhs-row__main">
          <label className="dhs-row__title" htmlFor={`${idPrefix}-review-cap`}>
            Maximum reviews per day
          </label>
          <p className="dhs-muted">{HELP.cap}</p>
        </div>
        {capField}
      </div>
    </>
  );
}
