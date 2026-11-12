import type { ReviewOrderSettings } from "@deephaus/shared";

/** iOS only (review-order-rows.ios.tsx). Android shows ReviewOrderControls in app/profile.tsx. */
export function ReviewOrderRows(_props: {
  value: ReviewOrderSettings;
  onChange: (next: ReviewOrderSettings) => void;
  locked?: boolean;
}) {
  return null;
}

export { REVIEW_ORDER_FOOTNOTE } from "./review-order-footnote";
