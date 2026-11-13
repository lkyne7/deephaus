/**
 * iOS only (study-limit-rows.ios.tsx): native Form rows. Android uses
 * RetentionSlider and NumberRow in app/profile.tsx.
 */
export function RetentionSliderRow(_props: {
  value: number;
  onChange: (pct: number) => void;
  locked?: boolean;
}) {
  return null;
}

export function NumberFieldRow(_props: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  max: number;
  placeholder?: string;
  allowEmpty?: boolean;
  locked?: boolean;
}) {
  return null;
}
