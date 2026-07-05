"use client";

import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

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
