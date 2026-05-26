import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div style={{ background: "var(--white)", minHeight: "100vh" }}>
      <nav style={s.nav}>
        <div style={s.brand}>
          <span style={s.brandMark}>
            <i className="ri-stack-fill" />
          </span>
          <span>DeepHaus</span>
        </div>
        <div style={s.navLinks}>
          <Link href="#features" style={s.navLink}>Features</Link>
          <Link href="#how" style={s.navLink}>How it works</Link>
          <Link href="#faq" style={s.navLink}>FAQ</Link>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
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

      <section style={s.hero}>
        <div style={s.heroGlow} />
        <div style={s.heroInner}>
          <span style={s.eyebrow}>AI-Powered Spaced Repetition</span>
          <h1 className="display-lg" style={{ maxWidth: 760 }}>
            Learn More, Study Less.
          </h1>
          <p className="text-lg" style={s.heroSub}>
            Paste in any resource — notes, slides, a textbook PDF — and DeepHaus turns it into a deck of flashcards you can
            study with an adaptive scheduler.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <Link href={user ? "/decks/new" : "/signup"} className="btn btn-primary">
              Get Started <i className="ri-arrow-right-line" />
            </Link>
            <Link href="#features" className="btn btn-ghost">
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      <section id="features" style={s.section}>
        <div style={s.sectionInner}>
          <h2 className="display-sm" style={{ textAlign: "center", marginBottom: 12 }}>
            Get Instant Study Materials
          </h2>
          <p style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 56px", color: "var(--fg-3)" }}>
            Three steps from a wall of notes to a study session that adapts to what you actually need to review.
          </p>
          <div style={s.featureGrid}>
            {features.map((f) => (
              <div key={f.title} style={s.featureCard}>
                <span style={s.featureIcon}>
                  <i className={f.icon} />
                </span>
                <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", margin: 0 }}>{f.title}</h3>
                <p style={{ color: "var(--fg-3)", font: "400 14px/22px var(--font-sans)", margin: 0 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" style={{ ...s.section, background: "var(--paper)" }}>
        <div style={s.sectionInner}>
          <h2 className="display-sm" style={{ textAlign: "center", marginBottom: 56 }}>
            From Text to Studying in Three Steps
          </h2>
          <div style={s.steps}>
            {steps.map((step, i) => (
              <div key={step.title} style={s.step}>
                <span style={s.stepNum}>{i + 1}</span>
                <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", margin: 0 }}>{step.title}</h3>
                <p style={{ color: "var(--fg-3)", font: "400 14px/22px var(--font-sans)", margin: 0 }}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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

      <section style={{ ...s.section, background: "var(--paper)", padding: "64px 24px" }}>
        <div style={{ ...s.sectionInner, textAlign: "center", maxWidth: 640 }}>
          <h2 className="display-sm" style={{ marginBottom: 12 }}>
            Ready to Study Smarter?
          </h2>
          <p style={{ color: "var(--fg-3)", marginBottom: 24 }}>
            Drop in your notes and get a flashcard deck in under a minute.
          </p>
          <Link href={user ? "/decks/new" : "/signup"} className="btn btn-primary">
            Get Started
          </Link>
        </div>
      </section>

      <footer style={s.footer}>
        <div style={s.brand}>
          <span style={s.brandMark}>
            <i className="ri-stack-fill" />
          </span>
          <span>DeepHaus</span>
        </div>
        <span style={{ color: "var(--fg-4)", fontSize: 13 }}>© {new Date().getFullYear()} DeepHaus. All rights reserved.</span>
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
    borderBottom: "1px solid var(--border-3)",
    background: "var(--white)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    font: "600 18px/1 var(--font-sans)",
    color: "var(--ink-900)",
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: "var(--ink-900)",
    color: "var(--white)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
  },
  navLinks: { display: "flex", gap: 28, marginLeft: 12, flex: 1 },
  navLink: { color: "var(--ink-500)", font: "500 14px/20px var(--font-sans)" },
  hero: {
    position: "relative",
    padding: "100px 24px 120px",
    overflow: "hidden",
    textAlign: "center",
    background: "var(--white)",
  },
  heroGlow: {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(ellipse 60% 60% at 50% 30%, var(--teal-75), transparent 70%)",
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
    color: "var(--teal-700)",
    background: "var(--teal-75)",
    padding: "6px 14px",
    borderRadius: 9999,
  },
  heroSub: { color: "var(--fg-3)", maxWidth: 640, margin: 0 },
  section: { padding: "96px 24px", background: "var(--white)" },
  sectionInner: { maxWidth: 1100, margin: "0 auto" },
  featureGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 },
  featureCard: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
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
    background: "var(--teal-75)",
    color: "var(--teal-700)",
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
    background: "var(--white)",
    border: "1px solid var(--border-2)",
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
    background: "var(--ink-900)",
    color: "var(--white)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 16px/1 var(--font-sans)",
  },
  faq: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    padding: "18px 22px",
  },
  faqQ: { font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)", cursor: "pointer", listStyle: "none" },
  faqA: { font: "400 14px/22px var(--font-sans)", color: "var(--fg-3)", marginTop: 10 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "32px 56px",
    borderTop: "1px solid var(--border-1)",
    background: "var(--white)",
  },
};
