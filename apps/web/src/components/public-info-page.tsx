import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import "@/components/landing/public-info.css";

export function PublicInfoPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="pi-page">
      <Link href="/" className="pi-brand">
        <BrandMark size={28} /><span className="dh-wordmark">DeepHaus</span>
      </Link>
      <h1 className="pi-title">{title}</h1>
      <div className="pi-body">{children}</div>
      <footer className="pi-foot">
        <Link href="/integrations">AI integrations</Link>{" · "}<Link href="/support">Support</Link>
        <p><Link href="/privacy">Privacy Policy</Link>{" · "}<Link href="/terms">Terms of Service</Link></p>
        <p>Dekki Inc · DeepHaus</p>
      </footer>
    </main>
  );
}
