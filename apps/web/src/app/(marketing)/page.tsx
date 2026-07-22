import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-provider";
import { HeroStudyDemo } from "@/components/landing/hero-study-demo";
import { GenerationDemo } from "@/components/landing/generation-demo";
import { Reveal } from "@/components/landing/reveal";
import { FadeIn } from "@/components/motion/fade-in";
import "@/components/landing/landing.css";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const primaryHref = user ? "/create" : "/signup";

  return (
    <div className="lp-root">
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link href="/" className="lp-nav-brand">
            <BrandMark size={28} />
            <span>DeepHaus</span>
          </Link>
          <div className="lp-nav-links">
            <Link href="#how" className="lp-nav-link">How it works</Link>
            <Link href="#features" className="lp-nav-link">Features</Link>
            <Link href="/pricing" className="lp-nav-link">Pricing</Link>
            <Link href="#faq" className="lp-nav-link">FAQ</Link>
          </div>
          <div className="lp-nav-actions">
            <ThemeToggle />
            {user ? (
              <Link href="/dashboard" className="btn btn-primary">
                Open App
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost">
                  Sign In
                </Link>
                <Link href="/signup" className="btn btn-primary">
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ------------------------------------------------ Hero */}
      <header className="lp-hero">
        <div className="lp-hero-grid-bg" aria-hidden />
        <div className="lp-hero-glow" aria-hidden />
        <div className="lp-container">
          <div className="lp-hero-inner">
            <FadeIn className="lp-hero-copy">
              <span className="lp-eyebrow">
                <i className="ri-flashlight-line" aria-hidden />
                AI-Powered Spaced Repetition
              </span>
              <h1 className="lp-headline">
                Your notes already know
                <br />
                <span className="lp-headline-accent">what to ask you.</span>
              </h1>
              <p className="lp-hero-sub">
                Paste notes, a PDF, or a lecture transcript — DeepHaus turns it into a flashcard deck and schedules
                every review so the right card shows up at the right moment.
              </p>
              <div className="lp-hero-ctas">
                <Link href={primaryHref} className="btn btn-primary lp-btn-lg">
                  Create your first deck <i className="ri-arrow-right-line" aria-hidden />
                </Link>
                <Link href="#how" className="btn btn-ghost lp-btn-lg">
                  See how it works
                </Link>
              </div>
              <div className="lp-hero-trust">
                <span><i className="ri-checkbox-circle-fill" aria-hidden /> Free plan, no credit card</span>
                <span><i className="ri-anchor-line" aria-hidden /> Anki &amp; Quizlet import</span>
                <span><i className="ri-smartphone-line" aria-hidden /> Web &amp; mobile</span>
              </div>
            </FadeIn>
            <FadeIn delay={0.12}>
              <HeroStudyDemo />
            </FadeIn>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------ Source marquee */}
      <section className="lp-marquee-band" aria-label="Supported study sources">
        <div className="lp-marquee-label">Feed it anything you study from</div>
        <div className="lp-marquee">
          {[0, 1].map((copy) => (
            <div className="lp-marquee-track" key={copy} aria-hidden={copy === 1}>
              {sources.map((src) => (
                <span className="lp-marquee-chip" key={src.label}>
                  <i className={src.icon} aria-hidden />
                  {src.label}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ How it works */}
      <section id="how" className="lp-how lp-section">
        <div className="lp-container">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow">
              <i className="ri-route-line" aria-hidden />
              How it works
            </span>
            <h2 className="lp-section-title">From a wall of notes to a study plan in one paste</h2>
            <p className="lp-section-sub">
              No templates to fill in, no cards to write by hand. Drop in the material and start reviewing in under a
              minute.
            </p>
          </Reveal>
          <div className="lp-how-grid">
            <Reveal>
              <div className="lp-steps">
                {steps.map((step, i) => (
                  <div className="lp-step" key={step.title}>
                    <div className="lp-step-rail">
                      <span className="lp-step-num">
                        <i className={step.icon} aria-hidden />
                      </span>
                      {i < steps.length - 1 && <span className="lp-step-line" aria-hidden />}
                    </div>
                    <div className="lp-step-body">
                      <h3 className="lp-step-title">{step.title}</h3>
                      <p className="lp-step-text">{step.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <GenerationDemo />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Feature bento */}
      <section id="features" className="lp-features lp-section">
        <div className="lp-container">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow">
              <i className="ri-apps-2-line" aria-hidden />
              Features
            </span>
            <h2 className="lp-section-title">Everything between &ldquo;I have notes&rdquo; and &ldquo;I know this&rdquo;</h2>
            <p className="lp-section-sub">
              A full study system — generation, scheduling, cramming, and sharing — that still plays nicely with the
              Anki ecosystem you may already use.
            </p>
          </Reveal>

          <div className="lp-bento">
            <Reveal className="lp-bento-cell lp-span-7">
              <span className="lp-bento-icon"><i className="ri-brain-line" aria-hidden /></span>
              <h3 className="lp-bento-title">A scheduler that learns you</h3>
              <p className="lp-bento-text">
                Rate each card Again, Hard, Good, or Easy. The FSRS-style engine stretches intervals for what you know
                and tightens them for what keeps slipping — so every session is spent where it counts.
              </p>
              <div className="lp-bento-visual">
                <div className="lp-timeline" aria-label="Review intervals growing over time">
                  {intervals.map((label, i) => (
                    <Fragment key={label}>
                      {i > 0 && <span className="lp-timeline-gap" aria-hidden />}
                      <span className="lp-timeline-stop">
                        <span className="lp-timeline-dot" aria-hidden />
                        <span className="lp-timeline-label">{label}</span>
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
            </Reveal>

            <Reveal className="lp-bento-cell lp-span-5" delay={0.05}>
              <span className="lp-bento-icon"><i className="ri-magic-line" aria-hidden /></span>
              <h3 className="lp-bento-title">Cards written for you</h3>
              <p className="lp-bento-text">
                The generator reads your material and drafts front/back and fill-in-the-blank cards you can edit
                before studying.
              </p>
              <div className="lp-bento-visual">
                <div className="lp-chip-row">
                  <span className="chip chip-card-basic">Front / Back</span>
                  <span className="chip chip-card-cloze">Fill in the Blank</span>
                </div>
              </div>
            </Reveal>

            <Reveal className="lp-bento-cell lp-span-5" delay={0.05}>
              <span className="lp-bento-icon"><i className="ri-fire-line" aria-hidden /></span>
              <h3 className="lp-bento-title">Cram mode for deadlines</h3>
              <p className="lp-bento-text">
                Exam on Friday? Build a cram plan and DeepHaus front-loads the schedule so everything is fresh on the
                day — without wrecking your long-term queue.
              </p>
              <div className="lp-bento-visual">
                <div className="lp-heatmap" aria-label="Study intensity ramping toward an exam">
                  <div className="lp-heatmap-grid">
                    {heatmap.map((v, i) => (
                      <span
                        key={i}
                        className="lp-heatmap-cell"
                        style={{
                          background:
                            v === 0
                              ? "var(--bg-surface-2)"
                              : `color-mix(in srgb, var(--brand-500) ${18 + v * 20}%, var(--bg-surface-2))`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="lp-heatmap-flag">
                    <i className="ri-flag-2-fill" aria-hidden />
                    <span>Exam day</span>
                  </span>
                </div>
              </div>
            </Reveal>

            <Reveal className="lp-bento-cell lp-span-7" delay={0.08}>
              <span className="lp-bento-icon"><i className="ri-download-2-line" aria-hidden /></span>
              <h3 className="lp-bento-title">Your deck is never locked in</h3>
              <p className="lp-bento-text">
                Study in DeepHaus on web and mobile, or export a real <code>.apkg</code> file any time and keep going
                in Anki desktop or AnkiMobile. Existing Anki decks and Quizlet sets import right in.
              </p>
              <div className="lp-bento-visual">
                <div className="lp-export-file">
                  <span className="lp-export-file-icon"><i className="ri-archive-2-line" aria-hidden /></span>
                  <span className="lp-export-file-meta">
                    <span className="lp-export-file-name">cardiology_block_3.apkg</span>
                    <span className="lp-export-file-size">248 cards · ready to download</span>
                  </span>
                  <i className="ri-download-line" aria-hidden />
                </div>
              </div>
            </Reveal>

            <Reveal className="lp-bento-cell lp-span-6" delay={0.05}>
              <span className="lp-bento-icon"><i className="ri-team-line" aria-hidden /></span>
              <h3 className="lp-bento-title">Community decks</h3>
              <p className="lp-bento-text">
                Publish a deck you&apos;re proud of, or subscribe to one someone else already perfected — updates flow
                to subscribers automatically.
              </p>
              <div className="lp-bento-visual">
                <div className="lp-community-stack">
                  <span className="lp-community-deck"><i className="ri-stack-line" aria-hidden /> USMLE Step 1</span>
                  <span className="lp-community-deck"><i className="ri-stack-line" aria-hidden /> JLPT N3 Kanji</span>
                  <span className="lp-community-deck"><i className="ri-stack-line" aria-hidden /> AWS SAA</span>
                </div>
              </div>
            </Reveal>

            <Reveal className="lp-bento-cell lp-span-6" delay={0.08}>
              <span className="lp-bento-icon"><i className="ri-inbox-unarchive-line" aria-hidden /></span>
              <h3 className="lp-bento-title">Bring sources from anywhere</h3>
              <p className="lp-bento-text">
                Plain text, PDFs, YouTube transcripts, Notion pages, a topic prompt, an Anki deck, or a Quizlet set —
                every source becomes the same kind of studyable deck.
              </p>
              <div className="lp-bento-visual">
                <div className="lp-source-icons">
                  {sourceIcons.map((icon) => (
                    <span className="lp-source-icon" key={icon.icon} title={icon.label}>
                      <i className={icon.icon} aria-hidden />
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ FAQ */}
      <section id="faq" className="lp-faq lp-section">
        <div className="lp-container">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow">
              <i className="ri-question-answer-line" aria-hidden />
              FAQ
            </span>
            <h2 className="lp-section-title">Questions, answered</h2>
          </Reveal>
          <Reveal>
            <div className="lp-faq-list">
              {faqs.map((f) => (
                <details key={f.q} className="lp-faq-item">
                  <summary className="lp-faq-q">
                    {f.q}
                    <i className="ri-add-line" aria-hidden />
                  </summary>
                  <div className="lp-faq-a">{f.a}</div>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ Final CTA */}
      <section className="lp-cta">
        <div className="lp-container">
          <Reveal>
            <div className="lp-cta-panel">
              <div className="lp-cta-glow" aria-hidden />
              <h2 className="lp-cta-title">The best time to review was yesterday.</h2>
              <p className="lp-cta-sub">
                The second best time is right after you paste your notes. Your first deck is about a minute away.
              </p>
              <Link href={primaryHref} className="btn lp-btn-lg lp-cta-btn">
                Start studying free <i className="ri-arrow-right-line" aria-hidden />
              </Link>
              <span className="lp-cta-note">No credit card required · Manual study stays free</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ Footer */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-brand">
              <span className="lp-footer-brand-row">
                <BrandMark size={26} />
                <span>DeepHaus</span>
              </span>
              <p className="lp-footer-blurb">
                AI-powered flashcards with adaptive spaced repetition — study smarter on web and mobile, export to Anki
                whenever you like.
              </p>
            </div>
            <div className="lp-footer-col">
              <h4 className="lp-footer-col-title">Product</h4>
              <Link href="#how" className="lp-footer-link">How it works</Link>
              <Link href="#features" className="lp-footer-link">Features</Link>
              <Link href="/pricing" className="lp-footer-link">Pricing</Link>
              <Link href="#faq" className="lp-footer-link">FAQ</Link>
            </div>
            <div className="lp-footer-col">
              <h4 className="lp-footer-col-title">Get started</h4>
              <Link href="/signup" className="lp-footer-link">Create an account</Link>
              <Link href="/login" className="lp-footer-link">Sign in</Link>
              <Link href={primaryHref} className="lp-footer-link">Make a deck</Link>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span className="lp-footer-copy">© {new Date().getFullYear()} DeepHaus. All rights reserved.</span>
            <span className="lp-footer-tag">
              <i className="ri-heart-3-fill" aria-hidden /> Built for people with too much to remember
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const sources = [
  { icon: "ri-file-text-line", label: "Lecture notes" },
  { icon: "ri-file-pdf-2-line", label: "PDF textbooks" },
  { icon: "ri-youtube-line", label: "YouTube transcripts" },
  { icon: "ri-booklet-line", label: "Notion pages" },
  { icon: "ri-slideshow-3-line", label: "Slide decks" },
  { icon: "ri-lightbulb-flash-line", label: "A topic prompt" },
  { icon: "ri-archive-2-line", label: "Existing Anki decks" },
  { icon: "ri-file-copy-2-line", label: "Quizlet sets" },
  { icon: "ri-image-2-line", label: "Diagrams & figures" },
];

const steps = [
  {
    icon: "ri-clipboard-line",
    title: "Paste your material",
    body: "Notes, a PDF chapter, a transcript, a Notion page — or just name a topic and let DeepHaus draft from scratch.",
  },
  {
    icon: "ri-sparkling-2-line",
    title: "Review the generated deck",
    body: "The AI extracts the concepts worth remembering and writes the cards. Edit, delete, or regenerate any of them before you commit.",
  },
  {
    icon: "ri-calendar-check-line",
    title: "Show up daily, briefly",
    body: "The scheduler queues exactly what's due. Most days that's a few minutes — the algorithm handles the long game.",
  },
];

const intervals = ["Today", "1d", "3d", "7d", "16d", "35d"];

// 30-day cram heatmap ramping toward the exam (0 = rest day, 3 = max).
const heatmap = [
  0, 1, 0, 0, 1, 0, 1, 0, 1, 1,
  0, 1, 1, 1, 0, 1, 1, 2, 1, 2,
  2, 2, 2, 3, 2, 3, 3, 3, 3, 3,
];

const sourceIcons = [
  { icon: "ri-file-text-line", label: "Plain text" },
  { icon: "ri-file-pdf-2-line", label: "PDF" },
  { icon: "ri-youtube-line", label: "YouTube" },
  { icon: "ri-booklet-line", label: "Notion" },
  { icon: "ri-lightbulb-flash-line", label: "Topic prompt" },
  { icon: "ri-archive-2-line", label: "Anki & Quizlet import" },
];

const faqs = [
  {
    q: "What can I turn into flashcards?",
    a: "Plain text, PDFs, YouTube transcripts, Notion pages, and topic prompts work today. You can also import an existing Anki deck or a Quizlet export.",
  },
  {
    q: "Do I have to give up Anki?",
    a: "No — DeepHaus speaks Anki natively. Study here on web and mobile, or export any deck as a .apkg file and continue in Anki desktop or AnkiMobile. Your cards are never locked in.",
  },
  {
    q: "How does the scheduling actually work?",
    a: "After each card you tap Again, Hard, Good, or Easy. An FSRS-style algorithm uses your history to predict when you're about to forget, and schedules the next review just before that point — so intervals grow for strong cards and shrink for weak ones.",
  },
  {
    q: "What if my exam is next week?",
    a: "Create a cram plan with the exam date and DeepHaus builds a compressed schedule that front-loads reviews so everything peaks on the day. Your regular long-term queue stays intact.",
  },
  {
    q: "Can I edit what the AI writes?",
    a: "Always. Generated cards land in a review screen where you can rewrite, delete, or regenerate any card — including rich text, LaTeX, and cloze deletions — before they enter your study queue.",
  },
  {
    q: "How much does it cost?",
    a: "Basic is free and includes manual card creation, adaptive FSRS study, and 250 monthly AI credits. Plus is C$9.99/month or C$99.99/year with 3,000 credits; Pro is C$19.99/month or C$199.99/year with 8,000 credits.",
  },
];
