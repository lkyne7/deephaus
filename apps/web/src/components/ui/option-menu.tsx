"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./option-menu.css";

export type OptionMenuOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

type Props<T extends string> = {
  value: T;
  options: Array<OptionMenuOption<T>>;
  onChange: (value: T) => void;
  "aria-label": string;
  /** Text before the selected label on the trigger, e.g. "Sort: ". */
  prefix?: string;
  /** Extra mark on the trigger, e.g. a sort direction arrow. */
  suffix?: ReactNode;
  className?: string;
  triggerClassName: string;
  placement?: "below" | "above";
};

export function OptionMenu<T extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  prefix = "",
  suffix,
  className = "",
  triggerClassName,
  placement = "below",
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    // Capture, so Escape closes this menu and not the panel around it.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`dh-option-select ${className}`}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${selected.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dh-option-select__label">
          {prefix}
          {selected.label}
        </span>
        {suffix}
        <i className="ri-arrow-down-s-line" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          className={`dh-option-menu dh-option-menu--${placement}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              className="dh-menu-row dh-option-menu__row"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="dh-option-menu__copy">
                <span>{option.label}</span>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {option.value === value ? <i className="ri-check-line" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
