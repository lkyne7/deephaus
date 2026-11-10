import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HeroStudyDemo } from "@/components/landing/hero-study-demo";
import { GenerationDemo } from "@/components/landing/generation-demo";
import { Reveal } from "@/components/landing/reveal";
import { MarketingFooter, MarketingNav } from "@/components/landing/marketing-chrome";
import { PlatformCards } from "@/components/landing/platform-cards";
import { IOS_APP } from "@/lib/apps";
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
      <MarketingNav user={user} current="home" />

      {/* ------------------------------------------------ Hero */}
      <header className="lp-hero">
        <div className="lp-container">
          <div className="lp-hero-inner">
            <FadeIn className="lp-hero-copy">
              <h1 className="lp-headline">
                Your notes already know <em className="lp-headline-accent">what to ask you.</em>
              </h1>
              <p className="lp-hero-sub">
                Paste notes, a PDF or a lecture transcript. DeepHaus turns it into a deck and schedules every review,
                so the right card shows up at the right moment.
              </p>
              <div className="lp-hero-ctas">
                <Link href={primaryHref} className="btn btn-primary lp-btn-lg">
                  Create your first deck
                </Link>
                <Link href="#how" className="btn btn-secondary lp-btn-lg">
                  See how it works
                </Link>
              </div>
              <p className="lp-hero-trust">
                <span>Free plan, no credit card</span>
                <span>Anki and Quizlet import</span>
                <span>Web, desktop and iPhone</span>
              </p>
            </FadeIn>
            <FadeIn delay={0.12}>
              <HeroStudyDemo />
            </FadeIn>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------ Sources */}
      <section className="lp-strip" aria-label="Supported study sources">
        <div className="lp-strip-chips">
          {sources.map((label) => (
            <span className="lp-strip-chip" key={label}>{label}</span>
          ))}
        </div>
      </section>

      <section className="lp-container lp-pillars" aria-label="What DeepHaus does">
        {pillars.map((pillar) => (
          <div key={pillar.title}>
            <h3 className="lp-pillar-title">{pillar.title}</h3>
            <p className="lp-pillar-text">{pillar.body}</p>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------ How it works */}
      <section id="how" className="lp-how lp-section">
        <div className="lp-container">
          <Reveal className="lp-section-head">
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
            <h2 className="lp-section-title">Everything between &ldquo;I have notes&rdquo; and &ldquo;I know this&rdquo;</h2>
            <p className="lp-section-sub">
              A full study system, with generation, scheduling, cramming and sharing, that still plays nicely with
              the Anki ecosystem you may already use.
            </p>
          </Reveal>

          <div className="lp-bento">
            <Reveal className="lp-bento-cell lp-span-7">
              <span className="lp-bento-icon"><i className="ri-brain-line" aria-hidden /></span>
              <h3 className="lp-bento-title">A scheduler that learns you</h3>
              <p className="lp-bento-text">
                Rate each card Again, Hard, Good, or Easy. FSRS-7, the latest open scheduling model, stretches intervals
                for what you know and tightens them for what keeps slipping, so every session is spent where it counts.
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
                Tell it what you need in a chat. It reads your material and drafts short, one-idea cards, front/back or
                fill-in-the-blank, that you can edit before studying.
              </p>
              <div className="lp-bento-visual">
                <div className="lp-chip-row">
                  <span className="dh-pill dh-pill--accent">Front / Back</span>
                  <span className="dh-pill">Fill in the blank</span>
                </div>
              </div>
            </Reveal>

            <Reveal className="lp-bento-cell lp-span-5" delay={0.05}>
              <span className="lp-bento-icon"><i className="ri-fire-line" aria-hidden /></span>
              <h3 className="lp-bento-title">Cram mode for deadlines</h3>
              <p className="lp-bento-text">
                Exam on Friday? Build a cram plan and DeepHaus front-loads the schedule so everything is fresh on the
                day, without wrecking your long-term queue.
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
                              : `color-mix(in srgb, var(--accent) ${18 + v * 20}%, var(--bg-surface-2))`,
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
                Study in DeepHaus on web, desktop and iPhone, or export a real <code>.apkg</code> file any time and keep going
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
                Publish a deck you&apos;re proud of, or add one someone else already perfected. When the author
                updates it, your copy follows and your progress stays.
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
                Plain text, PDFs, YouTube transcripts, Notion pages, a topic prompt, an Anki deck, or a Quizlet set.
                Every source becomes the same kind of studyable deck.
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

      {/* ------------------------------------------------ Apps */}
      <section id="apps" className="lp-apps-section lp-section">
        <div className="lp-container">
          <Reveal className="lp-section-head">
            <h2 className="lp-section-title">One account, every device</h2>
            <p className="lp-section-sub">
              Make a deck on your laptop, review it on the bus. Your cards, schedule and progress stay in sync.
            </p>
          </Reveal>
          <Reveal>
            <PlatformCards webHref={user ? "/dashboard" : "/signup"} />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ FAQ */}
      <section id="faq" className="lp-faq lp-section">
        <div className="lp-container">
          <Reveal className="lp-section-head">
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
              <h2 className="lp-cta-title">The best time to review was yesterday.</h2>
              <p className="lp-cta-sub">
                The second best time is right after you paste your notes. Your first deck is about a minute away.
              </p>
              <Link href={primaryHref} className="btn btn-primary lp-btn-lg">
                Start studying free
              </Link>
              <span className="lp-cta-note">No credit card required · Manual study stays free</span>
            </div>
          </Reveal>
        </div>
      </section>

      <MarketingFooter user={user} />
    </div>
  );
}

const sources = [
  "Lecture notes",
  "PDF textbooks",
  "YouTube transcripts",
  "Notion pages",
  "Slide decks",
  "A topic prompt",
  "Existing Anki decks",
  "Quizlet sets",
  "Diagrams and figures",
];

const pillars = [
  { title: "Bring anything", body: "Documents, websites, videos, Notion pages or a single topic." },
  { title: "Shape it in conversation", body: "Ask for more cards, fix the tone, or add another source." },
  { title: "Remember it for good", body: "FSRS-7 schedules each card right before you would forget it." },
];

const steps = [
  {
    icon: "ri-clipboard-line",
    title: "Paste your material",
    body: "Notes, a PDF chapter, a transcript, a Notion page, or just name a topic and let DeepHaus draft from scratch.",
  },
  {
    icon: "ri-sparkling-2-line",
    title: "Review the generated deck",
    body: "The AI pulls out the concepts worth remembering and writes one idea per card. Ask for more, change the style, or edit any card in the chat.",
  },
  {
    icon: "ri-calendar-check-line",
    title: "Show up daily, briefly",
    body: "The scheduler queues exactly what's due. Most days that's a few minutes. The algorithm handles the long game.",
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
    a: "No. DeepHaus speaks Anki natively. Study here on web, desktop and iPhone, or export any deck as a .apkg file and continue in Anki desktop or AnkiMobile. Your cards are never locked in.",
  },
  {
    q: "How does the scheduling actually work?",
    a: "After each card you tap Again, Hard, Good, or Easy. FSRS-7 uses your history to predict when you're about to forget, and schedules the next review just before that point, so intervals grow for strong cards and shrink for weak ones.",
  },
  {
    q: "What if my exam is next week?",
    a: "Create a cram plan with the exam date and DeepHaus builds a compressed schedule that front-loads reviews so everything peaks on the day. Your regular long-term queue stays intact.",
  },
  {
    q: "Can I edit what the AI writes?",
    a: "Always. Generated cards appear beside the chat, where you can rewrite, delete, or regenerate any card, including rich text, LaTeX and cloze deletions, before they enter your study queue.",
  },
  {
    q: "Which devices can I use?",
    a: `Any modern browser, plus desktop apps for macOS, Windows and Linux that work offline. ${
      IOS_APP.available ? "The iPhone and iPad app is on the App Store." : "The iPhone and iPad app is coming to the App Store soon."
    } One account keeps your decks and reviews in sync everywhere.`,
  },
  {
    q: "Can I use my own Claude or ChatGPT plan?",
    a: "Yes, in the desktop app. If you already have Claude Code or Codex installed and signed in, DeepHaus can generate cards through it instead of spending AI credits. On the web and phone, generation uses your monthly credits.",
  },
  {
    q: "Does it work with my AI assistant?",
    a: "On Pro, you can connect DeepHaus to ChatGPT, Claude or Cursor to save cards from a conversation and get quizzed on what's due. See the integrations page for setup.",
  },
  {
    q: "How much does it cost?",
    a: "Basic is free and includes manual card creation, adaptive FSRS study, and 250 monthly AI credits. Plus is C$9.99/month or C$99.99/year with 3,000 credits; Pro is C$19.99/month or C$199.99/year with 8,000 credits.",
  },
];
