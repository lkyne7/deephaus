import Link from "next/link";

type Props = {
  title: string;
  back?: { href: string; label: string };
  action?: React.ReactNode;
};

export function PageHeader({ title, back, action }: Props) {
  return (
    <div className="app-chrome-bar" style={s.root}>
      <div style={s.left}>
        {back && (
          <Link href={back.href} style={s.back}>
            <i className="ri-arrow-left-s-line" />
            {back.label}
          </Link>
        )}
        <h1 style={s.title}>{title}</h1>
      </div>
      {action && <div style={s.actions}>{action}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    justifyContent: "space-between",
    padding: "0 32px",
  },
  left: { display: "flex", alignItems: "center", gap: 12 },
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    color: "var(--fg-tertiary)",
    font: "400 13px/18px var(--font-sans)",
  },
  title: {
    font: "600 20px/28px var(--font-sans)",
    color: "var(--fg-primary)",
    margin: 0,
    letterSpacing: "-0.01em",
  },
  actions: { display: "flex", gap: 8, alignItems: "center" },
};
