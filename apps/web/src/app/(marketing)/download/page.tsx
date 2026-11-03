import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-provider";
import { DownloadCards } from "@/components/landing/download-cards";
import { createClient } from "@/lib/supabase/server";
import { DESKTOP_RELEASES_URL } from "@/lib/desktop/downloads";
import "@/components/landing/landing.css";
import "@/components/landing/pricing.css";
import "@/components/landing/download.css";

export const metadata = {
  title: "Download | DeepHaus",
  description: "Get the DeepHaus desktop app for macOS, Windows and Linux. Study offline with decks that sync to web and mobile.",
};

const highlights = [
  {
    icon: "ri-wifi-off-line",
    title: "Study offline",
    body: "Your decks, schedule and media live on your computer. Grade cards on a plane and everything syncs when you reconnect.",
  },
  {
    icon: "ri-smartphone-line",
    title: "One account everywhere",
    body: "Reviews made on your Mac or PC show up on your phone within seconds, and the other way round.",
  },
  {
    icon: "ri-keyboard-line",
    title: "Built for the keyboard",
    body: "Jump between Dashboard, Decks and Review with native shortcuts, and see cards due in your dock or taskbar badge.",
  },
  {
    icon: "ri-refresh-line",
    title: "Always current",
    body: "The app updates itself in the background, so new features arrive without a reinstall.",
  },
];

export default async function DownloadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="lp-root">
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link href="/" className="lp-nav-brand dh-eq dh-eq-hover">
            <BrandMark size={28} />
            <span className="dh-wordmark">DeepHaus</span>
          </Link>
          <div className="lp-nav-links">
            <Link href="/#how" className="lp-nav-link">How it works</Link>
            <Link href="/#features" className="lp-nav-link">Features</Link>
            <Link href="/pricing" className="lp-nav-link">Pricing</Link>
            <Link href="/download" className="lp-nav-link" aria-current="page">Download</Link>
            <Link href="/#faq" className="lp-nav-link">FAQ</Link>
          </div>
          <div className="lp-nav-actions">
            <ThemeToggle />
            {user ? (
              <Link href="/dashboard" className="btn btn-primary">Open App</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost">Sign In</Link>
                <Link href="/signup" className="btn btn-primary">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main>
        <header className="pricing-hero">
          <div className="lp-hero-grid-bg" aria-hidden />
          <div className="lp-hero-glow" aria-hidden />
          <div className="lp-container pricing-hero-copy">
            <span className="lp-eyebrow">
              <i className="ri-computer-line" aria-hidden />
              DeepHaus for desktop
            </span>
            <h1 className="pricing-title">Study offline on your Mac, PC or Linux machine.</h1>
            <p className="pricing-subtitle">
              The desktop app keeps your decks on your computer, syncs with the mobile app, and works
              without a connection.
            </p>
          </div>
        </header>

        <section className="lp-container" aria-label="Download DeepHaus">
          <DownloadCards />
          <p className="download-note">
            Looking for an older build or release notes? See{" "}
            <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noreferrer">
              all releases on GitHub
            </a>
            . iPhone and iPad users can get DeepHaus from the App Store.
          </p>
        </section>

        <section className="lp-container download-highlights" aria-label="Why use the desktop app">
          {highlights.map((item) => (
            <article className="download-highlight" key={item.title}>
              <i className={item.icon} aria-hidden />
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
