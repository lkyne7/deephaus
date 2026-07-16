"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

type UntitledSearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  icon?: string;
  wrapperStyle?: CSSProperties;
};

export function UntitledSearchInput({
  icon = "ri-search-line",
  wrapperStyle,
  className,
  ...props
}: UntitledSearchInputProps) {
  return (
    <label className="untitled-search" style={wrapperStyle}>
      <i className={icon} aria-hidden />
      <input type="search" className={className ?? "untitled-search-input"} {...props} />
    </label>
  );
}

type UntitledSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  icon?: string;
  wrapperStyle?: CSSProperties;
  children: ReactNode;
};

export function UntitledSelect({
  icon,
  wrapperStyle,
  className,
  children,
  ...props
}: UntitledSelectProps) {
  return (
    <label className="untitled-pill-select" style={wrapperStyle}>
      {icon ? <i className={icon} aria-hidden /> : null}
      <select className={className ?? "untitled-pill-select-native"} {...props}>
        {children}
      </select>
      <i className="ri-arrow-down-s-line" aria-hidden />
    </label>
  );
}

export type UntitledMenuOption = {
  value: string;
  label: string;
  icon?: string;
};

type UntitledMenuSelectProps = {
  icon?: string;
  value: string;
  options: UntitledMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Accessible name for the trigger / menu. */
  "aria-label"?: string;
  wrapperStyle?: CSSProperties;
  /** Menu panel width in px (default 320). */
  menuWidth?: number;
};

/** Custom dropdown matching the Create page deck switcher (with grey item hover). */
export function UntitledMenuSelect({
  icon,
  value,
  options,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  wrapperStyle,
  menuWidth = 320,
}: UntitledMenuSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);

  const selected = options.find((opt) => opt.value === value) ?? options[0];
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="untitled-menu-select" style={wrapperStyle}>
      <button
        type="button"
        className={`untitled-menu-select__trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ? <i className={icon} aria-hidden /> : null}
        <span className="untitled-menu-select__label">{selected?.label ?? ""}</span>
        <i
          className={`${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} untitled-menu-select__caret`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className="untitled-menu-select__menu"
          style={{ width: menuWidth, maxWidth: `min(${menuWidth}px, 90vw)` }}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value || "__empty"}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`dh-menu-item${active ? " is-active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  close();
                }}
              >
                {opt.icon ? <i className={`${opt.icon} dh-menu-item__icon`} aria-hidden /> : null}
                <span className="dh-menu-item__label">{opt.label}</span>
                {active ? <i className="ri-check-line dh-menu-item__check" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
