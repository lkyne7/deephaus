export type SliderProps = {
  value: number;
  min: number;
  max: number;
  /** Called with whole numbers only, once per change. */
  onChange: (value: number) => void;
  accessibilityLabel?: string;
};
