"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CARD_MODEL_NAME,
  DETAIL_LEVEL_OPTIONS,
  FOCUS_PRESET_OPTIONS,
  GENERATION_CARD_TYPE_OPTIONS,
  QUALITY_LEVEL_OPTIONS,
  detailLevelLabel,
  focusPresetOption,
  type DetailLevel,
  type FocusPreset,
  type GenerationCardType,
  type QualityLevel,
} from "@deephaus/shared";
import "@/components/create/create-chat.css";

/** Generation settings edited from a composer's settings pill. */
export type GenerationControls = {
  detailLevel: DetailLevel;
  onDetailLevelChange: (level: DetailLevel) => void;
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
  selectedTypes: Set<GenerationCardType>;
  onToggleCardType: (type: GenerationCardType) => void;
  focusPreset: FocusPreset;
  onFocusPresetChange: (preset: FocusPreset) => void;
  clozeHints: boolean;
  onClozeHintsChange: (next: boolean) => void;
  autoTags: boolean;
  onAutoTagsChange: (next: boolean) => void;
};

const DETAIL_DESCRIPTIONS: Record<DetailLevel, string> = {
  low: "Only the essentials, fewer cards.",
  medium: "Balanced coverage of the material.",
  high: "Comprehensive, covers nearly everything.",
};

type SubmenuView = "quality" | "detail" | "focus" | "types";
type SettingsView = "root" | SubmenuView;

const SUBMENU_TITLES: Record<SubmenuView, string> = {
  quality: "Effort",
  detail: "Detail",
  focus: "Focus",
  types: "Card types",
};

/** A setting's choices opened beside the menu, positioned inside the menu root. */
type Flyout = { view: SubmenuView; top: number; left: number; focusFirst: boolean };

const FLYOUT_WIDTH = 264;
const FLYOUT_GAP = 4;
/** Matches `.dhc-menu` padding, so the panel's first choice lines up with its row. */
const FLYOUT_PADDING = 6;

function typeLabels(controls: Pick<GenerationControls, "selectedTypes">) {
  return GENERATION_CARD_TYPE_OPTIONS.filter((o) => controls.selectedTypes.has(o.value)).map((o) =>
    o.value === "cloze" ? "Blanks" : o.label,
  );
}

/**
 * What the settings pill says: the model and effort ("Haus 5.5 · Medium"),
 * plus every setting spelled out for its tooltip and screen readers.
 */
export function cardSettingsSummary(controls: GenerationControls) {
  const quality = QUALITY_LEVEL_OPTIONS.find((o) => o.value === controls.qualityLevel)!;
  const settings = [
    `${quality.label} effort`,
    `${detailLevelLabel(controls.detailLevel)} detail`,
    typeLabels(controls).join(" + ") || "No type",
    focusPresetOption(controls.focusPreset).label,
  ].join(" · ");
  return {
    label: `${CARD_MODEL_NAME} · ${quality.label}`,
    ariaLabel: `Card settings: ${CARD_MODEL_NAME}, ${settings}`,
    title: `${CARD_MODEL_NAME}: ${settings}`,
  };
}

/**
 * The card settings menu, Claude-style: one row per setting with its value,
 * whose choices open in a panel beside the menu on hover. Render it as the
 * direct child of a `.dhc-menu-root`, which the side panel is positioned in.
 * Where there's no room beside it, a setting drills down in place instead.
 */
export function CardSettingsMenu({
  controls,
  placement,
  width = 268,
}: {
  controls: GenerationControls;
  placement: "up" | "down";
  width?: number;
}) {
  const [settingsView, setSettingsView] = useState<SettingsView>("root");
  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const flyoutAnchorRef = useRef<HTMLButtonElement | null>(null);

  const quality = QUALITY_LEVEL_OPTIONS.find((o) => o.value === controls.qualityLevel)!;
  const labels = typeLabels(controls);
  const typeSummary =
    controls.selectedTypes.size === GENERATION_CARD_TYPE_OPTIONS.length ? "Both" : (labels[0] ?? "None");
  const clozeSelected = controls.selectedTypes.has("cloze");

  function openSubmenu(view: SubmenuView, row: HTMLButtonElement, focusFirst: boolean) {
    const menuEl = menuRef.current;
    const root = menuEl?.parentElement;
    if (!menuEl || !root) return;
    const rootRect = root.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();
    if (menuRect.right + FLYOUT_GAP + FLYOUT_WIDTH + 8 > window.innerWidth) {
      setSettingsView(view);
      return;
    }
    const rowRect = row.getBoundingClientRect();
    flyoutAnchorRef.current = row;
    setFlyout({
      view,
      top: rowRect.top - rootRect.top - FLYOUT_PADDING,
      left: menuRect.right - rootRect.left + FLYOUT_GAP,
      focusFirst,
    });
  }

  function closeFlyout(returnFocus: boolean) {
    setFlyout(null);
    if (returnFocus) flyoutAnchorRef.current?.focus();
  }

  // Keep the side panel on screen, and move focus into it when opened from the keyboard.
  useLayoutEffect(() => {
    const el = flyoutRef.current;
    if (!flyout || !el) return;
    const rect = el.getBoundingClientRect();
    const overflow = rect.bottom - (window.innerHeight - 8);
    const shift = overflow > 0.5 ? -Math.min(overflow, rect.top - 8) : 0;
    if (Math.abs(shift) > 0.5) {
      setFlyout({ ...flyout, top: flyout.top + shift });
      return;
    }
    if (flyout.focusFirst) {
      el.querySelector<HTMLButtonElement>("button")?.focus();
      setFlyout({ ...flyout, focusFirst: false });
    }
  }, [flyout]);

  /** The choices for one setting. `inFlyout` keeps the panel open after a pick. */
  function submenuOptions(view: SubmenuView, inFlyout: boolean) {
    const done = () => {
      if (!inFlyout) setSettingsView("root");
    };
    if (view === "quality") {
      return QUALITY_LEVEL_OPTIONS.map((option) => (
        <OptionItem
          key={option.value}
          role="menuitemradio"
          label={option.label}
          description={option.description}
          checked={controls.qualityLevel === option.value}
          onClick={() => {
            controls.onQualityLevelChange(option.value);
            done();
          }}
        />
      ));
    }
    if (view === "detail") {
      return DETAIL_LEVEL_OPTIONS.map((option) => (
        <OptionItem
          key={option.value}
          role="menuitemradio"
          label={option.label}
          description={DETAIL_DESCRIPTIONS[option.value]}
          checked={controls.detailLevel === option.value}
          onClick={() => {
            controls.onDetailLevelChange(option.value);
            done();
          }}
        />
      ));
    }
    if (view === "focus") {
      return FOCUS_PRESET_OPTIONS.map((option) => (
        <OptionItem
          key={option.value}
          role="menuitemradio"
          label={option.label}
          description={option.description}
          checked={controls.focusPreset === option.value}
          onClick={() => {
            controls.onFocusPresetChange(option.value);
            done();
          }}
        />
      ));
    }
    return GENERATION_CARD_TYPE_OPTIONS.map((option) => {
      const selected = controls.selectedTypes.has(option.value);
      const lastOne = selected && controls.selectedTypes.size === 1;
      return (
        <OptionItem
          key={option.value}
          role="menuitemcheckbox"
          icon={option.icon}
          label={option.label}
          description={lastOne ? "Keep at least one card type." : option.description}
          checked={selected}
          locked={lastOne}
          onClick={() => {
            if (!lastOne) controls.onToggleCardType(option.value);
          }}
        />
      );
    });
  }

  const settingRows: Array<{ view: SubmenuView; icon: string; value: string }> = [
    { view: "quality", icon: "ri-sparkling-2-line", value: quality.label },
    { view: "detail", icon: "ri-stack-line", value: detailLevelLabel(controls.detailLevel) },
    { view: "focus", icon: "ri-focus-3-line", value: focusPresetOption(controls.focusPreset).label },
    { view: "types", icon: "ri-layout-grid-line", value: typeSummary },
  ];

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        aria-label="Card generation settings"
        className={`dhc-menu dhc-menu--${placement} dhc-menu--left dhc-settings`}
        style={{ width }}
        onScroll={() => setFlyout(null)}
      >
        {settingsView !== "root" ? (
          <SettingsSubmenu title={SUBMENU_TITLES[settingsView]} onBack={() => setSettingsView("root")}>
            {submenuOptions(settingsView, false)}
          </SettingsSubmenu>
        ) : (
          <>
            {settingRows.map((row) => (
              <SettingRow
                key={row.view}
                icon={row.icon}
                label={SUBMENU_TITLES[row.view]}
                value={row.value}
                open={flyout?.view === row.view}
                onHover={(el) => {
                  if (window.matchMedia("(hover: hover)").matches) openSubmenu(row.view, el, false);
                }}
                onOpen={(el, fromKeyboard) => openSubmenu(row.view, el, fromKeyboard)}
              />
            ))}
            <div className="dhc-menu__sep" onMouseEnter={() => setFlyout(null)} />
            <ToggleItem
              icon="ri-price-tag-3-line"
              label="Auto tags"
              title="Tag new cards by topic and source."
              checked={controls.autoTags}
              onHover={() => setFlyout(null)}
              onChange={controls.onAutoTagsChange}
            />
            <ToggleItem
              icon="ri-lightbulb-line"
              label="Hints on blanks"
              title={
                clozeSelected
                  ? "Add hints to fill-in-the-blank cards."
                  : "Turn on Fill-in-the-Blank cards to use hints."
              }
              checked={clozeSelected && controls.clozeHints}
              disabled={!clozeSelected}
              onHover={() => setFlyout(null)}
              onChange={controls.onClozeHintsChange}
            />
          </>
        )}
      </div>
      {flyout ? (
        <div
          ref={flyoutRef}
          role="menu"
          aria-label={SUBMENU_TITLES[flyout.view]}
          className="dhc-menu dhc-settings dhc-flyout"
          style={{ top: flyout.top, left: flyout.left, width: FLYOUT_WIDTH }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              closeFlyout(true);
            }
          }}
        >
          {submenuOptions(flyout.view, true)}
        </div>
      ) : null}
    </>
  );
}

function ToggleItem({
  icon,
  label,
  title,
  checked,
  disabled,
  onHover,
  onChange,
}: {
  icon: string;
  label: string;
  title: string;
  checked: boolean;
  disabled?: boolean;
  onHover?: () => void;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      className="dh-menu-item"
      title={title}
      onMouseEnter={onHover}
      onClick={() => onChange(!checked)}
    >
      <i className={`${icon} dh-menu-item__icon`} aria-hidden />
      <span className="dh-menu-item__label">{label}</span>
      <span className={`dhc-switch${checked ? " dhc-switch--on" : ""}`} aria-hidden />
    </button>
  );
}

/** A top-level settings row: the setting, its current value, and a way in. */
function SettingRow({
  icon,
  label,
  value,
  open,
  onHover,
  onOpen,
}: {
  icon: string;
  label: string;
  value: string;
  open: boolean;
  onHover: (row: HTMLButtonElement) => void;
  onOpen: (row: HTMLButtonElement, fromKeyboard: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={open}
      className={`dh-menu-item${open ? " is-open" : ""}`}
      onMouseEnter={(e) => onHover(e.currentTarget)}
      onClick={(e) => onOpen(e.currentTarget, e.detail === 0)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onOpen(e.currentTarget, true);
        }
      }}
    >
      <i className={`${icon} dh-menu-item__icon`} aria-hidden />
      <span className="dh-menu-item__label">{label}</span>
      <span className="dhc-setting__value">{value}</span>
      <i className="ri-arrow-right-s-line dhc-setting__chevron" aria-hidden />
    </button>
  );
}

/** One level down in the settings menu, with a way back to the top. */
function SettingsSubmenu({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <button type="button" className="dh-menu-item dhc-setting__back" onClick={onBack}>
        <i className="ri-arrow-left-s-line dh-menu-item__icon" aria-hidden />
        <span className="dh-menu-item__label">{title}</span>
      </button>
      <div className="dhc-menu__sep" />
      {children}
    </>
  );
}

/** A choice in a settings submenu: name, one line on what it does, and a check. */
function OptionItem({
  role,
  icon,
  label,
  description,
  checked,
  locked,
  onClick,
}: {
  role: "menuitemradio" | "menuitemcheckbox";
  icon?: string;
  label: string;
  description: string;
  checked: boolean;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      aria-disabled={locked || undefined}
      className="dh-menu-item dhc-option"
      onClick={onClick}
    >
      {icon ? <i className={`${icon} dh-menu-item__icon`} aria-hidden /> : null}
      <span className="dhc-menu__text">
        <span className="dh-menu-item__label">{label}</span>
        <span className="dhc-menu__desc">{description}</span>
      </span>
      <i
        className={`ri-check-line dh-menu-item__check dhc-option__check${checked ? "" : " is-hidden"}`}
        aria-hidden
      />
    </button>
  );
}
