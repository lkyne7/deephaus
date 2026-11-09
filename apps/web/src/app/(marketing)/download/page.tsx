import Link from "next/link";
import { DownloadCards } from "@/components/landing/download-cards";
import { MarketingFooter, MarketingNav } from "@/components/landing/marketing-chrome";
import { IosAppAction } from "@/components/landing/platform-cards";
import { INTEGRATIONS_PAGE } from "@/lib/apps";
import { createClient } from "@/lib/supabase/server";
import { DESKTOP_RELEASES_URL } from "@/lib/desktop/downloads";
import "@/components/landing/landing.css";
import "@/components/landing/pricing.css";
import "@/components/landing/download.css";

export const metadata = {
  title: "Download | DeepHaus",
  description:
    "Get DeepHaus for macOS, Windows and Linux, on the web, and soon on iPhone. Study offline with decks that sync everywhere.",
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
    icon: "ri-sparkling-2-line",
    title: "Use your own AI plan",
    body: "Signed in to Claude Code or Codex? Generate cards on your Claude or ChatGPT plan instead of spending credits.",
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
      <MarketingNav user={user} current="download" />

      <main>
        <header className="pricing-hero">
          <div className="lp-container pricing-hero-copy">
            <h1 className="pricing-title">Study offline on your Mac, PC or Linux machine.</h1>
            <p className="pricing-subtitle">
              The desktop app keeps your decks on your computer, syncs with the web and your phone, and works
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
            .
          </p>
        </section>

        <section className="lp-container download-elsewhere" aria-labelledby="download-elsewhere-title">
          <h2 id="download-elsewhere-title" className="download-elsewhere-title">Also on</h2>
          <div className="download-elsewhere-grid">
            <article className="download-elsewhere-card">
              <i className="ri-smartphone-line" aria-hidden />
              <div>
                <h3>iPhone and iPad</h3>
                <p>Review on the go, even offline.</p>
              </div>
              <IosAppAction className="btn btn-secondary btn-sm" />
            </article>
            <article className="download-elsewhere-card">
              <i className="ri-global-line" aria-hidden />
              <div>
                <h3>Web</h3>
                <p>Nothing to install, in any modern browser.</p>
              </div>
              <Link href={user ? "/dashboard" : "/signup"} className="btn btn-secondary btn-sm">
                Open DeepHaus
              </Link>
            </article>
            <article className="download-elsewhere-card">
              <i className="ri-chat-smile-2-line" aria-hidden />
              <div>
                <h3>ChatGPT, Claude and Cursor</h3>
                <p>Make and review cards in your AI assistant.</p>
              </div>
              <Link href={INTEGRATIONS_PAGE} className="btn btn-secondary btn-sm">
                Set up
              </Link>
            </article>
          </div>
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
      <MarketingFooter user={user} />
    </div>
  );
}
