import Link from "next/link";

type Props = {
  title: string;
  back?: { href: string; label: string };
  action?: React.ReactNode;
};

export function PageHeader({ title, back, action }: Props) {
  return (
    <div style={s.root}>
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
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "24px 40px",
    borderBottom: "1px solid var(--border-1)",
    background: "var(--white)",
  },
  left: { display: "flex", alignItems: "center", gap: 16 },
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    color: "var(--ink-500)",
    font: "400 14px/20px var(--font-sans)",
  },
  title: { font: "500 28px/36px var(--font-sans)", color: "var(--ink-900)", margin: 0, letterSpacing: "-.01em" },
  actions: { display: "flex", gap: 8, alignItems: "center" },
};
