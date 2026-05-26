import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "@/components/brand-mark";
import { LandingFeatureGrid, LandingHero, LandingSteps } from "@/components/landing-sections";
import { ThemeToggle } from "@/components/theme-provider";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div style={{ background: "var(--bg-surface)", minHeight: "100vh" }}>
      <nav style={s.nav}>
        <div style={s.brand}>
          <BrandMark size={28} />
          <span>DeepHaus</span>
        </div>
        <div style={s.navLinks}>
          <Link href="#features" style={s.navLink}>Features</Link>
          <Link href="#how" style={s.navLink}>How it works</Link>
          <Link href="#faq" style={s.navLink}>FAQ</Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle />
          {user ? (
            <Link href="/dashboard" className="btn btn-primary">
              Open App
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-secondary">
                Sign In
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Get Started
              </Link>
            </>
          )}
        </div>
      </nav>

      <LandingHero
        user={!!user}
        heroSubStyle={s.heroSub}
        styles={{ hero: s.hero, heroGlow: s.heroGlow, heroInner: s.heroInner, eyebrow: s.eyebrow }}
      />

      <LandingFeatureGrid
        features={features}
        styles={{ section: s.section, sectionInner: s.sectionInner, featureGrid: s.featureGrid, featureCard: s.featureCard, featureIcon: s.featureIcon }}
      />

      <LandingSteps
        steps={steps}
        styles={{ section: { ...s.section, background: "var(--bg-canvas)" }, sectionInner: s.sectionInner, steps: s.steps, step: s.step, stepNum: s.stepNum }}
      />

      <section id="faq" style={s.section}>
        <div style={{ ...s.sectionInner, maxWidth: 760 }}>
          <h2 className="display-sm" style={{ textAlign: "center", marginBottom: 40 }}>
            Frequently Asked Questions
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {faqs.map((f) => (
              <details key={f.q} style={s.faq}>
                <summary style={s.faqQ}>{f.q}</summary>
                <div style={s.faqA}>{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section style={{ ...s.section, background: "var(--bg-canvas)", padding: "64px 24px" }}>
        <div style={{ ...s.sectionInner, textAlign: "center", maxWidth: 640 }}>
          <h2 className="display-sm" style={{ marginBottom: 12 }}>
            Ready to Study Smarter?
          </h2>
          <p style={{ color: "var(--fg-tertiary)", marginBottom: 24 }}>
            Drop in your notes and get a flashcard deck in under a minute.
          </p>
          <Link href={user ? "/decks/new" : "/signup"} className="btn btn-primary">
            Get Started
          </Link>
        </div>
      </section>

      <footer style={s.footer}>
        <div style={s.brand}>
          <BrandMark size={24} />
          <span>DeepHaus</span>
        </div>
        <span style={{ color: "var(--fg-quaternary)", fontSize: 13 }}>
          © {new Date().getFullYear()} DeepHaus. All rights reserved.
        </span>
      </footer>
    </div>
  );
}

const features = [
  { icon: "ri-magic-line", title: "AI Card Generation", body: "Paste text or upload a PDF and DeepHaus writes basic and cloze cards that capture the key ideas." },
  { icon: "ri-brain-line", title: "Adaptive Scheduler", body: "Review on a schedule that adapts to your performance — easy cards drift away, hard cards come back fast." },
  { icon: "ri-download-line", title: "Export to Anki", body: "Download a real .apkg file at any time so your deck travels with you across devices and apps." },
];

const steps = [
  { title: "Paste any resource", body: "Notes, slides, a textbook excerpt, a YouTube transcript. Anything text-based works." },
  { title: "Generate a deck", body: "DeepHaus extracts the concepts and writes a deck of basic and cloze cards in seconds." },
  { title: "Study every day", body: "Rate each card Again / Hard / Good / Easy. The scheduler decides when to show it next." },
];

const faqs = [
  { q: "What sources can I paste in?", a: "Plain text and PDF for now. PowerPoint, audio, and video transcripts are next on the roadmap." },
  { q: "Does this replace Anki?", a: "You can study inside DeepHaus or export a .apkg file and use Anki — the deck format is fully compatible." },
  { q: "How does scheduling work?", a: "Each card is rated Again, Hard, Good, or Easy. DeepHaus tracks the next review interval and surfaces due cards on your Dashboard." },
  { q: "Is it free?", a: "DeepHaus is free during open beta. We'll introduce a generous free tier when paid plans launch." },
];

const s: Record<string, React.CSSProperties> = {
  nav: {
    display: "flex",
    alignItems: "center",
    gap: 32,
    padding: "20px 56px",
    borderBottom: "1px solid var(--border-tertiary)",
    background: "var(--bg-surface)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    font: "600 18px/1 var(--font-sans)",
    color: "var(--fg-primary)",
  },
  navLinks: { display: "flex", gap: 28, marginLeft: 12, flex: 1 },
  navLink: { color: "var(--fg-tertiary)", font: "500 14px/20px var(--font-sans)" },
  hero: {
    position: "relative",
    padding: "100px 24px 120px",
    overflow: "hidden",
    textAlign: "center",
    background: "var(--bg-surface)",
  },
  heroGlow: {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(ellipse 60% 60% at 50% 30%, var(--brand-50), transparent 70%)",
    pointerEvents: "none",
  },
  heroInner: {
    position: "relative",
    maxWidth: 800,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 20,
  },
  eyebrow: {
    font: "600 12px/16px var(--font-sans)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--brand-700)",
    background: "var(--brand-50)",
    padding: "6px 14px",
    borderRadius: 9999,
  },
  heroSub: { color: "var(--fg-tertiary)", maxWidth: 640, margin: 0 },
  section: { padding: "96px 24px", background: "var(--bg-surface)" },
  sectionInner: { maxWidth: 1100, margin: "0 auto" },
  featureGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 },
  featureCard: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 16,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: "var(--brand-50)",
    color: "var(--brand-700)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
  },
  steps: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 20,
  },
  step: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 16,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: 9999,
    background: "var(--action-primary-bg)",
    color: "var(--action-primary-fg)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 16px/1 var(--font-sans)",
  },
  faq: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 12,
    padding: "18px 22px",
  },
  faqQ: { font: "500 16px/24px var(--font-sans)", color: "var(--fg-primary)", cursor: "pointer", listStyle: "none" },
  faqA: { font: "400 14px/22px var(--font-sans)", color: "var(--fg-tertiary)", marginTop: 10 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "32px 56px",
    borderTop: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
  },
};
