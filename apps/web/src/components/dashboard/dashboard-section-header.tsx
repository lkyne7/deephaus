import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

type ActionLink = {
  kind: "link";
  href: string;
  label: string;
};

type Props = {
  title: string;
  icon?: string;
  count?: number;
  action?: ActionLink;
  trailing?: ReactNode;
};

export function DashboardSectionHeader({ title, icon, count, action, trailing }: Props) {
  return (
    <div style={s.header}>
      <div style={s.titleRow}>
        {icon ? <i className={icon} style={s.icon} aria-hidden /> : null}
        <h2 style={s.title}>{title}</h2>
        {count !== undefined ? (
          <span style={s.count} aria-label={`${count} total`}>
            {count}
          </span>
        ) : null}
        {trailing ? <div style={s.trailing}>{trailing}</div> : null}
      </div>
      {action ? (
        <Link href={action.href} style={s.action}>
          {action.label}
          <i className="ri-arrow-right-s-line" style={s.actionIcon} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  icon: {
    fontSize: 20,
    color: "var(--teal-700)",
    flexShrink: 0,
  },
  title: {
    margin: 0,
    font: "600 22px/30px var(--font-sans)",
    letterSpacing: "-0.03em",
    color: "var(--ink-900)",
  },
  count: {
    font: "600 12px/1 var(--font-sans)",
    color: "var(--ink-600)",
    background: "var(--gray-100)",
    border: "1px solid var(--border-1)",
    borderRadius: 999,
    padding: "4px 9px",
    flexShrink: 0,
  },
  trailing: {
    display: "flex",
    alignItems: "center",
    marginLeft: 4,
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    color: "var(--teal-700)",
    font: "500 14px/20px var(--font-sans)",
    textDecoration: "none",
    flexShrink: 0,
  },
  actionIcon: {
    fontSize: 18,
    lineHeight: 1,
  },
};
