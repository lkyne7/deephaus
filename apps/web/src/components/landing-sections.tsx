"use client";

import Link from "next/link";
import { StaggerItem, StaggerList } from "@/components/motion/stagger-list";
import { FadeIn } from "@/components/motion/fade-in";

type Feature = { icon: string; title: string; body: string };
type Step = { title: string; body: string };

export function LandingHero({
  user,
  heroSubStyle,
  styles,
}: {
  user: boolean;
  heroSubStyle: React.CSSProperties;
  styles: {
    hero: React.CSSProperties;
    heroGlow: React.CSSProperties;
    heroInner: React.CSSProperties;
    eyebrow: React.CSSProperties;
  };
}) {
  return (
    <section style={styles.hero}>
      <div style={styles.heroGlow} />
      <FadeIn style={styles.heroInner}>
        <span style={styles.eyebrow}>AI-Powered Spaced Repetition</span>
        <h1 className="display-lg" style={{ maxWidth: 760 }}>
          Learn More, Study Less.
        </h1>
        <p className="text-lg" style={heroSubStyle}>
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
      </FadeIn>
    </section>
  );
}

export function LandingFeatureGrid({
  features,
  styles,
}: {
  features: Feature[];
  styles: {
    section: React.CSSProperties;
    sectionInner: React.CSSProperties;
    featureGrid: React.CSSProperties;
    featureCard: React.CSSProperties;
    featureIcon: React.CSSProperties;
  };
}) {
  return (
    <section id="features" style={styles.section}>
      <div style={styles.sectionInner}>
        <FadeIn>
          <h2 className="display-sm" style={{ textAlign: "center", marginBottom: 12 }}>
            Get Instant Study Materials
          </h2>
          <p style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 56px", color: "var(--fg-tertiary)" }}>
            Three steps from a wall of notes to a study session that adapts to what you actually need to review.
          </p>
        </FadeIn>
        <StaggerList style={styles.featureGrid}>
          {features.map((f) => (
            <StaggerItem key={f.title} style={styles.featureCard}>
              <span style={styles.featureIcon}>
                <i className={f.icon} />
              </span>
              <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--fg-primary)", margin: 0 }}>{f.title}</h3>
              <p style={{ color: "var(--fg-tertiary)", font: "400 14px/22px var(--font-sans)", margin: 0 }}>{f.body}</p>
            </StaggerItem>
          ))}
        </StaggerList>
      </div>
    </section>
  );
}

export function LandingSteps({
  steps,
  styles,
}: {
  steps: Step[];
  styles: {
    section: React.CSSProperties;
    sectionInner: React.CSSProperties;
    steps: React.CSSProperties;
    step: React.CSSProperties;
    stepNum: React.CSSProperties;
  };
}) {
  return (
    <section id="how" style={styles.section}>
      <div style={styles.sectionInner}>
        <FadeIn>
          <h2 className="display-sm" style={{ textAlign: "center", marginBottom: 56 }}>
            From Text to Studying in Three Steps
          </h2>
        </FadeIn>
        <StaggerList style={styles.steps}>
          {steps.map((step, i) => (
            <StaggerItem key={step.title} style={styles.step}>
              <span style={styles.stepNum}>{i + 1}</span>
              <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--fg-primary)", margin: 0 }}>{step.title}</h3>
              <p style={{ color: "var(--fg-tertiary)", font: "400 14px/22px var(--font-sans)", margin: 0 }}>{step.body}</p>
            </StaggerItem>
          ))}
        </StaggerList>
      </div>
    </section>
  );
}
