import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export function PublicInfoPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px 80px", color: "var(--fg-primary)", lineHeight: 1.7 }}>
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 36, color: "inherit", textDecoration: "none" }}>
        <BrandMark size={28} /><span className="dh-wordmark">DeepHaus</span>
      </Link>
      <h1 style={{ fontSize: 36, lineHeight: 1.2, marginBottom: 24 }}>{title}</h1>
      <div style={{ display: "grid", gap: 24 }}>{children}</div>
      <footer style={{ marginTop: 48, borderTop: "1px solid var(--border-secondary)", paddingTop: 20 }}>
        <Link href="/integrations">AI integrations</Link>{" · "}<Link href="/support">Support</Link>
        <p><Link href="/privacy">Privacy Policy</Link>{" · "}<Link href="/terms">Terms of Service</Link></p>
        <p>Dekki Inc · DeepHaus</p>
      </footer>
    </main>
  );
}
